/**
 * 결과 화면의 **본문** 한 장 — 스펙 §12.3의 아홉 항목 중 메뉴 위의 여덟. 그림은 `13_result/scene.js`.
 *
 * `screens/result.ts`에서 갈라 둔 이유는 한 파일 400줄 상한 하나다. 이음매는 `play.ts` ·
 * `play-view.ts`와 같다 — 상태와 입력은 그쪽에, 값 옮기기와 그림은 여기에 산다.
 *
 * **이 파일은 sim 상태를 한 줄도 바꾸지 않는다.** `Run`을 읽어서 글자와 도형으로 옮길 뿐이다.
 *
 * ── 숫자를 여기서 다시 계산하지 않는다 ─────────────────────────────────────────
 *
 * 콤보 배수는 `sim/score.ts`의 `comboMul`이 잘라 준 값을 그대로 쓴다(08 §2.5 A · §11 #1).
 * 목업은 콤보 88에 「×3.0 상한 도달」이라고 손으로 적었는데 §12.2의 식으로는 ×1.8이고 상한에
 * 닿지도 않았다. 「상한 도달」은 배수가 **실제로 잘렸을 때만** 붙는다 — 그 판정도 식을 옮겨
 * 적지 않고 잘린 값이 `COMBO.multMax`와 같은지로 한다.
 *
 * 획득 카드도 같다. `run.cards`를 그대로 펼치면 중첩 수 총합이 자동으로 4 이하가 된다
 * (§11.1 획득 4회, 08 §5.3 B) — 목록 길이를 여기서 자르지 않는다.
 */

