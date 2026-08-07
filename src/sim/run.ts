/**
 * 런의 생명주기 — 스펙 §13 · §12.3 · §18, 05_시스템_설계.md §12 · §14.
 *
 *   S1 → [클리어] → 카드 → S2 → 카드 → S3 → 카드 → S4 → 카드 → S5 → [클리어] → 엔딩·결과
 *
 * 타이틀은 여기 없다. 타이틀에는 런이 존재하지 않고 T-03(타이틀 → S1)이 곧 createRun이다
 * (08 §1.4). 런 포기와 타이틀 복귀는 이 객체를 버리는 것이지 상태 전이가 아니다.
 *
 * ── 스테이지를 넘어가는 것과 아닌 것 ────────────────────────────────────────────
 *
 * 라이프·점수·카드·보호막 충전은 넘어가고 콤보와 월드(적·탄환·반사탄·장판)는 안 넘어간다.
 * 라이프와 콤보의 수명이 다른 것이 §13.2와 §12.2의 요점이라 둘을 같은 자리에서 초기화하면
 * 규칙이 조용히 뒤집힌다. 월드를 통째로 새로 만드는 것이 그 경계를 구조로 만드는 방법이다 —
 * 이전 스테이지의 배율로 계산된 탄환이 남으면 어느 파라미터의 물체인지가 불분명해진다.
 *
 * 보호막 충전 수가 스냅샷이 아니라 여기 있는 것은 피격이 그것을 소모하기 때문이다
 * (§4.2의 0단계). EffectiveStats는 읽기 전용이라 소모를 쓸 자리가 없다.
 *
 * 치트가 sim에 닿는 지점은 아래 네 함수뿐이고 dev/cheat-menu.ts는 sim 내부에 접근하지
 * 않는다(05 §14). 넷 모두 스테이지 파라미터를 건드리지 않는데, 검사로 보장한 것이 아니라
 * createWorld가 stageId 하나로 §14.1의 값을 집기 때문이다 — 배율을 넘길 통로 자체가 없다.
 */
import { CARDS } from '../config/cards';
import { HITSTOP_BUDGET_PER_SEC } from '../config/feel';
import type { CardId, ParryGradeId, StageId } from '../config/ids';
import { PROGRESSION } from '../config/progression';
import { bus as globalBus, type FeedbackBus, type Unsubscribe } from '../core/bus';
import { createClock, type Clock } from '../core/clock';
import { createInput, type Input } from '../core/input';
import { FIXED_DT_SEC } from '../core/loop';
import { deriveStream } from '../core/rng';
import type { CardInventory, CardStack } from './cards';
import { awardStageClearBonus } from './score';
import { computeStats, type EffectiveStats } from './stats';
import { stepWorld, type StepFrame } from './step';
import { createWorld, type World } from './world';

/** createWorld가 Rng가 아니라 시드 숫자를 받으므로 스테이지 스트림을 한 번 접어 넘긴다 */
const STAGE_SEED_RANGE = 0x1_0000_0000;

/** 전투 중이 아닌 스텝은 돌지 않는다. 일시정지는 화면 계층이 stepRun을 안 부르는 것이다 */
export type RunPhase = 'combat' | 'cardSelect' | 'result';

/** §12.3 결과 화면의 머리말이 이 값으로 갈린다 */
export type RunResult = 'clear' | 'gameOver';

/** §18.3 진입 지점. waves·boss가 스테이지 시작 때 Run.entry를 읽는다. 정상 진행은 stageStart다 */
export type StageEntry =
  | { readonly kind: 'stageStart' }
  | { readonly kind: 'wave'; readonly waveIndex: number }
  | { readonly kind: 'lull' }
  | { readonly kind: 'bossPhase'; readonly phaseIndex: number };

const STAGE_START: StageEntry = { kind: 'stageStart' };

/**
 * §18.3 치트의 스테이지 자유 입장 한 벌. lives를 생략하면 진입 시점의 값을 유지하고,
 * resetReroll은 카드 추첨 화면을 반복 검증할 때만 쓴다.
 */
export interface StageEntryPoint {
  readonly stageId: StageId;
  readonly at: StageEntry;
  readonly lives?: number;
  readonly resetReroll?: boolean;
}

/**
 * §12.3 결과 화면이 요구하는 집계. 성공률의 분모는 패리 활성 구간이 열린 횟수이고 분자는
 * 그중 1발 이상 처리한 구간의 수다(08 §5.2) — 다중 패리를 여러 성공으로 세면 성공률이
 * 100%를 넘는다. 발사체 개수는 gradeCounts와 콤보가 이미 담고 있다.
 */
