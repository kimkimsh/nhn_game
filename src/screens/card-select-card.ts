/**
 * 카드 한 장 — 08_화면과_UI.md §3.2. 그림은 `11_card_select/scene.js:46-101`.
 *
 * §15.2가 요구하는 「이름 · 효과 설명 · **정확한 수치** · 현재 중첩 / 최대 중첩」이 여기서 한
 * 장에 들어간다. **수치는 반올림하거나 「약」을 붙이지 않는다** — 이 화면이 §11.6의 보정 결과를
 * 플레이어에게 처음 보여 주는 자리이고, 여기서 흐려지면 카드 선택이 감으로 바뀐다.
 *
 * 등급색이 닿는 자리는 상단 띠·테두리·「현재 → 선택 후」 판의 테두리뿐이다. 본문은 등급을
 * 색으로 말하지 않는다 — §17이 색만으로 상태를 구분하지 말라고 했고, 등급은 이름과 ID로도
 * 적혀 있다.
 */

import { PALETTE } from '../config/palette';
import { FONTS } from '../config/ui';
import { glow, hexA } from '../render/primitives';
import { CLAMP_RULE_LABELS, type CardDelta } from './card-delta';
import {
  cardRectU,
  roundedPath,
  ruleLine,
  setFont,
  wrapText,
  CS,
  RARITY_COLORS,
  RARITY_LABELS,
  THIN_LINE_U,
  type OfferedCardView,
  type RectU,
} from './card-select-parts';

/** 목업 카드 판의 채움색. 게임 규칙을 하나도 나르지 않아 palette.ts에 자리가 없다 (`:66-67` · `:98`) */
const PICKED_PLATE_FILL = '#151a24';
const IDLE_PLATE_FILL = '#0e1119';
const DELTA_PLATE_FILL = '#0a0d14';

/** 카드 원점(x, y) 기준 상대값 (u) */
const CARD_PAD_XU = 26;
const RARITY_BASELINE_DYU = 62;
const NAME_BASELINE_DYU = 140;
const CARD_RULE_DYU = 176;
const EFFECT_FIRST_DYU = 224;
const EFFECT_STEP_DYU = 38;
const DELTA_INSET_XU = 22;
const DELTA_RADIUS_U = 5;
const DELTA_BASELINE_DYU = 44;
const DELTA_BEFORE_DXU = 40;
const DELTA_ARROW_GAP_U = 12;
const DELTA_AFTER_GAP_U = 14;
/** 아래 둘만 카드 **바닥**에서 잰다 — 두 줄 다 카드 높이에 붙어 있다 */
const BLOCKED_BASELINE_UP_U = 78;
const STACK_BASELINE_UP_U = 40;

const PICKED_GLOW_RU = 380;
const PICKED_GLOW_ALPHA = 0.16;
const CARD_RULE_ALPHA = 0.14;
const CARD_IDLE_STROKE_ALPHA = 0.4;
const DELTA_BORDER_ALPHA = 0.3;

const RARITY_PX = 24;
const CARD_NAME_PX = 52;
const EFFECT_PX = 27;
const DELTA_PX = 26;
const STACK_PX = 24;
const BLOCKED_PX = 22;

const ARROW_TEXT = '→';
/** N14의 maxStack은 Infinity다 (§11.3 무제한) */
const STACK_UNLIMITED_TEXT = '∞';

/**
 * §15.2 「현재 값 → 선택 후 값」. 두 값은 §11.6을 실제로 두 번 돌려 얻은 것이고 문구의
 * 명목값을 더한 것이 아니다 — `card-delta.ts`가 그 계산을 갖는다.
 */
function drawDeltaPlate(
  ctx: CanvasRenderingContext2D,
  rect: RectU,
  color: string,
  delta: CardDelta,
): void {
  const plate: RectU = {
    xU: rect.xU + DELTA_INSET_XU,
    yU: rect.yU + CS.deltaPlateOffsetYU,
    widthU: rect.widthU - DELTA_INSET_XU * 2,
    heightU: CS.deltaPlateHeightU,
  };
  ctx.fillStyle = DELTA_PLATE_FILL;
  roundedPath(ctx, plate, DELTA_RADIUS_U);
  ctx.fill();
  ctx.strokeStyle = hexA(color, DELTA_BORDER_ALPHA);
  ctx.lineWidth = THIN_LINE_U;
  roundedPath(ctx, plate, DELTA_RADIUS_U);
  ctx.stroke();

  const baselineYU = plate.yU + DELTA_BASELINE_DYU;
  ctx.textAlign = 'left';
  setFont(ctx, 500, DELTA_PX, FONTS.data);
  ctx.fillStyle = PALETTE.baekFaint;
  const beforeXU = rect.xU + DELTA_BEFORE_DXU;
  ctx.fillText(delta.beforeText, beforeXU, baselineYU);
  const arrowXU = beforeXU + ctx.measureText(delta.beforeText).width + DELTA_ARROW_GAP_U;
  ctx.fillStyle = PALETTE.baekMute;
  ctx.fillText(ARROW_TEXT, arrowXU, baselineYU);
  const afterXU = arrowXU + ctx.measureText(ARROW_TEXT).width + DELTA_AFTER_GAP_U;
  setFont(ctx, 600, DELTA_PX, FONTS.data);
  ctx.fillStyle = PALETTE.hwang;
  ctx.fillText(delta.afterText, afterXU, baselineYU);
}

