/**
 * 가드 — 개발 빌드에서만 도는 실행 가능한 검사. 05_시스템_설계.md §13 · 09_검증_전략.md §2.
 *
 * **가드는 값을 고치지 않는다.** 보정은 §11.6의 7·8단계가 할 일이고 여기는 그것이 빠졌거나 순서가
 * 틀렸을 때 잡는 그물이다. 가드가 고치기 시작하면 보정의 버그가 영원히 안 보인다.
 *
 * **DEV 분기는 부르는 쪽에 있다.** 여기의 함수는 언제나 던진다. 호출 자리를 GUARDS_ENABLED로 감싸면
 * 릴리스에서 호출이 사라지고 이 모듈이 통째로 트리 셰이킹된다. 분기를 함수 안쪽에 두면 몸통만 죽고
 * 함수는 번들에 남으며 테스트가 가드를 직접 부를 수도 없다. GuardViolation으로 던지는 것은 헤드리스가
 * 받아 런을 중단하고 리포트를 guard-violation으로 표시해야 하기 때문이다(09 §2.1).
 *
 * 자동화하지 않는 것 셋. HR-06은 소스 텍스트 검사라 tests/에 있다 — sim/은 파일 시스템을 모른다.
 * **HR-04는 안전 폭 파라미터만 본다**: 장판이 겹친 순간의 잔여 이동 가능 면적은 기하 문제이고 "피할
 * 만한가"의 임계값이 스펙에 없다. 지어내면 그 숫자가 스펙보다 위에 서므로 09 §2.5의 수동 검토 항목으로
 * 남긴다 — 자동화한 척하는 것이 안 한 것보다 나쁘다. 히트스톱 "동일 프레임 1회"도 없다: 최고 등급
 * 1회는 parry.ts의 sessionRewarded가 구조로 보장하고, 보호막이 막은 스텝은 패리와 피격이 각각
 * 정상적으로 요청할 수 있어 단언하면 오탐이 난다.
 */
import { STAGE_SCALING } from '../config/difficulty';
import { ENEMIES } from '../config/enemies';
import { HITSTOP_BUDGET_PER_SEC, ZONE } from '../config/feel';
import type { StageId, TelegraphId } from '../config/ids';
import { HARD_LIMITS, INV_1_MARGIN_E07_SEC, INV_1_MARGIN_SEC, INV_2_RATIO } from '../config/parry';
import { PLAYFIELD } from '../config/playfield';
import { STAGES } from '../config/stages';
import { TELEGRAPH } from '../config/telegraph';
import type { BossPattern, LanceDef } from '../config/types';
import { distance, lengthOf } from '../core/vec';
import { bulletSpeedUPerSec, type EnemyShot, type Projectile } from './bullets';
import { assertMovingAway } from './reflect';
import type { EffectiveStats, World } from './world';

const EPSILON = 1e-9;            // 0.18 + 0.04가 0.22와 같지 않은 것이 오탐이 되면 안 된다
const HR03_MAX_EMPTY_SEC = 2.0;  // 스펙 §2 HR-03. config/에 없는 값이라 여기가 유일 소스다

/** 릴리스에서 가드를 지우는 유일한 장치. 없으면 모듈이 살아남아 config/ 표를 릴리스로 끌고 간다 */
export const GUARDS_ENABLED: boolean = import.meta.env.DEV;

export type GuardId =
  | 'HR-01' | 'HR-03' | 'HR-04' | 'HR-05' | 'HR-07' | 'HR-08' | 'HR-09' | 'INV-1' | 'INV-2'
  | 'BAND-ORDER' | 'CAP' | 'HITSTOP-BUDGET' | 'REFLECT-HOMING' | 'REFLECT-SPEED';

export class GuardViolation extends Error {
  readonly guardId: GuardId;
  constructor(guardId: GuardId, detail: string) {
    super(`${guardId} — ${detail}`);
    this.name = 'GuardViolation';
    this.guardId = guardId;
  }
}

