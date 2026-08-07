/**
 * 카드 선택 화면의 그림 한 장 — 08_화면과_UI.md §3.1 · §3.3 · §3.4. 그림은 `11_card_select/scene.js`.
 *
 * 상태를 하나도 갖지 않는다. `card-select.ts`가 만든 뷰 하나를 받아 그리기만 하므로, 무엇을
 * 고를 수 있는가(§3.5)와 무엇이 보이는가(§3.1)가 한 파일에서 섞이지 않는다.
 *
 * 딤은 여기서 얹는다 — 아래에 남아 있는 전투 프레임이 "런이 이어지고 있다"는 정보 그 자체다
 * (12 §1 C-02). 카드 한 장은 `card-select-card.ts`가, 타입과 기하는 `card-select-parts.ts`가 갖는다.
 */

import { DRAW, RARITY_WEIGHTS } from '../config/cards/draw-table';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { FONTS, UI } from '../config/ui';
import { glow, hexA } from '../render/primitives';
import { drawOfferedCard } from './card-select-card';
import {
  roundedPath,
  ruleLine,
  setFont,
  wrapText,
  CENTER_XU,
  CS,
  HELD_LABEL_PX,
  HELD_LEFT_XU,
  HELD_RIGHT_XU,
  RARITY_COLORS,
  THIN_LINE_U,
  type CardSelectView,
  type HeldCardView,
} from './card-select-parts';

const PAUSE = UI.pause;

const HELD_RULE_ALPHA = 0.12;
const HELD_CHIP_ALPHA = 0.2;
const REROLL_LEFT_ALPHA = 0.4;
const REROLL_SPENT_ALPHA = 0.12;
const CONFIRM_IDLE_ALPHA = 0.25;
const DETAIL_RULE_ALPHA = 0.14;

const HELD_CHIP_TEXT_DXU = 17;
const HELD_CHIP_TEXT_BASELINE_YU = 1404;

/** 버튼 상자 원점 기준 (u). 목업 `:220-241` */
const CONFIRM_LABEL_DYU = 56;
const CONFIRM_GLOW_DYU = 44;
const CONFIRM_GLOW_RU = 210;
const CONFIRM_GLOW_ALPHA = 0.1;
const CONFIRM_STROKE_U = 2.5;
const REROLL_STROKE_U = 2;
const REROLL_LABEL_DYU = 46;
const REROLL_SUB_DYU = 76;

/** `Tab` 상세는 일시정지 화면의 보유 목록과 **같은 기하**다 (08 §3.4 · §4.2) */
const DETAIL_LEFT_XU = 120;
const DETAIL_RIGHT_XU = 960;
const DETAIL_SWATCH_DYU = 6;
const DETAIL_ID_DXU = 26;
const DETAIL_ID_DYU = 28;
const DETAIL_NAME_DYU = 62;
const DETAIL_TEXT_DYU = 56;
const DETAIL_ID_PX = 22;
const DETAIL_NAME_PX = 32;
const DETAIL_TEXT_PX = 26;
/** 오른쪽 정렬 효과 문구가 이름 열을 침범하지 않게 하는 폭 (u) */
const DETAIL_TEXT_MAX_WIDTH_U = 420;

const CLEAR_PX = 30;
const TITLE_PX = 74;
const SUBTITLE_PX = 27;
const HELD_CHIP_PX = 25;
const BUTTON_PX = 36;
const BUTTON_SUB_PX = 22;
const HINT_PX = 26;
const DRAW_TABLE_PX = 24;

const TITLE_TEXT = '한 장을 고른다';
const HELD_LABEL_TEXT = '보유 카드';
const EMPTY_HELD_TEXT = '아직 없다';
const CONFIRM_TEXT = 'ENTER  확정';
const REROLL_TEXT = 'R  다시 뽑기';
const REROLL_NOTE_TEXT = '다시 뽑으면 등급부터 다시 추첨한다';
/** 확정 버튼 라벨은 `Enter` 하나뿐이라 §16.2의 세 입력을 이 줄이 전부 적는다 (08 §3.5) */
const HINT_TEXT = '← →  카드 이동      Enter · Space · 클릭  확정      R  다시 뽑기      Tab  보유 카드';

/**
 * §3.4 상시 칩 줄. 1회차의 보유 목록은 비어 있고, 그때도 **라벨과 가로선은 지우지 않는다** —
 * 줄 자체가 사라지면 이 기능이 없는 것처럼 읽히고 2회차에 갑자기 나타나면 화면이 바뀐 것으로 보인다.
 */