export interface RunTally {
  maxCombo: number;
  parryAttempts: number;
  parrySuccesses: number;
  /** 발사체 하나마다 한 번. 활성 구간의 최고 등급이 아니다 */
  gradeCounts: Record<ParryGradeId, number>;
  reparryCount: number;
  /** 반사탄 자해로 잃은 라이프 수 (T-06의 실측 근거) */
  reflectSelfHitLives: number;
}

export interface Run {
  /** 스테이지가 바뀔 때마다 새 것으로 갈린다. 이전 월드의 물체는 하나도 넘어오지 않는다 */
  world: World;
  phase: RunPhase;
  result: RunResult | null;
  stageId: StageId;
  /** 이 스테이지를 어디서 시작했는가. waves·boss가 스테이지 시작 시 읽는다 */
  entry: StageEntry;
  /** §11.2 등급 가중치가 이 값으로 정해진다. 화면을 열기 전에 오른다(08 §1.4 T-04) */
  cardScreenNo: number;
  /** §11.1 획득 순서 그대로. 중첩 수 총합이 곧 완료한 카드 화면 수다(08 §5.3 B) */
  cards: CardStack[];
  rerollUsed: boolean;
  /** §18.5 치트 메뉴를 연 순간부터 런 종료까지 참. 런 도중에는 해제되지 않는다 */
  contaminated: boolean;
  readonly tally: RunTally;
  readonly seed: number;
  readonly clock: Clock;
  readonly bus: FeedbackBus;
  /** 입력이 없는 스텝을 돌릴 때 쓰는 빈 입력. 헤드리스 검증이 프레임을 안 만들어도 되게 한다 */
  readonly idleInput: Input;
  /** createRun이 자기 자신을 넘겨 구독해야 하므로 객체가 만들어진 뒤에 채워진다 */
  detachTally: Unsubscribe;
}

export interface RunSpec {
  readonly seed: number;
  /** 생략하면 §13.3의 재시작 지점과 같은 스테이지에서 시작한다 */
  readonly stageId?: StageId;
  readonly at?: StageEntry;
  readonly clock?: Clock;
  readonly bus?: FeedbackBus;
}

function createTally(): RunTally {
  const gradeCounts: Record<ParryGradeId, number> = { GREAT: 0, GOOD: 0, NOT_BAD: 0 };
  return {
    maxCombo: 0, parryAttempts: 0, parrySuccesses: 0,
    gradeCounts, reparryCount: 0, reflectSelfHitLives: 0,
  };
}

/**
 * §12.3의 집계를 §17의 사건에서 얻는다. 세는 자리는 parry.ts와 collision.ts인데 그 둘은 §5와
 * §4.2의 소유자이지 §12.3의 소유자가 아니다 — 양쪽에서 올리면 카운터의 주인이 둘이 된다.
 */
function attachTally(run: Run, bus: FeedbackBus): Unsubscribe {
  const tally = run.tally;
  const offs = [
    bus.on('parry', (event) => {
      tally.parryAttempts += 1;
      tally.parrySuccesses += 1;
      tally.maxCombo = Math.max(tally.maxCombo, event.combo);
    }),
    bus.on('parryWhiff', () => void (tally.parryAttempts += 1)),
    bus.on('reflectLaunched', (event) => void (tally.gradeCounts[event.grade] += 1)),
    bus.on('reparry', () => void (tally.reparryCount += 1)),
    bus.on('playerHit', (event) => {
      if (event.cause === 'reflectedBullet') {
        tally.reflectSelfHitLives += 1;
      }
    }),
  ];
  return () => {
    for (const off of offs) {
      off();
    }
  };
}

/** 스테이지마다 다른 sim 스트림을 준다. 같은 시드를 다섯 번 쓰면 같은 수열이 다섯 번 흐른다 */
function stageSeed(runSeed: number, stageId: StageId): number {
  return deriveStream(runSeed, `sim/stage/${stageId}`).int(0, STAGE_SEED_RANGE);
}

/** §11.5 E03. 스테이지마다 차오르고 최대에서 멈춘다. 미보유면 두 값이 0이라 항등이다 */
function rechargeShieldAtStageStart(currentCharges: number, stats: EffectiveStats): number {
  return Math.min(currentCharges + stats.shieldChargesPerStage, stats.shieldMaxCharges);
}

/** 스테이지 하나를 세운다. 라이프·점수·카드는 넘어오고 콤보와 월드는 넘어오지 않는다 */
function enterStage(
  run: Run,
  stageId: StageId,
  entry: StageEntry,
  previous: World | null,
  livesOverride: number | null,
): void {
  const stats = computeStats(run.cards);
  const world = createWorld({
    stageId,
    seed: stageSeed(run.seed, stageId),
    clock: run.clock,
    bus: run.bus,
  });
  world.stats = stats;
  if (previous !== null) {
    world.run.score = previous.run.score;
    world.player.lives = previous.player.lives;
  }
  if (livesOverride !== null) {
    world.player.lives = livesOverride;
  }
  world.run.shieldCharges = rechargeShieldAtStageStart(
    previous === null ? 0 : previous.run.shieldCharges,
    stats,
  );
  run.world = world;
  run.stageId = stageId;
  run.entry = entry;
  run.phase = 'combat';
  run.result = null;
}