/** 반환형이 never라 좁히기에 쓸 수 있다. 조건이 값을 좁히는 자리에서는 ensure 대신 이쪽이다 */
function fail(guardId: GuardId, detail: string): never {
  throw new GuardViolation(guardId, detail);
}

/** detail을 지연 평가하지 않는다 — 클로저를 검사마다 하나씩 만들면 스텝 가드가 쓰레기를 더 낸다 */
function ensure(ok: boolean, guardId: GuardId, detail: string): void {
  if (!ok) {
    throw new GuardViolation(guardId, detail);
  }
}

export interface MissingRangedWave {
  readonly stageId: StageId;
  readonly waveIndex: number;
}

/** 런타임이 아니다. 목록을 돌려주는 것은 부르는 쪽이 웨이브마다 한 건씩 세워야 이름에 남기 때문이다 */
export function findWavesMissingRangedEnemy(): readonly MissingRangedWave[] {
  const missing: MissingRangedWave[] = [];
  for (const stage of Object.values(STAGES)) {
    stage.waves.forEach((wave, waveIndex) => {
      if (!wave.squads.some((squad) => ENEMIES[squad.enemy].isRanged)) {
        missing.push({ stageId: stage.id, waveIndex });
      }
    });
  }
  return missing;
}

/**
 * HR-03 누산을 멈추는 구간. 앞의 둘은 스펙이 규정한 면제이고, 셋째는 스펙 두 규칙이 부딪히는
 * 자리를 가드가 안 던지게 막아 둔 임시 조치라 성격이 다르다(01 §4-C S-04).
 */
export type Hr03Exemption = 'lull' | 'bossDefeat' | 'allSourcesSuppressed';

export interface Hr03ExemptionTally {
  /** 면제가 끊겼다 다시 걸린 횟수 */
  spans: number;
  steps: number;
  simSec: number;
}

/**
 * 면제가 얼마나 자주 걸렸는지가 곧 S-04가 실제 플레이에서 얼마나 자주 발생하는지의 측정값이고
 * 스펙 개정 판단의 근거다. 헤드리스 리포트가 이 값을 그대로 싣는다.
 */
export interface GuardReport {
  readonly hr03: Record<Hr03Exemption, Hr03ExemptionTally>;
  /**
   * allSourcesSuppressed 면제가 없었다면 HR-03이 던졌을 최장 공백 (s). **면제는 가드만 잠재우고
   * 교착은 못 고친다** — 진짜 고침은 스펙 §3.1 또는 §10 개정이라 구현이 못 한다.
   */
  worstMaskedEmptySec: number;
}

export interface GuardState {
  /** 적 탄환이 하나도 없었던 누적 sim 시간. 면제 구간에서 멈춘다 */
  emptyBulletSec: number;
  /** ③이 감추는 몫까지 계속 도는 그림자 타이머. 스펙이 규정한 면제 둘에서는 함께 멈춘다 */
  maskedEmptySec: number;
  liveFireSources: number;
  suppressedFireSources: number;
  lastExemption: Hr03Exemption | null;
  /**
   * 이 스테이지가 적 탄환을 한 번이라도 낸 뒤인가. **HR-03 하나에만 걸린다.**
   *
   * HR-03을 스테이지 시작 시각부터 재면 다섯 스테이지가 전부 시작 즉시 던진다. §9의 웨이브가
   * 0:00에 시작하는데 §8.2의 진입 궤적은 활동 영역 밖에서 출발하므로, 첫 탄까지의 공백은
   * 편성이 아니라 진입에 걸리는 시간 자체다 — 웨이브 표로는 없앨 수 없다.
   *
   * **면제가 아니라 시작점이다.** 첫 탄이 나온 뒤의 공백은 09 §2.4의 면제 말고는 그대로
   * 던진다. 진짜 해결은 §9.1의 웨이브 시작 시각이나 HR-03 조문의 개정이고 구현이 못 한다.
   *
   * 이 값이 GuardState에 있는 것이 계약이다 — 부르는 쪽에서 검사 전체를 건너뛰는 형태로 두면
   * HR-07·HR-08·상한·히트스톱 예산까지 첫 탄 전 구간 내내 함께 꺼진다.
   */
  hr03Armed: boolean;
  readonly report: GuardReport;
}

