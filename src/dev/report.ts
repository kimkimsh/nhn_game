/**
 * 밸런스 리포트의 형태와 판정 — 09_검증_전략.md §4.3(리포트 형태) · §4.4(허용 범위) · §4.5(손익분기).
 *
 * 시뮬을 돌리는 일은 `dev/headless.ts`가 하고 여기는 **나온 숫자를 무엇과 대조하는가**만 갖는다.
 * 둘을 한 파일에 두면 밴드를 고치는 사람이 시뮬 루프를 열게 되고, 그 순간 "측정을 통과시키려고
 * 합격선을 옮겼는가"가 diff에서 안 보인다.
 *
 * ── 밴드가 없는 칸은 지어내지 않는다 ────────────────────────────────────────────
 *
 * 09 §4.4의 규칙 하나 — 출처 열이 비어 있는 값은 없다. 스펙이 밴드를 주지 않은 항목은
 * `'no-band'`로 남고 판정하지 않는다. `reflect.hitRate`가 그 대표다: §14.4가 B3·B5의 여유를
 * "실측 필요"로 열어 두었으므로 **재는 것 자체가 이 시뮬의 첫 목적**이고 밴드는 실측 뒤에 생긴다.
 */
import { BOSSES } from '../config/bosses';
import { STAGE_SCALING } from '../config/difficulty';
import type { BossId, StageId } from '../config/ids';
import { PARRY_BANDS } from '../config/parry';
import { PLAYFIELD } from '../config/playfield';
import type { BossDef } from '../config/types';
import type { CardInventory } from '../sim/cards';
import type { StageEntry } from '../sim/run';
import { ZONE_CAP, type MetricsData, type PeakMetrics } from './metrics';

export const REPORT_SCHEMA = 'hwando-balance-report/1';

/** §14.3 T-04. 목표 길이 대비 이 비율을 벗어나면 웨이브 시간이 아니라 적 HP 배율부터 조정한다 */
export const LENGTH_TOLERANCE = 0.15;

/** §14.3 T-06. 반사탄 자해가 전체 피격의 이 비율을 넘으면 자해 유예부터 올린다 */
export const SELF_HARM_LIMIT = 0.15;

/** §14.3 T-05. 최상급 4장 빌드가 B5를 이보다 빨리 격파하면 카드 계수를 낮춘다 (s) */
export const T05_MIN_KILL_SEC = 20;

/**
 * 09 §4.4 — §9.7이 실제로 요구한 것은 숫자 20이 아니라 「신규 스폰이 지연되는 상황이 의도적으로
 * 발생하는 유일한 구간」이다. W5 편성이 16기이고 W4의 잔존 후보가 E-I 3기뿐이라 `== 20`은 편성이
 * 줄 수 없는 수이고, 그대로 두면 리포트가 영구 빨간불이 된다. 못 채우면 손대는 것은 이 두 값이
 * 아니라 W4의 잔류형(E-I)을 3 → 5로 올리는 쪽이다.
 */
export const S5_MIN_PEAK_ENEMIES = 18;
export const S5_MIN_SPAWN_DEFERRALS = 1;

/**
 * 스펙 §14.1 「동시 잡몹 최대 도달치」 행. **합격선이 아니라 대조용 참조 열이다** —
 * 09 §4.4가 합격선으로 준 것은 상한 20기와 S5의 하한 둘뿐이고, 나머지 스테이지에 이 값을
 * 밴드로 걸면 스펙이 주지 않은 밴드를 지어내는 것이 된다.
 */
export const SPEC_PEAK_ENEMIES: Readonly<Record<StageId, number>> = {
  1: 10, 2: 12, 3: 10, 4: 18, 5: 20,
};

/** §14.3 T-02의 전제. 캘리브레이션이 맞추는 표적이고 이 축으로는 판정하지 않는다 */
export const T02_SUCCESS_RATE = 0.5;
export const T02_MEAN_GRADE_MUL = 2.0;

/**
 * §14.4 「추정 DPS」 열. `config/`에 없는 값이라 여기가 유일 소스다 — T-01이 그 열을 실측으로
 * 갈아 끼우라고 지시했으므로 게임이 읽는 값이 아니라 리포트의 입력이다. 손익분기 명중률
 * `h* = 필요 DPS / 추정 DPS`가 이 표에서만 나오고, `measuredHitRate`와의 대소가 곧 T-01의 판정이다.
 */
