/**
 * S3 한산도 앞바다 — 이식: docs/sample_image/_shared/engine.js BG.hansando (1461-1517)
 *
 * 거북선 갑판 위에서 학익진에 갇힌 왜선 열을 마주 본다(스펙 §9.5 · §21 한산도 대첩).
 *
 * **목업 함수 하나가 네 함수로 갈렸고, 부르는 순서가 곧 그림이다.** 06 §3.2가 정적/동적을
 * 가르라고 했는데 이 배경은 동적 레이어가 정적 레이어 **사이에** 있다 — 목업은 파도(1476-1478)를
 * 먼저 긋고 그 위에 왜선(1481-1484)과 갑판(1489-1515)을 얹는다. 정적을 한 장으로 구워 파도
 * 위에 그리면 파도가 선체를 가로지르고, 그러면 배가 물 위가 아니라 물 속에 뜬다. 그래서
 * 정적 오프스크린이 **두 장**이다(먼 layer는 불투명 전면, 가까운 layer는 투명 배경 전면).
 *
 * ```
 * drawHansandoStaticWater   (구운 것 1장, 불투명)   1462-1474
 * drawHansandoDynamicWaves  (매 프레임)             1476-1478
 * drawHansandoStaticDeck    (구운 것 1장, 투명)     1481-1515
 * drawHansandoDynamicSpray  (매 프레임)             1516
 * ```
 *
 * 대가는 스테이지 오프스크린 8.3MB → 16.6MB와 프레임당 drawImage 1회 증가다. 06 §3.2가
 * 상주분을 현재 스테이지 하나로 제한했으므로 총량은 여전히 16.6MB이고, drawImage 1회는
 * 실측 여유(fill-rate 10.5배, 13 §4.1) 안이다. 갑판 층을 굽지 않고 매 프레임 그리면
 * 호출이 약 142개 늘어난다 — 그쪽이 훨씬 비싸다.
 *
 * `tSec`은 **스테이지 진입 기준 경과 시간**이다. 런 누적 시간을 넘기면 `embers`의 감기 식이
 * 288초에서 음수로 돌아 물보라가 화면 위로 사라진다(backgrounds/primitives.ts embers 주석).
 */

import { GLOW_BAKE_COLORS, PALETTE } from '../../config/palette';
import { PLAYFIELD } from '../../config/playfield';
import { deriveStream } from '../../core/rng';
import { glow, hexA, poly } from '../primitives';
import type { GradientStop, SeigaihaStrip } from './primitives';
import {
  bakeSeigaihaStrip,
  drawSeigaihaStrip,
  embers,
  foam,
  lattice,
  ridge,
  seigaiha,
  vgrad,
  wakoShipHull,
} from './primitives';

/** §3.1 논리 해상도 (u). 갑판이 화면 바닥에서 위로 재므로 높이가 계속 나온다 */
const PLAYFIELD_WIDTH_U = PLAYFIELD.widthU;
const PLAYFIELD_HEIGHT_U = PLAYFIELD.heightU;

/**
 * S3 전용 구조물 색 — backgrounds/primitives.ts의 `STONE_FACE_TOP` 무리와 같은 처지다.
 *
 * `config/palette.ts`는 "색 하나에 규칙 하나"를 계약으로 걸었고(03 §7) 아래는 규칙을 하나도
 * 나르지 않는 순수 구조물 색이라 그 계약에 들어갈 자리가 없다. `config/`에 `BACKGROUND_COLORS`
 * 같은 자리가 생기면 그리로 옮긴다. export하지 않는 것이 그 준비다.
 */
