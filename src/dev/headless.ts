/**
 * 헤드리스 밸런스 시뮬 — 09_검증_전략.md §4. 캔버스도 오디오도 없이 sim만 돌리고 숫자 하나를 뱉는다.
 *
 * 09 §1.2가 잡으려는 실패는 하나다 — **테스트는 초록불인데 게임이 안 되는 상태.** 단위 테스트는
 * 그것을 못 잡는다. 규칙은 전부 지켜지는데 플레이가 불가능하거나 시시한 것이 그 실패의 정의라서다.
 *
 * 이 파일은 「어떻게 돌리는가」만 갖는다. 나온 값을 무엇과 대조하는지는 `dev/report.ts`,
 * 사건과 상태를 모으는 일은 `dev/metrics.ts`, 입력을 만드는 일은 `dev/bot.ts`다.
 *
 * ── 이 숫자들이 성립하는 조건 ───────────────────────────────────────────────────
 *
 * D-05(같은 시드 → 같은 결과)와 D-10(치트가 §14.4의 전제인 「카드 미획득 상태」를 만든다). 정상
 * 진행으로는 S3 보스를 카드 0장으로 만날 수 없으므로, 치트 없이는 §14.4 검산표를 실측으로 대조할
 * 방법 자체가 없다. 치트로 만든 런은 §18.5대로 오염이지만 §14의 실측 데이터로는 유효하다 —
 * 오염 표시가 배제하는 것은 점수 기록이지 밸런스 수치가 아니다.
 *
 * ── 리포트 머리에 제약을 찍는다 ─────────────────────────────────────────────────
 *
 * 봇은 y 하한을 적 활동 영역 아래로 고정한다(S-04). 그 위로 올라가면 보스의 발사원 전체가 HR-09로
 * 억제되어 측정이 숫자 대신 guard-violation으로 끝난다. 대가는 **플레이어 영역의 약 30%를 한 번도
 * 안 밟는다**는 것이고, 그 사실이 값과 같이 다녀야 한다. `constraints`가 그 자리다.
 *
 * ── 지금 이 시뮬이 못 하는 것 ───────────────────────────────────────────────────
 *
 * `sim/run.ts`의 `Run.entry`(§18.3의 웨이브·소강·보스 페이즈 지정)를 읽는 코드가 sim 어디에도
 * 아직 없다. `jumpTo`는 스테이지 교체까지만 실제로 하고 진입 지점은 상태로만 남는다. 그래서 보스
 * 시나리오도 웨이브를 실제로 지나 보스를 만나고, 격파 시간은 **보스 등장 시점부터** 잰다 —
 * 값은 §14.4와 같은 축 위에 있지만 「페이즈 1부터 진입」이라는 조건은 아직 아니다.
 * `run.entry.applied`가 그 사실을 매 리포트에 적는다.
 *
 * ── npm run verify에 어떻게 붙는가 ──────────────────────────────────────────────
 *
 * `sim/guards.ts`의 `GUARDS_ENABLED`가 `import.meta.env.DEV`라 맨 node에서는 읽을 수 없다.
 * 그래서 이 파일은 스스로 실행되지 않고 함수만 낸다 — `tests/`가 `runAllScenarios`를 부르면
 * `npm run verify`의 vitest 안에서 가드가 살아 있는 채로 돈다.
 */