const SPEC_ESTIMATED_DPS: Readonly<Record<BossId, number>> = {
  B1: 58.2, B2: 100.5, B3: 297, B4: 150.8, B5: 299.5,
};

/**
 * §14.4 — B1의 여유 −4%는 그대로 두기로 했다. "24초가 실제로는 약 25초가 된다는 뜻이고 ...
 * 오히려 첫 보스가 약간 버텨 주는 편이 학습 구간에 맞다." 그래서 B1만 상단 밴드가 1초 넓다.
 */
const B1_SLACK_SEC = 1;

export type SimStatus = 'ok' | 'gameOver' | 'timeout' | 'guard-violation';
export type Verdict = 'pass' | 'fail' | 'alert-T-01' | 'no-band';

/** 보스 하나의 등장·격파 시각 (해당 스테이지의 누적 sim 초). 시뮬이 채우고 여기가 읽는다 */
export interface BossTrace {
  readonly bossId: BossId;
  appearedSec: number;
  /** HP가 0이 된 시각. 격파 연출 2.0초는 여기 안 들어간다 */
  defeatedSec: number | null;
}

export interface BossRow {
  readonly id: BossId;
  /** 본체 + 파괴 가능 부위. B3의 필요 DPS 110.3이 2000이 아니라 3200에서 나온다 */
  readonly totalHp: number;
  readonly killSec: number | null;
  readonly targetSec: number;
  readonly deltaPct: number | null;
  readonly requiredDps: number;
  readonly estimatedDps: number;
  readonly measuredDps: number | null;
  readonly breakEvenHitRate: number;
  readonly measuredHitRate: number | null;
  readonly verdict: Verdict;
}

export interface StageRow {
  readonly id: StageId;
  readonly clearSec: number | null;
  readonly targetSec: number;
  readonly deltaPct: number | null;
  readonly verdict: Verdict;
}

/** 스테이지 하나가 실제로 도달한 동시 존재 수. 상한이 스테이지마다 다르므로 대조도 여기서 한다 */
export interface StagePeakRow {
  readonly id: StageId;
  readonly enemies: number;
  /** 스펙 §14.1의 대조값. 밴드가 아니다 */
  readonly specEnemies: number;
  readonly enemyBullets: number;
  readonly enemyBulletCap: number;
  readonly enemySpawnDeferrals: number;
  readonly reflects: number;
  readonly zones: number;
  readonly verdict: Verdict;
}

