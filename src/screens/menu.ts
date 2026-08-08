/**
 * 일시정지와 결과가 공유하는 조각 — 08 §4.3 · §4.5 · §5.5, 스펙 §16.3.
 *
 * 두 화면은 같은 조작(↑ ↓ 이동 · `Enter` / `Space` / 클릭 실행)을 받으므로 상자 규격을
 * 공유한다. 규격 자체는 `config/ui.ts`의 `UI.menu`이고 이 파일이 갖는 것은 그 값으로 상자를
 * 놓고 · 그리고 · 맞히는 일뿐이다. 같은 모양이 두 화면에서 다르게 동작하면 조작이 화면마다
 * 다르다는 뜻이 된다.
 *
 * **확정 패널도 같은 메뉴다** (08 §4.5 · §5.5). 「메뉴를 확정 패널로 **교체**한다」이므로
 * 항목 수만 다른 같은 배치를 쓴다. 첫 상자 자리가 같아서 확정 단계에 들어가도 화면 아래
 * 안내 줄이 위아래로 튀지 않는다.
 *
 * 메뉴가 아닌 것 셋(등급색·중첩 표기·천 단위 콤마)도 여기 있다. 둘 다 보유 카드를 그리므로
 * 두 번째 사용처가 이미 있고, 그 셋을 위해 파일을 하나 더 늘리면 두 화면이 세 파일을 연다.
 *
 * 파일이 갈린 이유는 한 파일 400줄 상한 하나이고, 이 파일을 쓰는 것은 `pause.ts`·`result.ts`
 * 둘뿐이다.
 */

import { CARDS } from '../config/cards';
import type { CardId, CardRarity } from '../config/ids';
import { PALETTE } from '../config/palette';
import { FONTS, UI } from '../config/ui';
import type { InputPress, PointerPositionU, PointerState } from '../core/input';
import { glow, hexA } from '../render/primitives';

const MENU = UI.menu;

/** §11.2 등급색 3종. 이 값의 소유자는 palette.ts이고 여기서는 등급 → 색만 잇는다 */
const RARITY_COLORS: Readonly<Record<CardRarity, string>> = {
  NORMAL: PALETTE.rarityNormal,
  RARE: PALETTE.rarityRare,
  EPIC: PALETTE.rarityEpic,
};

export function rarityColorOf(id: CardId): string {
  return RARITY_COLORS[CARDS[id].rarity];
}

/**
 * 10 A2 — 중첩은 한 줄(칩)에 `×n`으로 접는다. 1중첩에는 붙이지 않는다:
 * 「현재 중첩 / 최대 중첩」은 카드 선택 화면의 요구사항(§15.2)이고 이 두 화면이 말할 것은
 * 「같은 카드를 몇 번 골랐나」뿐이다.
 */
export function cardNameWithStack(id: CardId, stack: number): string {
  return stack > 1 ? `${CARDS[id].name} ×${stack}` : CARDS[id].name;
}

