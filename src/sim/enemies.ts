/**
 * 잡몹 — 아키타입 행동 6종 · 발사 주기 · HR-09 억제. 스펙 §8.1, 05_시스템_설계.md §6.
 * 05 §1의 5번(적 스폰)과 6번(적 행동·발사)이 이 파일이다.
 *
 * `config/enemies.ts`의 behavior 열이 행동을 고르고 `sim/formations.ts`가 진입 궤적을 준다.
 * 여기 있는 것은 「진입이 끝난 뒤 무엇을 하는가」와 「언제 쏘는가」 둘뿐이다.
 *
 * **스폰 경로는 이 파일의 두 함수뿐이다.** 아래 EnemyRuntime은 world.ts의 Enemy가 아직 갖지
 * 않는 행동 상태이고, 그 둘이 개체마다 채운다. 다른 곳에서 caps.ts의 acquireEnemySlot을 직접
 * 불러 적을 세우면 행동 상태가 없어 stepEnemies가 그 개체를 건너뛴다 — 화면에는 있고 아무것도
 * 하지 않는 적이 된다. 상태를 Enemy에 직접 얹지 않고 곁 표에 두는 것은 소유권 때문이고,
 * world.ts가 이 열들을 흡수하면 여기서 사라지는 것은 WeakMap 하나다.
 *
 * **이동 속도에는 스테이지 배율이 없다**(A16). 배율은 탄속에만 걸린다 — 여기서 곱하면 §14.2의
 * 난이도 축이 다섯에서 여섯이 되고 §14.4의 검산표가 다루지 않는 축이 생긴다.
 *
 * 발사 주기는 05 §1의 1번이 훑는 타이머 목록에 없다. 이 파일이 6번 자리에서 자기 것을 깎는다.
 */
