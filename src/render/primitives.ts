/**
 * 캔버스 프리미티브 — 목업 engine.js 이식 (06_렌더링과_게임필.md §1.3)
 *
 * 여기 있는 다섯 함수는 render/ 전체가 공유하는 최하층이다. 이 파일은 config/ 말고는
 * 아무것도 import하지 않는다.
 *
 * **글로우 스프라이트 보관소가 여기 있는 이유.** 03_파일_구조.md는 스프라이트 조회를
 * sprites.ts에 배정했는데, glow()가 그 보관소의 유일한 소비자다. sprites.ts에 두면
 * primitives → sprites → primitives(hexA) 순환 import가 생긴다. 탄환 스프라이트는
 * sprites.ts가 그대로 갖고, 글로우만 이 파일이 갖는다.
 */

import { GLOW_BAKE_COLORS, PALETTE } from '../config/palette';
import { FONTS } from '../config/ui';

/** #rrggbb 여섯 자리만 받는다. 앞의 '#' 한 글자를 건너뛴 나머지가 16진수여야 한다 */
const HEX_BODY_START = 1;
const HEX_RADIX = 16;
const BYTE_MASK = 255;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;

/** 목업의 해칭 타일 — engine.js hatch (128-143) */
const HATCH_TILE_PX = 14;
const HATCH_LINE_WIDTH_PX = 2.4;
const HATCH_STROKE_ALPHA = 0.5;
const HATCH_STROKE_A = { fromX: -4, fromY: 18, toX: 18, toY: -4 };
const HATCH_STROKE_B = { fromX: 3, fromY: 25, toX: 25, toY: 3 };

/**
 * 색 → 구운 글로우 스프라이트. 부팅 시 boot/sprite-bake.ts가 13색을 전부 넣고, 그 뒤로는
 * 읽기만 한다. 지연 생성은 금지다 — 전투 중 첫 등장 시점의 256×256 radial gradient fill
 * 한 번이 그 프레임을 튀게 하고, 그 프레임이 패리 프레임이면 판정 실패가 된다 (06 §3.1).
 */
const glowSprites = new Map<string, CanvasImageSource>();

/**
 * createPattern이 만든 ctx에 묶이므로 모듈 상태로 한 장만 들고 다닌다.
 * DPR 변경으로 메인 ctx의 backing store가 새로 만들어지면 invalidateHatchPattern()이 버린다.
 */
let hatchPattern: CanvasPattern | null = null;

/** 목록 밖 색이 요청됐을 때 프레임을 죽이지 않기 위한 빈 스프라이트. 아래 getGlowSprite 참조 */
let emptyGlowSprite: HTMLCanvasElement | null = null;
let unlistedGlowReported = false;

/** 이식: docs/sample_image/_shared/engine.js hexA (113-116) */
export function hexA(hex: string, alpha: number): string {
  const packed = parseInt(hex.slice(HEX_BODY_START), HEX_RADIX);
  const red = (packed >> RED_SHIFT) & BYTE_MASK;
  const green = (packed >> GREEN_SHIFT) & BYTE_MASK;
  const blue = packed & BYTE_MASK;
  return `rgba(${red},${green},${blue},${alpha})`;
}

/**
 * 부팅 굽기가 결과를 여기 넣는다. 같은 색을 두 번 넣으면 뒤엣것이 이긴다 —
 * 다시 굽기(DPR 변경)가 그렇게 동작해야 한다.
 */
export function registerGlowSprite(color: string, sprite: CanvasImageSource): void {
  glowSprites.set(color, sprite);
}

/**
 * 굽기가 GLOW_BAKE_COLORS를 다 채웠는지 확인한다. 부팅 마지막에 한 번 부른다 —
 * 빠진 색은 전투 중에야 드러나고, 그때는 이미 프레임이 튄 뒤다.
 */
export function assertGlowSpritesBaked(): void {
  const missing = GLOW_BAKE_COLORS.filter((color) => !glowSprites.has(color));
  if (missing.length > 0) {
    throw new Error(`글로우 스프라이트가 안 구워진 색이 있다: ${missing.join(', ')}`);
  }
}

/**
 * 구워 둔 글로우 색. **타입으로 막는 것이 1순위이고 아래의 throw는 2순위다** — 런타임에서야
 * 아는 것은 그 화면을 실제로 열어 본 사람이 있을 때뿐이고, 카드 선택 화면의 등급색 셋이
 * 정확히 그렇게 P7까지 살아남았다.
 */
export type GlowBakeColor = (typeof GLOW_BAKE_COLORS)[number];

/**
 * 목록 밖 색은 dev에서 던진다 — 그 요청 자체가 palette.ts의 GLOW_BAKE_COLORS와
 * 호출부가 어긋났다는 뜻이다. 제출 빌드에서는 던지지 않는다: 전투 중 예외 하나로 화면이
 * 멈추는 것보다 글로우 한 장이 빠지는 편이 낫다. 대신 콘솔에 한 번 남긴다.
 */