function createTally(): Hr03ExemptionTally {
  return { spans: 0, steps: 0, simSec: 0 };
}

export function createGuardState(): GuardState {
  const hr03 = { lull: createTally(), bossDefeat: createTally(), allSourcesSuppressed: createTally() };
  return {
    emptyBulletSec: 0, maskedEmptySec: 0, liveFireSources: 0, suppressedFireSources: 0,
    lastExemption: null, hr03Armed: false, report: { hr03, worstMaskedEmptySec: 0 },
  };
}

/**
 * 월드 하나에 가드 상태 하나. World의 필드가 아니라 여기 있는 것은 릴리스에서
 * `GUARDS_ENABLED`가 상수 false가 되면 이 모듈로 가는 호출이 전부 사라져 통째로 트리
 * 셰이킹되어야 하기 때문이다 — World의 필드로 두면 createWorld가 무조건 만들어야 해서
 * 그 길이 막힌다. 부르는 쪽은 언제나 `if (GUARDS_ENABLED)` 안에서만 부른다.
 */
const GUARD_STATES = new WeakMap<World, GuardState>();

export function guardStateOf(world: World): GuardState {
  let state = GUARD_STATES.get(world);
  if (state === undefined) {
    state = createGuardState();
    GUARD_STATES.set(world, state);
  }
  return state;
}

/**
 * 05 §1의 6·7번이 살아 있는 발사원마다 스텝마다 한 번 부른다. 발사 주기가 돌아왔는지가 아니라 **지금 그
 * 자리에서 HR-09에 막히는지**를 넘긴다 — 면제 ③의 조문이 "억제된 상태"이지 "이번 주기에 안 쐈다"가 아니다.
 * 안 부르면 면제 ③이 안 걸려 오탐이 나는데, 조용한 쪽이 아니라 시끄러운 쪽이 의도다.
 */
export function noteFireSource(state: GuardState, isSuppressedByHr09: boolean): void {
  state.liveFireSources += 1;
  if (isSuppressedByHr09) {
    state.suppressedFireSources += 1;
  }
}

function tallyExemption(state: GuardState, exemption: Hr03Exemption, dtSec: number): void {
  const tally = state.report.hr03[exemption];
  if (state.lastExemption !== exemption) {
    tally.spans += 1;
  }
  tally.steps += 1;
  tally.simSec += dtSec;
}

/** 가드가 스스로 판정하는 셋째 면제는 여기 오지 않는다 — 부르는 쪽이 아는 것은 앞의 둘뿐이다 */
type Hr03Request = 'lull' | 'bossDefeat' | null;

/**
 * 소강은 정지, 격파 연출은 정지 후 리셋이다(09 §2.4). 리셋이 격파 연출에만 붙는 것은 §10.1이 그
 * 구간에서 적 탄환을 전부 지우도록 규정했기 때문이고, 지운 것을 공백으로 세면 규정이 곧 위반이 된다.
 * 소강은 지우지 않으므로 쌓인 값이 남고 끝나면 그 자리에서 이어 센다.
 */