import { STAGE_SCALING } from '../config/difficulty';
import { ENEMIES } from '../config/enemies';
import type { EnemyBehaviorId, EnemyId, FormationId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import { TELEGRAPH } from '../config/telegraph';
import type { EnemyDef } from '../config/types';
import { clamp } from '../core/math';
import { aimAt } from '../core/vec';
import { acquireEnemySlot, canSpawnEnemy } from './caps';
import { advanceCrossPassFire, advanceFireCycle } from './enemy-shots';
import { FIELD_EXIT_MARGIN_U, planEntry, sineOffsetU, type FormationEntry } from './formations';
import { isRetreating, takeDueSpawn } from './waves';
import type { Enemy, World } from './world';

/**
 * 좌우 왕복의 편도 폭 (u). §8.1이 「좌우 왕복」이라고만 적었다.
 * 왕복 한 번이 발사 주기와 비슷한 길이라 궁병이 양 끝에서 번갈아 쏘게 된다.
 */
const STRAFE_HALF_SPAN_U = 180;

/**
 * §9.1 강제 퇴장 속도 (u/s). 아키타입의 이동 속도로는 모자란다 — 가장 느린 화포병은 자기
 * 속도로 화면을 뜨는 데 소강 3초의 열 배가 걸린다.
 */
const FORCED_EXIT_SPEED_U_PER_SEC = 800;

type EnemyPhase = 'entering' | 'stationed';
type ChargeStep = 'idle' | 'telegraph' | 'dashing';

/** 개체 하나의 행동 상태. 쓰는 것은 이 파일뿐이고 render는 예비동작·조준·돌진 예고를 읽는다 */
export interface EnemyRuntime {
  typeId: EnemyId;
  behavior: EnemyBehaviorId;
  phase: EnemyPhase;
  entry: FormationEntry;
  /** 진입 경로에서 이동한 거리 (u). 사인 오프셋과 측면 통과의 발사 시점이 이 값을 읽는다 */
  traveledU: number;
  /** 다음 발사까지 (s). 예비동작 시간을 포함한다 */
  fireTimerSec: number;
  /** 0보다 크면 예비동작 중이다 */
  windupRemainingSec: number;
  windupTotalSec: number;
  /** 조준 단위 벡터. 안 쏘는 개체는 화면 아래를 본다 */
  aimXU: number;
  aimYU: number;
  /** 측면 통과가 이번 통과에서 이미 쏜 횟수 */
  shotsDone: number;
  chargeStep: ChargeStep;
  /** 돌진 방향선이 남은 시간 (s). 0보다 크면 render가 dash 예고를 그린다 */
  telegraphRemainingSec: number;
  dashDirXU: number;
  dashDirYU: number;
  strafeDirX: number;
  strafeCenterXU: number;
}

/** Enemy 슬롯은 풀에서 돌려 쓰이므로 항목 수가 잡몹 상한을 넘지 않는다 */
const runtimeByEnemy = new WeakMap<Enemy, EnemyRuntime>();

/** render와 screens가 예비동작·조준·돌진 예고를 읽는 자리. 이 파일이 세우지 않은 적이면 없다 */
export function enemyRuntimeOf(enemy: Enemy): EnemyRuntime | undefined {
  return runtimeByEnemy.get(enemy);
}

export interface EnemySpawn {
  readonly enemyId: EnemyId;
  readonly formationId: FormationId;
  /** 같은 웨이브가 같은 형태로 내보내는 개체 전부 안의 순번 */
  readonly memberIndex: number;
  readonly memberCount: number;
}

/** 진입 경로 위의 좌표. 사인 오프셋은 진행 방향에 수직이다 */
function applyEntryPosition(enemy: Enemy, runtime: EnemyRuntime): void {
  const entry = runtime.entry;
  const offsetU = sineOffsetU(entry.amplitudeU, runtime.traveledU);
  enemy.xU = entry.spawnXU + entry.dirXU * runtime.traveledU - entry.dirYU * offsetU;
  enemy.yU = entry.spawnYU + entry.dirYU * runtime.traveledU + entry.dirXU * offsetU;
}

/**
 * 한 기를 세운다. absorbEntryDelay가 참이면 진입 지연을 시간이 아니라 거리로 소화한다 —
 * 경로 위에서 그만큼 뒤로 물러난 자리, 즉 활동 영역 밖에서 출발한다.
 */
function spawnPlaced(world: World, spawn: EnemySpawn, absorbEntryDelay: boolean): Enemy | null {
  const enemy = acquireEnemySlot(world);
  if (enemy === null) {
    return null;
  }
  const def: EnemyDef = ENEMIES[spawn.enemyId];
  const entry = planEntry(spawn.formationId, spawn.memberIndex, spawn.memberCount);

  enemy.hitRadiusU = def.hitRadiusU;
  // §8.1 기본 HP × §14.1 스테이지 배율. 내림이라 배율이 반올림 위쪽에서 난이도를 올리지 않는다
  enemy.maxHp = Math.max(1, Math.floor(def.hp * STAGE_SCALING[world.stageId].enemyHpMul));
  enemy.hp = enemy.maxHp;
  enemy.scoreValue = def.score;
  enemy.contactDamage = def.contactDamage;
  enemy.frontShieldIntact = def.frontShield === true;

  const runtime: EnemyRuntime = {
    typeId: spawn.enemyId,
    behavior: def.behavior,
    phase: 'entering',
    entry,
    traveledU: absorbEntryDelay ? -entry.delaySec * def.moveSpeedUPerSec : 0,
    fireTimerSec: def.fireCycleSec,
    windupRemainingSec: 0,
    windupTotalSec: 0,
    aimXU: 0,
    aimYU: 1,
    shotsDone: 0,
    chargeStep: 'idle',
    telegraphRemainingSec: 0,
    dashDirXU: 0,
    dashDirYU: 1,
    strafeDirX: entry.dirXU >= 0 ? 1 : -1,
    strafeCenterXU: entry.spawnXU,
  };
  runtimeByEnemy.set(enemy, runtime);
  applyEntryPosition(enemy, runtime);
  enemy.prevXU = enemy.xU;
  enemy.prevYU = enemy.yU;
  return enemy;
}

/**
 * §3.2 잡몹 상한에 걸리면 null이고, **부르는 쪽이 편성을 그대로 들고 있는다** — 상한 초과는
 * 지연이지 취소가 아니다(05 §2).
 *
 * 진입 지연(FormationEntry.delaySec)은 여기서 세지 않는다. 언제 부를지가 웨이브의 예약이고,
 * planEntry가 순수 함수라 waves.ts가 같은 인자로 미리 읽어도 값이 갈라지지 않는다.
 */
export function spawnEnemy(world: World, spawn: EnemySpawn): Enemy | null {
  return spawnPlaced(world, spawn, false);
}

/**
 * §10.2 연막 돌격처럼 보스가 한 무리를 한꺼번에 부르는 자리. 예약 큐가 없으므로 진입 간격을
 * 거리로 소화한다 — 전원을 같은 자리에서 출발시키면 마지막 한 기가 설 때까지 무리 전체가 한 점에
 * 겹쳐 내려온다. 상한에 걸리면 거기서 멈추고, 다음 순환에서 같은 패턴이 다시 온다.
 */
export function spawnEnemyGroup(
  world: World,
  enemyId: EnemyId,
  formationId: FormationId,
  count: number,
): number {
  let spawned = 0;
  for (let memberIndex = 0; memberIndex < count; memberIndex += 1) {
    const spawn = { enemyId, formationId, memberIndex, memberCount: count };
    if (spawnPlaced(world, spawn, true) === null) {
      break;
    }
    spawned += 1;
  }
  return spawned;
}

/**
 * 05 §1의 5번. 상한에 걸리면 예약을 꺼내지 않고 큐 머리에 남긴다 — 지연이지 취소가 아니다.
 * 6번보다 앞이어야 하고, 그 순서의 근거는 이 스텝에 세운 개체가 아직 진입 중이라 발사 주기를
 * 돌리지 않는다는 것이다.
 */
export function stepEnemySpawns(world: World): void {
  while (canSpawnEnemy(world)) {
    const due = takeDueSpawn(world);
    if (due === null) {
      return;
    }
    spawnEnemy(world, {
      enemyId: due.enemy,
      formationId: due.formation,
      memberIndex: due.slotIndex,
      memberCount: due.slotCount,
    });
  }
}

function advanceEntry(enemy: Enemy, runtime: EnemyRuntime, def: EnemyDef, dtSec: number): void {
  const entry = runtime.entry;
  runtime.traveledU += def.moveSpeedUPerSec * dtSec;
  if (entry.stops && runtime.traveledU >= entry.pathLengthU) {
    runtime.traveledU = entry.pathLengthU;
    runtime.phase = 'stationed';
  }
  applyEntryPosition(enemy, runtime);
  if (runtime.phase === 'stationed') {
    runtime.strafeCenterXU = enemy.xU;
  }
}

/**
 * §8.1 E-D. 방향은 예고가 뜨는 순간 고정된다 — 예고 동안 플레이어를 계속 따라가면 방향선이
 * 회피 정보가 아니라 조준선이 되고, HR-04가 요구한 회피 여지가 사라진다.
 */
function advanceCharge(
  world: World,
  enemy: Enemy,
  runtime: EnemyRuntime,
  def: EnemyDef,
  dtSec: number,
): void {
  if (runtime.chargeStep === 'idle') {
    const towardRad = aimAt(enemy.xU, enemy.yU, world.player.xU, world.player.yU);
    runtime.dashDirXU = Math.cos(towardRad);
    runtime.dashDirYU = Math.sin(towardRad);
    runtime.aimXU = runtime.dashDirXU;
    runtime.aimYU = runtime.dashDirYU;
    runtime.chargeStep = 'telegraph';
    runtime.telegraphRemainingSec = TELEGRAPH.shapes.dash.durationSec;
    world.bus.emit({ kind: 'telegraph', shape: 'dash', xU: enemy.xU, yU: enemy.yU });
    return;
  }
  if (runtime.chargeStep === 'telegraph') {
    runtime.telegraphRemainingSec -= dtSec;
    if (runtime.telegraphRemainingSec <= 0) {
      runtime.telegraphRemainingSec = 0;
      runtime.chargeStep = 'dashing';
    }
    return;
  }
  const stepU = def.moveSpeedUPerSec * dtSec;
  enemy.xU += runtime.dashDirXU * stepU;
  // 돌격형만 화면 바닥까지 내려온다(§3.1). 활동 영역으로 자르면 돌진이 중간에 멈춘다
  enemy.yU = Math.min(enemy.yU + runtime.dashDirYU * stepU, PLAYFIELD.chargerMaxYU);
}

/** §8.1 E-B. 정지 지점을 중심으로 좌우 왕복한다 */
function advanceStrafe(enemy: Enemy, runtime: EnemyRuntime, def: EnemyDef, dtSec: number): void {
  const bounds = PLAYFIELD.enemyBounds;
  const minXU = Math.max(runtime.strafeCenterXU - STRAFE_HALF_SPAN_U, bounds.minXU);
  const maxXU = Math.min(runtime.strafeCenterXU + STRAFE_HALF_SPAN_U, bounds.maxXU);
  const nextXU = enemy.xU + runtime.strafeDirX * def.moveSpeedUPerSec * dtSec;
  if (nextXU <= minXU || nextXU >= maxXU) {
    runtime.strafeDirX = -runtime.strafeDirX;
  }
  enemy.xU = clamp(nextXU, minXU, maxXU);
}

/** 조준은 매 스텝 갱신한다. render가 실루엣이 보는 방향을 이 값으로 그린다 */
function updateAim(world: World, enemy: Enemy, runtime: EnemyRuntime, def: EnemyDef): void {
  if (def.bullet === null) {
    return;
  }
  const towardRad = aimAt(enemy.xU, enemy.yU, world.player.xU, world.player.yU);
  runtime.aimXU = Math.cos(towardRad);
  runtime.aimYU = Math.sin(towardRad);
}

/**
 * 소멸 판정. 하단 경계는 §8.1이 직접 준 값이고 나머지 세 면은 이탈 여백만큼 나간 자리다.
 * 진입 중인 개체가 옆면·윗면 검사에서 빠지는 것은 진입 자체가 화면 밖에서 시작하기 때문이다.
 */
function hasLeftField(enemy: Enemy, runtime: EnemyRuntime): boolean {
  if (enemy.yU > PLAYFIELD.heightU) {
    return true;
  }
  const entry = runtime.entry;
  if (!entry.stops && runtime.traveledU >= entry.pathLengthU) {
    // A8. 통과 후 소멸이다 — 화면 끝에서 되돌리면 측면 위협이 상주 적이 된다
    return true;
  }
  if (runtime.phase === 'entering') {
    return false;
  }
  const bounds = PLAYFIELD.enemyBounds;
  return (
    enemy.xU < bounds.minXU - FIELD_EXIT_MARGIN_U ||
    enemy.xU > bounds.maxXU + FIELD_EXIT_MARGIN_U ||
    enemy.yU < bounds.minYU - FIELD_EXIT_MARGIN_U
  );
}

function stepOne(world: World, enemy: Enemy, dtSec: number, isRetreat: boolean): boolean {
  const runtime = runtimeByEnemy.get(enemy);
  if (runtime === undefined) {
    return false;
  }
  // 10번의 상대 변위 스윕이 읽는 이전 위치. 이동보다 먼저 남겨야 한 스텝의 변위가 된다
  enemy.prevXU = enemy.xU;
  enemy.prevYU = enemy.yU;

  const def: EnemyDef = ENEMIES[runtime.typeId];
  if (isRetreat) {
    // §9.1 퇴장은 그 자리에서 사라지는 것이 아니라 화면을 나가는 것이다. 예비동작과 예고도
    // 함께 끊는다 — 소강의 정의가 「신규 적 탄환 없음」이라 예고만 남으면 거짓말이 된다
    runtime.windupRemainingSec = 0;
    runtime.telegraphRemainingSec = 0;
    enemy.yU += FORCED_EXIT_SPEED_U_PER_SEC * dtSec;
    return enemy.yU > PLAYFIELD.heightU;
  }

  if (runtime.phase === 'entering') {
    advanceEntry(enemy, runtime, def, dtSec);
  } else {
    switch (runtime.behavior) {
      case 'descend':
        // 돌격형이 아니므로 활동 영역 바닥에서 멈춘다(§3.1). 접촉 피해는 그 뒤에도 유효하다
        enemy.yU = Math.min(enemy.yU + def.moveSpeedUPerSec * dtSec, PLAYFIELD.enemyBounds.maxYU);
        break;
      case 'charge':
        advanceCharge(world, enemy, runtime, def, dtSec);
        break;
      case 'strafeAndFire':
        advanceStrafe(enemy, runtime, def, dtSec);
        break;
      case 'holdAndFire':
      case 'crossPass':
      case 'mounted':
        break;
      default: {
        const unreachable: never = runtime.behavior;
        throw new Error(`알 수 없는 잡몹 행동: ${String(unreachable)}`);
      }
    }
  }

  updateAim(world, enemy, runtime, def);
  if (runtime.behavior === 'crossPass') {
    advanceCrossPassFire(world, enemy, runtime, def, dtSec);
  } else if (runtime.phase === 'stationed') {
    advanceFireCycle(world, enemy, runtime, def, dtSec);
  }
  return hasLeftField(enemy, runtime);
}

/**
 * 05 §1의 6번. 한 번의 순회로 이동·발사·소멸을 끝낸다.
 *
 * 퇴장 여부는 개체마다 묻지 않고 스텝마다 한 번 읽는다 — 웨이브 구간이 정하는 전역 상태이고,
 * 순회 도중에 바뀌면 같은 스텝의 앞뒤 개체가 다른 규칙으로 움직인다.
 */
export function stepEnemies(world: World, dtSec: number): void {
  const isRetreat = isRetreating(world);
  world.enemies.releaseWhere((enemy) => stepOne(world, enemy, dtSec, isRetreat));
}
