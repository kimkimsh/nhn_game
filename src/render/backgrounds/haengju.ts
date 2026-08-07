/**
 * S4 행주산성 야전 — 이식: docs/sample_image/_shared/engine.js BG.haengju (1521-1597)
 *
 * 구름 뒤의 달, 목책, 그리고 횃불 줄. **이 화면에서 따뜻한 빛은 전부 불에서만 나온다** —
 * 그것이 이 배경의 아트 디렉션이자, S4가 처음 들여오는 화염 장판(P9)을 배경에서 떼어
 * 놓는 장치다. 장판은 탁적(`PALETTE.takjeok`)에 각진 7각형과 해칭이 붙고(§17 · 12 §8-6),
 * 횃불은 원형 글로우와 타원 불꽃이라 형태가 겹치지 않는다.
 *
 * **정적/동적이 두 함수로 갈린다**(06 §3.2). 한산도와 달리 여기는 동적이 전부 뒤에 몰려
 * 있어 정적 오프스크린이 한 장이면 된다.
 *
 * ```
 * drawHaengjuStatic   (구운 것 1장, 불투명)  1522-1584 + 횃대 기둥 1593-1594
 * drawHaengjuDynamic  (매 프레임)            1586-1592 + 1596
 * ```
 *
 * **횃대 기둥만 목업의 순서에서 빠져나온다.** 목업은 `forEach` 하나 안에서 불꽃을 그리고
 * 그 위에 기둥을 덧그리는데(1593-1594), 기둥은 위치가 고정이라 06 §3.2가 정적 층으로
 * 보내라고 지정했다. 그래서 기둥이 불꽃 위가 아니라 아래로 간다. 겹치는 구간은 기둥 상단
 * 1u뿐이다 — 불꽃 타원이 y 457~483이고 기둥이 y 482에서 시작한다.
 *
 * `tSec`은 **스테이지 진입 기준 경과 시간**이다. 런 누적 시간을 넘기면 `embers`의 감기 식이
 * 288초에서 음수로 돌아 불티가 화면 위로 사라진다(backgrounds/primitives.ts embers 주석).
 */

import { GLOW_BAKE_COLORS, PALETTE } from '../../config/palette';
import { PLAYFIELD } from '../../config/playfield';
import { deriveStream } from '../../core/rng';
import { glow, hexA, poly } from '../primitives';
import type { GradientStop } from './primitives';
import { cloud, embers, lattice, ridge, vgrad } from './primitives';

/** §3.1 논리 해상도 (u) */
const PLAYFIELD_WIDTH_U = PLAYFIELD.widthU;

/** 호를 한 바퀴 도는 각. 목업이 2π 대신 쓴 값이라 그대로 옮긴다 (engine.js:1535 등) */
const FULL_TURN_RAD = 6.284;

/**
 * S4 전용 구조물 색 — backgrounds/primitives.ts의 `STONE_FACE_TOP` 무리와 같은 처지다.
 *
 * `config/palette.ts`는 "색 하나에 규칙 하나"를 계약으로 걸었고(03 §7) 아래는 규칙을 하나도
 * 나르지 않는 순수 구조물 색이라 그 계약에 들어갈 자리가 없다. `config/`에 `BACKGROUND_COLORS`
 * 같은 자리가 생기면 그리로 옮긴다. export하지 않는 것이 그 준비다.
 */
const NIGHT_SKY_TOP = '#0d0c16'; // engine.js:1522 밤하늘. 위가 푸르고 아래가 붉다
const NIGHT_SKY_MID = '#08070f';
const NIGHT_SKY_BOTTOM = '#0c0709';
const MOON_DISC = '#c3d2e8'; // 달 원반과 무리. 달빛 글로우보다 한 단 희다
const RIDGE_NEAR_INK = '#090a11'; // 앞 능선
const RIDGE_FAR_INK = '#06070d'; // 뒤 능선. 사면 페이드도 이 먹색을 쓴다 (engine.js:1565-1566)
const FORTRESS_WALL_INK = '#0b0d13'; // 산성 벽면
const FORTRESS_CRENEL_INK = '#0f121a'; // 여장(女墻). 벽면보다 밝아야 톱니가 선다
const FORTRESS_FOOT_SHADOW = '#030408'; // 벽 밑동 그림자띠
const PALISADE_INK = '#0c0908'; // 목책 말뚝
const PALISADE_RAIL_INK = '#150f0d'; // 가로대
const SLOPE_SMOKE = '#120e11'; // 사면 연기
const TORCH_FLAME = '#f7b13a'; // 횃불 불꽃 타원
const TORCH_POLE = '#1a1210'; // 횃대 기둥
const EMBER_ASH = '#8a4a1c'; // 불티

