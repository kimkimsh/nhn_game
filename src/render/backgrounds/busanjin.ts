/**
 * S1 부산진 새벽 — 목업 engine.js `BG.busanjin`(1280-1359) 이식 (06 §1.9 · §3.2)
 *
 * 해가 아직 수평선 아래인데 함대는 이미 상륙해 있다. 위쪽에 따뜻한 띠 하나, 나머지는 전부 먹.
 *
 * **목업 함수 하나가 여기서 둘이 된다.** 06 §3.2의 S1 표가 `t` 의존 여부로 레이어를 갈랐고,
 * 그 표를 그대로 옮긴 것이 아래 두 함수다. 어느 줄이 어느 쪽으로 갔는지는 함수마다 블록
 * 주석에 원본 줄 번호로 적혀 있다.
 *
 * - `drawBusanjinStatic` — 스테이지 진입 시 1080×1920 오프스크린에 **한 번** 그린다
 * - `drawBusanjinDynamic` — 그 한 장을 `drawImage`한 뒤 매 프레임 위에 얹는다
 *
 * **굽기와 캐시는 여기 없다.** 오프스크린을 만들고 들고 버리는 것은 `backgrounds/index.ts`다
 * (03 §1 · 11 P4-11). 이 파일의 두 함수는 논리 단위(u)로 그리기만 하므로 캔버스 크기도
 * DPR도 모른다 — 캐시를 언제 다시 굽는지는 캐시를 가진 쪽이 정한다.
 *
 * **정적 함수를 매 프레임 부르면 안 된다.** 그 안에 `createLinearGradient` 두 번(하늘·하단
 * 페이드)이 들어 있고, 06 §3.3이 매 프레임 gradient 생성을 금지 목록에 올렸다(Firefox에서
 * `fillRect` 대비 100배).
 */

import { GLOW_BAKE_COLORS } from '../../config/palette';
import { PLAYFIELD } from '../../config/playfield';
import { createRng } from '../../core/rng';
import { glow, hexA } from '../primitives';
import { cloud, embers, lattice, ridge, vgrad, wakoShipHull, type GradientStop } from './primitives';

/**
 * 이 스테이지 전용 색 — `backgrounds/primitives.ts`가 같은 사정으로 같은 짓을 한다.
 *
 * `config/palette.ts`의 계약이 "색 하나에 규칙 하나, 규칙 없는 색은 추가하지 않는다"이고
 * (03 §7), 아래는 전부 게임 규칙을 하나도 나르지 않는 배경 구조물 색이라 그 계약에 들어갈
 * 자리가 없다. `config/`에 `BACKGROUND_COLORS` 같은 칸이 생기면 그리로 옮긴다 —
 * export하지 않는 것이 그 준비다.
 */
const SKY_TOP = '#43220f'; // 여명이 가장 뜨거운 상단
const SKY_UPPER = '#1d1210';
const SKY_MID = '#0b0a12';
const SKY_INK = '#050609'; // 하단 먹. 아래 페이드가 이 색으로 수렴한다
const SUN_DISC = '#f0873a'; // 수평선 아래 해의 원반
const RIDGE_FAR = '#120d13';
const RIDGE_NEAR = '#0d0a10';
const SMOKE = '#1a1620'; // 해변에서 오르는 연기 기둥
const PILING = '#0a0c13'; // 부두 말뚝
const EMBER = '#8a4a1c'; // 불티. 위로 오르는 재다

/**
 * 일출 글로우 색. **`GLOW_BAKE_COLORS`에 이 값이 없으면 컴파일이 실패해야 한다.**
 *
 * `glow()`는 색 문자열을 구운 스프라이트의 조회 키로 쓰고, 목록 밖 색은 dev에서 던지고
 * 제출 빌드에서는 빈 스프라이트를 낸다 — 즉 일출이 조용히 사라진다. 타입을 목록의 원소
 * 유니온으로 못 박아 두면 palette.ts에서 이 색이 빠지는 순간 `npm run typecheck`가 잡는다.
 */
const SUNRISE_GLOW: (typeof GLOW_BAKE_COLORS)[number] = '#e2762e';

/** 목업이 2π 대신 쓴 값(engine.js:1291). 그대로 옮긴다 */
const FULL_TURN_RAD = 6.284;

/** engine.js:1281-1285 하늘 그라디언트 */
const SKY_STOPS: readonly GradientStop[] = [
  [0, SKY_TOP],
  [0.11, SKY_UPPER],
  [0.26, SKY_MID],
  [1, SKY_INK],
];