function updateHr03(world: World, state: GuardState, dtSec: number, requested: Hr03Request): void {
  if (!state.hr03Armed) {
    if (world.enemyBullets.activeCount === 0) {
      return;
    }
    state.hr03Armed = true;
  }
  const allSuppressed =
    state.liveFireSources > 0 && state.suppressedFireSources === state.liveFireSources;
  const exemption = requested ?? (allSuppressed ? 'allSourcesSuppressed' : null);
  if (world.enemyBullets.activeCount > 0 || exemption === 'bossDefeat') {
    state.emptyBulletSec = 0;
    state.maskedEmptySec = 0;
  } else if (exemption === 'allSourcesSuppressed') {
    state.maskedEmptySec += dtSec;
  } else if (exemption === null) {
    state.emptyBulletSec += dtSec;
    state.maskedEmptySec += dtSec;
  }
  if (state.maskedEmptySec > state.report.worstMaskedEmptySec) {
    state.report.worstMaskedEmptySec = state.maskedEmptySec;
  }
  if (exemption !== null) {
    tallyExemption(state, exemption, dtSec);
  }
  state.lastExemption = exemption;
  // 면제 구간에서는 타이머가 멈춰 있다. 그래도 검사하면 이미 상한을 넘긴 채로 소강에 들어간
  // 런이 소강 내내 매 스텝 같은 위반을 다시 던져, 리포트에 한 사건이 수천 건으로 실린다
  if (exemption === null) {
    checkHR03(state);
  }
}

/** 09 §3.5가 이 하나만 따로 부른다 — 타이머 값을 손으로 세워 경계를 재는 형태다 */
export function checkHR03(state: GuardState): void {
  const emptySec = state.emptyBulletSec;
  ensure(emptySec <= HR03_MAX_EMPTY_SEC, 'HR-03', `적 탄환 공백 ${emptySec.toFixed(3)}초`);
}

/** 보스는 sim/boss.ts가 갖는다. 가드가 보는 것은 위치와 돌진 여부뿐이라 그 둘만 받는다 */
export interface GuardBossView {
  readonly xU: number;
  readonly yU: number;
  /** 지정 돌진 패턴이 도는 중인가. HR-08의 유일한 면제이고 그 구간은 HR-04가 대신 받는다 */
  readonly isCharging: boolean;
}

export interface StepGuardContext {
  /**
   * §9.1 소강과 §10.1 보스 격파 연출. 보스 페이즈 전환 1.2초는 **면제가 아니다** — HR-03 본문이
   * 그 구간도 상한에 포함한다고 명시했고, §10.1이 전환 중에 적 탄환을 유지하는 이유가 이것이다.
   */
  readonly hr03Exemption: Hr03Request;
  readonly boss: GuardBossView | null;
}

/**
 * 소유권 플래그가 자기 풀과 어긋나지 않는지. "양쪽에 유효"는 collision.ts가 반사탄 풀을 피격·명중 양쪽에
 * 넣는 것으로 구조가 보장하고, 그 구조가 기대는 유일한 전제가 풀과 owner의 일치다 — 반사탄 풀에 적
 * 탄환이 섞이면 그 탄이 적을 때린다. 생성 시점 검사는 같은 스텝 안이라 따로 두지 않는다.
 */
export function checkHR07(world: World): void {
  for (const shot of world.reflectBullets.active) {
    ensure(shot.owner === 'player', 'HR-07', `반사탄 풀에 owner=${shot.owner}인 ${shot.bulletId}`);
  }
  for (const shot of world.enemyBullets.active) {
    ensure(shot.owner === 'enemy', 'HR-07', `적 탄환 풀에 owner=${shot.owner}인 ${shot.bulletId}`);
  }
}

export function checkHR08(boss: GuardBossView): void {
  if (boss.isCharging) {
    return;
  }
  const { minXU, maxXU, minYU, maxYU } = PLAYFIELD.bossHomeBounds;
  const inside = boss.xU >= minXU && boss.xU <= maxXU && boss.yU >= minYU && boss.yU <= maxYU;
  ensure(inside, 'HR-08', `보스가 정위치 밖이다 (${boss.xU.toFixed(1)}, ${boss.yU.toFixed(1)})`);
}