/** engine.js:1533·1539-1540·1588 — 색값의 소유자는 palette.ts의 `GLOW_BAKE_COLORS`다 */
const MOONLIGHT_GLOW_INDEX = 10;
const TORCH_GLOW_INDEX = 11;
const MOONLIGHT_GLOW = GLOW_BAKE_COLORS[MOONLIGHT_GLOW_INDEX];
const TORCH_GLOW = GLOW_BAKE_COLORS[TORCH_GLOW_INDEX];

/** engine.js:1522. `vgrad`가 정적 굽기 안에서만 도므로 gradient는 1회 생성이다 */
const NIGHT_SKY_STOPS: readonly GradientStop[] = [
  [0, NIGHT_SKY_TOP],
  [0.45, NIGHT_SKY_MID],
  [1, NIGHT_SKY_BOTTOM],
];

/** engine.js:1524-1531 별 60개. 목업의 `rng(5)` 자리가 주입 스트림이 됐다 (D-05) */
const STAR_COUNT = 60;
const STAR_FIELD_HEIGHT_U = 420; // 별은 위쪽 420u에만 뜬다. 그 아래는 능선과 성벽이다
const STAR_SIZE_U = 1.6;
const STAR_FILL_ALPHA = 0.35;
const STAR_TWINKLE_FLOOR = 0.1;
const STAR_TWINKLE_SPAN = 0.3;
const STAR_STREAM_LABEL = 'bg/s4/stars';

/** engine.js:1533-1538 달. 글로우 · 원반 · 무리 세 겹이다 */
const MOON = {
  xU: 810,
  yU: 210,
  glowRadiusU: 300,
  glowAlpha: 0.14,
  discRadiusU: 96,
  discAlpha: 0.13,
  haloRadiusU: 150,
  haloAlpha: 0.07,
  haloWidthU: 2,
} as const;

/** engine.js:1539-1540 구름무늬 둘. 달빛을 받으므로 달 글로우와 같은 색이다 */
const CLOUDS: readonly (readonly [number, number, number, number])[] = [
  [760, 246, 96, 0.18],
  [300, 170, 74, 0.1],
];

/** engine.js:1542-1543 능선 둘 */
const RIDGE_NEAR = { baseYU: 470, ampU: 190, k: 0.6 } as const;
const RIDGE_FAR = { baseYU: 380, ampU: 130, k: 2.9 } as const;

/** engine.js:1545-1550 산성 벽과 여장 */
const WALL = { y0U: 452, heightU: 62 } as const;
const CRENEL_COUNT = 14;
const CRENEL_FIRST_X_U = 8;
const CRENEL_PITCH_U = 78;
const CRENEL_Y_U = 434;
const CRENEL_WIDTH_U = 54;
const CRENEL_HEIGHT_U = 22;
const WALL_FOOT = { y0U: 514, heightU: 40, alpha: 0.6 } as const;

/** engine.js:1551 창호 문살 */
const LATTICE = { alpha: 0.022, stepU: 180 } as const;

/**
 * engine.js:1555-1562 목책 24본 — 행주에서 관군과 백성이 지킨 방책이다(스펙 §21).
 *
 * 말뚝 하나가 오각형이다: 밑변 y 604, 어깨 y 514, 뾰족한 끝 y 492.
 */
const PALISADE_COUNT = 24;
const PALISADE_FIRST_X_U = 8;
const PALISADE_PITCH_U = 47;
const PALISADE_WIDTH_U = 26;
const PALISADE_FOOT_Y_U = 604;
const PALISADE_SHOULDER_Y_U = 514;
const PALISADE_TIP_Y_U = 492;
const PALISADE_TIP_X_U = 13; // 말뚝 폭의 절반. 끝이 가운데로 모인다
const PALISADE_RAIL_Y_U = 558;
const PALISADE_RAIL_WIDTH_U = 6;