/** §13.1 런 하나. 08 §1.4의 T-03이 이 함수이고, 상태는 전부 여기서 처음 만들어진다 */
export function createRun(spec: RunSpec): Run {
  const clock = spec.clock ?? createClock(HITSTOP_BUDGET_PER_SEC);
  const bus = spec.bus ?? globalBus;
  const stageId = spec.stageId ?? PROGRESSION.restartStageId;
  // 카드가 0장이라 enterStage가 할 나머지가 전부 항등이고, 부르면 월드를 두 번 만들게 된다
  const world = createWorld({ stageId, seed: stageSeed(spec.seed, stageId), clock, bus });
  world.stats = computeStats([]);
  const run: Run = {
    world,
    phase: 'combat',
    result: null,
    stageId,
    entry: spec.at ?? STAGE_START,
    // §18.3 건너뛴 회차는 소비한 것으로 처리한다 — 다음 카드 화면의 가중치가 정상과 같아야 한다
    cardScreenNo: stageId - 1,
    cards: [],
    rerollUsed: false,
    contaminated: false,
    tally: createTally(),
    seed: spec.seed,
    clock,
    bus,
    idleInput: createInput(),
    detachTally: () => undefined,
  };
  run.detachTally = attachTally(run, bus);
  return run;
}

/** 버스 구독을 끊는다. 런을 버릴 때 부르지 않으면 죽은 런이 계속 집계한다 */
export function disposeRun(run: Run): void {
  run.detachTally();
}

/** 05 §1의 15번 중 런의 몫. 라이프 0은 collision.ts가, 격파 종료는 boss.ts가 확정한다 */
export function stepRun(run: Run, dtSec: number, frame?: StepFrame): void {
  if (run.phase !== 'combat') {
    return;
  }
  stepWorld(run.world, dtSec, frame ?? { input: run.idleInput, untilMs: 0 });
  run.tally.maxCombo = Math.max(run.tally.maxCombo, run.world.run.combo);
  if (run.world.isGameOver) {
    endRun(run, 'gameOver');
  } else if (run.world.boss?.isFinished === true) {
    clearStage(run);
  }
}

/** 헤드리스 검증용. 실기 루프는 core/loop.ts가 이미 누산하므로 stepRun을 직접 부른다 */
export function advanceRun(run: Run, elapsedSec: number, frame?: StepFrame): void {
  const steps = Math.floor(elapsedSec / FIXED_DT_SEC);
  for (let index = 0; index < steps; index += 1) {
    stepRun(run, FIXED_DT_SEC, frame);
  }
}

function endRun(run: Run, result: RunResult): void {
  run.phase = 'result';
  run.result = result;
}

/**
 * 보스 격파 연출이 끝난 시점 — 08 §1.4의 T-04·T-06. 클리어 보너스를 먼저 더한 뒤에 화면을
 * 넘긴다. 마지막 스테이지에도 보너스가 걸리고(§12.1) 카드 화면은 그 앞의 네 번뿐이다(§11.1).
 */
export function clearStage(run: Run): void {
  if (run.phase !== 'combat') {
    throw new Error(`전투 중이 아닌 런을 클리어할 수 없다: ${run.phase}`);
  }
  awardStageClearBonus(run.world, run.world.player.lives);
  if (run.stageId >= PROGRESSION.stageCount) {
    endRun(run, 'clear');
    return;
  }
  run.cardScreenNo += 1;
  run.phase = 'cardSelect';
}

/** §11.1 카드 화면에서 반드시 1장을 고른다. 확정이 곧 다음 스테이지의 시작이다(T-05) */
export function pickCard(run: Run, cardId: CardId): void {
  if (run.phase !== 'cardSelect') {
    throw new Error(`카드 선택 중이 아닌 런에 카드를 줄 수 없다: ${run.phase}`);
  }
  const held = run.cards.find((card) => card.id === cardId);
  applyInventory(
    run,
    held === undefined
      ? [...run.cards, { id: cardId, stack: 1 }]
      : run.cards.map((card) =>
          card.id === cardId ? { id: card.id, stack: card.stack + 1 } : card,
        ),
  );
  enterStage(run, nextStageId(run.stageId), STAGE_START, run.world, null);
}