const SEA_SKY_HORIZON = '#0d3047'; // engine.js:1462 수평선. 이 배경에서 가장 밝은 자리다
const SEA_SKY_UPPER = '#0a2033';
const SEA_SKY_MID = '#061021';
const SEA_SKY_LOWER = '#040a14';
const SEA_SKY_DEEP = '#03070e';
const ISLAND_INK = '#081726'; // 원경 섬. 하늘보다 어둡고 능선보다 밝아 거리 순서가 읽힌다
const HEADLAND_INK = '#06121e'; // 근경 곶
const DECK_PLANK_INK = '#0a0e16'; // 거북선 갑판 판재
const DECK_SPIKE_INK = '#1a222e'; // 개판 쇠못. 판재보다 밝아야 못이 개별로 선다
const SEA_SPRAY = '#3d7f96'; // 물보라. S1·S2의 불티와 같은 함수인데 색만 바닷물이다

/** engine.js:1463 상단 수면광. 색값의 소유자는 palette.ts의 `GLOW_BAKE_COLORS`다 */
const SEA_LIGHT_GLOW_INDEX = 9;
const SEA_LIGHT_GLOW = GLOW_BAKE_COLORS[SEA_LIGHT_GLOW_INDEX];

/** engine.js:1462 하늘에서 심해까지. `vgrad`가 정적 굽기 안에서만 도므로 gradient는 1회 생성이다 */
const SEA_SKY_STOPS: readonly GradientStop[] = [
  [0, SEA_SKY_HORIZON],
  [0.16, SEA_SKY_UPPER],
  [0.44, SEA_SKY_MID],
  [0.78, SEA_SKY_LOWER],
  [1, SEA_SKY_DEEP],
];

/** engine.js:1463 수면광 */
const SEA_LIGHT = { xU: 540, yU: 100, radiusU: 520, alpha: 0.1 } as const;

/** engine.js:1467 원경 섬 넷. `[봉우리 x, 봉우리 높이]` */
const ISLANDS: readonly (readonly [number, number])[] = [
  [130, 60],
  [420, 44],
  [780, 70],
  [1010, 40],
];
const ISLAND_BASE_Y_U = 190; // engine.js:1469 섬이 물에 잠기는 선
const ISLAND_HALF_SPAN_U = 130; // 좌우 폭의 절반
const ISLAND_PEAK_SCALE = 2; // 제어점이 봉우리 높이의 2배까지 올라가야 호가 봉우리에 닿는다

/** engine.js:1474 근경 곶 */
const HEADLAND = { baseYU: 200, ampU: 60, k: 5.1 } as const;

/**
 * engine.js:1476-1477 청해파문 두 층. `phase`가 `tSec × phaseRate`다.
 *
 * 위층(y 300)이 멀고 아래층(y 980)이 가깝다 — 가까울수록 아치가 크고(step 210) 옅다(0.05).
 */
const SEIGAIHA_FAR = { y0U: 300, rows: 9, stepU: 150, alpha: 0.07, phaseRate: 0.5 } as const;
const SEIGAIHA_NEAR = { y0U: 980, rows: 7, stepU: 210, alpha: 0.05, phaseRate: -0.4 } as const;

/** engine.js:1478 포말 */
const FOAM = { y0U: 420, rows: 3, stepU: 300, alpha: 0.06 } as const;

/**
 * engine.js:1481-1483 학익진 — 한산도에서 조선 수군이 왜선 열을 감싼 반원이다(스펙 §21).
 *
 * `k`가 −1..1이고 y가 `k²`에 걸리므로 가운데가 앞으로 나오고 양 끝이 뒤로 물러난다.
 * 폭이 `|k|`에 반비례해 줄어드는 것이 원근이라, 이 세 식이 함께 있어야 반원으로 읽힌다.
 */
const CRANE_WING_SHIP_COUNT = 7;
const CRANE_WING_CENTER_INDEX = 3;
const CRANE_WING_HALF_SPAN = 3; // k = (s − 3) / 3 의 분모
const CRANE_WING_CENTER_X_U = 540;
const CRANE_WING_SPREAD_U = 440;
const CRANE_WING_APEX_Y_U = 168;
const CRANE_WING_DEPTH_U = 120;
const CRANE_WING_WIDTH_U = 170;
const CRANE_WING_WIDTH_FALLOFF_U = 30;

