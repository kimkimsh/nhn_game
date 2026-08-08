/**
 * 발사체 — 풀, 적분, 발사. 스펙 §6 · §7.1, 05_시스템_설계.md §1의 8번.
 *
 * 적 탄환과 반사탄이 같은 구조체를 쓰고 owner 한 칸으로 갈린다. 스펙 §7.4가 "날아오는 위험한
 * 것은 전부 쳐낼 수 있다"로 규칙을 하나로 묶었으므로, 타입을 둘로 가르면 패리 판정이 두 갈래가
 * 되고 그 순간 재패리가 예외 처리가 된다.
 *
 * 풀은 둘이다. 상한의 처리 방식이 서로 다르고(05 §2), 반사탄만 "가장 오래된 것부터"라는 순서
 * 규칙을 갖는다 — 한 풀에 섞으면 그 순서가 적 탄환의 생성 순서에 오염된다. 그 대신 패리가
 * 성립할 때 슬롯을 옮기는 복사가 한 번 든다(convertToReflect).
 *
 * 적분이 releaseWhere 안에서 도는 것은 한 번의 순회로 이동·수명·경계 소멸을 함께 끝내고
 * 활성 목록의 순서를 지키기 위해서다. 순서가 곧 반사탄 상한의 규칙이다.
 */