/** 목업 13_result/scene.js:74 총점의 천 단위 콤마. 자릿수가 많아 구분 없이는 읽히지 않는다 */
export function formatCount(value: number): string {
  return String(Math.max(0, Math.floor(value))).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/** 목업 14_pause/scene.js:146 커서가 놓인 상자의 테두리 두께 (u) */
const CURSOR_STROKE_U = 2.5;
/** 목업 14_pause/scene.js:155 나머지 상자 (u) */
const IDLE_STROKE_U = 2;
/** 목업 14_pause/scene.js:155 나머지 상자 테두리 알파 (0~1) */
const IDLE_STROKE_ALPHA = 0.28;
/** 목업 14_pause/scene.js:148 커서 상자 글로우 알파 (0~1) */
const CURSOR_GLOW_ALPHA = 0.09;
/** 목업 14_pause/scene.js:146·151 — 첫 상자(92u)의 라벨 베이스라인이 상단에서 떨어진 거리 (u) */
const PRIMARY_LABEL_OFFSET_U = 58;
/** 목업 14_pause/scene.js:154·158 — 나머지 상자(78u) (u) */
const SECONDARY_LABEL_OFFSET_U = 48;

/** 목업 14_pause/scene.js:167 조작 안내 줄 (px). weight 400 / body */
const HINT_PX = 26;

export interface MenuBox {
  readonly yU: number;
  readonly heightU: number;
  readonly labelPx: number;
  readonly labelBaselineYU: number;
}

export interface MenuLayout {
  readonly boxes: readonly MenuBox[];
  /** 마지막 상자의 아래 변 (u). 그 아래에 안내 줄을 놓는 화면이 읽는다 */
  readonly bottomYU: number;
}

/**
 * 첫 항목만 높이·글자가 크다. 커서가 어디 있든 그 크기는 그대로이고 강조(황 테두리·글로우)만
 * 커서를 따라간다 — 커서가 상자 크기를 바꾸면 이동할 때마다 아래 항목이 통째로 밀린다.
 */
export function layoutMenu(firstYU: number, count: number): MenuLayout {
  const boxes: MenuBox[] = [];
  let yU = firstYU;
  for (let index = 0; index < count; index += 1) {
    const primary = index === 0;
    const heightU = primary ? MENU.primaryHeightU : MENU.secondaryHeightU;
    boxes.push({
      yU,
      heightU,
      labelPx: primary ? MENU.labelPx : MENU.subLabelPx,
      labelBaselineYU: yU + (primary ? PRIMARY_LABEL_OFFSET_U : SECONDARY_LABEL_OFFSET_U),
    });
    yU += heightU + MENU.gapU;
  }
  return { boxes, bottomYU: Math.max(firstYU, yU - MENU.gapU) };
}

/** 목업 14_pause/scene.js:12-20 rrect — 모서리 반경은 UI.menu.boxRadiusU 하나뿐이다 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  xU: number,
  yU: number,
  widthU: number,
  heightU: number,
  radiusU: number,
): void {
  ctx.beginPath();
  ctx.moveTo(xU + radiusU, yU);
  ctx.arcTo(xU + widthU, yU, xU + widthU, yU + heightU, radiusU);
  ctx.arcTo(xU + widthU, yU + heightU, xU, yU + heightU, radiusU);
  ctx.arcTo(xU, yU + heightU, xU, yU, radiusU);
  ctx.arcTo(xU, yU, xU + widthU, yU, radiusU);
  ctx.closePath();
}

/**
 * 08 §4.3 — 강조가 커서 표시를 겸한다. 별도의 커서 도형을 만들지 않는 것은 목업이 그렇게
 * 그렸기 때문이고, 강조가 곧 커서라서 「지금 Enter를 누르면 무엇이 실행되나」가 한 곳에만 있다.
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  layout: MenuLayout,
  labels: readonly string[],
  cursor: number,
): void {
  const centerXU = MENU.boxXU + MENU.boxWidthU / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let index = 0; index < layout.boxes.length; index += 1) {
    const box = layout.boxes[index];
    if (box === undefined) {
      continue;
    }
    const focused = index === cursor;
    ctx.strokeStyle = focused ? PALETTE.hwang : hexA(PALETTE.baek, IDLE_STROKE_ALPHA);
    ctx.lineWidth = focused ? CURSOR_STROKE_U : IDLE_STROKE_U;
    roundRect(ctx, MENU.boxXU, box.yU, MENU.boxWidthU, box.heightU, MENU.boxRadiusU);
    ctx.stroke();
    if (focused) {
      glow(ctx, centerXU, box.yU + box.heightU / 2, MENU.primaryGlowRU, PALETTE.hwang, CURSOR_GLOW_ALPHA);
    }
    ctx.fillStyle = focused ? PALETTE.hwang : PALETTE.baekMute;
    ctx.font = `600 ${box.labelPx}px ${FONTS.data}`;
    ctx.fillText(labels[index] ?? '', centerXU, box.labelBaselineYU);
  }
  ctx.restore();
}

/** 목업 14_pause/scene.js:167-170 조작 안내·경고 줄. 두 화면이 같은 서체와 색을 쓴다 */
export function drawHintLine(ctx: CanvasRenderingContext2D, yU: number, text: string): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `400 ${HINT_PX}px ${FONTS.body}`;
  ctx.fillText(text, MENU.boxXU + MENU.boxWidthU / 2, yU);
  ctx.restore();
}