/** engine.js:1485 창호 문살 */
const LATTICE = { alpha: 0.026, stepU: 180 } as const;

/** engine.js:1489-1499 갑판. 전부 화면 바닥에서 위로 잰다 */
const DECK_TOP_FROM_BOTTOM_U = 150;
const DECK_PLANK_COUNT = 9;
const DECK_PLANK_PITCH_U = 122;
const DECK_LINE_WIDTH_U = 2;
const DECK_PLANK_LINE_ALPHA = 0.9;
const DECK_EDGE_ALPHA = 0.16;

/** engine.js:1501-1509 개판(蓋板) 쇠못 18개. 왜병이 뛰어내리지 못하게 갑판을 덮은 것이다 */
const SPIKE_COUNT = 18;
const SPIKE_FIRST_X_U = 20;
const SPIKE_PITCH_U = 60;
const SPIKE_APEX_OFFSET_U = 20;
const SPIKE_BASE_WIDTH_U = 40;
const SPIKE_APEX_FROM_BOTTOM_U = 190;
const SPIKE_CORE_HALF_U = 4;
const SPIKE_CORE_BASE_FROM_BOTTOM_U = 156;
const SPIKE_CORE_ALPHA = 0.22;

/** engine.js:1511-1515 포문 8문 */
const PORT_COUNT = 8;
const PORT_FIRST_X_U = 40;
const PORT_PITCH_U = 130;
const PORT_TOP_FROM_BOTTOM_U = 96;
const PORT_WIDTH_U = 96;
const PORT_HEIGHT_U = 14;
const PORT_EDGE_ALPHA = 0.2;

/** engine.js:1516 물보라 */
const SPRAY_COUNT = 18;
const SPRAY_ALPHA = 0.16;
const SPRAY_RISES = true;

/** D-05 — 목업의 `embers(…, 45, …)` 시드 자리다. 라벨은 배경 파일이 정한다 */
const SPRAY_STREAM_LABEL = 'bg/s3/spray';

/**
 * 정적 ①/② — 하늘·수면광·섬·곶. **불투명 전면이라 이 층이 화면 바닥을 만든다.**
 *
 * 스테이지 진입 시 오프스크린에 1회 굽는다(06 §3.2). 매 프레임 부르면 `vgrad`의
 * gradient 객체 생성이 프레임에 들어오고, 그것은 Firefox에서 `fillRect` 대비 100배다.
 */
export function drawHansandoStaticWater(ctx: CanvasRenderingContext2D): void {
  vgrad(ctx, SEA_SKY_STOPS);
  glow(ctx, SEA_LIGHT.xU, SEA_LIGHT.yU, SEA_LIGHT.radiusU, SEA_LIGHT_GLOW, SEA_LIGHT.alpha);

  ctx.fillStyle = ISLAND_INK;
  for (const island of ISLANDS) {
    const peakXU = island[0];
    const peakHeightU = island[1];
    ctx.beginPath();
    ctx.moveTo(peakXU - ISLAND_HALF_SPAN_U, ISLAND_BASE_Y_U);
    ctx.quadraticCurveTo(
      peakXU, ISLAND_BASE_Y_U - peakHeightU * ISLAND_PEAK_SCALE,
      peakXU + ISLAND_HALF_SPAN_U, ISLAND_BASE_Y_U,
    );
    ctx.closePath();
    ctx.fill();
  }
  ridge(ctx, HEADLAND.baseYU, HEADLAND.ampU, HEADLAND.k, HEADLAND_INK);
}

/**
 * 동적 ① — 청해파문 두 층과 포말. `drawHansandoStaticWater` 다음, `StaticDeck` 앞이다.
 *
 * 이 순서가 규칙이다. 파도가 갑판과 왜선 위로 올라가면 배가 물 속에 있는 그림이 된다.
 */
