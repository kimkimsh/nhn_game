/**
 * 밸런스 리포트 집계와 판정 — 09_검증_전략.md §4. `npm run balance`가 부르는 자리다.
 *
 * `dev/headless.ts`가 시나리오 하나를 돌려 리포트 하나를 내고, 여기는 **여러 시드의 리포트를
 * 모아 하나의 표로 만들고 합격선과 대조한다.** 둘을 가르는 이유는 09 §4.2의 요구 하나다 —
 * 한 판의 패리 시행이 수십 단위라 시드 하나의 성공률·명중률은 잡음과 구분되지 않는다.
 * 평균만 찍으면 그 잡음이 사실처럼 보이므로 표준편차와 최소·최대를 같이 싣는다.
 *
 * ── 왜 vitest가 아니라 별도 스크립트인가 ────────────────────────────────────────
 *
 * 09 §1.2가 잡으려는 실패는 「테스트 초록불 + 게임 플레이 불가」다. 단위 테스트와 같은 명령에
 * 묶으면 이 리포트가 그 초록불의 일부가 되어 버려서, 리포트가 무엇을 못 쟀는지가 통과·실패
 * 한 글자에 접힌다. `npm run verify`가 typecheck → test → balance 셋을 순서대로 부르고
 * 셋째의 표가 사람 눈에 그대로 남는 것이 이 파일이 존재하는 이유다.
 *
 * ── 합격선을 여기서 짓지 않는다 ────────────────────────────────────────────────
 *
 * 판정에 쓰는 값은 전부 `dev/report.ts`가 스펙에서 옮겨 온 상수이고 이 파일에는 숫자가 없다.
 * 밴드가 없는 항목은 `no-band`로 남고 판정하지 않는다 — 09 §4.4의 「출처 열이 비어 있는 값은
 * 없다」가 그 규칙이다.
 */
import { BOSSES } from '../config/bosses';
import { STAGE_SCALING } from '../config/difficulty';
import type { BossId, StageId } from '../config/ids';
import { judgeT05, runAllScenarios, type CalibrationResult } from './headless';
import { BALANCE_SEEDS } from './scenarios';
import {
  breakEvenHitRateOf,
  SELF_HARM_LIMIT, T02_MEAN_GRADE_MUL, T02_SUCCESS_RATE, T05_MIN_KILL_SEC,
  type BalanceReport, type Verdict,
} from './report';

/** 09 §4.2의 캘리브레이션이 도는 이분법 횟수. 구간 폭 59u가 이 횟수만큼 반씩 접힌다 */
const CALIBRATION_ROUNDS = 8;

/**
 * 09 §2.1은 「가드가 던지면 런을 중단한다」이고, 리포트는 그 반대로 돈다.
 *
 * 지금 HR-03이 다섯 스테이지의 시작 구간 전부에서 걸리기 때문이다(guards.ts의 hr03Armed 주석).
 * 중단으로 두면 모든 시나리오가 첫 몇 초에서 끝나 리포트에 숫자가 한 칸도 안 남는다. 대신
 * 위반 목록을 전부 싣고 **위반이 하나라도 있으면 판정을 빨간불로 만든다** — 끄고 잰 것이
 * 아니라 적고 잰 것이다.
 */
const STOP_ON_GUARD_VIOLATION = false;

/** 완주 판정의 기준 시나리오. 이 하나가 S1부터 S5까지 가야 09 §1.2의 실패가 아니라고 말할 수 있다 */
const FULL_RUN_SCENARIO = 'baseline-full';
const LAST_STAGE_ID: StageId = 5;

export interface SeedSuite {
  readonly seed: number;
  readonly calibration: CalibrationResult;
  readonly appliedSigmaU: number;
  readonly reports: readonly BalanceReport[];
}

export interface BalanceSuite {
  readonly seeds: readonly SeedSuite[];
  readonly wallSec: number;
}

/** 표본 하나. `n`이 곧 「몇 판에서 이 값이 실제로 나왔는가」라 평균보다 먼저 읽어야 하는 칸이다 */
export interface Sample {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly minValue: number;
  readonly maxValue: number;
}