/** engine.js:1564-1568 목책 아래로 사면이 먹으로 떨어진다 */
const SLOPE_FADE = { y0U: 590, y1U: 760, heightU: 170, edgeAlpha: 0.9 } as const;

/** engine.js:1572-1583 사면 연기 세 줄기. 아래에서 횃불이 받쳐 준다는 전제의 실루엣이다 */
const SMOKE_COLUMN_X_U: readonly number[] = [200, 560, 900];
const SMOKE_ALPHA = 0.6;
const SMOKE_BASE_Y_U = 600;
const SMOKE_FOOT_LEFT_U = 60;
const SMOKE_FOOT_RIGHT_U = 70;
const SMOKE_SEGMENTS = 5;
const SMOKE_CONTROL_SWAY_U = 70;
const SMOKE_CONTROL_PHASE = 1.6;
const SMOKE_CONTROL_RISE_U = 60;
const SMOKE_ANCHOR_SWAY_U = 40;
const SMOKE_ANCHOR_PHASE = 2.1;
const SMOKE_ANCHOR_TOP_U = 570;
const SMOKE_ANCHOR_RISE_U = 66;

/** engine.js:1586-1594 횃불 다섯. 홀수 번째가 40u 아래로 내려가 줄이 평평해지지 않는다 */
const TORCH_X_U: readonly number[] = [110, 330, 600, 850, 1010];
const TORCH_Y_U = 470;
const TORCH_ROW_DROP_U = 40;
const TORCH_FLICKER_BASE = 0.62;
const TORCH_FLICKER_RATE = 7;
const TORCH_FLICKER_PHASE_STEP = 2;
const TORCH_FLICKER_SPAN = 0.2;
const TORCH_GLOW_RADIUS_U = 130;
const TORCH_GLOW_ALPHA = 0.32;
const TORCH_FLAME_RX_U = 7;
const TORCH_FLAME_RY_U = 13;
const TORCH_POLE_TOP_U = 482;
const TORCH_POLE_BOTTOM_Y_U = 560;
const TORCH_POLE_WIDTH_U = 5;

/** engine.js:1596 불티 */
const EMBER_COUNT = 40;
const EMBER_ALPHA = 0.34;
const EMBER_RISES = true;

/** D-05 — 목업의 `embers(…, 12, …)` 시드 자리다. 라벨은 배경 파일이 정한다 */
const EMBER_STREAM_LABEL = 'bg/s4/embers';

/**
 * 정적 — 하늘부터 횃대 기둥까지 전부. 스테이지 진입 시 오프스크린에 1회 굽는다(06 §3.2).
 *
 * 매 프레임 부르면 `vgrad`와 사면 페이드의 gradient 객체 생성 2회가 프레임에 들어온다.
 * Firefox에서 gradient fill은 `fillRect` 대비 100배다(06 §3.3).
 *
 * `renderSeed`는 런 시드다. 별자리를 라벨에 묶어 파생시키므로 같은 런에서는 언제나 같은
 * 하늘이 나오고, 런이 바뀌면 하늘도 바뀐다(D-05).
 */
export function drawHaengjuStatic(ctx: CanvasRenderingContext2D, renderSeed: number): void {
  vgrad(ctx, NIGHT_SKY_STOPS);
  drawStars(ctx, renderSeed);
  drawMoon(ctx);

  for (const cloudSpec of CLOUDS) {
    cloud(ctx, cloudSpec[0], cloudSpec[1], cloudSpec[2], MOONLIGHT_GLOW, cloudSpec[3]);
  }
  ridge(ctx, RIDGE_NEAR.baseYU, RIDGE_NEAR.ampU, RIDGE_NEAR.k, RIDGE_NEAR_INK);
  ridge(ctx, RIDGE_FAR.baseYU, RIDGE_FAR.ampU, RIDGE_FAR.k, RIDGE_FAR_INK);

  ctx.fillStyle = FORTRESS_WALL_INK;
  ctx.fillRect(0, WALL.y0U, PLAYFIELD_WIDTH_U, WALL.heightU);
  ctx.fillStyle = FORTRESS_CRENEL_INK;
  for (let crenel = 0; crenel < CRENEL_COUNT; crenel += 1) {
    ctx.fillRect(
      crenel * CRENEL_PITCH_U + CRENEL_FIRST_X_U, CRENEL_Y_U,
      CRENEL_WIDTH_U, CRENEL_HEIGHT_U,
    );
  }
  ctx.fillStyle = hexA(FORTRESS_FOOT_SHADOW, WALL_FOOT.alpha);
  ctx.fillRect(0, WALL_FOOT.y0U, PLAYFIELD_WIDTH_U, WALL_FOOT.heightU);
  lattice(ctx, LATTICE.alpha, LATTICE.stepU);

  drawPalisade(ctx);
  drawSlopeFade(ctx);
  drawSlopeSmoke(ctx);
  drawTorchPoles(ctx);
}