import { STAGE_SCALING } from '../config/difficulty';
import { HITSTOP_BUDGET_PER_SEC } from '../config/feel';
import type { CardId, StageId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import { bus } from '../core/bus';
import { FIXED_DT_SEC } from '../core/loop';
import { deriveStream, type Rng } from '../core/rng';
import { drawOffer, type CardRound } from '../sim/cards';
import { createRun, disposeRun, jumpTo, pickCard, setCards, stepRun, type Run } from '../sim/run';
import { BOT_POLICY, createBot } from './bot';
import { createMetrics, ZONE_CAP, type Metrics } from './metrics';
import { scenarios, type ScenarioSpec } from './scenarios';
import {
  bossRowOf, meanGradeMulOf, peaksVerdict, percentile, playerYRangeOf, stagePeakRowsOf, stageRowOf,
  REPORT_SCHEMA, SELF_HARM_LIMIT, T02_MEAN_GRADE_MUL, T02_SUCCESS_RATE, T05_MIN_KILL_SEC,
  type BalanceReport, type BossTrace, type SimStatus, type StageRow, type Verdict,
} from './report';

const MS_PER_SEC = 1000;

/** 캘리브레이션이 훑는 구간 (u). 아래는 오차가 거의 없는 봇, 위는 거의 못 치는 봇이다 */
const SIGMA_SEARCH_MIN_U = 1;
const SIGMA_SEARCH_MAX_U = 60;

/** 캘리브레이션 탐색이 도는 스테이지와 길이. S1은 편성이 얇아 프로브가 싸다 */
const CALIBRATION_STAGE_ID: StageId = 1;
const CALIBRATION_PROBE_SEC = 45;
/** sigma 한 점을 재는 판 수. 한 판의 시행이 수십이라 이 수만큼 합쳐야 이분법이 잡음을 안 탄다 */
const CALIBRATION_PROBE_RUNS = 4;
/** 프로브 시드를 뽑는 구간. 런 시드 하나에서 파생하므로 캘리브레이션도 재현된다(D-05) */
const PROBE_SEED_RANGE = 0x1_0000_0000;

/**
 * 캘리브레이션이 표적을 못 감쌌을 때 쓰는 오차 (u).
 *
 * 경계값(sigma 60)을 그대로 쓰면 봇이 거의 못 치고 10초 안에 죽어 시나리오가 통째로 빈 리포트가
 * 된다. 그래서 실측 곡선에서 생존 sim 시간이 가장 길었던 자리를 기본값으로 둔다 — **T-02에
 * 맞춘 값이 아니고**, 그 사실은 `SuiteResult.calibration.bracketed`가 거짓인 것으로 남는다.
 */
const DEFAULT_TIMING_SIGMA_U = 12;


/** 위반이 이어지는 구간에서는 스텝마다 같은 문장이 온다. 원인 파악에 필요한 만큼만 남긴다 */
const MAX_GUARD_MESSAGES = 20;

interface DriveResult {
  readonly status: SimStatus;
  readonly guards: string[];
  readonly bosses: BossTrace[];
  /** 스테이지별 클리어 시각 (그 스테이지의 누적 sim 초) */
  readonly stages: Map<StageId, number>;
  readonly stepMs: number[];
  simSec: number;
}

/**
 * §11.2 추첨 한 장. `hideConditions`를 비워 두는 것은 그 목록을 만드는 자리가 카드 화면이기
 * 때문이고(런 상태를 봐야 안다), 비우면 풀이 넓어지기만 하므로 밸런스를 낙관 쪽으로 밀지 않는다.
 */
function autoPick(run: Run, rng: Rng): CardId | null {
  const round = run.cardScreenNo as CardRound;
  return drawOffer({ round, held: run.cards, hideConditions: [] }, rng)[0] ?? null;
}

/**
 * 시나리오 하나를 끝까지 돌린다. sim에 쓰는 것은 `stepRun`·`pickCard`뿐이고 나머지는 읽기다.
 *
 * 가드 위반은 던져서 올라온다(09 §2.1). 잡아서 상태로 남기는 것은 리포트가 「어디까지 갔는지」를
 * 함께 실어야 원인을 좁힐 수 있기 때문이고, 삼키는 것이 아니라 status를 빨간불로 바꾼다.
 */
function drive(run: Run, spec: ScenarioSpec, metrics: Metrics): DriveResult {
  const bot = createBot({ rng: deriveStream(spec.seed, 'dev/bot'), timingSigmaU: spec.timingSigmaU });
  const cardRng = deriveStream(spec.seed, 'dev/headless/cards');
  const result: DriveResult = {
    status: 'timeout', guards: [], bosses: [], stages: new Map(), stepMs: [], simSec: 0,
  };
  const maxSteps = Math.ceil(spec.maxSimSec / FIXED_DT_SEC);
  let trace: BossTrace | null = null;

  /** 위반을 적어 두고 계속 돈 런은 끝까지 갔더라도 초록불이 아니다 */
  function finish(status: SimStatus): DriveResult {
    return { ...result, status: result.guards.length > 0 ? 'guard-violation' : status };
  }

  for (let step = 0; step < maxSteps; step += 1) {
    if (run.phase === 'result') {
      // 마지막 스테이지에는 카드 화면이 없다. 여기서 안 적으면 S5의 클리어 시간만 리포트에서 빠진다
      if (run.result === 'clear') {
        result.stages.set(run.stageId, run.world.simTimeSec);
      }
      return finish(run.result === 'gameOver' ? 'gameOver' : 'ok');
    }
    if (run.phase === 'cardSelect') {
      result.stages.set(run.stageId, run.world.simTimeSec);
      const picked = spec.autoPickCards ? autoPick(run, cardRng) : null;
      if (picked === null) {
        return finish('ok');
      }
      pickCard(run, picked);
      trace = null;
      continue;
    }

    const world = run.world;
    metrics.beforeStep(world);
    const untilMs = bot.beginStep(run);
    const startedMs = performance.now();
    try {
      stepRun(run, FIXED_DT_SEC, { input: bot.input, untilMs });
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!result.guards.includes(message) && result.guards.length < MAX_GUARD_MESSAGES) {
        result.guards.push(message);
      }
      if (spec.stopOnGuardViolation) {
        return finish('guard-violation');
      }
      // 가드는 05 §1의 16번, 즉 스텝의 거의 끝에서 던진다. 뒤에 남은 것은 17번(큐 배출)뿐이라
      // 세계는 온전하고, 화면 전환은 stepRun의 finally가 이미 확정해 두었다. 그 finally가
      // 없으면 여기서 계속 돌아도 클리어·게임오버가 영원히 안 걸려 런이 그 자리에 멈춘다
      run.bus.flush();
    }
    result.stepMs.push(performance.now() - startedMs);
    metrics.afterStep(world, FIXED_DT_SEC);
    result.simSec = world.simTimeSec;

    const boss = world.boss;
    if (boss === null) {
      continue;
    }
    if (trace === null) {
      trace = { bossId: boss.def.id, appearedSec: world.simTimeSec, defeatedSec: null };
      result.bosses.push(trace);
    }
    if (trace.defeatedSec === null && boss.mode === 'defeated') {
      // 격파 연출 2.0초는 격파 시간이 아니다. HP가 0이 된 시각이 §14.4가 말하는 그 값이다
      trace.defeatedSec = world.simTimeSec;
    }
  }
  return finish('timeout');
}