/** 12 §1 C-02 — 배경은 전투 프레임이고 딤은 각 화면이 자기 그림 안에서 얹는다 */
export function dimFrame(ctx: CanvasRenderingContext2D, alpha: number, widthU: number, heightU: number): void {
  ctx.save();
  ctx.fillStyle = hexA(PALETTE.ink900, alpha);
  ctx.fillRect(0, 0, widthU, heightU);
  ctx.restore();
}

function menuHit(layout: MenuLayout, point: PointerPositionU): number | null {
  if (point.xU < MENU.boxXU || point.xU > MENU.boxXU + MENU.boxWidthU) {
    return null;
  }
  for (let index = 0; index < layout.boxes.length; index += 1) {
    const box = layout.boxes[index];
    if (box !== undefined && point.yU >= box.yU && point.yU <= box.yU + box.heightU) {
      return index;
    }
  }
  return null;
}

export interface MenuState {
  cursor: number;
  /** 마지막으로 호버 판정에 쓴 커서 자리. 실제로 움직였을 때만 다시 판정한다 */
  pointerXU: number;
  pointerYU: number;
}

export function createMenuState(): MenuState {
  return { cursor: 0, pointerXU: Number.NaN, pointerYU: Number.NaN };
}

/**
 * 항목 수가 바뀌는 자리(메뉴 ↔ 확정 패널)와 화면을 다시 열 때 부른다.
 *
 * **지금 커서 자리를 같이 받는다.** NaN으로 두면 `NaN === NaN`이 거짓이라 다음 프레임의
 * `applyMenuHover`가 「움직였다」로 읽고 가만히 놓인 마우스 아래 항목을 집는다. 08 §4.3이
 * 「언제나 계속하기에서 연다」고 했는데 마우스로 패리하던 사람은 음소거나 런 포기에서 열린다.
 */
export function resetMenuState(state: MenuState, pointer: PointerState): void {
  state.cursor = 0;
  state.pointerXU = pointer.seen ? pointer.xU : Number.NaN;
  state.pointerYU = pointer.seen ? pointer.yU : Number.NaN;
}

/**
 * 커서가 마우스를 따라간다 — **움직였을 때만**. 매 프레임 무조건 따라가게 두면 키보드로 옮긴
 * 커서를 가만히 놓인 마우스가 매 프레임 되돌려 놓아 방향키가 아무 일도 안 하는 것처럼 보인다.
 */
export function applyMenuHover(state: MenuState, layout: MenuLayout, pointer: PointerState): void {
  if (!pointer.seen || (pointer.xU === state.pointerXU && pointer.yU === state.pointerYU)) {
    return;
  }
  state.pointerXU = pointer.xU;
  state.pointerYU = pointer.yU;
  const hit = menuHit(layout, pointer);
  if (hit !== null) {
    state.cursor = hit;
  }
}

/**
 * 눌림 하나를 메뉴 동작으로 해석한다. 실행된 항목의 인덱스를 내고, 이동이거나 이 메뉴와
 * 무관한 눌림이면 null이다.
 *
 * 커서 이동은 감싸지 않는다(clamp). 첫 항목에서 ↑ 를 누른 것이 마지막 항목으로 감기면
 * 08 §4.5가 커서에서 가장 멀리 두라고 한 「런 포기」가 ↑ 한 번 거리로 돌아온다.
 */
export function applyMenuPress(state: MenuState, layout: MenuLayout, press: InputPress): number | null {
  const last = layout.boxes.length - 1;
  if (press.action === 'moveUp') {
    state.cursor = Math.max(0, state.cursor - 1);
    return null;
  }
  if (press.action === 'moveDown') {
    state.cursor = Math.min(last, state.cursor + 1);
    return null;
  }
  if (press.action !== 'confirm') {
    return null;
  }
  // 클릭은 커서를 거치지 않고 누른 자리를 실행한다(§16.3). 눌린 순간의 좌표를 쓰는 것은
  // 커서가 그 사이에 움직이기 때문이다 — core/input.ts가 눌림에 좌표를 실어 보낸다
  if (press.pointerU !== null) {
    const hit = menuHit(layout, press.pointerU);
    if (hit === null) {
      return null;
    }
    state.cursor = hit;
    return hit;
  }
  return Math.min(last, Math.max(0, state.cursor));
}