export function drawHansandoDynamicWaves(ctx: CanvasRenderingContext2D, tSec: number): void {
  drawSeigaihaLayer(ctx, SEIGAIHA_FAR, farStrip, tSec);
  drawSeigaihaLayer(ctx, SEIGAIHA_NEAR, nearStrip, tSec);
  foam(ctx, FOAM.y0U, FOAM.rows, FOAM.stepU, tSec, FOAM.alpha);
}

interface SeigaihaLayer {
  readonly y0U: number;
  readonly rows: number;
  readonly stepU: number;
  readonly alpha: number;
  readonly phaseRate: number;
}

/** 구운 스트립이 있으면 그것으로, 없으면 목업 그대로 stroke로 그린다 */
function drawSeigaihaLayer(
  ctx: CanvasRenderingContext2D,
  layer: SeigaihaLayer,
  strip: SeigaihaStrip | null,
  tSec: number,
): void {
  const phase = tSec * layer.phaseRate;
  if (strip !== null) {
    drawSeigaihaStrip(ctx, strip, layer.y0U, layer.rows, phase);
    return;
  }
  seigaiha(ctx, layer.y0U, layer.rows, layer.stepU, PALETTE.cheong, layer.alpha, phase);
}

/**
 * 정적 ②/② — 학익진 왜선·문살·갑판. **투명 배경 전면이고 동적 파도 위에 얹는다.**
 *
 * 문살(1485)이 왜선 뒤가 아니라 앞이라는 것이 이 층에서 유일하게 순서가 중요한 자리다.
 * 배경 왜선은 적처럼 생겼지만 반사탄이 닿지 않는다 — 조준 대상이 아니라는 신호를 문살
 * 한 겹이 만든다(10 §2.2 "적처럼 보이는 것이 실은 배경이면 조준 판단이 무효가 된다").
 * 실제 적은 이 층보다 위에 그려지고 HP 바가 붙는다.
 */
export function drawHansandoStaticDeck(ctx: CanvasRenderingContext2D): void {
  for (let s = 0; s < CRANE_WING_SHIP_COUNT; s += 1) {
    const k = (s - CRANE_WING_CENTER_INDEX) / CRANE_WING_HALF_SPAN;
    wakoShipHull(
      ctx,
      CRANE_WING_CENTER_X_U + k * CRANE_WING_SPREAD_U,
      CRANE_WING_APEX_Y_U + k * k * CRANE_WING_DEPTH_U,
      CRANE_WING_WIDTH_U - Math.abs(k) * CRANE_WING_WIDTH_FALLOFF_U,
    );
  }
  lattice(ctx, LATTICE.alpha, LATTICE.stepU);

  const deckTopYU = PLAYFIELD_HEIGHT_U - DECK_TOP_FROM_BOTTOM_U;
  ctx.fillStyle = DECK_PLANK_INK;
  ctx.fillRect(0, deckTopYU, PLAYFIELD_WIDTH_U, DECK_TOP_FROM_BOTTOM_U);
  ctx.strokeStyle = hexA(PALETTE.ink900, DECK_PLANK_LINE_ALPHA);
  ctx.lineWidth = DECK_LINE_WIDTH_U;
  for (let plank = 0; plank < DECK_PLANK_COUNT; plank += 1) {
    ctx.beginPath();
    ctx.moveTo(plank * DECK_PLANK_PITCH_U, deckTopYU);
    ctx.lineTo(plank * DECK_PLANK_PITCH_U, PLAYFIELD_HEIGHT_U);
    ctx.stroke();
  }
  ctx.strokeStyle = hexA(PALETTE.cheong, DECK_EDGE_ALPHA);
  ctx.beginPath();
  ctx.moveTo(0, deckTopYU);
  ctx.lineTo(PLAYFIELD_WIDTH_U, deckTopYU);
  ctx.stroke();

  const spikeApexYU = PLAYFIELD_HEIGHT_U - SPIKE_APEX_FROM_BOTTOM_U;
  const spikeCoreBaseYU = PLAYFIELD_HEIGHT_U - SPIKE_CORE_BASE_FROM_BOTTOM_U;
  ctx.fillStyle = DECK_SPIKE_INK;
  for (let spike = 0; spike < SPIKE_COUNT; spike += 1) {
    const baseXU = SPIKE_FIRST_X_U + spike * SPIKE_PITCH_U;
    poly(ctx, [
      [baseXU, deckTopYU],
      [baseXU + SPIKE_APEX_OFFSET_U, spikeApexYU],
      [baseXU + SPIKE_BASE_WIDTH_U, deckTopYU],
    ]);
    ctx.fill();
    ctx.fillStyle = hexA(PALETTE.cheong, SPIKE_CORE_ALPHA);
    poly(ctx, [
      [baseXU + SPIKE_APEX_OFFSET_U - SPIKE_CORE_HALF_U, spikeCoreBaseYU],
      [baseXU + SPIKE_APEX_OFFSET_U, spikeApexYU],
      [baseXU + SPIKE_APEX_OFFSET_U + SPIKE_CORE_HALF_U, spikeCoreBaseYU],
    ]);
    ctx.fill();
    ctx.fillStyle = DECK_SPIKE_INK;
  }

  const portTopYU = PLAYFIELD_HEIGHT_U - PORT_TOP_FROM_BOTTOM_U;
  ctx.fillStyle = PALETTE.ink900;
  for (let port = 0; port < PORT_COUNT; port += 1) {
    ctx.fillRect(PORT_FIRST_X_U + port * PORT_PITCH_U, portTopYU, PORT_WIDTH_U, PORT_HEIGHT_U);
  }
  ctx.strokeStyle = hexA(PALETTE.cheong, PORT_EDGE_ALPHA);
  ctx.lineWidth = DECK_LINE_WIDTH_U;
  for (let port = 0; port < PORT_COUNT; port += 1) {
    ctx.strokeRect(PORT_FIRST_X_U + port * PORT_PITCH_U, portTopYU, PORT_WIDTH_U, PORT_HEIGHT_U);
  }
}