/** 시나리오 하나 → 리포트 하나. 같은 인자는 언제나 같은 리포트를 낸다(D-05) */
export function runScenario(spec: ScenarioSpec): BalanceReport {
  // 버스는 게임 전체가 하나를 쓴다(core/bus.ts). 앞 시나리오의 구독이 남으면 죽은 런이 계속
  // 집계하므로, 런과 계측을 세우기 전에 비우는 것이 시나리오 사이의 유일한 격리다
  bus.reset();
  const run = createRun({ seed: spec.seed, stageId: spec.stageId });
  const usedCheat = spec.cards.length > 0 || spec.at.kind !== 'stageStart';
  if (spec.cards.length > 0) {
    setCards(run, spec.cards);
  }
  if (spec.at.kind !== 'stageStart') {
    jumpTo(run, { stageId: spec.stageId, at: spec.at });
  }

  const metrics = createMetrics(bus);
  const startedMs = performance.now();
  const driven = drive(run, spec, metrics);
  const wallSec = (performance.now() - startedMs) / MS_PER_SEC;
  const data = metrics.data;
  metrics.detach();

  const parry = data.parry;
  const reflect = data.reflect;
  const successRate = parry.attempts === 0 ? 0 : parry.successes / parry.attempts;
  const hitRate = reflect.spawned === 0 ? 0 : reflect.hitSomething / reflect.spawned;
  const selfHarmPct = data.hits.total === 0 ? 0 : data.hits.byCause.reflectedBullet / data.hits.total;
  const meanGradeMul = meanGradeMulOf(parry.grades);
  const sortedStepMs = [...driven.stepMs].sort((left, right) => left - right);
  // 보스 HP 감소는 런 전체의 합계다. 한 시나리오가 보스를 여럿 지나면 그 수로 나눠야 DPS가 된다
  const bossDamagePerBoss = driven.bosses.length === 0 ? 0 : reflect.bossDamage / driven.bosses.length;
  const contaminated = run.contaminated;
  const stages: StageRow[] = [...driven.stages.entries()].map(([id, sec]) => stageRowOf(id, sec));
  const playerYU = playerYRangeOf(data);
  disposeRun(run);

  return {
    schema: REPORT_SCHEMA,
    constraints: [
      `봇은 y ≥ ${BOT_POLICY.minYU}u를 유지한다(S-04). 실제로 밟은 구간은 ` +
        (playerYU === null
          ? '없다 — 스텝이 한 번도 안 돌았다'
          : `y ${playerYU.minU.toFixed(0)}~${playerYU.maxU.toFixed(0)}u, ` +
            `§3.1 플레이어 이동 영역(620~1830u)의 ${playerYU.boundsPct.toFixed(1)}%다`),
      '봇은 x축으로만 정렬하고 반사탄을 쫓지 않는다 — T-02의 재패리 0회 전제를 지키기 위해서다',
      'Run.entry를 읽는 sim 코드가 아직 없다. 보스 시나리오도 웨이브를 실제로 지나 보스를 만난다',
      'HR-03 면제의 셋째 칸(unattributed)은 관측이 아니라 추정이다 — 가드의 집계는 밖에서 못 읽는다',
    ],
    run: {
      scenario: spec.id,
      seed: spec.seed,
      input: { mode: 'bot', timingSigmaU: spec.timingSigmaU, reactionSteps: BOT_POLICY.reactionSteps },
      entry: {
        via: usedCheat ? 'cheat' : 'normal',
        stageId: spec.stageId,
        at: spec.at,
        cards: spec.cards,
        applied: 'stageStart',
      },
      simSec: driven.simSec,
      wallSec,
      speedup: wallSec === 0 ? 0 : driven.simSec / wallSec,
      status: driven.status,
      stopOnGuardViolation: spec.stopOnGuardViolation,
      contaminated,
    },
    calibration: {
      targetSuccessRate: T02_SUCCESS_RATE,
      measuredSuccessRate: successRate,
      targetMeanGradeMul: T02_MEAN_GRADE_MUL,
      measuredMeanGradeMul: meanGradeMul,
    },
    parry: {
      attempts: parry.attempts,
      successes: parry.successes,
      empty: parry.empty,
      successRate,
      grades: parry.grades,
      meanGradeMul,
      effectiveParriesPerSec: data.simSec === 0 ? 0 : parry.successes / data.simSec,
      reparries: parry.reparries,
      reparryGrades: parry.reparryGrades,
      meanReflectsPerParry: parry.successes === 0 ? 0 : parry.reflectedTotal / parry.successes,
      maxReflectsPerParry: parry.maxSimultaneous,
    },
    reflect: { ...reflect, hitRate },
    bosses: driven.bosses.map((trace) => bossRowOf(trace, hitRate, bossDamagePerBoss)),
    stages,
    hits: {
      total: data.hits.total,
      byCause: data.hits.byCause,
      selfHarmPct,
      verdict: selfHarmPct >= SELF_HARM_LIMIT ? 'fail' : 'pass',
    },
    peaks: {
      enemyBullets: data.peaks.enemyBullets,
      enemyBulletCap: STAGE_SCALING[spec.stageId].maxEnemyBullets,
      reflects: data.peaks.reflects,
      reflectCap: PLAYFIELD.maxReflectBullets,
      enemies: data.peaks.enemies,
      enemyCap: PLAYFIELD.maxEnemies,
      enemySpawnDeferrals: data.peaks.enemySpawnDeferrals,
      zones: data.peaks.zones,
      zoneCap: ZONE_CAP,
      verdict: peaksVerdict(data.peaks, spec.stageId),
    },
    peaksByStage: stagePeakRowsOf(data),
    hitstop: {
      maxPerSecondSec: data.maxHitstopPerSecSec,
      capSec: HITSTOP_BUDGET_PER_SEC,
      verdict: data.maxHitstopPerSecSec > HITSTOP_BUDGET_PER_SEC ? 'fail' : 'pass',
    },
    hr03: data.emptySpans,
    playerYU,
    perf: {
      simStepMsP50: percentile(sortedStepMs, 0.5),
      simStepMsP99: percentile(sortedStepMs, 0.99),
      renderMs: null,
    },
    guards: driven.guards,
  };
}