export interface Failure {
  readonly rule: string;
  readonly detail: string;
}

export function sampleOf(values: readonly number[]): Sample | null {
  if (values.length === 0) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  // 표본이 1이면 분산의 자유도가 0이다. 0으로 나누는 대신 편차를 0으로 둔다 — 「편차가 없다」가
  // 아니라 「한 판이라 잴 수 없다」이고, 그 사실은 n 칸이 이미 말한다
  const variance =
    values.length < 2
      ? 0
      : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return {
    n: values.length,
    mean,
    sd: Math.sqrt(variance),
    minValue: Math.min(...values),
    maxValue: Math.max(...values),
  };
}

export function runBalanceSuite(seeds: readonly number[]): BalanceSuite {
  const startedMs = performance.now();
  const suites: SeedSuite[] = seeds.map((seed) => ({
    seed,
    ...runAllScenarios(seed, CALIBRATION_ROUNDS, STOP_ON_GUARD_VIOLATION),
  }));
  return { seeds: suites, wallSec: (performance.now() - startedMs) / 1000 };
}

interface ScenarioReports {
  readonly id: string;
  readonly bySeed: readonly BalanceReport[];
}

function byScenario(suite: BalanceSuite): ScenarioReports[] {
  const order: string[] = [];
  const grouped = new Map<string, BalanceReport[]>();
  for (const seed of suite.seeds) {
    for (const report of seed.reports) {
      let bucket = grouped.get(report.run.scenario);
      if (bucket === undefined) {
        bucket = [];
        grouped.set(report.run.scenario, bucket);
        order.push(report.run.scenario);
      }
      bucket.push(report);
    }
  }
  return order.map((id) => ({ id, bySeed: grouped.get(id) ?? [] }));
}

function allReports(suite: BalanceSuite): BalanceReport[] {
  return suite.seeds.flatMap((seed) => [...seed.reports]);
}

// ── 표 만들기 ─────────────────────────────────────────────────────────────────

/**
 * 터미널에서 두 칸을 먹는 글자 구간 (Unicode East Asian Width의 W·F).
 *
 * 이 표는 한글 헤더와 아스키 숫자가 같은 열에 선다. `String.length`로 폭을 재면 한글 한 글자가
 * 한 칸으로 세어져 열이 글자 수만큼 어긋나고, 표가 표로 안 읽힌다. 모호 폭(§, ±, ×, ─)은
 * 대부분의 터미널이 한 칸으로 그리므로 여기서도 한 칸이다.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd],
];

function displayWidth(text: string): number {
  let width = 0;
  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0;
    width += WIDE_RANGES.some(([low, high]) => code >= low && code <= high) ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap <= 0 ? text : text + ' '.repeat(gap);
}

function padLeft(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap <= 0 ? text : ' '.repeat(gap) + text;
}

function num(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? '못 잼' : value.toFixed(digits);
}

function pct(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? '못 잼' : `${(value * 100).toFixed(digits)}%`;
}

/** 표본 한 칸을 「평균 ±편차 (최소~최대, n판)」로. n을 빼면 한 판짜리 값이 다섯 판처럼 보인다 */
function sampleText(sample: Sample | null, digits: number): string {
  if (sample === null) {
    return '못 잼 (표본 0)';
  }
  return (
    `${sample.mean.toFixed(digits)} ±${sample.sd.toFixed(digits)} ` +
    `(${sample.minValue.toFixed(digits)}~${sample.maxValue.toFixed(digits)}, n=${sample.n})`
  );
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, index) =>
    Math.max(displayWidth(cell), ...rows.map((row) => displayWidth(row[index] ?? ''))),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, index) => (index === 0 ? pad(cell, widths[index] ?? 0) : padLeft(cell, widths[index] ?? 0))).join('  ');
  return [line(header), widths.map((width) => '─'.repeat(width)).join('  '), ...rows.map(line)];
}

// ── 항목별 집계 ───────────────────────────────────────────────────────────────

