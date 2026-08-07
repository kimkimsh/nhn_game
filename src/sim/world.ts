/**
 * 세계 상태 — 05_시스템_설계.md §1이 도는 대상.
 *
 * 이 파일이 갖는 것은 「무엇이 있는가」 하나다. 한 스텝의 순서는 sim/step.ts가 갖는다 —
 * 여기 두면 sim/ 전체가 이 파일을 import하는 것만으로 순서에 손댈 수 있게 되고, 순서를
 * 바꾸면 스펙이 깨지는 자리 넷(05 §1)의 소유자가 사라진다.
 *
 * ── EffectiveStats가 여기 있는 것은 임시다 ────────────────────────────────────────
 *
 * 소유자는 sim/stats.ts이고 그 파일이 §11.6의 9단계로 카드를 접어 같은 형태를 만든다. 형태
 * 자체는 05 §10.3과 12 §10 E-05가 확정한 계약이라 카드가 없는 지금 고정한다 — 정적 필드와
 * 런타임 파생이 갈려 있고, parryCooldownSec와 reflectDamageMul은 필드가 아니다. 둘은 호출
 * 시점의 상태 없이는 값이 없는 것이고, 필드로 두면 그 사실이 감춰진다.
 */
import { COMBO } from '../config/scoring';
import { HITSTOP_BUDGET_PER_SEC } from '../config/feel';
import type { ParryGradeId, StageId } from '../config/ids';
import { PARRY, PARRY_BANDS } from '../config/parry';
import { PLAYER } from '../config/player';
import { PLAYFIELD } from '../config/playfield';
import { REFLECT } from '../config/reflect';
import { bus as globalBus, type FeedbackBus } from '../core/bus';
import { createClock, type Clock } from '../core/clock';
import { clamp } from '../core/math';
import { createPool, type Pool } from '../core/pool';
import { createRng, type Rng } from '../core/rng';
import type { BossState } from './boss';
import { createEnemyBulletPool, createReflectBulletPool, type Projectile } from './bullets';
import { createParryState, type ParryState } from './parry';
import { createPlayer, type Player } from './player';
import { createZonePool, type Zone } from './zones';

/** §18.4 어느 단계에서 어느 규칙이 어떤 값을 얼마로 잘랐는지. 네 필드 이름이 계약이다 */
export interface StatClamp {
  /** 잘린 단계. 9단계는 아무것도 자르지 않으므로 여기 나타날 수 없다 */
  readonly step: number;
  readonly rule: 'INV-1' | 'INV-2' | 'hardLimit' | 'bandOrder';
  readonly field: string;
  readonly after: number;
}

/**
 * §5.3 밴드의 스냅샷 형태. config의 ParryBand와 달리 maxDistU가 null이 아니다 —
 * 마지막 밴드는 스냅샷을 만들 때 실효 패리 반경으로 채워진다. 그 채움이 없으면 반경을 키우는
 * 카드에서 C1은 통과하는데 어느 밴드에도 안 걸리는 고리가 생기고, 등급이 없으면 데미지 배수·
 * 히트스톱·점수·무적이 전부 미정의다.
 */
export interface EffectiveParryBand {
  readonly id: ParryGradeId;
  readonly maxDistU: number;
  readonly damageMul: number;
  readonly speedMul: number;
  readonly hitstopSec: number;
  readonly score: number;
}

export interface EffectiveStats {
  readonly parryRadiusU: number;
  readonly parryActiveSec: number;
  readonly parryInvulnSec: number;
  readonly parryBufferSec: number;
  readonly bands: readonly EffectiveParryBand[];
  readonly comboHoldSec: number;
  readonly moveSpeedUPerSec: number;
  readonly hitInvulnSec: number;
  readonly maxLife: number;
  readonly reflectLifetimeSec: number;
  readonly reflectGraceSec: number;
  readonly reflectSpeedMaxUPerSec: number;
  readonly reflectPierceCount: number;
  /** N12. 적 명중 판정만 넓힌다 — 플레이어 피격 판정은 원래 크기다 */
  readonly reflectHitRadiusBonusU: number;
  readonly clamps: readonly StatClamp[];

  /** R05. 콤보 종속이라 카드 목록이 그대로여도 값이 바뀐다 */
  reflectDamageMulFor(combo: number): number;
  /** N13. 쿨다운이 값 하나가 아니라 둘이 된다 */
  cooldownSecFor(outcome: 'hit' | 'empty'): number;
  /** R10. 미보유면 null */
  readonly r10ActiveMinGapSec: number | null;
  /** E03 능력치. 현재 충전 수는 RunState가 갖는다 */
  readonly shieldMaxCharges: number;
}

/**
 * 카드 0장의 스냅샷. sim/stats.ts가 생기면 이 함수는 9단계의 0번째 입력이 된다.
 * 마지막 밴드의 상한을 여기서 채우는 것이 §5.3과 C1을 같은 값에 묶는 유일한 자리다.
 */
export function createBaseStats(): EffectiveStats {
  const bands: EffectiveParryBand[] = PARRY_BANDS.map((band) => ({
    id: band.id,
    maxDistU: band.maxDistU ?? PARRY.radiusU,
    damageMul: band.damageMul,
    speedMul: band.speedMul,
    hitstopSec: band.hitstopSec,
    score: band.score,
  }));
  return {
    parryRadiusU: PARRY.radiusU,
    parryActiveSec: PARRY.activeSec,
    parryInvulnSec: PARRY.invulnSec,
    parryBufferSec: PARRY.bufferSec,
    bands,
    comboHoldSec: COMBO.holdSec,
    moveSpeedUPerSec: PLAYER.moveSpeedUPerSec,
    hitInvulnSec: PLAYER.hitInvulnSec,
    maxLife: PLAYER.maxLife,
    reflectLifetimeSec: REFLECT.lifetimeSec,
    reflectGraceSec: REFLECT.graceSec,
    reflectSpeedMaxUPerSec: REFLECT.speedMaxUPerSec,
    reflectPierceCount: REFLECT.pierceCount,
    reflectHitRadiusBonusU: 0,
    clamps: [],
    reflectDamageMulFor: () => 1,
    cooldownSecFor: () => PARRY.cooldownSec,
    r10ActiveMinGapSec: null,
    shieldMaxCharges: 0,
  };
}