/** engine.js:1524-1531 — 소비 순서가 x · y · 밝기라 목업과 같은 수열에서 같은 하늘이 나온다 */
function drawStars(ctx: CanvasRenderingContext2D, renderSeed: number): void {
  const stream = deriveStream(renderSeed, STAR_STREAM_LABEL);
  ctx.save();
  ctx.fillStyle = hexA(PALETTE.baek, STAR_FILL_ALPHA);
  for (let star = 0; star < STAR_COUNT; star += 1) {
    const xU = stream.float() * PLAYFIELD_WIDTH_U;
    const yU = stream.float() * STAR_FIELD_HEIGHT_U;
    ctx.globalAlpha = STAR_TWINKLE_FLOOR + stream.float() * STAR_TWINKLE_SPAN;
    ctx.fillRect(xU, yU, STAR_SIZE_U, STAR_SIZE_U);
  }
  ctx.restore();
}

/** engine.js:1533-1538 — 글로우, 원반, 그리고 습기를 알리는 무리 한 겹 */
function drawMoon(ctx: CanvasRenderingContext2D): void {
  glow(ctx, MOON.xU, MOON.yU, MOON.glowRadiusU, MOONLIGHT_GLOW, MOON.glowAlpha);
  ctx.fillStyle = hexA(MOON_DISC, MOON.discAlpha);
  ctx.beginPath();
  ctx.arc(MOON.xU, MOON.yU, MOON.discRadiusU, 0, FULL_TURN_RAD);
  ctx.fill();
  ctx.strokeStyle = hexA(MOON_DISC, MOON.haloAlpha);
  ctx.lineWidth = MOON.haloWidthU;
  ctx.beginPath();
  ctx.arc(MOON.xU, MOON.yU, MOON.haloRadiusU, 0, FULL_TURN_RAD);
  ctx.stroke();
}

/** engine.js:1554-1562 */
function drawPalisade(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = PALISADE_INK;
  for (let post = 0; post < PALISADE_COUNT; post += 1) {
    const xU = post * PALISADE_PITCH_U + PALISADE_FIRST_X_U;
    poly(ctx, [
      [xU, PALISADE_FOOT_Y_U],
      [xU + PALISADE_WIDTH_U, PALISADE_FOOT_Y_U],
      [xU + PALISADE_WIDTH_U, PALISADE_SHOULDER_Y_U],
      [xU + PALISADE_TIP_X_U, PALISADE_TIP_Y_U],
      [xU, PALISADE_SHOULDER_Y_U],
    ]);
    ctx.fill();
  }
  ctx.strokeStyle = PALISADE_RAIL_INK;
  ctx.lineWidth = PALISADE_RAIL_WIDTH_U;
  ctx.beginPath();
  ctx.moveTo(0, PALISADE_RAIL_Y_U);
  ctx.lineTo(PLAYFIELD_WIDTH_U, PALISADE_RAIL_Y_U);
  ctx.stroke();
}

/**
 * engine.js:1564-1568 — 목책 아래를 먹으로 지운다. 사면 너머를 그리지 않기 위한 장치다.
 *
 * `vgrad`를 못 쓴다. 화면 전체가 아니라 y 590~760 구간만 덮는 그라디언트라 시작·끝 좌표가
 * 다르다. 정적 굽기 안에서만 도는 것은 `vgrad`와 같고, 그래서 gradient 생성이 스테이지당 1회다.
 */
function drawSlopeFade(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, SLOPE_FADE.y0U, 0, SLOPE_FADE.y1U);
  gradient.addColorStop(0, hexA(RIDGE_FAR_INK, 0));
  gradient.addColorStop(1, hexA(RIDGE_FAR_INK, SLOPE_FADE.edgeAlpha));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, SLOPE_FADE.y0U, PLAYFIELD_WIDTH_U, SLOPE_FADE.heightU);
}