/**
 * §11.6이 값을 잘라 이 카드가 아무것도 바꾸지 못하는 상태. 무엇이 잘랐는지는
 * `EffectiveStats.clamps`의 rule이 답한다 (12 §8-17).
 *
 * 색이 아니라 문장이 신호인 것은 §17 — 팔레트의 다섯 색이 전부 전투 규칙에 묶여 있어 경고에
 * 쓸 색이 없고, 색만으로 상태를 구분하지도 않는다.
 */
function blockedNote(delta: CardDelta): string {
  const rule = delta.cappedRule;
  return rule === null
    ? '이미 상한이라 수치가 움직이지 않는다'
    : `${CLAMP_RULE_LABELS[rule]}에 막혀 수치가 움직이지 않는다`;
}

export function drawOfferedCard(
  ctx: CanvasRenderingContext2D,
  card: OfferedCardView,
  index: number,
  picked: boolean,
): void {
  const rect = cardRectU(index);
  const color = RARITY_COLORS[card.rarity];
  ctx.save();
  if (picked) {
    glow(
      ctx,
      rect.xU + rect.widthU / 2,
      rect.yU + rect.heightU / 2,
      PICKED_GLOW_RU,
      color,
      PICKED_GLOW_ALPHA,
    );
    ctx.translate(0, -CS.pickedLiftU);
  }
  ctx.fillStyle = picked ? PICKED_PLATE_FILL : IDLE_PLATE_FILL;
  roundedPath(ctx, rect, CS.cardRadiusU);
  ctx.fill();
  ctx.strokeStyle = picked ? color : hexA(color, CARD_IDLE_STROKE_ALPHA);
  ctx.lineWidth = picked ? CS.pickedStrokeU : CS.idleStrokeU;
  roundedPath(ctx, rect, CS.cardRadiusU);
  ctx.stroke();

  ctx.fillStyle = color;
  roundedPath(ctx, { ...rect, heightU: CS.rarityBandHeightU }, CS.cardRadiusU / 2);
  ctx.fill();

  const leftXU = rect.xU + CARD_PAD_XU;
  const rightXU = rect.xU + rect.widthU - CARD_PAD_XU;
  setFont(ctx, 600, RARITY_PX, FONTS.data);
  ctx.textAlign = 'left';
  ctx.fillText(RARITY_LABELS[card.rarity], leftXU, rect.yU + RARITY_BASELINE_DYU);
  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.fillText(card.id, rightXU, rect.yU + RARITY_BASELINE_DYU);

  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baek;
  setFont(ctx, 700, CARD_NAME_PX, FONTS.display);
  // §12 §3.1 웹폰트를 번들하지 않으므로 대체 폰트의 자폭이 기기마다 다르다. 이름 넉 자가
  // 카드 판을 넘어 옆 카드 밑으로 들어가면 「무명 병졸의 갑」까지만 읽힌다 — maxWidth가
  // 그 자리에서 글자를 눌러 담고, 표시 폭은 텍스트 열 안에 갇힌다
  ctx.fillText(card.name, leftXU, rect.yU + NAME_BASELINE_DYU, rightXU - leftXU);
  ruleLine(ctx, leftXU, rightXU, rect.yU + CARD_RULE_DYU, hexA(PALETTE.baek, CARD_RULE_ALPHA));

  setFont(ctx, 400, EFFECT_PX, FONTS.body);
  ctx.fillStyle = PALETTE.baekMute;
  wrapText(ctx, card.text, rightXU - leftXU).forEach((line, lineIndex) => {
    ctx.fillText(line, leftXU, rect.yU + EFFECT_FIRST_DYU + lineIndex * EFFECT_STEP_DYU);
  });

  // §15.2 이 판은 **이미 보유 중인** 카드에만 붙는다. 미보유 카드는 그 자리를 비운다 —
  // 다른 것으로 채우면 세 장의 세로 리듬이 어긋나 비교가 어려워진다 (08 §3.2)
  if (card.delta !== null && card.stack > 0) {
    drawDeltaPlate(ctx, rect, color, card.delta);
  }
  if (card.delta !== null && !card.delta.changed) {
    setFont(ctx, 400, BLOCKED_PX, FONTS.body);
    ctx.fillStyle = PALETTE.baekMute;
    ctx.fillText(blockedNote(card.delta), leftXU, rect.yU + rect.heightU - BLOCKED_BASELINE_UP_U);
  }

  setFont(ctx, 500, STACK_PX, FONTS.data);
  ctx.fillStyle = PALETTE.baekFaint;
  const maxText = Number.isFinite(card.maxStack) ? String(card.maxStack) : STACK_UNLIMITED_TEXT;
  ctx.fillText(
    `중첩  ${card.stack} / ${maxText}`,
    leftXU,
    rect.yU + rect.heightU - STACK_BASELINE_UP_U,
  );
  ctx.restore();
}