/**
 * sigma 하나의 성공률. 프로브 한 판의 시행 수가 수십 단위라 한 판으로 재면 이분법이 잡음을 따라
 * 엉뚱한 쪽으로 접힌다. 그래서 파생 시드 여러 판을 돌려 **분자와 분모를 합친 뒤에** 나눈다 —
 * 판별 성공률의 평균이 아니라 시행 전체의 성공률이어야 표본이 적은 판에 끌려가지 않는다.
 */
function probeSuccessRate(seed: number, sigmaU: number, runs: number): number {
  let attempts = 0;
  let successes = 0;
  for (let index = 0; index < runs; index += 1) {
    const probe = runScenario({
      id: `calibrate-${sigmaU.toFixed(3)}-${index}`,
      seed: deriveStream(seed, `dev/headless/probe/${index}`).int(0, PROBE_SEED_RANGE),
      stageId: CALIBRATION_STAGE_ID, at: { kind: 'stageStart' }, cards: [],
      maxSimSec: CALIBRATION_PROBE_SEC, autoPickCards: false, timingSigmaU: sigmaU,
      // 프로브가 HR-03에서 멈추면 시행 수가 모자라 성공률이 잡음이 된다
      stopOnGuardViolation: false,
    });
    attempts += probe.parry.attempts;
    successes += probe.parry.successes;
  }
  return attempts === 0 ? 0 : successes / attempts;
}