/** §11.1 리롤은 런당 1회다. 사용 여부만 여기 있고 다시 뽑는 일은 sim/cards.ts가 한다 */
export function markRerollUsed(run: Run): void {
  run.rerollUsed = true;
}

/**
 * §13.3 재시작. 스테이지 1부터이고 카드·라이프·최대 라이프·점수·콤보·리롤 사용 여부·오염
 * 표시가 전부 초기값이다. 새 시드를 인자로 받는 것은 sim이 벽시계도 전역 난수도 만질 수
 * 없기 때문이고(D-05), 추첨이 이전 런과 독립이라는 §13.3의 요구가 그 시드에 걸려 있다.
 */
export function restartRun(run: Run, seed: number): Run {
  disposeRun(run);
  return createRun({
    seed,
    stageId: PROGRESSION.restartStageId,
    clock: run.clock,
    bus: run.bus,
  });
}

/**
 * §18.5 오염 표시. 치트 메뉴를 연 순간 서고 아무것도 바꾸지 않고 닫아도 남는다.
 *
 * 아래 세 함수도 각자 이 표시를 세운다. §18.5가 못 박은 대로 손해가 한쪽으로만 나야 하기
 * 때문이다 — 멀쩡한 런을 오염으로 표시하면 한 판 더 하면 되고, 그 반대는 §14의 근거를 썩힌다.
 */
export function markCheatOpened(run: Run): void {
  run.contaminated = true;
}

/** §18.3 자유 입장. 적·탄환·반사탄·장판 제거와 콤보 0은 월드를 새로 세우는 것이 곧 그것이다 */
export function jumpTo(run: Run, target: StageEntryPoint): void {
  markCheatOpened(run);
  if (target.resetReroll === true) {
    run.rerollUsed = false;
  }
  const lives = target.lives === undefined ? null : clampLives(run, target.lives);
  run.cardScreenNo = target.stageId - 1;
  enterStage(run, target.stageId, target.at, run.world, lives);
}

/** §18.4 카드 직접 지정. 최대 중첩 수는 넘을 수 없고 변경 즉시 §11.6의 9단계가 다시 돈다 */
export function setCards(run: Run, cards: CardInventory): void {
  markCheatOpened(run);
  applyInventory(run, cards);
}

/** §18.3 라이프 지정. 1 ~ 현재 최대 라이프 */
export function setLives(run: Run, lives: number): void {
  markCheatOpened(run);
  run.world.player.lives = clampLives(run, lives);
}

function clampLives(run: Run, lives: number): number {
  return Math.min(Math.max(1, Math.floor(lives)), run.world.stats.maxLife);
}

function nextStageId(stageId: StageId): StageId {
  const next = stageId + 1;
  if (next > PROGRESSION.stageCount) {
    throw new Error(`마지막 스테이지 뒤에는 다음 스테이지가 없다: ${stageId}`);
  }
  return next as StageId;
}

/**
 * 보유 목록을 갈아 끼우고 §11.6의 9단계를 다시 실행한다. 정상 획득과 치트 지정이 같은 경로를
 * 지나는 것은 §18.4가 요구한 것이다 — 치트로 만들 수 있는 빌드의 범위가 정상 플레이의 범위와
 * 같아야 최악 조합 검산 둘이 근거로 남는다. 늘어난 중첩만큼만 즉발 효과가 발동한다.
 */
function applyInventory(run: Run, wanted: CardInventory): void {
  const before = new Map<CardId, number>();
  for (const held of run.cards) {
    before.set(held.id, held.stack);
  }
  const next: CardStack[] = [];
  const added: CardStack[] = [];
  for (const card of wanted) {
    const stack = Math.min(Math.max(0, Math.floor(card.stack)), CARDS[card.id].maxStack);
    if (stack === 0) {
      continue;
    }
    next.push({ id: card.id, stack });
    const delta = stack - (before.get(card.id) ?? 0);
    if (delta > 0) {
      added.push({ id: card.id, stack: delta });
    }
  }
  run.cards = next;
  // R06은 최대치를 올리는 효과와 채우는 효과를 함께 갖는다. 스냅샷이 먼저 갱신돼야 오른
  // 최대치 위에서 채워진다 — 뒤집으면 즉발분이 옛 최대치에 막힌다
  run.world.stats = computeStats(next);
  applyInstantLife(run, added);
}

/** §11.3 N14 · §11.4 R06의 즉발 라이프. 최대치를 넘지 않는다 */
function applyInstantLife(run: Run, added: CardInventory): void {
  let gain = 0;
  for (const card of added) {
    for (const effect of CARDS[card.id].effects) {
      if (effect.kind === 'instantLife') {
        gain += effect.value * card.stack;
      }
    }
  }
  const player = run.world.player;
  player.lives = Math.min(player.lives + gain, run.world.stats.maxLife);
}