/** engine.js:1571-1584 — 기둥 하나가 이차곡선 5마디로 흔들리며 올라간다 */
function drawSlopeSmoke(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  for (let column = 0; column < SMOKE_COLUMN_X_U.length; column += 1) {
    const xU = SMOKE_COLUMN_X_U[column];
    if (xU === undefined) {
      continue;
    }
    ctx.fillStyle = hexA(SLOPE_SMOKE, SMOKE_ALPHA);
    ctx.beginPath();
    ctx.moveTo(xU - SMOKE_FOOT_LEFT_U, SMOKE_BASE_Y_U);
    for (let segment = 0; segment < SMOKE_SEGMENTS; segment += 1) {
      ctx.quadraticCurveTo(
        xU + Math.sin(segment * SMOKE_CONTROL_PHASE + column) * SMOKE_CONTROL_SWAY_U,
        SMOKE_BASE_Y_U - segment * SMOKE_CONTROL_RISE_U,
        xU + Math.sin(segment * SMOKE_ANCHOR_PHASE + column) * SMOKE_ANCHOR_SWAY_U,
        SMOKE_ANCHOR_TOP_U - segment * SMOKE_ANCHOR_RISE_U,
      );
    }
    ctx.lineTo(xU + SMOKE_FOOT_RIGHT_U, SMOKE_BASE_Y_U);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * engine.js:1593-1594 — 목업 `forEach` 안에서 불꽃 뒤에 그려지던 두 줄을 정적 층으로 뺐다.
 *
 * 06 §3.2가 지시한 유일한 순서 변경이다. 기둥이 불꽃 위가 아니라 아래로 가지만, 겹치는
 * 구간이 기둥 상단 1u뿐이라 그림이 달라지지 않는다.
 */
function drawTorchPoles(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = TORCH_POLE;
  ctx.lineWidth = TORCH_POLE_WIDTH_U;
  for (let torch = 0; torch < TORCH_X_U.length; torch += 1) {
    const xU = TORCH_X_U[torch];
    if (xU === undefined) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(xU, TORCH_POLE_TOP_U + (torch % 2) * TORCH_ROW_DROP_U);
    ctx.lineTo(xU, TORCH_POLE_BOTTOM_Y_U);
    ctx.stroke();
  }
}

/**
 * 동적 — 횃불 명멸과 불티. 정적 층 위에 매 프레임 그린다.
 *
 * 명멸은 횃불마다 위상이 `i × 2` 어긋나 다섯이 함께 밝아지지 않는다. 같이 뛰면 화면 전체
 * 밝기가 초당 1.1회 오르내리고, 그건 횃불이 아니라 스트로브다.
 *
 * `renderSeed`는 런 시드다. 여기서 라벨에 묶어 스트림을 파생시키고, `embers`가 매 프레임
 * 그 스트림을 처음부터 다시 돌려 불티 40개의 기준 위치를 고정한다(D-05).
 */
export function drawHaengjuDynamic(
  ctx: CanvasRenderingContext2D,
  tSec: number,
  renderSeed: number,
): void {
  for (let torch = 0; torch < TORCH_X_U.length; torch += 1) {
    const xU = TORCH_X_U[torch];
    if (xU === undefined) {
      continue;
    }
    const yU = TORCH_Y_U + (torch % 2) * TORCH_ROW_DROP_U;
    const flicker = TORCH_FLICKER_BASE
      + Math.sin(tSec * TORCH_FLICKER_RATE + torch * TORCH_FLICKER_PHASE_STEP) * TORCH_FLICKER_SPAN;
    glow(ctx, xU, yU, TORCH_GLOW_RADIUS_U, TORCH_GLOW, TORCH_GLOW_ALPHA * flicker);
    ctx.fillStyle = hexA(TORCH_FLAME, flicker);
    ctx.beginPath();
    ctx.ellipse(xU, yU, TORCH_FLAME_RX_U, TORCH_FLAME_RY_U, 0, 0, FULL_TURN_RAD);
    ctx.fill();
  }

  embers(
    ctx, tSec, EMBER_COUNT, EMBER_ASH, EMBER_ALPHA,
    () => deriveStream(renderSeed, EMBER_STREAM_LABEL),
    EMBER_RISES,
  );
}