/** engine.js:1289-1291 일출 후광과 그 아래 원반 */
const SUN_GLOW_XU = 540;
const SUN_GLOW_YU = 190;
const SUN_GLOW_RADIUS_U = 470;
const SUN_GLOW_ALPHA = 0.13;
const SUN_DISC_XU = 540;
const SUN_DISC_YU = 232;
const SUN_DISC_RADIUS_U = 220;
const SUN_DISC_ALPHA = 0.09;

/** engine.js:1293-1294 능선 2겹 */
const RIDGE_FAR_BASE_YU = 300;
const RIDGE_FAR_AMP_U = 130;
const RIDGE_FAR_K = 1.1;
const RIDGE_NEAR_BASE_YU = 250;
const RIDGE_NEAR_AMP_U = 90;
const RIDGE_NEAR_K = 3.4;

/** engine.js:1296-1298 구름무늬 4개. 짝수·홀수가 높이를 번갈아 쓴다 */
const CLOUD_COUNT = 4;
const CLOUD_X0_U = 180;
const CLOUD_X_STEP_U = 300;
const CLOUD_Y0_U = 130;
const CLOUD_Y_ALTERNATE_U = 70;
const CLOUD_SIZE_U = 60;
const CLOUD_ALPHA = 0.1;

/** engine.js:1300-1303 수면 연무띠. 화면 밖까지 벋어야 좌우 끝이 안 잘린다 */
const HAZE_BAND_COUNT = 4;
const HAZE_Y0_U = 300;
const HAZE_Y_STEP_U = 90;
const HAZE_HEIGHT_U = 52;
const HAZE_MARGIN_U = 200;
const HAZE_DRIFT_RATE = 0.2;
const HAZE_DRIFT_U = 70;
const HAZE_ALPHA_TOP = 0.026;
const HAZE_ALPHA_STEP = 0.006;

/** engine.js:1305 창호 격자 */
const LATTICE_ALPHA = 0.028;
const LATTICE_STEP_U = 180;

/** engine.js:1308-1313 왜선 6척. 뒤쪽 열이 더 멀고 더 어둡다 */
const WAKO_SHIPS = [
  { cxU: 300, yU: 214, widthU: 130 },
  { cxU: 700, yU: 206, widthU: 120 },
  { cxU: 150, yU: 268, widthU: 210 },
  { cxU: 470, yU: 232, widthU: 250 },
  { cxU: 820, yU: 276, widthU: 200 },
  { cxU: 1010, yU: 236, widthU: 170 },
] as const;

/** engine.js:1318-1323 선체 아래 물빛. 큰 배 4척 밑에만 깐다 */
const REFLECT_SHIP_XU = [150, 470, 820, 1010] as const;
const REFLECT_ALPHA = 0.05;
const REFLECT_ROWS = 5;
const REFLECT_WIDTH_U = 110;
const REFLECT_WIDTH_STEP_U = 14;
const REFLECT_DEPTH_FALLOFF = 0.06;
const REFLECT_SWAY_RATE = 0.9;
const REFLECT_SWAY_U = 7;
const REFLECT_Y0_U = 300;
const REFLECT_Y_STEP_U = 22;
const REFLECT_HEIGHT_U = 4;

/** engine.js:1329-1339 연기 기둥 3본. 이차 곡선 5마디를 이어 올린다 */
const SMOKE_COLUMN_XU = [230, 610, 900] as const;
const SMOKE_ALPHA = 0.5;
const SMOKE_FOOT_YU = 320;
const SMOKE_SEGMENTS = 5;
const SMOKE_CONTROL_PHASE = 1.7;
const SMOKE_CONTROL_SWAY_U = 40;
const SMOKE_CONTROL_RISE_U = 46;
const SMOKE_END_PHASE = 1.9;
const SMOKE_END_SWAY_U = 26;
const SMOKE_END_Y0_U = 300;
const SMOKE_END_RISE_U = 52;
const SMOKE_FOOT_WIDTH_U = 40;

/** engine.js:1345-1349 부두 말뚝 7본. 길이가 3본 주기로 달라진다 */
const PILING_COUNT = 7;
const PILING_X0_U = 70;
const PILING_STEP_U = 160;
const PILING_TOP_YU = 400;
const PILING_WIDTH_U = 16;
const PILING_HEIGHT_U = 90;
const PILING_HEIGHT_STEP_U = 40;
const PILING_HEIGHT_CYCLE = 3;
const PILING_LIT_WIDTH_U = 4;
const PILING_LIT_ALPHA = 0.05;