export function getGlowSprite(color: GlowBakeColor): CanvasImageSource {
  const sprite = glowSprites.get(color);
  if (sprite !== undefined) {
    return sprite;
  }
  if (import.meta.env.DEV) {
    throw new Error(`글로우 스프라이트 목록에 없는 색이다: ${color} (palette.ts GLOW_BAKE_COLORS)`);
  }
  if (!unlistedGlowReported) {
    unlistedGlowReported = true;
    console.error('글로우 목록 밖 색 요청', color);
  }
  if (emptyGlowSprite === null) {
    emptyGlowSprite = document.createElement('canvas');
    emptyGlowSprite.width = 1;
    emptyGlowSprite.height = 1;
  }
  return emptyGlowSprite;
}

/**
 * 이식: engine.js glow (119-126) — 그대로.
 *
 * 탄환 층은 이 함수를 쓰지 않는다. 발마다 save/restore와 합성 모드 왕복이 붙기 때문이고,
 * 그 층은 sprites.ts의 두 패스 헬퍼가 모드를 한 번만 바꿔서 그린다 (06 §3.1).
 */
export function glow(
  ctx: CanvasRenderingContext2D,
  xU: number,
  yU: number,
  radiusU: number,
  color: GlowBakeColor,
  alpha: number,
): void {
  const sprite = getGlowSprite(color);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, xU - radiusU, yU - radiusU, radiusU * 2, radiusU * 2);
  ctx.restore();
}

/**
 * 이식: engine.js hatchPat + hatch (128-143) — 패턴을 만드는 ctx를 오프스크린으로 바꿨다.
 *
 * 원본은 첫 호출자의 ctx로 패턴을 만들어 그 ctx에 묶였다. 메인 ctx가 DPR 변경으로 새로
 * 만들어지면 그 패턴은 다른 컨텍스트의 것이 된다.
 */
export function hatch(): CanvasPattern {
  if (hatchPattern !== null) {
    return hatchPattern;
  }
  const tile = document.createElement('canvas');
  tile.width = HATCH_TILE_PX;
  tile.height = HATCH_TILE_PX;
  const tileCtx = tile.getContext('2d');
  if (tileCtx === null) {
    throw new Error('해칭 타일의 2d 컨텍스트를 얻지 못했다');
  }
  tileCtx.strokeStyle = hexA(PALETTE.baek, HATCH_STROKE_ALPHA);
  tileCtx.lineWidth = HATCH_LINE_WIDTH_PX;
  tileCtx.beginPath();
  tileCtx.moveTo(HATCH_STROKE_A.fromX, HATCH_STROKE_A.fromY);
  tileCtx.lineTo(HATCH_STROKE_A.toX, HATCH_STROKE_A.toY);
  tileCtx.moveTo(HATCH_STROKE_B.fromX, HATCH_STROKE_B.fromY);
  tileCtx.lineTo(HATCH_STROKE_B.toX, HATCH_STROKE_B.toY);
  tileCtx.stroke();

  const pattern = tileCtx.createPattern(tile, 'repeat');
  if (pattern === null) {
    throw new Error('해칭 패턴을 만들지 못했다');
  }
  hatchPattern = pattern;
  return pattern;
}

/** backing store를 다시 만든 직후 부른다. 다음 hatch() 호출이 새 패턴을 만든다 */
export function invalidateHatchPattern(): void {
  hatchPattern = null;
}

/** 꼭짓점 하나. 목업이 `[x, y]` 배열을 쓰므로 그 형태를 유지한다 */
export type PolyPoint = readonly [number, number];

/** 이식: engine.js poly (145-150) */
export function poly(ctx: CanvasRenderingContext2D, points: readonly PolyPoint[]): void {
  const first = points[0];
  if (first === undefined) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point !== undefined) {
      ctx.lineTo(point[0], point[1]);
    }
  }
  ctx.closePath();
}

/**
 * label의 서체·굵기·정렬. 호출부는 이것을 모듈 상수로 하나 만들어 재사용한다 —
 * 매 호출 리터럴로 적으면 프레임마다 객체가 하나씩 생긴다.
 */
export interface LabelStyle {
  readonly color: string;
  readonly sizePx: number;
  /** CSS font-weight. 목업 label(152-160)은 600 고정이었다 */
  readonly weight: number;
  readonly align: CanvasTextAlign;
}

/**
 * 이식: engine.js label (152-160) — 폰트 문자열의 서체 부분만 config/ui.ts의 FONTS.data로 뺐다.
 *
 * 굵기가 인자인 것은 ui.ts에 굵기 칸이 없기 때문이다. §15의 화면 표에는 요소마다 weight가
 * 적혀 있으므로(예: 점수 600, 라벨 500) 600 고정으로는 그 표를 못 지킨다.
 */
export function label(
  ctx: CanvasRenderingContext2D,
  xU: number,
  yU: number,
  text: string,
  style: LabelStyle,
): void {
  ctx.save();
  ctx.fillStyle = style.color;
  ctx.font = `${style.weight} ${style.sizePx}px ${FONTS.data}`;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, xU, yU);
  ctx.restore();
}