/** §3.2 셋의 처리 방식은 서로 다르지만 초과 상태가 존재해선 안 된다는 결론은 하나다 */
function checkCaps(world: World): void {
  const maxBullets = STAGE_SCALING[world.stageId].maxEnemyBullets;
  const bullets = world.enemyBullets.activeCount;
  ensure(bullets <= maxBullets, 'CAP', `적 탄환 ${bullets} > ${maxBullets}`);
  ensure(world.reflectBullets.activeCount <= PLAYFIELD.maxReflectBullets, 'CAP', '반사탄 초과');
  ensure(world.enemies.activeCount <= PLAYFIELD.maxEnemies, 'CAP', '잡몹 초과');
}

/**
 * 05 §1의 16번. 15번(런 상태) 뒤라 게임오버가 확정돼 있고, 그 구간에서 빠져나가는 것은 거기가
 * 규칙이 적용되는 플레이 구간이 아니기 때문이다 — 라이프가 0이면 적도 보스도 발사를 멈추므로
 * HR-03이 곧바로 던지고, 그 원인은 전투 규칙이 아니라 게임오버 처리다. 히트스톱 누적은 절단을
 * core/clock.ts가 하므로 여기가 보는 것은 절단이 걸렸는가 하나다.
 */
export function checkStep(world: World, state: GuardState, dtSec: number, ctx: StepGuardContext): void {
  if (!world.isGameOver) {
    updateHr03(world, state, dtSec, ctx.hr03Exemption);
    checkHR07(world);
    if (ctx.boss !== null) {
      checkHR08(ctx.boss);
    }
    checkCaps(world);
    const usedSec = world.clock.budgetUsedSec(world.simTimeSec);
    ensure(usedSec <= HITSTOP_BUDGET_PER_SEC + EPSILON, 'HITSTOP-BUDGET', `${usedSec.toFixed(4)}초`);
  }
  state.liveFireSources = 0;
  state.suppressedFireSources = 0;
}

/**
 * HR-01. 적 HP를 깎기 직전에 부른다. owner만 보지 않고 풀 소속까지 보는 이유는 owner가 한 칸짜리
 * 플래그라서다 — 잘못 세운 코드는 그 검사를 통과한다. 반사탄 풀에 있다는 것이 유일한 증거다.
 */
export function checkHR01(world: World, source: Projectile): void {
  const isReflect = source.owner === 'player' && world.reflectBullets.active.includes(source);
  ensure(isReflect, 'HR-01', `${source.bulletId}(owner=${source.owner})이 적 HP를 깎는다`);
}

/**
 * HR-05가 허용한 예고 3종과 그것을 붙일 수 있는 원인. 짝이 고정이라 이 표가 곧 판정이다.
 *
 * 방향선의 원인이 둘인 것은 스펙 §6.2가 「본체 돌진」을 보스로 한정하지 않았기 때문이다 —
 * §8.1 E-D 돌격형의 돌진에도 방향선이 붙고(sim/enemies.ts), 그쪽을 표에서 빼면 잡몹 돌진마다
 * 오탐이 난다.
 */
const TELEGRAPH_CAUSE = {
  impactCircle: ['P7'],
  pierceLine: ['P12'],
  dash: ['bossCharge', 'enemyCharge'],
} as const satisfies Record<TelegraphId, readonly string[]>;

export type TelegraphCause = (typeof TELEGRAPH_CAUSE)[TelegraphId][number];

/**
 * HR-05. 예고 객체를 만들 때 부른다. kind를 넓은 string으로 받는 것은 의도다 — TelegraphId로 좁히면
 * 컴파일러가 이미 잡는 경로만 다시 보게 되고, 노리는 것은 데이터에서 흘러든 넷째 도형이다.
 */