import { DRAW } from '../config/cards/draw-table';
import type { ParryGradeId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { COMBO } from '../config/scoring';
import { STAGES } from '../config/stages';
import { FONTS, UI } from '../config/ui';
import { glow, hatch, hexA } from '../render/primitives';
import type { Run, RunResult, RunTally } from '../sim/run';
import { comboMul } from '../sim/score';
import { cardNameWithStack, dimFrame, formatCount, rarityColorOf, roundRect } from './menu';

const RESULT = UI.result;

/** 목업 13_result/scene.js:57-77 머리말과 총점 (px) */
const KICKER_PX = 30;
const ENDING_PX = 92;
const SCORE_LABEL_PX = 26;
const SCORE_LABEL_TEXT = 'TOTAL SCORE';
/** 목업 :77 총점 글로우. 중심 y는 값 베이스라인보다 이만큼 위다 (u) */
const SCORE_GLOW_ALPHA = 0.09;
const SCORE_GLOW_LIFT_U = 32;

/** 목업 13_result/scene.js:79-80 구분선 */
const RULE_WIDTH_U = 1.5;
const RULE_ALPHA = 0.14;
/** 목업 :118 항목 줄 아래 실선. 위 구분선보다 훨씬 옅다 */
const ROW_RULE_ALPHA = 0.07;

/** 목업 13_result/scene.js:82-101 등급 분포 (px) */
const GRADE_LABEL_PX = 24;
const GRADE_LABEL_TEXT = '패리 등급 분포';
const GRADE_NAME_PX = 25;
const GRADE_COUNT_PX = 25;
/** 세그먼트가 좁아도 이름끼리 겹치지 않게 하는 최소 진행 폭의 여백 (u) */
const GRADE_LABEL_GAP_U = 24;

/** 목업 13_result/scene.js:105-120 항목 줄 (px) */
const ROW_LABEL_PX = 28;
const ROW_VALUE_PX = 28;

/** 목업 13_result/scene.js:123-144 획득 카드 (px · u) */
const CARDS_LABEL_PX = 24;
const CARDS_LABEL_TEXT = '획득 카드';
const CHIP_TEXT_PX = 25;
const CHIP_RADIUS_U = 4;
const CHIP_STROKE_U = 1.8;
const CHIP_STROKE_ALPHA = 0.55;
/** 목업 :138 글자 폭에 더하는 좌우 여백 합 (u). 글자는 그 절반 지점에서 시작한다 */
const CHIP_PAD_U = 34;
const CHIP_GAP_U = 14;
/** 목업 :141 칩 상단에서 글자 베이스라인까지 (u). 1330 → 1363 */
const CHIP_TEXT_OFFSET_YU = 33;
const CARDS_EMPTY_TEXT = '없음';

/** 목업 13_result/scene.js:147-149 오염 여부 (px) */
const INTEGRITY_PX = 25;
const INTEGRITY_CLEAN_TEXT = '치트 모드 미사용 — 기록 대상 런';
const INTEGRITY_DIRTY_TEXT = '치트 모드 사용 — 오염된 런 · 기록 제외';
/** §18.5 「점수 — 기록·순위 대상에서 제외한다」를 총점 값 옆에 병기한다 */
const SCORE_EXCLUDED_TEXT = '기록 제외';
const SCORE_EXCLUDED_PX = 25;
const SCORE_EXCLUDED_GAP_U = 28;
/** 해칭 판이 글자 위아래로 넘는 길이 (u). 판의 뜻은 HUD의 오염 띠와 같다 (08 §2.3 b) */
const INTEGRITY_PLATE_PAD_U = 12;

interface GradeView {
  readonly id: ParryGradeId;
  readonly label: string;
  readonly color: string;
}

/**
 * 목업 13_result/scene.js:6-10의 등급색 그대로. 인게임 팝업(§2.4)과 같은 색이어야 한다 —
 * 여기서 바꾸면 같은 등급이 화면마다 두 색을 갖는다.
 */
const GRADE_VIEWS: readonly GradeView[] = [
  { id: 'GREAT', label: 'GREAT', color: PALETTE.hwang },
  { id: 'GOOD', label: 'GOOD', color: PALETTE.cheong },
  { id: 'NOT_BAD', label: 'NOT BAD', color: PALETTE.baek },
];

/** §13.1의 「엔딩」 한 줄. 클리어와 게임오버가 다른 문구를 쓴다 (08 §5.1) */
const ENDINGS: Readonly<Record<RunResult, { readonly kicker: string; readonly title: string }>> = {
  clear: { kicker: '최종 결전 종료', title: '돌려주었다' },
  gameOver: { kicker: '전투 중단', title: '돌려주지 못했다' },
};

interface ResultRow {
  readonly label: string;
  readonly value: string;
}

/** 08 §5.3 A — 배수는 `sim/score.ts`가 잘라 준 값이고 「상한 도달」은 실제로 잘렸을 때만 붙는다 */
function comboValueText(maxCombo: number): string {
  const mul = comboMul(maxCombo);
  const capped = mul >= COMBO.multMax ? ' 상한 도달' : '';
  return `${formatCount(maxCombo)}  (×${mul.toFixed(1)}${capped})`;
}

/**
 * 08 §5.2 — 분모는 패리 활성 구간이 열린 횟수, 분자는 그중 1발 이상 처리한 구간의 수다.
 * 한 번도 열지 않은 런에는 비율이 없다. 0%를 적으면 「전부 실패했다」로 읽힌다.
 */
function successValueText(tally: RunTally): string {
  if (tally.parryAttempts <= 0) {
    return '—   0 / 0';
  }
  const percent = Math.round((tally.parrySuccesses / tally.parryAttempts) * 100);
  return `${percent}%   ${formatCount(tally.parrySuccesses)} / ${formatCount(tally.parryAttempts)}`;
}

function buildRows(run: Run): readonly ResultRow[] {
  const tally = run.tally;
  return [
    { label: '도달 스테이지', value: `${run.stageId} · ${run.result === 'clear' ? '클리어' : '게임오버'}` },
    { label: '최대 콤보', value: comboValueText(tally.maxCombo) },
    { label: '패리 성공률', value: successValueText(tally) },
    { label: '재패리', value: `${formatCount(tally.reparryCount)}회` },
    { label: '반사탄 자해로 잃은 라이프', value: formatCount(tally.reflectSelfHitLives) },
    // §12.3의 필수 목록에는 없지만 §15.3이 추가를 금지하지 않았고, 리롤은 런당 1회뿐이라
    // 어디서 썼는지가 그 런의 판단을 설명한다 (08 §5.1)
    { label: '리롤 사용', value: `${run.rerollUsed ? 1 : 0} / ${DRAW.rerollsPerRun}` },
  ];
}

/** `result`는 결과 국면에서 언제나 채워져 있다. null은 그 국면이 아닌 런을 그린 것이라 게임오버로 읽는다 */
function drawEnding(ctx: CanvasRenderingContext2D, run: Run): void {
  const ending = ENDINGS[run.result ?? 'gameOver'];
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.hwang;
  ctx.font = `500 ${KICKER_PX}px ${FONTS.data}`;
  ctx.fillText(`${STAGES[run.stageId].name} · ${ending.kicker}`, PLAYFIELD.widthU / 2, RESULT.kickerBaselineYU);
  ctx.fillStyle = PALETTE.baek;
  ctx.font = `700 ${ENDING_PX}px ${FONTS.display}`;
  ctx.fillText(ending.title, PLAYFIELD.widthU / 2, RESULT.endingBaselineYU);
}

function drawScore(ctx: CanvasRenderingContext2D, run: Run): void {
  const centerXU = PLAYFIELD.widthU / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `500 ${SCORE_LABEL_PX}px ${FONTS.data}`;
  ctx.fillText(SCORE_LABEL_TEXT, centerXU, RESULT.scoreLabelBaselineYU);
  const text = formatCount(run.world.run.score);
  ctx.fillStyle = PALETTE.baek;
  ctx.font = `600 ${RESULT.scoreValuePx}px ${FONTS.data}`;
  ctx.fillText(text, centerXU, RESULT.scoreValueBaselineYU);
  const valueWidthU = ctx.measureText(text).width;
  glow(
    ctx, centerXU, RESULT.scoreValueBaselineYU - SCORE_GLOW_LIFT_U,
    RESULT.scoreGlowRU, PALETTE.hwang, SCORE_GLOW_ALPHA,
  );
  if (!run.contaminated) {
    return;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekMute;
  ctx.font = `500 ${SCORE_EXCLUDED_PX}px ${FONTS.data}`;
  ctx.fillText(
    SCORE_EXCLUDED_TEXT,
    centerXU + valueWidthU / 2 + SCORE_EXCLUDED_GAP_U,
    RESULT.scoreValueBaselineYU,
  );
}

/**
 * 08 §5.1의 4번 — 누적 막대 하나가 런의 모양을 한눈에 보여 준다. 세그먼트 폭은 비율이지만
 * **이름의 진행 폭은 이름이 필요한 만큼**이다. 비율만 따르면 0회인 등급들이 같은 x에 겹쳐
 * 「한 번도 못 낸 등급」이 화면에서 사라진다.
 */
function drawGradeBar(ctx: CanvasRenderingContext2D, tally: RunTally): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `500 ${GRADE_LABEL_PX}px ${FONTS.data}`;
  ctx.fillText(GRADE_LABEL_TEXT, RESULT.gradeBarXU, RESULT.gradeLabelBaselineYU);

  let total = 0;
  for (const grade of GRADE_VIEWS) {
    total += tally.gradeCounts[grade.id];
  }
  const segmentU = (count: number): number =>
    total > 0 ? (RESULT.gradeBarWidthU * count) / total : 0;

  let barXU = RESULT.gradeBarXU;
  for (const grade of GRADE_VIEWS) {
    const widthU = segmentU(tally.gradeCounts[grade.id]);
    if (widthU > 0) {
      ctx.fillStyle = grade.color;
      ctx.fillRect(barXU, RESULT.gradeBarYU, Math.max(0, widthU - RESULT.gradeSegGapU), RESULT.gradeBarHeightU);
    }
    barXU += widthU;
  }

  // 라벨은 자기 구간의 왼쪽 끝에 붙지만, 구간이 이름보다 좁으면 다음 라벨이 그만큼 밀린다.
  // 오른쪽 한계가 없으면 GREAT이 전체 패리의 89%를 넘는 순간 셋째 라벨이 플레이필드 밖으로
  // 나가 이름과 횟수가 통째로 잘린다 — 폰트 폭이 아니라 clamp 부재가 원인이라 여기서 막는다
  const labelRightLimitU = RESULT.gradeBarXU + RESULT.gradeBarWidthU;
  let labelXU = RESULT.gradeBarXU;
  for (const grade of GRADE_VIEWS) {
    const count = tally.gradeCounts[grade.id];
    ctx.font = `600 ${GRADE_NAME_PX}px ${FONTS.data}`;
    const nameWidthU = ctx.measureText(grade.label).width;
    const drawXU = Math.min(labelXU, labelRightLimitU - nameWidthU);
    ctx.fillStyle = grade.color;
    ctx.fillText(grade.label, drawXU, RESULT.gradeNameBaselineYU);
    ctx.fillStyle = PALETTE.baekMute;
    ctx.font = `400 ${GRADE_COUNT_PX}px ${FONTS.data}`;
    ctx.fillText(formatCount(count), drawXU, RESULT.gradeCountBaselineYU);
    labelXU = drawXU + Math.max(segmentU(count), nameWidthU + GRADE_LABEL_GAP_U);
  }
}

function drawRows(ctx: CanvasRenderingContext2D, rows: readonly ResultRow[]): void {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) {
      continue;
    }
    const yU = RESULT.rowFirstBaselineYU + index * RESULT.rowStepU;
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.baekFaint;
    ctx.font = `400 ${ROW_LABEL_PX}px ${FONTS.body}`;
    ctx.fillText(row.label, RESULT.rowLeftXU, yU);
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.baek;
    ctx.font = `500 ${ROW_VALUE_PX}px ${FONTS.data}`;
    ctx.fillText(row.value, RESULT.rowRightXU, yU);
    ctx.textAlign = 'left';
    ctx.strokeStyle = hexA(PALETTE.baek, ROW_RULE_ALPHA);
    ctx.lineWidth = RULE_WIDTH_U;
    ctx.beginPath();
    ctx.moveTo(RESULT.rowLeftXU, yU + RESULT.rowRuleOffsetYU);
    ctx.lineTo(RESULT.rowRightXU, yU + RESULT.rowRuleOffsetYU);
    ctx.stroke();
  }
}