/**
 * 동적 ② — 물보라. 갑판 위까지 올라오므로 정적 두 층 **다음**이다.
 *
 * `renderSeed`는 런 시드다. 여기서 라벨에 묶어 스트림을 파생시키고, `embers`가 매 프레임
 * 그 스트림을 처음부터 다시 돌려 물방울 18개의 기준 위치를 고정한다(D-05).
 */
export function drawHansandoDynamicSpray(
  ctx: CanvasRenderingContext2D,
  tSec: number,
  renderSeed: number,
): void {
  embers(
    ctx, tSec, SPRAY_COUNT, SEA_SPRAY, SPRAY_ALPHA,
    () => deriveStream(renderSeed, SPRAY_STREAM_LABEL),
    SPRAY_RISES,
  );
}

/**
 * 청해파문 스트립 굽기 — **꺼져 있는 것이 기본이다.** 06 §3.6 손잡이 2순위.
 *
 * 켜면 프레임당 arc stroke 약 190개가 drawImage 16개가 된다. P1 성능 게이트가 실패했을 때만
 * 켠다 — 대가는 성능이 아니라 목업과의 1:1 대조가 끊기는 것이다(03 §2.3).
 * 스테이지 진입 시 정적 굽기와 같은 자리에서 부른다.
 */
let farStrip: SeigaihaStrip | null = null;
let nearStrip: SeigaihaStrip | null = null;

export function enableHansandoSeigaihaStrips(): void {
  farStrip = bakeSeigaihaStrip(SEIGAIHA_FAR.stepU, PALETTE.cheong, SEIGAIHA_FAR.alpha);
  nearStrip = bakeSeigaihaStrip(SEIGAIHA_NEAR.stepU, PALETTE.cheong, SEIGAIHA_NEAR.alpha);
}

/** 스테이지를 떠날 때 부른다. 스트립 두 장이 다음 스테이지까지 살아 있을 이유가 없다 */
export function disableHansandoSeigaihaStrips(): void {
  farStrip = null;
  nearStrip = null;
}