export function checkHR05(kind: string, cause: TelegraphCause): void {
  const allowed = (TELEGRAPH_CAUSE as Record<string, readonly string[] | undefined>)[kind];
  if (allowed === undefined) {
    fail('HR-05', `허용되지 않은 예고 도형 '${kind}'`);
  }
  const detail = `예고 '${kind}'는 ${allowed.join('·')} 전용인데 원인이 ${cause}다`;
  ensure(allowed.includes(cause), 'HR-05', detail);
}

/** HR-04의 자동화되는 몫. 중첩 패턴으로 내려가지 않는다 — 실행기가 그것을 시작할 때 다시 부른다 */
export function checkHR04Pattern(pattern: BossPattern): void {
  if (pattern.kind === 'charge') {
    ensure(pattern.safeCorridorU > 0, 'HR-04', `돌진 안전 지대 폭 ${pattern.safeCorridorU}u`);
  }
}

/** §9.7 관통 대창. 웨이브와 B5 페이즈 4가 같은 sim/lance.ts를 부르므로 검사도 하나다 */
export function checkHR04Lance(lance: LanceDef): void {
  ensure(lance.safeCorridorU > 0, 'HR-04', `관통 대창 안전 지대 폭 ${lance.safeCorridorU}u`);
}

/** §9.6 장판 생성 시. P9(적)와 E06(카드)이 같은 상한을 공유한다(§11.5) */
export function checkZoneCap(zoneCount: number): void {
  ensure(zoneCount <= ZONE.maxConcurrent, 'CAP', `장판 ${zoneCount} > ${ZONE.maxConcurrent}`);
}

/**
 * HR-09. 발사 직전에 부른다. 조준 방향과 무관하다 — §6.2가 억제 거리를 "플레이어까지의 거리"로 정의해
 * 링 탄막도 같은 규칙을 받는다. 억제는 bullets.ts가 하고 가드는 그것을 거치지 않은 경로를 잡는다.
 */
export function checkHR09(world: World, shot: EnemyShot): void {
  if (shot.hasTelegraph) {
    return;
  }
  const speedUPerSec = bulletSpeedUPerSec(world, shot.bulletId);
  const flightSec = distance(shot.xU, shot.yU, world.player.xU, world.player.yU) / speedUPerSec;
  const detail = `${shot.bulletId} 비행 ${flightSec.toFixed(3)}초 < ${TELEGRAPH.minFlightSec}`;
  ensure(flightSec >= TELEGRAPH.minFlightSec, 'HR-09', detail);
}

/**
 * 반사 계산 직후에 부른다. v'·n > 0은 reflect.ts의 assertMovingAway가 이미 갖고 있다 — 두 벌이 되면 조용히
 * 어긋나므로 그 함수를 그대로 부르고, parry.ts가 직접 부르는 자리는 이것으로 대체할 수 있다. 유도는
 * R03에서만 온다: 원래 탄의 유도가 소유권과 함께 넘어오면 쳐낸 탄이 플레이어를 쫓아온다.
 */
export function checkReflect(world: World, projectile: Projectile, hasR03: boolean): void {
  assertMovingAway(world, projectile);
  const homingSec = projectile.homingRemainingSec;
  ensure(hasR03 || homingSec === 0, 'REFLECT-HOMING', `R03 없이 유도 ${homingSec}초가 남았다`);
  const speedUPerSec = lengthOf(projectile.vxUPerSec, projectile.vyUPerSec);
  const maxSpeed = HARD_LIMITS.reflectSpeedMaxUPerSec;
  ensure(speedUPerSec <= maxSpeed + EPSILON, 'REFLECT-SPEED', `${speedUPerSec.toFixed(1)} u/s`);
}

export interface InvariantInput {
  readonly activeSec: number;
  readonly cooldownSec: number;
  readonly invulnSec: number;
  /** E07은 INV-1을 건너뛰는 대신 간극을 고정한다. 부등식이 아니라 등식이 된다 */
  readonly hasE07: boolean;
}