/**
 * 잡몹 한 기. sim/enemies.ts가 생기면 행동·발사 상태가 여기 붙는다.
 * 지금 있는 칸은 반사탄이 죽일 수 있기 위해 필요한 최소치다.
 */
export interface Enemy {
  xU: number;
  yU: number;
  prevXU: number;
  prevYU: number;
  hitRadiusU: number;
  hp: number;
  maxHp: number;
  scoreValue: number;
  contactDamage: boolean;
  /** §7.3 정면 반사탄 1회 무효화. 파괴되면 이후 반사탄은 정상 피해를 준다 */
  frontShieldIntact: boolean;
}

function createEnemy(): Enemy {
  return {
    xU: 0,
    yU: 0,
    prevXU: 0,
    prevYU: 0,
    hitRadiusU: 0,
    hp: 0,
    maxHp: 0,
    scoreValue: 0,
    contactDamage: false,
    frontShieldIntact: false,
  };
}

function resetEnemy(enemy: Enemy): void {
  enemy.contactDamage = false;
  enemy.frontShieldIntact = false;
}

/**
 * 런 전체가 들고 가는 가변 상태. shieldCharges가 EffectiveStats가 아니라 여기 있는 이유는
 * 피격이 그것을 소모하기 때문이다 — 스냅샷은 읽기 전용이라 소모를 쓸 자리가 없다.
 */
export interface RunState {
  score: number;
  combo: number;
  /** §12.2 콤보 유지의 만료 시각 (누적 sim 초) */
  comboUntilSec: number;
  /** 경고를 콤보 한 벌에 한 번만 내기 위한 표시 */
  comboWarned: boolean;
  shieldCharges: number;
}

export interface World {
  readonly stageId: StageId;
  /** 누적 sim 시간. 모든 만료 시각이 이 값과 비교된다 — 벽시계는 sim에 들어오지 않는다 */
  simTimeSec: number;
  readonly player: Player;
  readonly parry: ParryState;
  readonly run: RunState;
  readonly enemyBullets: Pool<Projectile>;
  readonly reflectBullets: Pool<Projectile>;
  readonly enemies: Pool<Enemy>;
  /** §9.6 P9와 E06이 공유하는 하나. 풀 용량이 곧 상한이라 초과 상태가 존재하지 않는다 */
  readonly zones: Pool<Zone>;
  /**
   * 보스 구간에 들어가기 전에는 null이다. 세우는 자리는 sim/step.ts의 7번 하나이고, 여기서
   * 미리 만들지 않는 것은 「보스가 아직 없다」와 「보스가 등장했다」가 구분돼야 하기 때문이다.
   */
  boss: BossState | null;
  stats: EffectiveStats;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly bus: FeedbackBus;
  /** 06 §6.1 연쇄 큐의 키. 처치가 어느 패리에서 나왔는지를 render가 이 값으로 가른다 */
  parrySeq: number;
  chainIndex: number;
  isGameOver: boolean;
}

export interface WorldSpec {
  readonly stageId: StageId;
  readonly seed: number;
  readonly clock?: Clock;
  readonly bus?: FeedbackBus;
}

export function createWorld(spec: WorldSpec): World {
  return {
    stageId: spec.stageId,
    simTimeSec: 0,
    player: createPlayer(),
    parry: createParryState(),
    run: { score: 0, combo: 0, comboUntilSec: 0, comboWarned: false, shieldCharges: 0 },
    enemyBullets: createEnemyBulletPool(spec.stageId),
    reflectBullets: createReflectBulletPool(),
    enemies: createPool({ capacity: PLAYFIELD.maxEnemies, create: createEnemy, reset: resetEnemy }),
    zones: createZonePool(),
    boss: null,
    stats: createBaseStats(),
    clock: spec.clock ?? createClock(HITSTOP_BUDGET_PER_SEC),
    rng: createRng(spec.seed),
    bus: spec.bus ?? globalBus,
    parrySeq: 0,
    chainIndex: 0,
    isGameOver: false,
  };
}

/** §12.2 배수. 상한 클램프가 없으면 콤보 200 이상에서 스펙을 넘는다 */
export function comboMultiplier(combo: number): number {
  return clamp(
    1 + Math.floor(combo / COMBO.multStep) * COMBO.multPerStep,
    1,
    COMBO.multMax,
  );
}

/** 점수는 언제나 현재 콤보 배수를 거친다. 배수를 부르는 쪽에 맡기면 곳곳이 갈린다 */
export function addScore(world: World, basePoints: number): void {
  world.run.score += Math.floor(basePoints * comboMultiplier(world.run.combo));
}

/** §12.2 콤보는 패리로 처리한 발사체 개수만큼 오른다. 유지 시간은 그때마다 다시 시작한다 */
export function addCombo(world: World, count: number): void {
  const run = world.run;
  run.combo += count;
  run.comboUntilSec = world.simTimeSec + world.stats.comboHoldSec;
  run.comboWarned = false;
}

export function resetCombo(world: World): void {
  world.run.combo = 0;
  world.run.comboWarned = false;
}
