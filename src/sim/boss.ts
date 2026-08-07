/**
 * 보스 상태 — 페이즈 전환·부위 파괴·격파 연출. 스펙 §10.1 · §10.4, 05_시스템_설계.md §8.1 · §8.3.
 * 05 §1의 7번이 stepBoss 하나를 부른다.
 *
 * 이 파일은 「보스가 지금 어떤 상태인가」만 갖는다. 「무슨 패턴을 쏘고 있는가」는 boss-runner.ts,
 * 명중 판정은 boss-hits.ts다 — 03_파일_구조.md §6의 400줄 때문이고, 그 둘은 여기서 타입과
 * `applyBossDamage` 하나만 가져간다.
 *
 * ── 정지 구간이 둘인데 탄환 처리가 반대다 ────────────────────────────────────────
 *
 * 둘 다 보스가 무적이고 신규 발사가 멈춘다. 그런데 화면의 적 탄환은 전환에서 **유지**되고
 * 격파에서 **소멸**한다(§10.1) — 전환에서 지우면 적 탄환 0인 구간이 전환 연출 내내 이어지고
 * 다음 패턴의 예비동작까지 더해 HR-03의 상한을 넘긴다.
 *
 * ── B1 부하 조총병 5기는 부위가 아니다 (10_스펙_목업_불일치.md A14) ──────────────
 *
 * 실체 충돌 대상이지만 B1의 단일 HP 풀을 공유한다. 개별 HP도 개별 파괴도 없어 `BossPartDef`가
 * 될 수 없고 그래서 `parts`가 아니라 `satellites`다 — §14.4의 B1 DPS 검산이 HP 전체가 한 풀이라는
 * 전제로 계산됐으므로 여기에 개별 HP를 주면 그 검산이 무효가 된다.
 */