/** 08 §5.3 B — 0장이어도 줄을 유지하고 `없음`을 적는다. 줄이 사라지면 만들다 만 화면이 된다 */
function drawCardChips(ctx: CanvasRenderingContext2D, run: Run): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `500 ${CARDS_LABEL_PX}px ${FONTS.data}`;
  ctx.fillText(CARDS_LABEL_TEXT, RESULT.rowLeftXU, RESULT.cardsLabelBaselineYU);

  const textYU = RESULT.cardChipYU + CHIP_TEXT_OFFSET_YU;
  ctx.font = `400 ${CHIP_TEXT_PX}px ${FONTS.body}`;
  if (run.cards.length === 0) {
    ctx.fillStyle = PALETTE.baekMute;
    ctx.fillText(CARDS_EMPTY_TEXT, RESULT.rowLeftXU, textYU);
    return;
  }
  let chipXU = RESULT.rowLeftXU;
  for (const held of run.cards) {
    const label = `${held.id}  ${cardNameWithStack(held.id, held.stack)}`;
    const widthU = ctx.measureText(label).width + CHIP_PAD_U;
    const color = rarityColorOf(held.id);
    ctx.strokeStyle = hexA(color, CHIP_STROKE_ALPHA);
    ctx.lineWidth = CHIP_STROKE_U;
    roundRect(ctx, chipXU, RESULT.cardChipYU, widthU, RESULT.cardChipHeightU, CHIP_RADIUS_U);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, chipXU + CHIP_PAD_U / 2, textYU);
    chipXU += widthU + CHIP_GAP_U;
  }
}