export interface BalanceReport {
  readonly schema: typeof REPORT_SCHEMA;
  /** 리포트 머리. 이 값들이 어떤 봇으로 나온 것인지가 값과 같이 다닌다 */
  readonly constraints: readonly string[];
  readonly run: {
    readonly scenario: string;
    readonly seed: number;
    readonly input: {
      readonly mode: 'bot';
      readonly timingSigmaU: number;
      readonly reactionSteps: number;
    };
    readonly entry: {
      readonly via: 'cheat' | 'normal';
      readonly stageId: StageId;
      readonly at: StageEntry;
      readonly cards: CardInventory;
      /** sim이 실제로 적용한 것. `Run.entry`를 읽는 코드가 없어 지금은 언제나 stageStart다 */
      readonly applied: 'stageStart';
    };
    readonly simSec: number;
    readonly wallSec: number;
    readonly speedup: number;
    readonly status: SimStatus;
    /** 09 §2.1의 「위반이면 중단」을 지켰는가. 거짓이면 위반을 적어 두고 계속 잰 값이다 */
    readonly stopOnGuardViolation: boolean;
    /** §18.5 — 치트를 쓴 런이다. 배제되는 것은 점수 기록이지 §14의 밸런스 수치가 아니다 */
    readonly contaminated: boolean;
  };
  readonly calibration: {
    readonly targetSuccessRate: number;
    readonly measuredSuccessRate: number;
    readonly targetMeanGradeMul: number;
    readonly measuredMeanGradeMul: number;
  };
  readonly parry: {
    readonly attempts: number;
    readonly successes: number;
    readonly empty: number;
    readonly successRate: number;
    readonly grades: MetricsData['parry']['grades'];
    readonly meanGradeMul: number;
    readonly effectiveParriesPerSec: number;
    readonly reparries: number;
    readonly reparryGrades: MetricsData['parry']['reparryGrades'];
    /** D-09 — 패리 한 번이 동시에 반사한 발수 */
    readonly meanReflectsPerParry: number;
    readonly maxReflectsPerParry: number;
  };
  readonly reflect: MetricsData['reflect'] & {
    /** R-03이 지목한 미측정 축. 허용 범위는 없다 — 재는 것 자체가 이 시뮬의 첫 목적이다 */
    readonly hitRate: number;
  };
  readonly bosses: readonly BossRow[];
  readonly stages: readonly StageRow[];
  readonly hits: {
    readonly total: number;
    readonly byCause: MetricsData['hits']['byCause'];
    readonly selfHarmPct: number;
    readonly verdict: Verdict;
  };
  readonly peaks: {
    readonly enemyBullets: number;
    readonly enemyBulletCap: number;
    readonly reflects: number;
    readonly reflectCap: number;
    readonly enemies: number;
    readonly enemyCap: number;
    readonly enemySpawnDeferrals: number;
    readonly zones: number;
    readonly zoneCap: number;
    readonly verdict: Verdict;
  };
  /** 09 §4.4가 §14.1과 대조하라고 지시한 스테이지별 도달치. 런 전체의 최대치 하나로는 못 맞춘다 */
  readonly peaksByStage: readonly StagePeakRow[];
  readonly hitstop: {
    readonly maxPerSecondSec: number;
    readonly capSec: number;
    readonly verdict: Verdict;
  };
  /** 09 §4.4가 요구한 HR-03 면제 구간 표. 셋째 칸은 관측이 아니라 추정이다(metrics.ts 참고) */
  readonly hr03: MetricsData['emptySpans'];
  /** S-04의 대가를 관측으로 남긴 값. 밟은 적이 없으면 null이다 */
  readonly playerYU: { readonly minU: number; readonly maxU: number; readonly boundsPct: number } | null;
  readonly perf: {
    readonly simStepMsP50: number;
    readonly simStepMsP99: number;
    /** 캔버스가 없으므로 렌더 시간은 잴 수 없다. T-07은 09 §6의 실기 게이트가 맡는다 */
    readonly renderMs: null;
  };
  readonly guards: readonly string[];
}

/** §5.3 등급 배수. 평균 등급을 T-02의 GOOD(×2.0)과 대조하려면 이 표를 지나야 한다 */
function gradeMul(grade: keyof MetricsData['parry']['grades']): number {
  return PARRY_BANDS.find((band) => band.id === grade)?.damageMul ?? 1;
}

export function meanGradeMulOf(grades: MetricsData['parry']['grades']): number {
  const total = grades.GREAT + grades.GOOD + grades.NOT_BAD;
  if (total === 0) {
    return 0;
  }
  const weighted =
    grades.GREAT * gradeMul('GREAT') +
    grades.GOOD * gradeMul('GOOD') +
    grades.NOT_BAD * gradeMul('NOT_BAD');
  return weighted / total;
}

/** §10.4 B3의 포문 4 × 300은 `BossDef.hp`에 없다. 필요 DPS는 그 합계에서 나온다 */
export function totalBossHp(bossId: BossId): number {
  // BOSSES는 as const라 B3만 갖는 parts가 다섯 중 하나의 타입에만 있다. 계약은 BossDef다
  const def: BossDef = BOSSES[bossId];
  let total = def.hp;
  for (const part of def.parts ?? []) {
    total += part.hp;
  }
  return total;
}

/**
 * 09 §4.5의 손익분기 명중률 `h* = 필요 DPS / 추정 DPS`. 보스를 만나지 못한 리포트도 이 값은
 * 낼 수 있어야 한다 — 실측 `h`가 h*의 어느 쪽인지가 T-01의 판정이라, 만나지도 못한 보스에
 * 대해서도 「얼마가 필요했는가」는 표에 남아야 다음 조정의 근거가 된다.
 */
export function breakEvenHitRateOf(bossId: BossId): number {
  return totalBossHp(bossId) / BOSSES[bossId].targetKillSec / SPEC_ESTIMATED_DPS[bossId];
}

export function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

/**
 * §14.4 검산표 한 줄. 밴드 이탈은 `alert-T-01`이고 **HP를 자동으로 고치지 않는다** —
 * 재산정은 실측 `h`를 얻은 뒤 `HP_new = HP × (h / h*)`로 사람이 하고 그 결과를 §14.4에 다시 적는다.
 */