function bossSection(suite: BalanceSuite): string[] {
  const ids: readonly BossId[] = ['B1', 'B2', 'B3', 'B4', 'B5'];
  const measuredHitRate = sampleOf(
    allReports(suite).filter((report) => report.reflect.spawned > 0).map((report) => report.reflect.hitRate),
  );
  const rows = ids.map((id) => {
    const seen = allReports(suite).flatMap((report) => report.bosses.filter((boss) => boss.id === id));
    const kills = seen.map((boss) => boss.killSec).filter((sec): sec is number => sec !== null);
    const killSample = sampleOf(kills);
    return [
      id,
      BOSSES[id].targetKillSec.toFixed(0),
      String(seen.length),
      String(kills.length),
      killSample === null ? '못 잼' : `${killSample.mean.toFixed(1)} ±${killSample.sd.toFixed(1)}`,
      killSample === null ? '못 잼' : `${killSample.minValue.toFixed(1)}~${killSample.maxValue.toFixed(1)}`,
      pct(breakEvenHitRateOf(id), 1),
      pct(measuredHitRate === null ? null : measuredHitRate.mean, 1),
      seen.length === 0 ? '미측정' : [...new Set(seen.map((boss) => boss.verdict))].join('/'),
    ];
  });
  return [
    '## T-01 보스 격파 시간 (§14.4 · 09 §4.4 — 목표 ×[0.85, 1.15])',
    '',
    ...table(
      ['보스', '목표s', '조우', '격파', '격파s 평균±편차', '최소~최대', '손익분기 h*', '실측 h', '판정'],
      rows,
    ),
    '',
    '  조우 = 보스를 실제로 만난 판 수, 격파 = 그중 HP가 0이 된 판 수. 둘이 다르면 평균은 격파한 판만의 값이다.',
    '  h* = 필요 DPS / 추정 DPS (09 §4.5). h < h* 면 목표 시간을 못 맞춘다. HP 재산정은 HP × (h / h*)이고 사람이 한다.',
  ];
}

function stageSection(suite: BalanceSuite): string[] {
  const ids: readonly StageId[] = [1, 2, 3, 4, 5];
  const rows = ids.map((id) => {
    const seen = allReports(suite).flatMap((report) => report.stages.filter((stage) => stage.id === id));
    const clears = seen.map((stage) => stage.clearSec).filter((sec): sec is number => sec !== null);
    const targetSec = STAGE_SCALING[id].targetLengthSec;
    const sample = sampleOf(clears);
    return [
      `S${id}`,
      targetSec.toFixed(0),
      String(clears.length),
      sample === null ? '못 잼' : `${sample.mean.toFixed(1)} ±${sample.sd.toFixed(1)}`,
      sample === null ? '못 잼' : `${sample.minValue.toFixed(1)}~${sample.maxValue.toFixed(1)}`,
      sample === null ? '못 잼' : `${(((sample.mean - targetSec) / targetSec) * 100).toFixed(1)}%`,
      seen.length === 0 ? '미측정' : [...new Set(seen.map((stage) => stage.verdict))].join('/'),
    ];
  });
  return [
    '## T-04 스테이지 클리어 시간 (§9.2 목표 ±15%)',
    '',
    ...table(['스테이지', '목표s', '클리어', '실측s 평균±편차', '최소~최대', 'Δ', '판정'], rows),
  ];
}