export interface CalibrationResult {
  readonly timingSigmaU: number;
  readonly measuredSuccessRate: number;
  readonly targetSuccessRate: number;
  /**
   * 탐색 구간이 표적 성공률을 감쌌는가. 거짓이면 `timingSigmaU`는 경계값이고, 그 봇으로 잰
   * 격파 시간은 T-02의 전제 위에 있지 않다 — §14.4와 대조하기 전에 이 값을 먼저 본다.
   */
  readonly bracketed: boolean;
}

/**
 * 봇의 목표 거리 오차를 T-02의 성공률 50%에 맞춘다. **격파 시간을 재기 전에 이것부터 한다** —
 * 성공률 100%짜리 봇으로 잰 값은 §14.4의 어떤 칸과도 비교할 수 없다.
 *
 * 구간이 표적을 감싸는지 양 끝에서 먼저 본다. 못 감싸면 이분법이 경계로 접혀 아무 뜻 없는 값을
 * 내는데, 그 값이 조용히 리포트에 들어가면 「T-02에 맞춘 봇」이라는 거짓말이 숫자에 붙는다.
 * 09 §4.6이 T-02를 "판정하지 않는다, 경보만"으로 둔 것과 같은 처리다.
 */
export function calibrateBot(seed: number, rounds: number): CalibrationResult {
  let lowU = SIGMA_SEARCH_MIN_U;
  let highU = SIGMA_SEARCH_MAX_U;
  const atLow = probeSuccessRate(seed, lowU, CALIBRATION_PROBE_RUNS);
  const atHigh = probeSuccessRate(seed, highU, CALIBRATION_PROBE_RUNS);
  if (atLow <= T02_SUCCESS_RATE || atHigh >= T02_SUCCESS_RATE) {
    const useHigh = Math.abs(atHigh - T02_SUCCESS_RATE) < Math.abs(atLow - T02_SUCCESS_RATE);
    return {
      timingSigmaU: useHigh ? highU : lowU,
      measuredSuccessRate: useHigh ? atHigh : atLow,
      targetSuccessRate: T02_SUCCESS_RATE,
      bracketed: false,
    };
  }
  let measured = atHigh;
  for (let round = 0; round < rounds; round += 1) {
    const midU = (lowU + highU) / 2;
    measured = probeSuccessRate(seed, midU, CALIBRATION_PROBE_RUNS);
    if (measured > T02_SUCCESS_RATE) {
      lowU = midU;
    } else {
      highU = midU;
    }
  }
  return {
    timingSigmaU: (lowU + highU) / 2,
    measuredSuccessRate: measured,
    targetSuccessRate: T02_SUCCESS_RATE,
    bracketed: true,
  };
}

export { scenarios, type ScenarioSpec };

export interface SuiteResult {
  readonly calibration: CalibrationResult;
  /** 시나리오가 실제로 쓴 오차 (u). 캘리브레이션이 표적을 못 감쌌으면 기본값이다 */
  readonly appliedSigmaU: number;
  readonly reports: readonly BalanceReport[];
}

/** `npm run verify`가 붙는 자리. 캘리브레이션 → 시나리오 순서가 09 §4.2의 요구 그대로다 */
export function runAllScenarios(
  seed: number,
  calibrationRounds: number,
  stopOnGuardViolation: boolean,
): SuiteResult {
  const calibration = calibrateBot(seed, calibrationRounds);
  const appliedSigmaU = calibration.bracketed ? calibration.timingSigmaU : DEFAULT_TIMING_SIGMA_U;
  return {
    calibration,
    appliedSigmaU,
    reports: scenarios(seed, appliedSigmaU, stopOnGuardViolation).map(runScenario),
  };
}

/** T-05는 별도 판정이다 — B5를 20초 미만에 격파하면 카드 계수를 낮춘다 */
export function judgeT05(report: BalanceReport): Verdict {
  const killSec = report.bosses.find((boss) => boss.id === 'B5')?.killSec ?? null;
  if (killSec === null) {
    return 'no-band';
  }
  return killSec < T05_MIN_KILL_SEC ? 'fail' : 'pass';
}