import { BOSSES, BOSS_COMMON } from '../config/bosses';
import { B1_GUNNER_LINE_SPAN_U } from '../config/bosses/boss-1-johong';
import { ENEMIES } from '../config/enemies';
import type { BossId, TelegraphId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import type { BossDef, BossPartDef } from '../config/types';
import { clamp } from '../core/math';
import { createRunnerState, resetRunner, stepRunner, type RunnerState } from './boss-runner';
import { GUARDS_ENABLED, guardStateOf, noteFireSource } from './guards';
import { awardBossKill, awardBossPhaseChange } from './score';
import type { World } from './world';
// 곡사가 장판을 만드는 이상 보스 스텝은 장판이 있는 World를 요구한다(§10.5)
import type { ZoneWorld } from './zones';

/**
 * §10.2 부하 조총병 라인의 인원. 가로 폭은 `B1_GUNNER_LINE_SPAN_U`가 갖지만 인원을 담을 필드가
 * `BossDef`에 없고, 페이즈 2가 같은 라인에서 7발을 쏘므로 패턴의 `count`에서 유도할 수도 없다.
 */
const B1_GUNNER_COUNT = 5;

/**
 * §10.1이 허용한 좌우 이동의 왕복 주기 (s). 스펙도 `config/`도 정하지 않았고 진폭은 정위치
 * 영역과 선체 폭에서 유도하므로 자유도가 이 하나뿐이다. 왕복을 없애면 §10.2 엄폐 전진이
 * 「본체가 좌↔우 왕복 이동하며」를 잃는다 — 그 패턴에는 이동을 적을 필드가 없다.
 */
const BOSS_STRAFE_PERIOD_SEC = 6.0;

/**
 * §17 · C9 — 다음 페이즈 임계값에 이만큼 남으면 「곧 바뀐다」로 본다. 눈금(어디서 바뀌는가)은
 * HUD가 갖고 사전 신호는 sim이 상태로 낸다. render는 `bossPhaseWarning`을 읽어 그리기만 한다.
 */
export const PHASE_WARN_MARGIN_RATIO = 0.03;

const FULL_TURN_RAD = Math.PI * 2;

/** §10.4 파괴 가능 부위 한 기. 본체와 별도 HP·별도 히트박스를 갖는다 */
export interface BossPart {
  readonly def: BossPartDef;
  xU: number;
  yU: number;
  /** 05 §1의 8번이 발사체에 남기는 것과 같은 뜻 — 11번의 스윕이 여기서 상대 변위를 만든다 */
  prevXU: number;
  prevYU: number;
  hp: number;
  destroyed: boolean;
}

/** A14 B1 부하 조총병. 판정만 갖고 HP는 갖지 않는다 — 본체 풀을 공유한다 */
export interface BossSatellite {
  xU: number;
  yU: number;
  prevXU: number;
  prevYU: number;
  readonly hitRadiusU: number;
}

/**
 * HR-05가 허용한 예고 도형 하나. 소유자가 sim인 이유는 남은 시간이 sim 시계이기 때문이고,
 * render/telegraph.ts의 `TelegraphView`가 이 필드를 그대로 읽는다.
 */
export interface BossTelegraph {
  readonly shape: TelegraphId;
  xU: number;
  yU: number;
  radiusU: number;
  widthU: number;
  angleRad: number;
  lengthU: number;
  ageSec: number;
  readonly durationSec: number;
}

/** §10.1 보스가 있을 수 있는 세 상태. 셋 다 발사 여부와 무적 여부가 다르다 */
export type BossMode = 'fighting' | 'phaseTransition' | 'defeated';

export interface BossState {
  readonly def: BossDef;
  readonly homeXU: number;
  readonly homeYU: number;
  /** 좌우 왕복의 진폭 (u). 선체가 화면 밖으로 나가지 않는 값으로 생성 시 유도한다 */
  readonly strafeAmplitudeU: number;
  xU: number;
  yU: number;
  prevXU: number;
  prevYU: number;
  hp: number;
  readonly maxHp: number;
  phaseIndex: number;
  mode: BossMode;
  /** 전환·격파 연출의 남은 시간 (s). fighting에서는 0이다 */
  modeRemainingSec: number;
  /**
   * 돌진과 **그 복귀**가 본체 좌표를 쥐고 있는 동안 참. 참이면 좌우 왕복도 HR-08 클램프도
   * 걸지 않는다 — 돌진은 §10.1이 이름 붙인 상단 고정의 유일한 예외다.
   *
   * 복귀까지 포함하는 것이 요점이다. 내려간 자리에서 곧바로 거짓으로 내리면 그 스텝의 보스는
   * 「예외 구간이 아닌데 정위치 밖」이 되어 HR-08이 던진다.
   */
  positionOwnedByPattern: boolean;
  /**
   * 정위치로 되돌아가는 데 남은 시간 (s). 0이면 복귀 중이 아니다.
   *
   * 복귀가 필요한 자리는 둘이고 성격이 다르다 — `returnToStart`가 없는 돌진이 끝나는 순간과,
   * 페이즈 전환·격파가 돌진을 도중에 끊는 순간(stopFiring)이다. 둘 다 좌표를 놓아 버리면
   * 다음 스텝의 왕복이 보스를 화면 절반만큼 순간이동시킨다.
   */
  returnHomeRemainingSec: number;
  /** §6.2 발사 예비동작 중. render/boss.ts의 `BossSilhouette.charging`이 이 값이다 */
  charging: boolean;
  readonly parts: BossPart[];
  readonly satellites: BossSatellite[];
  readonly telegraphs: BossTelegraph[];
  readonly runner: RunnerState;
  /** 격파 연출까지 끝났다. 스테이지 진행이 이 값을 보고 클리어로 넘어간다 */
  isFinished: boolean;
}

/**
 * 부위와 부하는 개수만 만든다. 좌표는 syncAttachments가 본체에서 매 스텝 다시 유도하므로,
 * 여기서 또 계산하면 같은 배치식의 두 번째 소스가 된다.
 */
function createAttachments(def: BossDef): { parts: BossPart[]; satellites: BossSatellite[] } {
  const parts = (def.parts ?? []).map((part: BossPartDef) => ({
    def: part,
    xU: 0,
    yU: 0,
    prevXU: 0,
    prevYU: 0,
    hp: part.hp,
    destroyed: false,
  }));
  const satellites: BossSatellite[] = [];
  const count = def.id === 'B1' ? B1_GUNNER_COUNT : 0;
  for (let index = 0; index < count; index += 1) {
    satellites.push({ xU: 0, yU: 0, prevXU: 0, prevYU: 0, hitRadiusU: ENEMIES['E-A'].hitRadiusU });
  }
  return { parts, satellites };
}

export function createBossState(bossId: BossId): BossState {
  const def: BossDef = BOSSES[bossId];
  const home = PLAYFIELD.bossHomeBounds;
  const homeXU = (home.minXU + home.maxXU) / 2;
  const homeYU = (home.minYU + home.maxYU) / 2;
  // 진폭은 정위치 영역의 반폭과 선체가 화면 안에 남는 반폭 중 작은 쪽이다. 뒤엣것이 없으면
  // 폭 900u인 B5가 왕복 끝에서 화면 밖으로 절반 나간다
  const strafeAmplitudeU = Math.min(
    (home.maxXU - home.minXU) / 2,
    Math.max(0, (PLAYFIELD.widthU - def.hitBox.wU) / 2),
  );
  const attachments = createAttachments(def);
  const boss: BossState = {
    def,
    homeXU,
    homeYU,
    strafeAmplitudeU,
    xU: homeXU,
    yU: homeYU,
    prevXU: homeXU,
    prevYU: homeYU,
    hp: def.hp,
    maxHp: def.hp,
    phaseIndex: 0,
    mode: 'fighting',
    modeRemainingSec: 0,
    positionOwnedByPattern: false,
    returnHomeRemainingSec: 0,
    charging: false,
    parts: attachments.parts,
    satellites: attachments.satellites,
    telegraphs: [],
    runner: createRunnerState(),
    isFinished: false,
  };
  syncAttachments(boss);
  snapshotPrevious(boss);
  return boss;
}

/**
 * §18.3 치트의 「B5 P4」 진입. 점수도 전환 연출도 없이 그 페이즈의 시작 상태를 만든다 —
 * 정상 진행으로 도달한 것이 아니므로 §12.1의 전환 점수를 주면 치트가 점수를 만든다.
 *
 * HP를 임계값으로 내리는 것이 페이즈 진입의 정의다. 그러지 않으면 첫 피해 한 번에
 * checkPhaseAdvance가 같은 페이즈로 다시 들어간다.
 */
export function enterPhaseDirectly(boss: BossState, phaseIndex: number): void {
  const phase = boss.def.phases[phaseIndex];
  if (phase === undefined || phaseIndex <= 0) {
    return;
  }
  boss.phaseIndex = phaseIndex;
  boss.hp = Math.max(1, Math.floor(boss.maxHp * phase.hpThreshold));
}

export function bossHpRatio(boss: BossState): number {
  return boss.hp / boss.maxHp;
}

/** §10.1 무적. 전환과 격파 둘 다이고 접촉 피해도 이 동안 무해하다 */
export function isBossInvulnerable(boss: BossState): boolean {
  return boss.mode !== 'fighting';
}

/** 총구선 (u). 발사원이 선체 아래 모서리라야 탄이 실루엣 안에서 솟지 않는다 */
export function bossMuzzleYU(boss: BossState): number {
  return boss.yU + boss.def.hitBox.hU / 2;
}

export function destroyedPartCount(boss: BossState): number {
  return boss.parts.filter((part) => part.destroyed).length;
}

/**
 * C9 — 다음 페이즈가 임박했는가. 눈금이 아니라 사전 신호다(§17).
 * 부위 조건 쪽은 신호를 내지 않는다: 포문이 몇 개 남았는지는 화면에 게이지로 이미 보인다.
 */
export function bossPhaseWarning(boss: BossState): boolean {
  const next = boss.def.phases[boss.phaseIndex + 1];
  if (next === undefined || boss.mode !== 'fighting') {
    return false;
  }
  return bossHpRatio(boss) <= next.hpThreshold + PHASE_WARN_MARGIN_RATIO;
}

function syncAttachments(boss: BossState): void {
  for (const part of boss.parts) {
    part.xU = boss.xU + part.def.offsetU.xU;
    part.yU = boss.yU + part.def.offsetU.yU;
  }
  if (boss.satellites.length === 0) {
    return;
  }
  const yU = bossMuzzleYU(boss);
  const spacingU = B1_GUNNER_LINE_SPAN_U / (B1_GUNNER_COUNT - 1);
  for (let index = 0; index < boss.satellites.length; index += 1) {
    const satellite = boss.satellites[index]!;
    satellite.xU = boss.xU + (index - (boss.satellites.length - 1) / 2) * spacingU;
    satellite.yU = yU;
  }
}

function snapshotPrevious(boss: BossState): void {
  boss.prevXU = boss.xU;
  boss.prevYU = boss.yU;
  for (const part of boss.parts) {
    part.prevXU = part.xU;
    part.prevYU = part.yU;
  }
  for (const satellite of boss.satellites) {
    satellite.prevXU = satellite.xU;
    satellite.prevYU = satellite.yU;
  }
}

/**
 * §10.1 좌우 이동의 지금 x (u). sim 시각만의 함수라 같은 시드의 두 런이 같은 궤적을 그리고,
 * 돌진의 복귀도 이 값을 목표로 삼는다 — 돌진 시작 좌표로 되돌리면 그 사이 흐른 몇 초만큼
 * 왕복이 앞서 있어서 복귀가 끝나는 순간 보스가 그 차이만큼 순간이동한다.
 */
export function bossStrafeXU(world: World, boss: BossState): number {
  const phaseRad = (world.simTimeSec / BOSS_STRAFE_PERIOD_SEC) * FULL_TURN_RAD;
  return boss.homeXU + Math.sin(phaseRad) * boss.strafeAmplitudeU;
}

function strafe(world: World, boss: BossState): void {
  boss.xU = bossStrafeXU(world, boss);
  boss.yU = boss.homeYU;
}

/** HR-08. 돌진이 좌표를 쥐고 있지 않은 동안에는 언제나 정위치 영역 안이다 */
function clampToHome(boss: BossState): void {
  const home = PLAYFIELD.bossHomeBounds;
  boss.xU = clamp(boss.xU, home.minXU, home.maxXU);
  boss.yU = clamp(boss.yU, home.minYU, home.maxYU);
}

function isAtHome(boss: BossState): boolean {
  const home = PLAYFIELD.bossHomeBounds;
  return (
    boss.xU >= home.minXU && boss.xU <= home.maxXU &&
    boss.yU >= home.minYU && boss.yU <= home.maxYU
  );
}

/**
 * 좌표를 쥐고 있던 패턴이 끝났다. 정위치 밖이면 놓는 대신 복귀를 시작한다.
 *
 * 복귀 시간을 페이즈 전환 연출과 같은 값으로 두는 것은 전환이 끝나는 순간 이미 정위치에
 * 있어야 하기 때문이다 — 자기 숫자를 새로 만들면 스펙에 없는 값이 하나 더 생긴다.
 */
export function releasePatternPosition(boss: BossState): void {
  if (isAtHome(boss)) {
    boss.positionOwnedByPattern = false;
    boss.returnHomeRemainingSec = 0;
    return;
  }
  boss.positionOwnedByPattern = true;
  boss.returnHomeRemainingSec = BOSS_COMMON.phaseTransitionSec;
}

/** 복귀 한 스텝. 도착하면 좌표를 왕복에 돌려준다 */
function advanceReturnHome(world: World, boss: BossState, dtSec: number): void {
  if (boss.returnHomeRemainingSec <= 0) {
    return;
  }
  const t = Math.min(1, dtSec / boss.returnHomeRemainingSec);
  boss.xU += (bossStrafeXU(world, boss) - boss.xU) * t;
  boss.yU += (boss.homeYU - boss.yU) * t;
  boss.returnHomeRemainingSec -= dtSec;
  if (boss.returnHomeRemainingSec <= 0) {
    boss.returnHomeRemainingSec = 0;
    boss.positionOwnedByPattern = false;
    clampToHome(boss);
  }
}

/**
 * 전환·격파 공통. 진행 중이던 패턴과 예고 도형을 함께 버린다 — 예고만 남으면 신규 발사가
 * 멈춘 구간에서 그것만 터지고, 플레이어는 무엇을 피하고 있었는지 모르는 채로 맞는다.
 */
function stopFiring(boss: BossState): void {
  boss.charging = false;
  resetRunner(boss.runner);
  boss.telegraphs.length = 0;
  releasePatternPosition(boss);
}

function enterPhase(world: World, boss: BossState, phaseIndex: number): void {
  boss.phaseIndex = phaseIndex;
  boss.mode = 'phaseTransition';
  boss.modeRemainingSec = BOSS_COMMON.phaseTransitionSec;
  stopFiring(boss);
  awardBossPhaseChange(world);
  world.bus.emit({ kind: 'bossPhase', phase: phaseIndex + 1, xU: boss.xU, yU: boss.yU });
}

/** §10.4의 「선착」. HP와 부위가 독립 트리거이고, 둘 다 만족해도 phaseIndex가 한 칸만 오른다 */
function checkPhaseAdvance(world: World, boss: BossState): void {
  const next = boss.def.phases[boss.phaseIndex + 1];
  if (next === undefined) {
    return;
  }
  const byHp = bossHpRatio(boss) <= next.hpThreshold;
  const threshold = next.partsDestroyedThreshold;
  const byParts = threshold !== undefined && destroyedPartCount(boss) >= threshold;
  if (byHp || byParts) {
    enterPhase(world, boss, boss.phaseIndex + 1);
  }
}

function beginDefeat(world: World, boss: BossState): void {
  boss.mode = 'defeated';
  boss.modeRemainingSec = BOSS_COMMON.deathSec;
  boss.hp = 0;
  stopFiring(boss);
  awardBossKill(world);
  world.bus.emit({ kind: 'bossDefeated', xU: boss.xU, yU: boss.yU });
}

/**
 * §10.1 격파 연출 — 모든 적 탄환 소멸, 플레이어 무적.
 *
 * 매 스텝 비우는 것은 살아남은 잡몹이 이 구간에도 쏠 수 있어서다. 시작 한 번만 비우면
 * 「이 동안 모든 적 탄환 소멸」이 첫 스텝에만 참이 된다. 무적은 만료 시각을 직접 민다 —
 * grantHitInvuln의 길이는 §4.2 피격 무적이라 연출 길이와 어긋난다.
 */
function holdDefeatCurtain(world: World, boss: BossState): void {
  world.enemyBullets.releaseAll();
  const untilSec = world.simTimeSec + boss.modeRemainingSec;
  const player = world.player;
  if (player.hitInvulnUntilSec < untilSec) {
    player.hitInvulnUntilSec = untilSec;
  }
}

/**
 * 05 §1의 7번. 8번(발사체 적분)보다 앞이라 이 스텝에 나간 탄이 같은 스텝에 한 번 적분되고,
 * 이전 위치를 먼저 남겨야 11번의 스윕이 본체·부위·부하의 상대 변위를 만들 수 있다.
 */
export function stepBoss(world: ZoneWorld, boss: BossState, dtSec: number): void {
  if (boss.isFinished) {
    return;
  }
  snapshotPrevious(boss);

  // 복귀는 세 모드에 공통이다 — 돌진을 끊는 것이 전환과 격파이고, 끊긴 자리에서 정위치까지는
  // 그 연출이 도는 동안 좁혀진다. 패턴보다 앞에 두어 새 돌진이 같은 스텝에 좌표를 뺏을 수 있다
  advanceReturnHome(world, boss, dtSec);

  if (boss.mode === 'defeated') {
    boss.modeRemainingSec -= dtSec;
    holdDefeatCurtain(world, boss);
    if (boss.modeRemainingSec <= 0) {
      boss.isFinished = true;
    }
    syncAttachments(boss);
    return;
  }

  if (boss.mode === 'phaseTransition') {
    boss.modeRemainingSec -= dtSec;
    if (!boss.positionOwnedByPattern) {
      strafe(world, boss);
    }
    if (boss.modeRemainingSec <= 0) {
      boss.mode = 'fighting';
      boss.modeRemainingSec = 0;
    }
    syncAttachments(boss);
    return;
  }

  if (!boss.positionOwnedByPattern) {
    strafe(world, boss);
  }
  if (GUARDS_ENABLED) {
    // 보스는 상단에 고정되므로 HR-09에 막히는 거리가 나오지 않는다. 억제된 발사원으로 세면
    // 면제 ③이 보스전에서 상시로 걸려 HR-03이 통째로 잠든다
    noteFireSource(guardStateOf(world), false);
  }
  stepRunner(world, boss, dtSec);
  if (!boss.positionOwnedByPattern) {
    clampToHome(boss);
  }
  syncAttachments(boss);
}

/**
 * 반사탄 한 발이 확정한 피해. `part`가 null이면 본체이고 A14의 부하 조총병도 그쪽으로 온다 —
 * 5기가 단일 풀을 공유한다는 것이 곧 「부위가 아니라 본체 피격」이다. 부위 피해를 본체에 옮겨
 * 적지 않는다: §10.7 요약표가 본체 + 포문 합계라 둘 다 깎으면 같은 피해를 두 번 센다.
 */
export function applyBossDamage(
  world: World,
  boss: BossState,
  part: BossPart | null,
  amount: number,
): void {
  // §10.1 무적 구간에는 어떤 피해도 안 들어온다. HP를 바꾸는 유일한 자리라 여기서 막는다 —
  // 격파 연출 중에 한 번 더 들어오면 hp가 다시 0 이하가 되어 연출이 처음부터 다시 시작한다
  if (boss.isFinished || isBossInvulnerable(boss)) {
    return;
  }
  if (part !== null) {
    part.hp -= amount;
    if (part.hp > 0) {
      return;
    }
    part.hp = 0;
    part.destroyed = true;
    world.bus.emit({ kind: 'bossPartBroken', xU: part.xU, yU: part.yU });
    checkPhaseAdvance(world, boss);
    return;
  }
  boss.hp -= amount;
  if (boss.hp <= 0) {
    beginDefeat(world, boss);
    return;
  }
  checkPhaseAdvance(world, boss);
}