function reflectSection(suite: BalanceSuite): string[] {
  const reports = allReports(suite).filter((report) => report.reflect.spawned > 0);
  const hitRate = sampleOf(reports.map((report) => report.reflect.hitRate));
  const totals = reports.reduce(
    (sum, report) => ({
      spawned: sum.spawned + report.reflect.spawned,
      hit: sum.hit + report.reflect.hitSomething,
      expired: sum.expired + report.reflect.expiredByLifetime,
      left: sum.left + report.reflect.leftField,
      reparried: sum.reparried + report.reflect.reparried,
      hitPlayer: sum.hitPlayer + report.reflect.hitPlayer,
      shield: sum.shield + report.reflect.shieldBlocked,
      kills: sum.kills + report.reflect.enemiesKilled,
    }),
    { spawned: 0, hit: 0, expired: 0, left: 0, reparried: 0, hitPlayer: 0, shield: 0, kills: 0 },
  );
  const share = (value: number): string =>
    totals.spawned === 0 ? '못 잼' : `${value} (${((value / totals.spawned) * 100).toFixed(1)}%)`;
  // 넷의 합이 발사 수에 못 미치는 몫은 런이 끝나는 순간 아직 날고 있던 반사탄이다. 「최후」의
  // 다섯째 칸으로 적지 않으면 분모가 어디로 샜는지 표에서 사라진다
  const alive = totals.spawned - (totals.hit + totals.expired + totals.left + totals.reparried);
  return [
    '## 반사탄 명중률 (R-03이 지목한 미측정 축 — 09 §4.4상 허용 범위 없음)',
    '',
    `  판별 명중률   ${sampleText(hitRate, 3)}`,
    `  전체 합산     ${totals.hit} / ${totals.spawned} = ${pct(totals.spawned === 0 ? null : totals.hit / totals.spawned, 1)}`,
    '',
    ...table(
      ['반사탄의 최후 (넷 + 잔존이 발사 수를 나눈다)', '발', '비고'],
      [
        ['맞았다', share(totals.hit), `잡몹 처치 ${totals.kills}기`],
        ['수명 소진', share(totals.expired), ''],
        ['화면 이탈', share(totals.left), '반사각이 적을 안 향한 몫'],
        ['재패리', share(totals.reparried), 'T-02 전제는 0회'],
        ['런 종료 시 잔존', share(alive), '최후가 안 정해진 채로 판이 끝났다'],
      ],
    ),
    '',
    ...table(
      ['위 표와 겹치는 축', '발', '비고'],
      [
        ['플레이어 피격', String(totals.hitPlayer), 'T-06의 분자. 「맞았다」에도 들어간다'],
        ['방패 무효화', String(totals.shield), '§7.3 E-C 정면 1회'],
      ],
    ),
  ];
}

function parrySection(suite: BalanceSuite): string[] {
  const reports = allReports(suite).filter((report) => report.parry.attempts > 0);
  const grades = reports.reduce(
    (sum, report) => ({
      GREAT: sum.GREAT + report.parry.grades.GREAT,
      GOOD: sum.GOOD + report.parry.grades.GOOD,
      NOT_BAD: sum.NOT_BAD + report.parry.grades.NOT_BAD,
    }),
    { GREAT: 0, GOOD: 0, NOT_BAD: 0 },
  );
  const gradeTotal = grades.GREAT + grades.GOOD + grades.NOT_BAD;
  const gradeShare = (value: number): string =>
    gradeTotal === 0 ? '못 잼' : `${value} (${((value / gradeTotal) * 100).toFixed(1)}%)`;
  const attempts = reports.reduce((sum, report) => sum + report.parry.attempts, 0);
  const successes = reports.reduce((sum, report) => sum + report.parry.successes, 0);
  return [
    '## 패리 성공률·등급 분포 (T-02 전제와의 차이만 표시한다 — 09 §4.6은 이 축으로 판정하지 않는다)',
    '',
    `  성공률        ${sampleText(sampleOf(reports.map((report) => report.parry.successRate)), 3)}   전제 ${T02_SUCCESS_RATE.toFixed(2)}`,
    `  전체 합산     ${successes} / ${attempts} = ${pct(attempts === 0 ? null : successes / attempts, 1)}`,
    `  평균 등급배수 ${sampleText(sampleOf(reports.map((report) => report.parry.meanGradeMul)), 3)}   전제 ${T02_MEAN_GRADE_MUL.toFixed(2)} (GOOD)`,
    `  유효 패리/초  ${sampleText(sampleOf(reports.map((report) => report.parry.effectiveParriesPerSec)), 3)}   전제 2.08`,
    `  재패리        ${reports.reduce((sum, report) => sum + report.parry.reparries, 0)}회   전제 0회`,
    '',
    ...table(
      ['등급', '발', '배수'],
      [
        ['GREAT', gradeShare(grades.GREAT), '×3.5'],
        ['GOOD', gradeShare(grades.GOOD), '×2.0'],
        ['NOT_BAD', gradeShare(grades.NOT_BAD), '×1.0'],
      ],
    ),
    '',
    '## D-09 패리당 동시 반사 발수 (머니샷 — 평균 1~2발이면 머니샷이 성립하지 않는다)',
    '',
    `  평균 동시 반사 ${sampleText(sampleOf(reports.map((report) => report.parry.meanReflectsPerParry)), 2)}`,
    `  한 번의 최대치 ${Math.max(0, ...reports.map((report) => report.parry.maxReflectsPerParry))}발`,
  ];
}