/** §18.5 — 정상 런도 문구를 적는다. 표시가 없으면 「정상」인지 「안 만든 것」인지 구별되지 않는다 */
function drawIntegrity(ctx: CanvasRenderingContext2D, contaminated: boolean): void {
  if (contaminated) {
    ctx.save();
    ctx.globalAlpha = UI.hud.cheatMark.hatchAlpha;
    ctx.fillStyle = hatch();
    ctx.fillRect(
      RESULT.rowLeftXU,
      RESULT.integrityBaselineYU - INTEGRITY_PX - INTEGRITY_PLATE_PAD_U,
      RESULT.rowRightXU - RESULT.rowLeftXU,
      INTEGRITY_PX + INTEGRITY_PLATE_PAD_U * 2,
    );
    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = contaminated ? PALETTE.baek : PALETTE.cheong;
  ctx.font = `500 ${INTEGRITY_PX}px ${FONTS.data}`;
  ctx.fillText(
    contaminated ? INTEGRITY_DIRTY_TEXT : INTEGRITY_CLEAN_TEXT,
    RESULT.rowLeftXU,
    RESULT.integrityBaselineYU,
  );
}

/** §12.3 아홉 항목 중 메뉴 위의 여덟. 딤도 여기서 얹는다 (12 §1 C-02) */
export function paintResultBody(ctx: CanvasRenderingContext2D, run: Run): void {
  dimFrame(ctx, RESULT.dimAlpha, PLAYFIELD.widthU, PLAYFIELD.heightU);
  drawEnding(ctx, run);
  drawScore(ctx, run);
  ctx.strokeStyle = hexA(PALETTE.baek, RULE_ALPHA);
  ctx.lineWidth = RULE_WIDTH_U;
  ctx.beginPath();
  ctx.moveTo(RESULT.rowLeftXU, RESULT.ruleYU);
  ctx.lineTo(RESULT.rowRightXU, RESULT.ruleYU);
  ctx.stroke();
  drawGradeBar(ctx, run.tally);
  drawRows(ctx, buildRows(run));
  drawCardChips(ctx, run);
  drawIntegrity(ctx, run.contaminated);
}