/** engine.js:1353-1357 하단 페이드 */
const FADE_TOP_YU = 330;
const FADE_BOTTOM_YU = 760;
const FADE_TOP_ALPHA = 0;
const FADE_BOTTOM_ALPHA = 0.92;

/** engine.js:1358 불티 30개. `true`가 위로 오르는 모드다 */
const EMBER_COUNT = 30;
const EMBER_ALPHA = 0.3;
const EMBER_RISES = true;

/**
 * engine.js:1358이 `embers`에 넘긴 시드. **목업이 적은 값 그대로다.**
 *
 * 배경은 승인된 아트 디렉션이고 런마다 달라지면 안 되므로 런 시드에서 파생하지 않는다
 * (06 §1.8 "결과는 시드가 같으므로 그림이 안 바뀐다"). D-05가 금지한 것은 전역 난수이지
 * 이름 붙은 고정 시드가 아니고, 09 §5의 시각 회귀가 픽셀 대조를 하려면 오히려 고정이어야 한다.
 */
const EMBER_SEED = 21;

/**
 * 이식: docs/sample_image/_shared/engine.js BG.busanjin의 정적 레이어 (1281-1357)
 *
 * 06 §3.2 S1 표의 「정적」 칸 전부다. 스테이지 진입 연출 중에 오프스크린 한 장에 굽는다.
 */