function drawHeldRow(ctx: CanvasRenderingContext2D, held: readonly HeldCardView[]): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, 500, HELD_LABEL_PX, FONTS.data);
  ctx.fillText(HELD_LABEL_TEXT, HELD_LEFT_XU, CS.heldLabelYU);
  ruleLine(ctx, HELD_LEFT_XU, HELD_RIGHT_XU, CS.heldRuleYU, hexA(PALETTE.baek, HELD_RULE_ALPHA));

  setFont(ctx, 400, HELD_CHIP_PX, FONTS.body);
  if (held.length === 0) {
    ctx.fillStyle = PALETTE.baekFaint;
    ctx.fillText(EMPTY_HELD_TEXT, HELD_LEFT_XU, HELD_CHIP_TEXT_BASELINE_YU);
    return;
  }
  let chipXU = HELD_LEFT_XU;
  for (const card of held) {
    // 10 A2 — 중첩은 칩 하나에 `×n`으로 접는다. 칩 수는 회차 수를 넘지 않는다
    const text = `${card.id} ${card.name} ×${card.stack}`;
    const widthU = ctx.measureText(text).width + CS.heldChipPadU;
    ctx.strokeStyle = hexA(PALETTE.baek, HELD_CHIP_ALPHA);
    ctx.lineWidth = THIN_LINE_U;
    roundedPath(
      ctx,
      { xU: chipXU, yU: CS.heldChipYU, widthU, heightU: CS.heldChipHeightU },
      CS.cardRadiusU / 2,
    );
    ctx.stroke();
    ctx.fillStyle = PALETTE.baekMute;
    ctx.fillText(text, chipXU + HELD_CHIP_TEXT_DXU, HELD_CHIP_TEXT_BASELINE_YU);
    chipXU += widthU + CS.heldChipGapU;
  }
}

/** §3.5 확정 버튼. 선택이 없으면 테두리가 옅어지고 글로우가 빠진다 — 비활성이 보여야 한다 */
function drawConfirmButton(ctx: CanvasRenderingContext2D, active: boolean): void {
  const box = CS.confirmBox;
  const centerXU = box.xU + box.widthU / 2;
  const color = active ? PALETTE.hwang : hexA(PALETTE.hwang, CONFIRM_IDLE_ALPHA);
  ctx.strokeStyle = color;
  ctx.lineWidth = CONFIRM_STROKE_U;
  roundedPath(ctx, box, box.radiusU);
  ctx.stroke();
  if (active) {
    glow(ctx, centerXU, box.yU + CONFIRM_GLOW_DYU, CONFIRM_GLOW_RU, PALETTE.hwang, CONFIRM_GLOW_ALPHA);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  setFont(ctx, 600, BUTTON_PX, FONTS.data);
  ctx.fillText(CONFIRM_TEXT, centerXU, box.yU + CONFIRM_LABEL_DYU);
}

/**
 * §3.3 리롤 버튼. **소진돼도 지우지 않는다** — 사라지면 "왜 R이 안 먹지"가 되고, 남아 있으면
 * "이미 썼구나"가 된다. §15.2의 "사용 불가임이 보여야 한다"는 없애라는 뜻이 아니다.
 */
function drawRerollButton(ctx: CanvasRenderingContext2D, rerollLeft: number): void {
  const box = CS.rerollBox;
  const centerXU = box.xU + box.widthU / 2;
  const usable = rerollLeft > 0;
  ctx.strokeStyle = hexA(PALETTE.baek, usable ? REROLL_LEFT_ALPHA : REROLL_SPENT_ALPHA);
  ctx.lineWidth = REROLL_STROKE_U;
  roundedPath(ctx, box, box.radiusU);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = usable ? PALETTE.baek : PALETTE.baekFaint;
  setFont(ctx, 600, BUTTON_PX, FONTS.data);
  ctx.fillText(REROLL_TEXT, centerXU, box.yU + REROLL_LABEL_DYU);
  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, 400, BUTTON_SUB_PX, FONTS.body);
  ctx.fillText(
    `런당 ${DRAW.rerollsPerRun}회 · 남음 ${rerollLeft}`,
    centerXU,
    box.yU + REROLL_SUB_DYU,
  );
}