import { BULLETS } from '../config/bullets';
import { STAGE_SCALING } from '../config/difficulty';
import type { BulletId, ParryGradeId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import { TELEGRAPH } from '../config/telegraph';
import type { BulletDef } from '../config/types';
import { clamp } from '../core/math';
import { createPool, type Pool } from '../core/pool';
import { aimAt, distance, distanceSq, lengthOf } from '../core/vec';
import { acquireReflectSlot, canFireEnemyBullet } from './caps';
import type { World } from './world';

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_RAD = Math.PI * 2;
/** 적 탄환은 수명으로 사라지지 않는다 — 경계를 벗어나는 것이 유일한 소멸 경로다(§6.1) */
const NO_LIFETIME_SEC = Number.POSITIVE_INFINITY;
/** §5.2 C4의 "아직 패리되지 않았다". 어떤 활성 구간 ID와도 같지 않은 값이어야 한다 */
const NEVER_PARRIED_SESSION = 0;

export type ProjectileOwner = 'enemy' | 'player';

export interface Projectile {
  bulletId: BulletId;
  /** §7.1 소유권. 반사탄은 적과 플레이어 양쪽에 판정된다(HR-07) */
  owner: ProjectileOwner;
  xU: number;
  yU: number;
  /** 05 §1의 8번이 남기는 값. 10번의 상대 변위 스윕이 여기서 선분을 만든다 */
  prevXU: number;
  prevYU: number;
  vxUPerSec: number;
  vyUPerSec: number;
  radiusU: number;
  /** §7.2의 1번. 재패리해도 데미지는 언제나 이 값에서 다시 시작한다 */
  brp: number;
  isParryable: boolean;
  /** §6.1 P11. 반사되는 순간 0이 된다 — 그 한 줄이 없으면 쳐낸 탄이 플레이어를 쫓아온다 */
  homingRemainingSec: number;
  homingTurnRateDegPerSec: number;
  homingExitSpeedUPerSec: number;
  /** §7.1 반사탄 수명. 적 탄환은 값이 없다 */
  lifeRemainingSec: number;
  /** §7.1 자해 유예. 0보다 크면 피격 판정도 패리 판정도 하지 않는다 */
  graceRemainingSec: number;
  /** §5.2 C4. 같은 활성 구간에서 반사 → 즉시 재패리가 무한 반복되는 것을 막는다 */
  parriedSessionId: number;
  /** §7.4 직전 등급. reparry 사건이 등급이 올랐는지를 이 값으로 가른다 */
  lastGrade: ParryGradeId | null;
  /**
   * §15.1 이 탄이 다시 쳐내진 횟수. render가 탄 옆에 `재N` 라벨로 적는다
   * (`render/bullet.ts`의 `drawReparryLabels` · 목업 `engine.js:280`).
   * 소유권이 적으로 돌아가면 0이다 — 새 탄이지 같은 탄의 이력이 아니다.
   */
  reparryCount: number;
  /** §7.2 6번까지 끝난 값. 명중 시점에 다시 계산하지 않는다 */
  damage: number;
  pierceRemaining: number;
  /** 태어난 뒤 흐른 sim 시간 (s). 06 §1.4의 P4 자체 회전이 이 값에서 유도된다 */
  ageSec: number;
}

function createProjectile(): Projectile {
  return {
    bulletId: 'P1',
    owner: 'enemy',
    xU: 0,
    yU: 0,
    prevXU: 0,
    prevYU: 0,
    vxUPerSec: 0,
    vyUPerSec: 0,
    radiusU: 0,
    brp: 0,
    isParryable: false,
    homingRemainingSec: 0,
    homingTurnRateDegPerSec: 0,
    homingExitSpeedUPerSec: 0,
    lifeRemainingSec: NO_LIFETIME_SEC,
    graceRemainingSec: 0,
    parriedSessionId: NEVER_PARRIED_SESSION,
    lastGrade: null,
    reparryCount: 0,
    damage: 0,
    pierceRemaining: 0,
    ageSec: 0,
  };
}

function resetProjectile(projectile: Projectile): void {
  projectile.owner = 'enemy';
  projectile.homingRemainingSec = 0;
  projectile.lifeRemainingSec = NO_LIFETIME_SEC;
  projectile.graceRemainingSec = 0;
  projectile.parriedSessionId = NEVER_PARRIED_SESSION;
  projectile.lastGrade = null;
  projectile.reparryCount = 0;
  projectile.damage = 0;
  projectile.pierceRemaining = 0;
  projectile.ageSec = 0;
}

export function createEnemyBulletPool(stageId: World['stageId']): Pool<Projectile> {
  return createPool({
    capacity: STAGE_SCALING[stageId].maxEnemyBullets,
    create: createProjectile,
    reset: resetProjectile,
  });
}

export function createReflectBulletPool(): Pool<Projectile> {
  return createPool({
    capacity: PLAYFIELD.maxReflectBullets,
    create: createProjectile,
    reset: resetProjectile,
  });
}

/** §14.1 실제 탄속 = 표의 기본 속도 × 스테이지 배율. 판정에 쓰는 값은 언제나 이쪽이다 */
export function bulletSpeedUPerSec(world: World, bulletId: BulletId): number {
  return BULLETS[bulletId].speedUPerSec * STAGE_SCALING[world.stageId].bulletSpeedMul;
}

export interface EnemyShot {
  readonly bulletId: BulletId;
  readonly xU: number;
  readonly yU: number;
  readonly angleRad: number;
  /**
   * 예고 도형이 붙은 발사인가. HR-09의 조문이 "예고 표시가 없는 탄환은"으로 시작하므로
   * 예고가 붙은 것은 억제 대상이 아니다 — 억제하면 근거리 위협을 담당하는 수단이 통째로 사라진다.
   */
  readonly hasTelegraph: boolean;
  /**
   * 이 발사의 실효 탄속 (u/s). 생략하면 §14.1의 표 × 스테이지 배율이다.
   *
   * **HR-09가 재는 것은 실제 탄속이다**(스펙 §6.2). 속도를 바꾸는 패턴(§10.2 일제사격 강화의
   * speedMul, §10.5 불화살 비의 speedUPerSec)에서 표 속도로 억제 거리를 재면, 빠른 쪽은 억제
   * 되어야 할 발사가 통과하고 느린 쪽은 비행 시간이 0.45초를 넘는데도 취소된다.
   */
  readonly speedUPerSec?: number;
}

/**
 * 05 §1의 6번이 부르는 유일한 발사 경로. 만들지 못한 경우를 null로 돌려주고, 그 null이
 * §3.2의 억제와 HR-09의 취소 둘 다를 뜻한다 — 어느 쪽이든 이번 발사는 취소되고 다음 주기를
 * 기다린다는 결과가 같다.
 */
export function fireEnemyBullet(world: World, shot: EnemyShot): Projectile | null {
  if (!canFireEnemyBullet(world)) {
    return null;
  }
  const speedUPerSec = shot.speedUPerSec ?? bulletSpeedUPerSec(world, shot.bulletId);
  if (!shot.hasTelegraph) {
    const toPlayerU = distance(shot.xU, shot.yU, world.player.xU, world.player.yU);
    if (toPlayerU < speedUPerSec * TELEGRAPH.minFlightSec) {
      return null;
    }
  }

  const projectile = world.enemyBullets.acquire();
  if (projectile === null) {
    return null;
  }
  // as const satisfies가 남긴 리터럴 타입에는 P11에만 있는 homing 칸이 없다. 표의 계약 타입으로
  // 넓혀야 열 하나가 선택 필드라는 사실이 여기서 읽힌다
  const def: BulletDef = BULLETS[shot.bulletId];
  projectile.bulletId = shot.bulletId;
  projectile.xU = shot.xU;
  projectile.yU = shot.yU;
  projectile.prevXU = shot.xU;
  projectile.prevYU = shot.yU;
  projectile.vxUPerSec = Math.cos(shot.angleRad) * speedUPerSec;
  projectile.vyUPerSec = Math.sin(shot.angleRad) * speedUPerSec;
  projectile.radiusU = def.radiusU;
  projectile.brp = def.brp;
  projectile.isParryable = def.isParryable;
  const homing = def.homing;
  if (homing !== undefined) {
    projectile.homingRemainingSec = homing.durationSec;
    projectile.homingTurnRateDegPerSec = homing.turnRateDegPerSec;
    projectile.homingExitSpeedUPerSec =
      homing.exitSpeedUPerSec * STAGE_SCALING[world.stageId].bulletSpeedMul;
  }
  return projectile;
}

/**
 * 적 탄환 슬롯을 반사탄 슬롯으로 옮긴다. 두 풀이 갈려 있는 대가가 이 복사 한 번이다.
 * 반사탄 쪽은 실패할 수 없으므로(§3.2) 여유가 없으면 가장 오래된 반사탄이 회수된다.
 */
export function convertToReflect(world: World, source: Projectile): Projectile {
  const target = acquireReflectSlot(world);
  target.bulletId = source.bulletId;
  target.xU = source.xU;
  target.yU = source.yU;
  target.prevXU = source.prevXU;
  target.prevYU = source.prevYU;
  target.vxUPerSec = source.vxUPerSec;
  target.vyUPerSec = source.vyUPerSec;
  target.radiusU = source.radiusU;
  target.brp = source.brp;
  target.isParryable = source.isParryable;
  world.enemyBullets.release(source);
  return target;
}

/**
 * §11.4 R03. 반사탄이 쫓아갈 자리 — 가장 가까운 적. 하나도 없으면 null이고 그 스텝은 직진한다.
 * 보스도 후보에 넣는 것은 보스전에 잡몹이 없는 페이즈가 있어서다 — 그 구간에서 카드가 죽는다.
 */
function nearestTargetRad(world: World, projectile: Projectile): number | null {
  let bestSqU = Number.POSITIVE_INFINITY;
  let bestXU = 0;
  let bestYU = 0;
  for (const enemy of world.enemies.active) {
    const distSqU = distanceSq(projectile.xU, projectile.yU, enemy.xU, enemy.yU);
    if (distSqU < bestSqU) {
      bestSqU = distSqU;
      bestXU = enemy.xU;
      bestYU = enemy.yU;
    }
  }
  const boss = world.boss;
  if (boss !== null && !boss.isFinished) {
    const distSqU = distanceSq(projectile.xU, projectile.yU, boss.xU, boss.yU);
    if (distSqU < bestSqU) {
      bestSqU = distSqU;
      bestXU = boss.xU;
      bestYU = boss.yU;
    }
  }
  if (bestSqU === Number.POSITIVE_INFINITY) {
    return null;
  }
  return aimAt(projectile.xU, projectile.yU, bestXU, bestYU);
}

/**
 * 유도의 대상이 소유권으로 갈린다. 적 탄환은 플레이어를, 반사탄은 가장 가까운 적을 쫓는다 —
 * 원래 탄이 들고 있던 유도는 소유권이 뒤집히는 순간 사라지고(sim/reflect.ts), 반사탄에 다시
 * 붙는 경로는 카드 R03 하나뿐이다. 대상을 바꾸지 않으면 쳐낸 탄이 플레이어를 쫓아온다.
 */
function steerHoming(projectile: Projectile, world: World, dtSec: number): void {
  if (projectile.homingRemainingSec <= 0) {
    return;
  }
  const speedUPerSec = lengthOf(projectile.vxUPerSec, projectile.vyUPerSec);
  const towardRad =
    projectile.owner === 'enemy'
      ? aimAt(projectile.xU, projectile.yU, world.player.xU, world.player.yU)
      : nearestTargetRad(world, projectile);
  if (towardRad === null) {
    projectile.homingRemainingSec -= dtSec;
    return;
  }
  const desiredRad = towardRad;
  const currentRad = Math.atan2(projectile.vyUPerSec, projectile.vxUPerSec);
  // 각 차이를 [-π, π]로 접지 않으면 한 바퀴 돌아가는 쪽으로 선회한다
  let deltaRad = (desiredRad - currentRad) % FULL_TURN_RAD;
  if (deltaRad > Math.PI) {
    deltaRad -= FULL_TURN_RAD;
  } else if (deltaRad < -Math.PI) {
    deltaRad += FULL_TURN_RAD;
  }
  const maxTurnRad = projectile.homingTurnRateDegPerSec * DEG_TO_RAD * dtSec;
  const nextRad = currentRad + clamp(deltaRad, -maxTurnRad, maxTurnRad);

  projectile.homingRemainingSec -= dtSec;
  // 유도가 끝나는 스텝에 직진 속도로 갈아탄다(§6.1). 갈아타기 전 각도를 그대로 물려받는다
  const nextSpeedUPerSec =
    projectile.homingRemainingSec <= 0 ? projectile.homingExitSpeedUPerSec : speedUPerSec;
  projectile.vxUPerSec = Math.cos(nextRad) * nextSpeedUPerSec;
  projectile.vyUPerSec = Math.sin(nextRad) * nextSpeedUPerSec;
}

function isOutOfBounds(projectile: Projectile): boolean {
  const marginU = PLAYFIELD.despawnMarginU;
  return (
    projectile.xU < -marginU ||
    projectile.xU > PLAYFIELD.widthU + marginU ||
    projectile.yU < -marginU ||
    projectile.yU > PLAYFIELD.heightU + marginU
  );
}

/**
 * §11.4 R07. 속도 자체를 깎지 않고 이동량에만 곱한다 — 속도를 고쳐 두면 되돌릴 값이 없어져
 * 0.35초가 끝난 뒤에도 그 탄만 영원히 느리다. 반사탄은 대상이 아니다.
 */
function slowMulFor(projectile: Projectile, world: World): number {
  if (projectile.owner !== 'enemy' || world.simTimeSec >= world.run.enemyBulletSlowUntilSec) {
    return 1;
  }
  return world.run.enemyBulletSlowMul;
}

function integrateOne(projectile: Projectile, world: World, dtSec: number): boolean {
  projectile.prevXU = projectile.xU;
  projectile.prevYU = projectile.yU;
  steerHoming(projectile, world, dtSec);
  const moveSec = dtSec * slowMulFor(projectile, world);
  projectile.xU += projectile.vxUPerSec * moveSec;
  projectile.yU += projectile.vyUPerSec * moveSec;
  projectile.lifeRemainingSec -= dtSec;
  projectile.ageSec += dtSec;
  return projectile.lifeRemainingSec <= 0 || isOutOfBounds(projectile);
}

/**
 * 05 §1의 8번. 9번이 적분 **후** 위치로 등급을 매기고 10번이 이전 위치로 선분을 만들므로,
 * 이 함수가 두 단계보다 먼저 돌아야 하고 이전 위치를 남겨야 한다.
 */
export function integrateProjectiles(world: World, dtSec: number): void {
  world.enemyBullets.releaseWhere((projectile) => integrateOne(projectile, world, dtSec));
  world.reflectBullets.releaseWhere((projectile) => integrateOne(projectile, world, dtSec));
}

/**
 * 05 §1의 1번 중 자해 유예 몫. 적 탄환은 유예를 갖지 않으므로 반사탄만 훑는다.
 * 수명과 달리 여기 있는 것은 유예가 판정 자격이고 8번의 적분 결과가 아니기 때문이다.
 */
export function decayReflectGrace(world: World, dtSec: number): void {
  for (const projectile of world.reflectBullets.active) {
    if (projectile.graceRemainingSec > 0) {
      projectile.graceRemainingSec -= dtSec;
    }
  }
}