function selfHarmSection(suite: BalanceSuite): string[] {
  const reports = allReports(suite).filter((report) => report.hits.total > 0);
  const total = reports.reduce((sum, report) => sum + report.hits.total, 0);
  const causes = reports.reduce(
    (sum, report) => ({
      enemyBullet: sum.enemyBullet + report.hits.byCause.enemyBullet,
      reflectedBullet: sum.reflectedBullet + report.hits.byCause.reflectedBullet,
      body: sum.body + report.hits.byCause.body,
      zone: sum.zone + report.hits.byCause.zone,
    }),
    { enemyBullet: 0, reflectedBullet: 0, body: 0, zone: 0 },
  );
  const share = (value: number): string =>
    total === 0 ? '못 잼' : `${value} (${((value / total) * 100).toFixed(1)}%)`;
  const ratio = total === 0 ? null : causes.reflectedBullet / total;
  return [
    `## T-06 반사탄 자해로 잃은 라이프 비율 (합격선 < ${(SELF_HARM_LIMIT * 100).toFixed(0)}%)`,
    '',
    `  전체 합산 ${causes.reflectedBullet} / ${total} = ${pct(ratio, 1)}   판정 ${
      ratio === null ? '미측정' : ratio >= SELF_HARM_LIMIT ? 'fail' : 'pass'
    }`,
    `  판별 비율 ${sampleText(sampleOf(reports.map((report) => report.hits.selfHarmPct)), 3)}`,
    '',
    ...table(
      ['피격 원인', '회'],
      [
        ['적 탄환', share(causes.enemyBullet)],
        ['반사탄 (자해)', share(causes.reflectedBullet)],
        ['적 본체', share(causes.body)],
        ['장판', share(causes.zone)],
      ],
    ),
  ];
}

function peakSection(suite: BalanceSuite): string[] {
  const ids: readonly StageId[] = [1, 2, 3, 4, 5];
  const rows = ids.map((id) => {
    const seen = allReports(suite).flatMap((report) =>
      report.peaksByStage.filter((peaks) => peaks.id === id),
    );
    const first = seen[0];
    if (first === undefined) {
      return [`S${id}`, '미측정', '—', '미측정', '—', '—', '—', '미측정'];
    }
    return [
      `S${id}`,
      String(Math.max(...seen.map((peaks) => peaks.enemies))),
      String(first.specEnemies),
      String(Math.max(...seen.map((peaks) => peaks.enemyBullets))),
      String(first.enemyBulletCap),
      String(Math.max(...seen.map((peaks) => peaks.enemySpawnDeferrals))),
      String(Math.max(...seen.map((peaks) => peaks.reflects))),
      [...new Set(seen.map((peaks) => peaks.verdict))].join('/'),
    ];
  });
  return [
    '## 동시 잡몹 최대 도달치 (difficulty.ts의 peakEnemies 대신 여기가 잰다 — 12 §5)',
    '',
    ...table(
      ['스테이지', '잡몹', '§14.1', '적탄', '상한', '스폰지연', '반사탄', '판정'],
      rows,
    ),
    '',
    '  §14.1 열은 대조용이고 합격선이 아니다. 합격선은 잡몹 ≤ 20 · 적탄 ≤ 상한, 그리고 S5만 잡몹 ≥ 18 그리고 스폰지연 ≥ 1이다 (09 §4.4).',
  ];
}