export function drawBusanjinStatic(ctx: CanvasRenderingContext2D): void {
  // 1281-1287 하늘. 목업은 gradient를 함수 안에 폈지만 vgrad와 한 글자도 다르지 않다
  vgrad(ctx, SKY_STOPS);

  // 1289-1291 수평선 아래 해 — 후광 한 장에 원반 하나
  glow(ctx, SUN_GLOW_XU, SUN_GLOW_YU, SUN_GLOW_RADIUS_U, SUNRISE_GLOW, SUN_GLOW_ALPHA);
  ctx.fillStyle = hexA(SUN_DISC, SUN_DISC_ALPHA);
  ctx.beginPath();
  ctx.arc(SUN_DISC_XU, SUN_DISC_YU, SUN_DISC_RADIUS_U, 0, FULL_TURN_RAD);
  ctx.fill();

  // 1293-1294 능선 2겹
  ridge(ctx, RIDGE_FAR_BASE_YU, RIDGE_FAR_AMP_U, RIDGE_FAR_K, RIDGE_FAR);
  ridge(ctx, RIDGE_NEAR_BASE_YU, RIDGE_NEAR_AMP_U, RIDGE_NEAR_K, RIDGE_NEAR);

  // 1296-1298 구름무늬 4개
  for (let i = 0; i < CLOUD_COUNT; i += 1) {
    cloud(
      ctx,
      CLOUD_X0_U + i * CLOUD_X_STEP_U,
      CLOUD_Y0_U + (i % 2) * CLOUD_Y_ALTERNATE_U,
      CLOUD_SIZE_U,
      SUNRISE_GLOW,
      CLOUD_ALPHA,
    );
  }

  // 1305 창호 격자
  lattice(ctx, LATTICE_ALPHA, LATTICE_STEP_U);

  // 1308-1313 왜선 6척
  for (const ship of WAKO_SHIPS) {
    wakoShipHull(ctx, ship.cxU, ship.yU, ship.widthU);
  }

  // 1328-1341 해변 연기 기둥 3본
  ctx.save();
  for (let k = 0; k < SMOKE_COLUMN_XU.length; k += 1) {
    const x = SMOKE_COLUMN_XU[k]!;
    ctx.fillStyle = hexA(SMOKE, SMOKE_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x, SMOKE_FOOT_YU);
    for (let s = 0; s < SMOKE_SEGMENTS; s += 1) {
      ctx.quadraticCurveTo(
        x + Math.sin(s * SMOKE_CONTROL_PHASE + k) * SMOKE_CONTROL_SWAY_U,
        SMOKE_FOOT_YU - s * SMOKE_CONTROL_RISE_U,
        x + Math.sin(s * SMOKE_END_PHASE + k) * SMOKE_END_SWAY_U,
        SMOKE_END_Y0_U - s * SMOKE_END_RISE_U,
      );
    }
    ctx.lineTo(x + SMOKE_FOOT_WIDTH_U, SMOKE_FOOT_YU);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 1344-1350 부두 말뚝 7본. 왼쪽 4u만 해를 받는다
  ctx.fillStyle = PILING;
  for (let p = 0; p < PILING_COUNT; p += 1) {
    const x = PILING_X0_U + p * PILING_STEP_U;
    const heightU = PILING_HEIGHT_U + (p % PILING_HEIGHT_CYCLE) * PILING_HEIGHT_STEP_U;
    ctx.fillRect(x, PILING_TOP_YU, PILING_WIDTH_U, heightU);
    ctx.fillStyle = hexA(SUNRISE_GLOW, PILING_LIT_ALPHA);
    ctx.fillRect(x, PILING_TOP_YU, PILING_LIT_WIDTH_U, heightU);
    ctx.fillStyle = PILING;
  }

  /*
   * 1351-1357 하단 페이드. 따뜻한 띠가 서서히 죽지 않으면 해안선이 화면 한가운데를 가로지르는
   * 수평 절단으로 읽힌다. 여기 gradient는 굽기 1회에만 도는 것이라 06 §3.3의 금지에 안 걸린다.
   */
  const fade = ctx.createLinearGradient(0, FADE_TOP_YU, 0, FADE_BOTTOM_YU);
  fade.addColorStop(0, hexA(SKY_INK, FADE_TOP_ALPHA));
  fade.addColorStop(1, hexA(SKY_INK, FADE_BOTTOM_ALPHA));
  ctx.fillStyle = fade;
  ctx.fillRect(0, FADE_TOP_YU, PLAYFIELD.widthU, FADE_BOTTOM_YU - FADE_TOP_YU);
}

/**
 * 이식: engine.js BG.busanjin의 동적 레이어 (1300-1304 · 1316-1325 · 1358)
 *
 * 구운 한 장을 `drawImage`한 **뒤에** 부른다. 셋의 상대 순서는 목업 그대로다.
 *
 * `tSec`은 **스테이지 진입 기준 경과 시간**이다. 런 전체 누적이면 안 된다 — `embers`의
 * 상승 모드 감기 식이 t > 288초에서 y를 음수로 내보내 불티가 화면 위로 사라진다
 * (`backgrounds/primitives.ts` embers 주석). 연출이므로 시각은 sim의 FIXED_DT가 아니라
 * realDt 누적이다.
 */
export function drawBusanjinDynamic(ctx: CanvasRenderingContext2D, tSec: number): void {
  // 1299-1304 연무는 수면 위에만 흐른다. 부두 아래는 먹으로 남아야 한다
  for (let f = 0; f < HAZE_BAND_COUNT; f += 1) {
    const y = HAZE_Y0_U + f * HAZE_Y_STEP_U;
    const driftU = Math.sin(tSec * HAZE_DRIFT_RATE + f) * HAZE_DRIFT_U;
    ctx.fillStyle = hexA(SUNRISE_GLOW, HAZE_ALPHA_TOP - f * HAZE_ALPHA_STEP);
    ctx.fillRect(-HAZE_MARGIN_U + driftU, y, PLAYFIELD.widthU + HAZE_MARGIN_U * 2, HAZE_HEIGHT_U);
  }

  // 1315-1325 낮은 해가 선체 밑 물을 때린다. 뒤쪽 배일수록 반사폭이 좁다
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < REFLECT_SHIP_XU.length; k += 1) {
    const x = REFLECT_SHIP_XU[k]!;
    ctx.fillStyle = hexA(SUNRISE_GLOW, REFLECT_ALPHA);
    for (let r = 0; r < REFLECT_ROWS; r += 1) {
      const widthU = (REFLECT_WIDTH_U - r * REFLECT_WIDTH_STEP_U) * (1 - k * REFLECT_DEPTH_FALLOFF);
      ctx.fillRect(
        x - widthU / 2 + Math.sin(tSec * REFLECT_SWAY_RATE + r) * REFLECT_SWAY_U,
        REFLECT_Y0_U + r * REFLECT_Y_STEP_U,
        widthU,
        REFLECT_HEIGHT_U,
      );
    }
  }
  ctx.restore();

  // 1358 불티
  embers(ctx, tSec, EMBER_COUNT, EMBER, EMBER_ALPHA, () => createRng(EMBER_SEED), EMBER_RISES);
}
