/**
 * 카드 선택 화면의 뷰 계약과, 그림 두 파일이 함께 쓰는 기하·헬퍼 — 08_화면과_UI.md §3.
 *
 * 여기 있는 것은 「무엇을 그릴지」의 모양(타입)과 「어디에 그릴지」(기하)뿐이고, 실제로 긋는
 * 획은 하나도 없다. 기하가 그림에서 떨어져 나온 이유는 소비자가 둘이기 때문이다 —
 * `card-select-view.ts`가 그리는 자리와 `card-select.ts`가 클릭을 맞히는 자리가 같은 값이어야
 * 하고, 두 곳에 따로 적으면 카드 폭을 고칠 때 그림만 움직인다.
 *
 * ── ui.ts에 없는 좌표가 여기 있는 이유 ──────────────────────────────────────────
 *
 * config/ui.ts의 cardSelect 블록은 화면 골격(카드 상자·보유 줄·버튼)까지다. 카드 **안쪽**의
 * 여백이나 줄 간격은 카드 한 장 안에서만 서로 얽혀 있어 상수로 뽑아도 한 곳에서만 읽힌다 —
 * 08 §9가 타이틀 구도 값을 ui.ts에 넣지 않은 것과 같은 이유이고, 그 값들은 그리는 파일이 갖는다.
 */

import type { CardId, CardRarity } from '../config/ids';
import { PALETTE } from '../config/palette';
import type { GlowBakeColor } from '../render/primitives';
import { PLAYFIELD } from '../config/playfield';
import { UI } from '../config/ui';
import type { CardRound } from '../sim/cards';
import type { CardDelta } from './card-delta';

export const CS = UI.cardSelect;
export const CENTER_XU = PLAYFIELD.widthU / 2;
export const THIN_LINE_U = 1.5;

/** 보유 줄의 좌우 끝 (u). 목업 `11_card_select/scene.js:203-218` */
export const HELD_LEFT_XU = 80;
export const HELD_RIGHT_XU = PLAYFIELD.widthU - HELD_LEFT_XU;
export const HELD_LABEL_PX = 24;

/** §11.2의 세 등급 이름. ids.ts의 키는 영문이고 화면에 적는 것은 스펙 표의 한글이다 */
export const RARITY_LABELS: Readonly<Record<CardRarity, string>> = {
  NORMAL: '노말',
  RARE: '레어',
  EPIC: '에픽',
};

/** §11.2가 고정한 세 색. 여기서 만들지 않고 palette.ts에서 읽는다 — 다시 칠하지 않는다 */
export const RARITY_COLORS: Readonly<Record<CardRarity, GlowBakeColor>> = {
  NORMAL: PALETTE.rarityNormal,
  RARE: PALETTE.rarityRare,
  EPIC: PALETTE.rarityEpic,
};

export interface RectU {
  readonly xU: number;
  readonly yU: number;
  readonly widthU: number;
  readonly heightU: number;
}

export interface OfferedCardView {
  readonly id: CardId;
  readonly name: string;
  readonly rarity: CardRarity;
  /** sim/cards.ts의 cardText가 채운 문구. 숫자 소스는 effects 하나다 (12 §8-12) */
  readonly text: string;
  readonly stack: number;
  readonly maxStack: number;
  /** 「현재 → 선택 후」 판과 상한 경고가 함께 여기서 나온다. 수치 한 칸이 아닌 카드는 null */
  readonly delta: CardDelta | null;
}

export interface HeldCardView {
  readonly id: CardId;
  readonly name: string;
  readonly rarity: CardRarity;
  readonly stack: number;
  readonly text: string;
}

export interface CardSelectView {
  readonly round: CardRound;
  readonly cards: readonly OfferedCardView[];
  readonly held: readonly HeldCardView[];
  readonly pickedIndex: number | null;
  /** §11.1 런당 1회. 0이면 버튼은 남되 입력이 무시된다 (08 §3.3) */
  readonly rerollLeft: number;
  readonly detailOpen: boolean;
}

/** 카드 i의 상자. 선택된 카드가 18u 떠오르는 것은 그림뿐이고 이 상자는 움직이지 않는다 */
export function cardRectU(index: number): RectU {
  return {
    xU: CS.cardFirstXU + index * (CS.cardWidthU + CS.cardGapU),
    yU: CS.cardTopYU,
    widthU: CS.cardWidthU,
    heightU: CS.cardHeightU,
  };
}

/** 보유 줄 전체. 마우스로 상세를 여는 자리다 — `Tab`은 홀드고 클릭은 토글이다 (08 §3.4) */
export const HELD_RECT: RectU = {
  xU: HELD_LEFT_XU,
  yU: CS.heldLabelYU - HELD_LABEL_PX,
  widthU: HELD_RIGHT_XU - HELD_LEFT_XU,
  heightU: CS.heldChipYU + CS.heldChipHeightU - (CS.heldLabelYU - HELD_LABEL_PX),
};

export function containsU(rect: RectU, xU: number, yU: number): boolean {
  return xU >= rect.xU && xU <= rect.xU + rect.widthU && yU >= rect.yU && yU <= rect.yU + rect.heightU;
}

/** 이식: 목업 `11_card_select/scene.js:36-44` rrect */
export function roundedPath(ctx: CanvasRenderingContext2D, rect: RectU, radiusU: number): void {
  const { xU, yU, widthU, heightU } = rect;
  ctx.beginPath();
  ctx.moveTo(xU + radiusU, yU);
  ctx.arcTo(xU + widthU, yU, xU + widthU, yU + heightU, radiusU);
  ctx.arcTo(xU + widthU, yU + heightU, xU, yU + heightU, radiusU);
  ctx.arcTo(xU, yU + heightU, xU, yU, radiusU);
  ctx.arcTo(xU, yU, xU + widthU, yU, radiusU);
  ctx.closePath();
}

export function setFont(
  ctx: CanvasRenderingContext2D,
  weight: number,
  sizePx: number,
  family: string,
): void {
  ctx.font = `${weight} ${sizePx}px ${family}`;
}

export function ruleLine(
  ctx: CanvasRenderingContext2D,
  fromXU: number,
  toXU: number,
  yU: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = THIN_LINE_U;
  ctx.beginPath();
  ctx.moveTo(fromXU, yU);
  ctx.lineTo(toXU, yU);
  ctx.stroke();
}

/**
 * 폰트가 실행 환경에서 해석되므로(12 §3.1 — 웹폰트를 번들하지 않는다) 줄바꿈 자리는 실제 폭을
 * 재서 정한다. 문구는 카드가 바뀔 때만 바뀌므로 결과를 붙들어 둔다 — 재는 일이 매 프레임 돌면
 * 정지 화면 하나에 measureText가 수십 번씩 들어간다.
 */
const wrapCache = new Map<string, readonly string[]>();

/**
 * 열쇠에 글꼴과 폭이 들어가야 한다. 같은 문장을 카드 열(268u·27px)과 보유 카드 상세
 * 오버레이(420u·26px)가 둘 다 감싸므로, 문장만으로 접으면 먼저 계산한 쪽의 줄나눔이 다른
 * 쪽에 그대로 나가 좁은 열에서 152u까지 넘친다.
 */
function wrapKey(ctx: CanvasRenderingContext2D, text: string, maxWidthU: number): string {
  return `${ctx.font}|${maxWidthU}|${text}`;
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthU: number,
): readonly string[] {
  const key = wrapKey(ctx, text, maxWidthU);
  const cached = wrapCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && ctx.measureText(candidate).width > maxWidthU) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    lines.push(current);
  }
  wrapCache.set(key, lines);
  return lines;
}