function hr03Section(suite: BalanceSuite): string[] {
  const reports = allReports(suite);
  const causes = ['lull', 'bossDefeat', 'unattributed'] as const;
  const label: Record<(typeof causes)[number], string> = {
    lull: '소강 (§9.1)',
    bossDefeat: '보스 격파 연출 (§10.1)',
    unattributed: '원인 미확정 — 가드의 ③ 모든 발사원 억제 구간',
  };
  const rows = causes.map((cause) => {
    const spans = reports.reduce((sum, report) => sum + report.hr03[cause].spans, 0);
    const simSec = reports.reduce((sum, report) => sum + report.hr03[cause].simSec, 0);
    const worst = Math.max(0, ...reports.map((report) => report.hr03[cause].worstSec));
    return [label[cause], String(spans), simSec.toFixed(2), worst.toFixed(3)];
  });
  return [
    '## HR-03 면제 구간 표 (적 탄환 0인 구간을 관측 가능한 원인으로 가른 것)',
    '',
    ...table(['원인', '구간 수', '합계s', '최장s'], rows),
    '',
    '  셋째 줄은 관측이 아니라 추정이다 — 이 표는 월드를 밖에서 본 것이고 가드의 자체 집계와 별개로 센다.',
    '  첫 탄이 나오기 전의 공백은 세지 않는다 — 그 시작점은 sim/guards.ts의 hr03Armed와 같은 자리다.',
  ];
}

function scenarioSection(suite: BalanceSuite): string[] {
  const rows = byScenario(suite).map((group) => {
    const first = group.bySeed[0];
    return [
      group.id,
      first === undefined ? '—' : `S${first.run.entry.stageId} ${first.run.entry.at.kind}`,
      first === undefined ? '—' : first.run.entry.applied,
      group.bySeed.map((report) => report.run.status).join(' '),
      group.bySeed.map((report) => report.run.simSec.toFixed(0)).join(' '),
      group.bySeed.reduce((sum, report) => sum + report.guards.length, 0).toString(),
    ];
  });
  return [
    '## 시나리오별 완주 상태 (열은 시드 순서)',
    '',
    ...table(['시나리오', '진입 요청', '실제 적용', '상태', 'sim초', '가드 위반 종류'], rows),
  ];
}

function calibrationSection(suite: BalanceSuite): string[] {
  const rows = suite.seeds.map((seed) => [
    String(seed.seed),
    seed.calibration.timingSigmaU.toFixed(2),
    seed.calibration.measuredSuccessRate.toFixed(3),
    seed.calibration.bracketed ? '예' : '아니오',
    seed.appliedSigmaU.toFixed(2),
  ]);
  return [
    `## 봇 캘리브레이션 (표적 성공률 ${T02_SUCCESS_RATE.toFixed(2)} — 09 §4.2)`,
    '',
    ...table(['시드', '탐색 결과 σ(u)', '그때 성공률', '표적을 감쌌나', '실제 사용 σ(u)'], rows),
    '',
    '  「감쌌나」가 아니오면 σ는 탐색 구간의 경계값이고, 그 봇으로 잰 격파 시간은 T-02의 전제 위에 있지 않다.',
    '  그때는 실제 사용 σ가 대체값이므로 캘리브레이션 결과와 실제 사용값이 다르다.',
  ];
}