export function bossRowOf(trace: BossTrace, hitRate: number, bossDamage: number): BossRow {
  const targetSec = BOSSES[trace.bossId].targetKillSec;
  const totalHp = totalBossHp(trace.bossId);
  const requiredDps = totalHp / targetSec;
  const estimatedDps = SPEC_ESTIMATED_DPS[trace.bossId];
  const killSec = trace.defeatedSec === null ? null : trace.defeatedSec - trace.appearedSec;
  const slackSec = trace.bossId === 'B1' ? B1_SLACK_SEC : 0;
  const withinBand =
    killSec !== null &&
    killSec >= targetSec * (1 - LENGTH_TOLERANCE) &&
    killSec <= targetSec * (1 + LENGTH_TOLERANCE) + slackSec;
  return {
    id: trace.bossId,
    totalHp,
    killSec,
    targetSec,
    deltaPct: killSec === null ? null : ((killSec - targetSec) / targetSec) * 100,
    requiredDps,
    estimatedDps,
    measuredDps: killSec === null || killSec <= 0 ? null : bossDamage / killSec,
    breakEvenHitRate: breakEvenHitRateOf(trace.bossId),
    measuredHitRate: hitRate,
    verdict: withinBand ? 'pass' : 'alert-T-01',
  };
}

/** §9.2 목표 길이에 T-04의 ±15%. 벗어나면 손대는 것은 웨이브 시간이 아니라 적 HP 배율이다 */
export function stageRowOf(id: StageId, clearSec: number | null): StageRow {
  const targetSec = STAGE_SCALING[id].targetLengthSec;
  const deltaPct = clearSec === null ? null : ((clearSec - targetSec) / targetSec) * 100;
  const within = deltaPct !== null && Math.abs(deltaPct) < LENGTH_TOLERANCE * 100;
  return {
    id, clearSec, targetSec, deltaPct,
    verdict: clearSec === null ? 'no-band' : within ? 'pass' : 'fail',
  };
}

export function peaksVerdict(peaks: PeakMetrics, stageId: StageId): Verdict {
  if (
    peaks.enemyBullets > STAGE_SCALING[stageId].maxEnemyBullets ||
    peaks.reflects > PLAYFIELD.maxReflectBullets ||
    peaks.enemies > PLAYFIELD.maxEnemies ||
    peaks.zones > ZONE_CAP
  ) {
    return 'fail';
  }
  // §9.7의 밀도 요구는 S5에만 있다. 다른 스테이지에서 18기를 요구하면 편성이 주지 않는 수가 된다
  if (stageId !== 5) {
    return 'pass';
  }
  const dense =
    peaks.enemies >= S5_MIN_PEAK_ENEMIES &&
    peaks.enemySpawnDeferrals >= S5_MIN_SPAWN_DEFERRALS;
  return dense ? 'pass' : 'fail';
}

/**
 * 밟은 y 구간과 그것이 §3.1 플레이어 이동 영역의 몇 %인가. 09 §4.2가 "약 30%를 안 밟는다"고
 * 미리 적어 두었지만 그 값은 정책에서 나온 추정이고, 여기는 실제로 지난 구간을 잰다.
 */
export function playerYRangeOf(data: MetricsData): BalanceReport['playerYU'] {
  const { minU, maxU } = data.playerYU;
  if (!Number.isFinite(minU) || !Number.isFinite(maxU)) {
    return null;
  }
  const bounds = PLAYFIELD.playerBounds;
  return { minU, maxU, boundsPct: ((maxU - minU) / (bounds.maxYU - bounds.minYU)) * 100 };
}

/** 스테이지별 도달치 표. 밟지 않은 스테이지는 줄이 없다 — 0으로 채우면 「안 갔다」가 「0이었다」가 된다 */
export function stagePeakRowsOf(data: MetricsData): StagePeakRow[] {
  return [...data.peaksByStage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([id, peaks]) => ({
      id,
      enemies: peaks.enemies,
      specEnemies: SPEC_PEAK_ENEMIES[id],
      enemyBullets: peaks.enemyBullets,
      enemyBulletCap: STAGE_SCALING[id].maxEnemyBullets,
      enemySpawnDeferrals: peaks.enemySpawnDeferrals,
      reflects: peaks.reflects,
      zones: peaks.zones,
      verdict: peaksVerdict(peaks, id),
    }));
}