/** §3.4 `Tab` 상세 — ID · 이름 ×중첩 · 효과 수치를 카드마다 3열로 */
function drawHeldDetail(ctx: CanvasRenderingContext2D, held: readonly HeldCardView[]): void {
  ctx.fillStyle = hexA(PALETTE.ink900, CS.dimAlpha);
  ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);

  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, 500, HELD_LABEL_PX, FONTS.data);
  ctx.fillText(`${HELD_LABEL_TEXT}  ${held.length}`, DETAIL_LEFT_XU, PAUSE.heldHeaderYU);
  ruleLine(ctx, DETAIL_LEFT_XU, DETAIL_RIGHT_XU, PAUSE.heldRuleYU, hexA(PALETTE.baek, DETAIL_RULE_ALPHA));

  if (held.length === 0) {
    setFont(ctx, 400, DETAIL_TEXT_PX, FONTS.body);
    ctx.fillText(EMPTY_HELD_TEXT, DETAIL_LEFT_XU, PAUSE.heldRowFirstYU + DETAIL_NAME_DYU);
    return;
  }
  held.forEach((card, index) => {
    const rowYU = PAUSE.heldRowFirstYU + index * PAUSE.heldRowStepU;
    ctx.fillStyle = RARITY_COLORS[card.rarity];
    ctx.fillRect(DETAIL_LEFT_XU, rowYU + DETAIL_SWATCH_DYU, PAUSE.heldSwatchWidthU, PAUSE.heldSwatchHeightU);
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.baekFaint;
    setFont(ctx, 500, DETAIL_ID_PX, FONTS.data);
    ctx.fillText(card.id, DETAIL_LEFT_XU + DETAIL_ID_DXU, rowYU + DETAIL_ID_DYU);
    ctx.fillStyle = PALETTE.baek;
    setFont(ctx, 600, DETAIL_NAME_PX, FONTS.body);
    ctx.fillText(`${card.name} ×${card.stack}`, DETAIL_LEFT_XU + DETAIL_ID_DXU, rowYU + DETAIL_NAME_DYU);
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.baekMute;
    setFont(ctx, 400, DETAIL_TEXT_PX, FONTS.body);
    // 효과 문구가 긴 카드(E02·E06)는 한 줄에 안 들어간다. 넘치면 위로 접어 이름 열을 덮지 않는다
    wrapText(ctx, card.text, DETAIL_TEXT_MAX_WIDTH_U).forEach((line, lineIndex, lines) => {
      const offsetYU = (lineIndex - (lines.length - 1)) * DETAIL_TEXT_PX;
      ctx.fillText(line, DETAIL_RIGHT_XU, rowYU + DETAIL_TEXT_DYU + offsetYU);
    });
  });
}

/** 층 12에 얹는 한 장 */
export function paintCardSelect(ctx: CanvasRenderingContext2D, view: CardSelectView): void {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = hexA(PALETTE.ink900, CS.dimAlpha);
  ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);

  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.cheong;
  setFont(ctx, 500, CLEAR_PX, FONTS.data);
  ctx.fillText(`STAGE ${view.round}  CLEAR`, CENTER_XU, CS.clearLabelBaselineYU);
  ctx.fillStyle = PALETTE.baek;
  setFont(ctx, 700, TITLE_PX, FONTS.display);
  ctx.fillText(TITLE_TEXT, CENTER_XU, CS.titleBaselineYU);
  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, 400, SUBTITLE_PX, FONTS.body);
  ctx.fillText(
    `건너뛸 수 없다 · 남은 선택 기회 ${DRAW.acquisitionCount}회 중 ${view.round}회차`,
    CENTER_XU,
    CS.subtitleBaselineYU,
  );

  view.cards.forEach((card, index) => {
    drawOfferedCard(ctx, card, index, view.pickedIndex === index);
  });

  drawHeldRow(ctx, view.held);
  drawConfirmButton(ctx, view.pickedIndex !== null);
  drawRerollButton(ctx, view.rerollLeft);

  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, 400, HINT_PX, FONTS.body);
  ctx.fillText(HINT_TEXT, CENTER_XU, CS.hintBaselineYU);
  setFont(ctx, 400, DRAW_TABLE_PX, FONTS.data);
  // §11.2의 회차별 가중치. 하드코딩하지 않고 config/cards/draw-table.ts에서 읽는다 (08 §3.1)
  const weights = RARITY_WEIGHTS[view.round];
  ctx.fillText(
    `등급 추첨 ${view.round}회차 — 노말 ${weights.NORMAL} / 레어 ${weights.RARE} / 에픽 ${weights.EPIC}`,
    CENTER_XU,
    CS.drawTableBaselineYU,
  );
  ctx.fillText(REROLL_NOTE_TEXT, CENTER_XU, CS.rerollNoteBaselineYU);

  if (view.detailOpen) {
    drawHeldDetail(ctx, view.held);
  }
  ctx.restore();
}