export function checkInvariants(input: InvariantInput): void {
  const { activeSec, cooldownSec, invulnSec } = input;
  if (input.hasE07) {
    const expectedSec = activeSec + INV_1_MARGIN_E07_SEC;
    const detail = `E07 쿨다운은 ${expectedSec}여야 하는데 ${cooldownSec}다`;
    ensure(Math.abs(cooldownSec - expectedSec) <= EPSILON, 'INV-1', detail);
  } else {
    const minSec = activeSec + INV_1_MARGIN_SEC;
    ensure(cooldownSec >= minSec - EPSILON, 'INV-1', `쿨다운 ${cooldownSec} < ${minSec}`);
  }
  const maxInvulnSec = cooldownSec * INV_2_RATIO;
  ensure(invulnSec <= maxInvulnSec + EPSILON, 'INV-2', `무적 ${invulnSec} > ${maxInvulnSec}`);
}

/**
 * §5.3의 밴드 순서와 마지막 밴드의 상한. 마지막이 반경과 어긋나면 C1은 통과하는데 어느 밴드에도
 * 안 걸리는 고리가 생기고, 등급이 없으면 데미지 배수·히트스톱·점수·무적이 전부 미정의다.
 */
function checkBands(stats: EffectiveStats): void {
  const bands = stats.bands;
  let previousU = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    ensure(previousU < band.maxDistU, 'BAND-ORDER', `${band.id} ${band.maxDistU} ≤ 이전 ${previousU}`);
    previousU = band.maxDistU;
  }
  const last = bands[bands.length - 1];
  if (last === undefined) {
    fail('BAND-ORDER', '밴드가 하나도 없다');
  }
  const gapU = Math.abs(last.maxDistU - stats.parryRadiusU);
  ensure(gapU <= EPSILON, 'BAND-ORDER', `마지막 밴드 ${last.maxDistU} ≠ 반경 ${stats.parryRadiusU}`);
}

/** §11.6 5단계의 개별 상한. 어떤 카드 조합으로도 넘을 수 없다 */
function checkHardLimits(stats: EffectiveStats): void {
  const cooldownSec = stats.cooldownSecFor('hit');
  const { cooldownMinSec, parryRadiusMaxU, moveSpeedMaxUPerSec } = HARD_LIMITS;
  const reflectMax = HARD_LIMITS.reflectSpeedMaxUPerSec;
  ensure(cooldownSec >= cooldownMinSec - EPSILON, 'INV-1', `쿨다운 ${cooldownSec} < 하한`);
  ensure(stats.parryRadiusU <= parryRadiusMaxU + EPSILON, 'BAND-ORDER', `반경 ${stats.parryRadiusU}`);
  ensure(stats.moveSpeedUPerSec <= moveSpeedMaxUPerSec + EPSILON, 'CAP', '이동 속도 상한 초과');
  ensure(stats.reflectSpeedMaxUPerSec <= reflectMax + EPSILON, 'REFLECT-SPEED', '반사탄 상한 초과');
}

/**
 * §11.6의 9단계가 끝난 스냅샷 전체. 런 시작 · 카드 선택 확정 · 치트 메뉴의 카드 변경에서 부른다(09
 * §2.3). 빈 패리 쿨다운도 INV-1을 받는다 — N13의 명목 −40%가 어떤 빌드에서도 그대로 나오지 않는 이유가
 * 그 하한이다. INV-2는 정상 쿨다운만 본다: 무적은 패리가 성립했을 때만 나온다.
 */
export function checkStatsSnapshot(stats: EffectiveStats, hasE07: boolean): void {
  const activeSec = stats.parryActiveSec;
  const invulnSec = stats.parryInvulnSec;
  checkInvariants({ activeSec, cooldownSec: stats.cooldownSecFor('hit'), invulnSec, hasE07 });
  checkInvariants({ activeSec, cooldownSec: stats.cooldownSecFor('empty'), invulnSec: 0, hasE07 });
  checkBands(stats);
  checkHardLimits(stats);
}