function guardSection(suite: BalanceSuite): string[] {
  const counted = new Map<string, number>();
  for (const report of allReports(suite)) {
    for (const message of report.guards) {
      // 위반 문장에는 그때의 수치가 박혀 있어 그대로 세면 같은 규칙이 수백 줄로 흩어진다
      const key = message.replace(/[\d.]+/g, '#');
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
  }
  if (counted.size === 0) {
    return ['## 가드 위반', '', '  없다.'];
  }
  const rows = [...counted.entries()]
    .sort(([, left], [, right]) => right - left)
    .map(([message, count]) => [message, String(count)]);
  return [
    '## 가드 위반 (09 §2.1의 계약은 중단이고, 이 리포트는 적고 계속 돈다)',
    '',
    ...table(['위반 (수치는 #로 접었다)', '시나리오×시드 수'], rows),
  ];
}

// ── 판정 ─────────────────────────────────────────────────────────────────────

function fullRunFailure(suite: BalanceSuite): Failure | null {
  const runs = allReports(suite).filter((report) => report.run.scenario === FULL_RUN_SCENARIO);
  const cleared = runs.filter(
    (report) =>
      report.run.status === 'ok' &&
      report.stages.some((stage) => stage.id === LAST_STAGE_ID && stage.clearSec !== null),
  );
  if (cleared.length > 0) {
    return null;
  }
  const reached = Math.max(0, ...runs.flatMap((report) => report.stages.map((stage) => stage.id)));
  return {
    rule: '09 §1.2 완주',
    detail:
      `${FULL_RUN_SCENARIO}이 ${runs.length}판 중 0판에서 S${LAST_STAGE_ID}에 닿았다. ` +
      `가장 멀리 간 판이 S${reached === 0 ? 1 : reached}에서 끝났고 상태는 ` +
      `${[...new Set(runs.map((report) => report.run.status))].join('/')}다. ` +
      '테스트가 초록불이어도 게임이 안 되는 상태이고, 09 §1.2가 최악 실패 모드로 못 박은 그것이다',
  };
}

export function judgeBalance(suite: BalanceSuite): Failure[] {
  const failures: Failure[] = [];
  const full = fullRunFailure(suite);
  if (full !== null) {
    failures.push(full);
  }
  for (const report of allReports(suite)) {
    const where = `${report.run.scenario}/seed ${report.run.seed}`;
    if (report.guards.length > 0) {
      failures.push({ rule: '09 §2.1 가드', detail: `${where} — ${report.guards[0] ?? ''}` });
    }
    if (report.hits.verdict === 'fail') {
      failures.push({
        rule: '§14.3 T-06',
        detail: `${where} — 자해 비율 ${pct(report.hits.selfHarmPct, 1)} ≥ ${pct(SELF_HARM_LIMIT, 0)}`,
      });
    }
    if (report.hitstop.verdict === 'fail') {
      failures.push({
        rule: '§3.2 히트스톱',
        detail: `${where} — 초당 ${report.hitstop.maxPerSecondSec.toFixed(3)}s > ${report.hitstop.capSec}s`,
      });
    }
    for (const stage of report.stages) {
      if (stage.verdict === 'fail') {
        failures.push({
          rule: '§14.3 T-04',
          detail: `${where} — S${stage.id} ${num(stage.clearSec, 1)}s, 목표 ${stage.targetSec}s에서 ${num(stage.deltaPct, 1)}%`,
        });
      }
    }
    for (const peaks of report.peaksByStage) {
      if (peaks.verdict === 'fail') {
        failures.push({
          rule: '§3.2 · §9.7 도달치',
          detail:
            `${where} — S${peaks.id} 잡몹 ${peaks.enemies}기 · 적탄 ${peaks.enemyBullets}/${peaks.enemyBulletCap} · ` +
            `스폰지연 ${peaks.enemySpawnDeferrals}회`,
        });
      }
    }
    if (report.run.scenario === 't05-max-build' && judgeT05(report) === 'fail') {
      const killSec = report.bosses.find((boss) => boss.id === 'B5')?.killSec;
      failures.push({
        rule: '§14.3 T-05',
        detail: `${where} — B5 ${num(killSec ?? null, 1)}s < ${T05_MIN_KILL_SEC}s. 카드 계수를 낮춘다`,
      });
    }
  }
  return failures;
}

/** 09 §4.6상 T-01의 밴드 이탈은 fail이 아니라 경보다 — HP를 자동으로 고치지 않기 때문이다 */
export function alertsOf(suite: BalanceSuite): string[] {
  const alerts: string[] = [];
  for (const report of allReports(suite)) {
    for (const boss of report.bosses) {
      if (boss.verdict === 'alert-T-01') {
        alerts.push(
          `${report.run.scenario}/seed ${report.run.seed} — ${boss.id} ` +
            (boss.killSec === null
              ? `격파 못 함 (목표 ${boss.targetSec}s)`
              : `${boss.killSec.toFixed(1)}s, 목표 ${boss.targetSec}s에서 ${num(boss.deltaPct, 1)}%`) +
            `. 재산정 HP = ${boss.totalHp} × (h ${pct(boss.measuredHitRate, 1)} / h* ${pct(boss.breakEvenHitRate, 1)})`,
        );
      }
    }
  }
  return alerts;
}

// ── 리포트 ───────────────────────────────────────────────────────────────────

export function formatBalanceReport(suite: BalanceSuite): string {
  const first = suite.seeds[0]?.reports[0];
  const failures = judgeBalance(suite);
  const alerts = alertsOf(suite);
  const lines: string[] = [
    '════════════════════════════════════════════════════════════════════════════',
    ' 환도 헤드리스 밸런스 리포트   schema hwando-balance-report/1   (09_검증_전략 §4)',
    '════════════════════════════════════════════════════════════════════════════',
    '',
    '## 이 숫자들이 성립하는 조건 — 값보다 먼저 읽는다',
    '',
    ...(first?.constraints ?? ['리포트가 한 장도 안 나왔다']).map((text) => `  · ${text}`),
    `  · 시드 ${suite.seeds.map((seed) => seed.seed).join(', ')} — 단일 실행으로 판단하지 않는다`,
    `  · 렌더 시간은 캔버스가 없어 못 잰다. T-07은 09 §6의 실기 게이트가 맡는다`,
    '',
    ...calibrationSection(suite),
    '',
    ...scenarioSection(suite),
    '',
    ...bossSection(suite),
    '',
    ...stageSection(suite),
    '',
    ...reflectSection(suite),
    '',
    ...parrySection(suite),
    '',
    ...selfHarmSection(suite),
    '',
    ...peakSection(suite),
    '',
    ...hr03Section(suite),
    '',
    ...guardSection(suite),
    '',
    '## T-01 경보 (HP를 자동으로 고치지 않는다 — 재산정은 사람이 §14.4 표에 다시 적는다)',
    '',
    ...(alerts.length === 0 ? ['  없다.'] : alerts.map((text) => `  ! ${text}`)),
    '',
    '════════════════════════════════════════════════════════════════════════════',
  ];
  if (failures.length === 0) {
    lines.push(` 판정: 통과   (시드 ${suite.seeds.length}개, 벽시계 ${suite.wallSec.toFixed(1)}s)`);
  } else {
    lines.push(` 판정: 실패 ${failures.length}건   (시드 ${suite.seeds.length}개, 벽시계 ${suite.wallSec.toFixed(1)}s)`);
    lines.push('');
    // 같은 규칙이 시나리오×시드마다 반복되므로 규칙 단위로 접는다. 첫 줄이 대표 사례다
    const grouped = new Map<string, Failure[]>();
    for (const failure of failures) {
      const bucket = grouped.get(failure.rule) ?? [];
      bucket.push(failure);
      grouped.set(failure.rule, bucket);
    }
    for (const [rule, bucket] of grouped) {
      lines.push(` ✗ ${rule} — ${bucket.length}건`);
      lines.push(`     ${bucket[0]?.detail ?? ''}`);
    }
  }
  lines.push('════════════════════════════════════════════════════════════════════════════');
  return lines.join('\n');
}

export { BALANCE_SEEDS };

/** 판정에 쓰지 않는 칸까지 전부 남긴다. 표가 접은 것을 다시 펴야 할 때 여기를 본다 */
export function toJson(suite: BalanceSuite): string {
  return JSON.stringify(
    suite,
    (_key, value: unknown) => (value instanceof Map ? Object.fromEntries(value) : value),
    2,
  );
}

/** 판정이 하나라도 실패면 참. `npm run balance`의 종료 코드가 이 값이다 */
export function hasFailure(suite: BalanceSuite): boolean {
  return judgeBalance(suite).length > 0;
}

export type { Verdict };
