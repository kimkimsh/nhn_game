/**
 * S2 동래성 성곽 — 목업 engine.js `BG.dongnae`(1363-1457) 이식 (06 §1.9 · §3.2)
 *
 * 회색 석축, 여장, 그리고 처마 하나로 조선 건물임을 읽히게 하는 문루.
 *
 * **동적 레이어가 불티 하나뿐이라 5스테이지 중 굽기 이득이 가장 크다**(06 §3.2). 그리고
 * 그 불티가 목업에서도 맨 마지막 줄(1456)이라, **정적/동적을 갈라도 그리는 순서가 목업과
 * 한 자리도 어긋나지 않는다.** S1은 그렇지 않다(`busanjin.ts` 참조).
 *
 * - `drawDongnaeseongStatic` — 스테이지 진입 시 1080×1920 오프스크린에 **한 번** 그린다
 * - `drawDongnaeseongDynamic` — 그 한 장을 `drawImage`한 뒤 매 프레임 위에 얹는다
 *
 * **굽기와 캐시는 여기 없다.** 오프스크린을 만들고 들고 버리는 것은 `backgrounds/index.ts`다
 * (03 §1 · 11 P4-11). 이 파일은 논리 단위(u)로 그리기만 하므로 캔버스 크기도 DPR도 모른다.
 *
 * **정적 함수를 매 프레임 부르면 안 된다.** 06 §3.2가 센 정적 path op이 약 350개(석성 150 +
 * 여장 30 + 문루 30 + 화살 22 + 사다리 24 + 격자 38 + 나머지)이고, `vgrad`와 `stoneWall`이
 * 각각 gradient 객체를 하나씩 만든다 — 06 §3.3의 매 프레임 금지 항목이다.
 */

import { GLOW_BAKE_COLORS, PALETTE } from '../../config/palette';
import { PLAYFIELD } from '../../config/playfield';
import { lerp } from '../../core/math';
import { createRng } from '../../core/rng';
import { glow, hexA } from '../primitives';
import {
  dancheong,
  embers,
  lattice,
  ridge,
  roofTiles,
  stoneWall,
  tiledRoof,
  vgrad,
  type GradientStop,
} from './primitives';

/**
 * 이 스테이지 전용 색 — `backgrounds/primitives.ts`가 같은 사정으로 같은 짓을 한다.
 *
 * `config/palette.ts`의 계약이 "색 하나에 규칙 하나, 규칙 없는 색은 추가하지 않는다"이고
 * (03 §7), 아래는 전부 게임 규칙을 하나도 나르지 않는 배경 구조물 색이라 그 계약에 들어갈
 * 자리가 없다. `config/`에 `BACKGROUND_COLORS` 같은 칸이 생기면 그리로 옮긴다 —
 * export하지 않는 것이 그 준비다.
 */
const SKY_TOP = '#252a35';
const SKY_UPPER = '#161a26';
const SKY_MID = '#0a0c14';
const SKY_INK = '#05060b';
const RIDGE_INK = '#1a1f28';
const PARAPET_FACE = '#272e3c'; // 여장 몸통
const DEEP_SHADOW = '#05070c'; // 총안 구멍과 홍예문 안쪽. 뚫린 것으로 읽혀야 한다
const STONE_EDGE = '#3d4759'; // 여장 테두리와 철정
const WALL_TOP_INK = '#04060a'; // 성벽 상단 절단선
const TOWER_BODY = '#0d1119'; // 문루 몸통
const GATE_TRIM_GREEN = '#2e6b5e'; // 단청 청록. 문루 기둥·처마·홍예문 테두리가 같은 색을 쓴다
const ROOF_UPPER = '#1f2531';
const ROOF_LOWER = '#191e29';
const ROOF_TILE_INK = '#06080d'; // 기와 골. 지붕면보다 어두워야 결이 산다
const EAVE_SHADOW = '#030408'; // 위 처마가 아래 지붕에 떨구는 그림자. 하단 띠도 같은 색
const LADDER_WOOD = '#2a1d14'; // 공성 사다리
const ARROW_SHAFT = '#5a4634'; // 성벽에 박힌 화살대
const EMBER = '#8fa4c4'; // 재. S1의 불티와 달리 아래로 내린다

/**
 * 그을음 글로우 색. **`GLOW_BAKE_COLORS`에 이 값이 없으면 컴파일이 실패해야 한다.**
 *
 * `glow()`는 색 문자열을 구운 스프라이트의 조회 키로 쓰므로 목록 밖 색은 dev에서 던지고
 * 제출 빌드에서는 빈 스프라이트가 된다. 타입을 목록 원소의 유니온으로 못 박아 palette.ts에서
 * 이 색이 빠지는 순간 `npm run typecheck`가 잡게 한다.
 *
 * **검정은 `lighter` 합성에서 0을 더하므로 실제로 그려지는 것은 없다**(palette.ts 주석).
 * 그래도 옮기는 이유는 둘이다 — 목업과 호출 수가 어긋나면 대조가 끊기고, 이 7회가 소비하는
 * 난수 14개를 빼면 뒤에 난수를 쓰는 코드가 생겼을 때 그림이 통째로 밀린다.
 */
const SCORCH_GLOW: (typeof GLOW_BAKE_COLORS)[number] = '#000000';

/** 목업이 2π 대신 쓴 값(engine.js:1417). 그대로 옮긴다 */
const FULL_TURN_RAD = 6.284;

/** engine.js:1364 하늘 그라디언트 */
const SKY_STOPS: readonly GradientStop[] = [
  [0, SKY_TOP],
  [0.22, SKY_UPPER],
  [0.6, SKY_MID],
  [1, SKY_INK],
];

/** engine.js:1365 능선 */
const RIDGE_BASE_YU = 190;
const RIDGE_AMP_U = 110;
const RIDGE_K = 2.2;

/** engine.js:1367 석성. 6행 × 12블록 */
const WALL_TOP_YU = 150;
const WALL_BOTTOM_YU = 450;
const WALL_COURSE_U = 50;

/**
 * engine.js:1367·1440이 `rng`에 넘긴 시드. **목업이 적은 값 그대로이고, 두 곳이 같은 9다.**
 *
 * 목업은 `stoneWall` 안에서 한 번, 화살·그을음에서 한 번, 총 두 개의 **독립된** 스트림을
 * 같은 시드로 만든다. 아래도 그래야 한다 — 하나로 합치면 석축이 소비한 만큼 화살 위치가 밀린다.
 *
 * 런 시드에서 파생하지 않는 이유는 배경이 승인된 아트 디렉션이기 때문이다. 런마다 달라지면
 * 목업과의 대조도 09 §5의 픽셀 대조도 성립하지 않는다(06 §1.8 "시드가 같으므로 그림이 안 바뀐다").
 * D-05가 금지한 것은 전역 난수이지 이름 붙은 고정 시드가 아니다.
 */
const MASONRY_SEED = 9;

/** engine.js:1370-1379 여장과 총안 */
const PARAPET_COUNT = 10;
const PARAPET_PITCH_U = 110;
const PARAPET_X0_U = 12;
const PARAPET_TOP_YU = 450;
const PARAPET_WIDTH_U = 84;
const PARAPET_HEIGHT_U = 58;
const LOOPHOLE_DX_U = 44;
const LOOPHOLE_TOP_YU = 470;
const LOOPHOLE_WIDTH_U = 20;
const LOOPHOLE_HEIGHT_U = 28;
const PARAPET_EDGE_ALPHA = 0.6;
const PARAPET_EDGE_WIDTH_U = 2;
const WALL_TOP_LINE_ALPHA = 0.85;
const WALL_TOP_LINE_WIDTH_U = 3;

/** engine.js:1382-1390 문루 몸통과 기둥 5본 */
const TOWER_X0_U = 360;
const TOWER_TOP_YU = 132;
const TOWER_WIDTH_U = 360;
const TOWER_HEIGHT_U = 100;
const TOWER_POST_COUNT = 5;
const TOWER_POST_X0_U = 392;
const TOWER_POST_STEP_U = 74;
const TOWER_POST_TOP_YU = 140;
const TOWER_POST_BOTTOM_YU = 226;
const TOWER_POST_ALPHA = 0.4;
const TOWER_POST_WIDTH_U = 3;

/** engine.js:1391-1399 단청 2띠 · 지붕 2겹 · 처마 그림자 */
const DANCHEONG_UPPER = { x0U: 360, x1U: 720, yU: 216, heightU: 16 } as const;
const DANCHEONG_LOWER = { x0U: 330, x1U: 750, yU: 128, heightU: 12 } as const;
const ROOF_UPPER_SHAPE = { cxU: 540, yU: 138, widthU: 470, heightU: 116 } as const;
const ROOF_LOWER_SHAPE = { cxU: 540, yU: 246, widthU: 400, heightU: 78 } as const;
const ROOF_UPPER_TRIM_ALPHA = 0.55;
const ROOF_LOWER_TRIM_ALPHA = 0.45;
const ROOF_UPPER_TILE_ALPHA = 0.5;
const ROOF_LOWER_TILE_ALPHA = 0.45;
const EAVE_SHADOW_ALPHA = 0.35;
const EAVE_SHADOW_X0_U = 340;
const EAVE_SHADOW_TOP_YU = 232;
const EAVE_SHADOW_WIDTH_U = 400;
const EAVE_SHADOW_HEIGHT_U = 18;

/** engine.js:1402-1420 홍예문과 철정 12개 */
const ARCH_LEFT_XU = 470;
const ARCH_RIGHT_XU = 610;
const ARCH_FOOT_YU = 450;
const ARCH_SPRING_YU = 330;
const ARCH_CENTER_XU = 540;
const ARCH_RADIUS_U = 70;
const ARCH_TRIM_ALPHA = 0.3;
const ARCH_TRIM_WIDTH_U = 3;
const STUD_ROWS = 4;
const STUD_COLUMNS = 3;
const STUD_X0_U = 496;
const STUD_X_STEP_U = 44;
const STUD_Y0_U = 360;
const STUD_Y_STEP_U = 24;
const STUD_RADIUS_U = 3;
const STUD_ALPHA = 0.5;

/** engine.js:1425-1437 공성 사다리 3본. 두 기둥 사이를 6칸으로 나눠 가로대를 건다 */
const LADDER_XU = [170, 760, 960] as const;
const LADDER_FOOT_YU = 700;
const LADDER_HEAD_YU = 474;
const LADDER_LEFT_FOOT_DX_U = -50;
const LADDER_LEFT_HEAD_DX_U = 0;
const LADDER_RIGHT_FOOT_DX_U = 26;
const LADDER_RIGHT_HEAD_DX_U = 70;
const LADDER_RAIL_WIDTH_U = 9;
const LADDER_RUNG_COUNT = 6;
const LADDER_RUNG_WIDTH_U = 4;

/** engine.js:1441-1451 박힌 화살 22개와 그을음 7개 */
const ARROW_COUNT = 22;
const ARROW_ALPHA = 0.65;
const ARROW_WIDTH_U = 2;
const ARROW_Y0_U = 180;
const ARROW_Y_SPAN_U = 250;
const ARROW_ANGLE_BASE_RAD = -0.9;
const ARROW_ANGLE_SPAN_RAD = 0.6;
const ARROW_LENGTH_U = 26;
const SCORCH_COUNT = 7;
const SCORCH_Y0_U = 200;
const SCORCH_Y_SPAN_U = 220;
const SCORCH_RADIUS_U = 60;
const SCORCH_ALPHA = 0.25;

/** engine.js:1453-1455 하단 띠와 창호 격자 */
const BOTTOM_BAND_TOP_YU = 508;
const BOTTOM_BAND_HEIGHT_U = 60;
const BOTTOM_BAND_ALPHA = 0.45;
const LATTICE_ALPHA = 0.03;
const LATTICE_STEP_U = 180;

/** engine.js:1456 재 18개. `false`가 아래로 내리는 모드다 */
const EMBER_COUNT = 18;
const EMBER_ALPHA = 0.16;
const EMBER_RISES = false;

/** engine.js:1456이 `embers`에 넘긴 시드. 목업이 적은 값 그대로다 — 위 MASONRY_SEED 주석 참조 */
const EMBER_SEED = 33;

/**
 * 이식: docs/sample_image/_shared/engine.js BG.dongnae의 정적 레이어 (1364-1455)
 *
 * 06 §3.2 S2 표의 「정적」 칸 전부다. 스테이지 진입 연출 중에 오프스크린 한 장에 굽는다.
 */
export function drawDongnaeseongStatic(ctx: CanvasRenderingContext2D): void {
  // 1364-1365 하늘과 능선
  vgrad(ctx, SKY_STOPS);
  ridge(ctx, RIDGE_BASE_YU, RIDGE_AMP_U, RIDGE_K, RIDGE_INK);

  // 1367 석성. 스트림 팩토리는 이 함수 안에서만 산다 — stoneWall이 안에서 한 번 부른다
  stoneWall(ctx, WALL_TOP_YU, WALL_BOTTOM_YU, WALL_COURSE_U, () => createRng(MASONRY_SEED));

  // 1369-1379 여장 — 궁수가 쏘는 총안이 뚫린 성가퀴
  ctx.fillStyle = PARAPET_FACE;
  for (let m = 0; m < PARAPET_COUNT; m += 1) {
    ctx.fillRect(
      m * PARAPET_PITCH_U + PARAPET_X0_U, PARAPET_TOP_YU,
      PARAPET_WIDTH_U, PARAPET_HEIGHT_U,
    );
  }
  ctx.fillStyle = DEEP_SHADOW;
  for (let sq = 0; sq < PARAPET_COUNT; sq += 1) {
    ctx.fillRect(
      sq * PARAPET_PITCH_U + LOOPHOLE_DX_U, LOOPHOLE_TOP_YU,
      LOOPHOLE_WIDTH_U, LOOPHOLE_HEIGHT_U,
    );
  }
  ctx.strokeStyle = hexA(STONE_EDGE, PARAPET_EDGE_ALPHA);
  ctx.lineWidth = PARAPET_EDGE_WIDTH_U;
  for (let sq = 0; sq < PARAPET_COUNT; sq += 1) {
    ctx.strokeRect(
      sq * PARAPET_PITCH_U + PARAPET_X0_U, PARAPET_TOP_YU,
      PARAPET_WIDTH_U, PARAPET_HEIGHT_U,
    );
  }
  ctx.strokeStyle = hexA(WALL_TOP_INK, WALL_TOP_LINE_ALPHA);
  ctx.lineWidth = WALL_TOP_LINE_WIDTH_U;
  ctx.beginPath();
  ctx.moveTo(0, PARAPET_TOP_YU);
  ctx.lineTo(PLAYFIELD.widthU, PARAPET_TOP_YU);
  ctx.stroke();

  // 1381-1399 문루 — 성벽 위에 그려야 처마가 성벽 상단을 넘어간다
  ctx.fillStyle = TOWER_BODY;
  ctx.fillRect(TOWER_X0_U, TOWER_TOP_YU, TOWER_WIDTH_U, TOWER_HEIGHT_U);
  ctx.strokeStyle = hexA(GATE_TRIM_GREEN, TOWER_POST_ALPHA);
  ctx.lineWidth = TOWER_POST_WIDTH_U;
  for (let b = 0; b < TOWER_POST_COUNT; b += 1) {
    const x = TOWER_POST_X0_U + b * TOWER_POST_STEP_U;
    ctx.beginPath();
    ctx.moveTo(x, TOWER_POST_TOP_YU);
    ctx.lineTo(x, TOWER_POST_BOTTOM_YU);
    ctx.stroke();
  }
  dancheong(ctx, DANCHEONG_UPPER.x0U, DANCHEONG_UPPER.x1U, DANCHEONG_UPPER.yU, DANCHEONG_UPPER.heightU);
  tiledRoof(
    ctx, ROOF_UPPER_SHAPE.cxU, ROOF_UPPER_SHAPE.yU, ROOF_UPPER_SHAPE.widthU, ROOF_UPPER_SHAPE.heightU,
    ROOF_UPPER, hexA(GATE_TRIM_GREEN, ROOF_UPPER_TRIM_ALPHA),
  );
  roofTiles(
    ctx, ROOF_UPPER_SHAPE.cxU, ROOF_UPPER_SHAPE.yU, ROOF_UPPER_SHAPE.widthU, ROOF_UPPER_SHAPE.heightU,
    hexA(ROOF_TILE_INK, ROOF_UPPER_TILE_ALPHA),
  );
  dancheong(ctx, DANCHEONG_LOWER.x0U, DANCHEONG_LOWER.x1U, DANCHEONG_LOWER.yU, DANCHEONG_LOWER.heightU);
  tiledRoof(
    ctx, ROOF_LOWER_SHAPE.cxU, ROOF_LOWER_SHAPE.yU, ROOF_LOWER_SHAPE.widthU, ROOF_LOWER_SHAPE.heightU,
    ROOF_LOWER, hexA(PALETTE.jeokDim, ROOF_LOWER_TRIM_ALPHA),
  );
  roofTiles(
    ctx, ROOF_LOWER_SHAPE.cxU, ROOF_LOWER_SHAPE.yU, ROOF_LOWER_SHAPE.widthU, ROOF_LOWER_SHAPE.heightU,
    hexA(ROOF_TILE_INK, ROOF_LOWER_TILE_ALPHA),
  );
  // 1397-1399 위 처마가 아래 지붕에 떨구는 그림자
  ctx.fillStyle = hexA(EAVE_SHADOW, EAVE_SHADOW_ALPHA);
  ctx.fillRect(EAVE_SHADOW_X0_U, EAVE_SHADOW_TOP_YU, EAVE_SHADOW_WIDTH_U, EAVE_SHADOW_HEIGHT_U);

  // 1401-1420 홍예문 — 문루 아래 아치문. 철정이 박혀 있다
  ctx.fillStyle = DEEP_SHADOW;
  ctx.beginPath();
  ctx.moveTo(ARCH_LEFT_XU, ARCH_FOOT_YU);
  ctx.lineTo(ARCH_LEFT_XU, ARCH_SPRING_YU);
  ctx.arc(ARCH_CENTER_XU, ARCH_SPRING_YU, ARCH_RADIUS_U, Math.PI, 0);
  ctx.lineTo(ARCH_RIGHT_XU, ARCH_FOOT_YU);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hexA(GATE_TRIM_GREEN, ARCH_TRIM_ALPHA);
  ctx.lineWidth = ARCH_TRIM_WIDTH_U;
  ctx.stroke();
  ctx.fillStyle = hexA(STONE_EDGE, STUD_ALPHA);
  for (let st = 0; st < STUD_ROWS; st += 1) {
    for (let sc = 0; sc < STUD_COLUMNS; sc += 1) {
      ctx.beginPath();
      ctx.arc(
        STUD_X0_U + sc * STUD_X_STEP_U, STUD_Y0_U + st * STUD_Y_STEP_U,
        STUD_RADIUS_U, 0, FULL_TURN_RAD,
      );
      ctx.fill();
    }
  }

  // 1422-1437 성벽에 기대 놓인 공성 사다리
  ctx.strokeStyle = LADDER_WOOD;
  ctx.lineWidth = LADDER_RAIL_WIDTH_U;
  for (const x of LADDER_XU) {
    ctx.beginPath();
    ctx.moveTo(x + LADDER_LEFT_FOOT_DX_U, LADDER_FOOT_YU);
    ctx.lineTo(x + LADDER_LEFT_HEAD_DX_U, LADDER_HEAD_YU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + LADDER_RIGHT_FOOT_DX_U, LADDER_FOOT_YU);
    ctx.lineTo(x + LADDER_RIGHT_HEAD_DX_U, LADDER_HEAD_YU);
    ctx.stroke();
    ctx.lineWidth = LADDER_RUNG_WIDTH_U;
    for (let k = 0; k < LADDER_RUNG_COUNT; k += 1) {
      const fr = k / LADDER_RUNG_COUNT;
      ctx.beginPath();
      ctx.moveTo(
        lerp(x + LADDER_LEFT_FOOT_DX_U, x + LADDER_LEFT_HEAD_DX_U, fr),
        lerp(LADDER_FOOT_YU, LADDER_HEAD_YU, fr),
      );
      ctx.lineTo(
        lerp(x + LADDER_RIGHT_FOOT_DX_U, x + LADDER_RIGHT_HEAD_DX_U, fr),
        lerp(LADDER_FOOT_YU, LADDER_HEAD_YU, fr),
      );
      ctx.stroke();
    }
    ctx.lineWidth = LADDER_RAIL_WIDTH_U;
  }

  /*
   * 1439-1452 성벽에 박힌 화살과 화전이 남긴 그을음.
   *
   * **화살과 그을음이 한 스트림을 이어서 쓴다**(목업 1440의 `ar` 하나가 1451까지 간다).
   * 둘로 쪼개면 그을음 7개의 자리가 통째로 달라진다.
   */
  const masonry = createRng(MASONRY_SEED);
  ctx.strokeStyle = hexA(ARROW_SHAFT, ARROW_ALPHA);
  ctx.lineWidth = ARROW_WIDTH_U;
  for (let a = 0; a < ARROW_COUNT; a += 1) {
    const ax = masonry.float() * PLAYFIELD.widthU;
    const ay = ARROW_Y0_U + masonry.float() * ARROW_Y_SPAN_U;
    const angleRad = ARROW_ANGLE_BASE_RAD - masonry.float() * ARROW_ANGLE_SPAN_RAD;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(angleRad) * ARROW_LENGTH_U, ay + Math.sin(angleRad) * ARROW_LENGTH_U);
    ctx.stroke();
  }
  for (let s = 0; s < SCORCH_COUNT; s += 1) {
    glow(
      ctx,
      masonry.float() * PLAYFIELD.widthU,
      SCORCH_Y0_U + masonry.float() * SCORCH_Y_SPAN_U,
      SCORCH_RADIUS_U, SCORCH_GLOW, SCORCH_ALPHA,
    );
  }

  // 1453-1455 하단 띠와 창호 격자
  ctx.fillStyle = hexA(EAVE_SHADOW, BOTTOM_BAND_ALPHA);
  ctx.fillRect(0, BOTTOM_BAND_TOP_YU, PLAYFIELD.widthU, BOTTOM_BAND_HEIGHT_U);
  lattice(ctx, LATTICE_ALPHA, LATTICE_STEP_U);
}

/**
 * 이식: engine.js BG.dongnae의 동적 레이어 (1456)
 *
 * 재가 내린다. **목업에서도 이것이 마지막 줄이므로 굽기가 순서를 바꾸지 않는다.**
 *
 * `tSec`은 **스테이지 진입 기준 경과 시간**이다 — `embers`의 감기 식이 런 전체 누적 시간을
 * 받으면 후반 스테이지에서 재가 화면 밖으로 밀린다(`backgrounds/primitives.ts` embers 주석).
 * 연출이므로 시각은 sim의 FIXED_DT가 아니라 realDt 누적이다.
 */
export function drawDongnaeseongDynamic(ctx: CanvasRenderingContext2D, tSec: number): void {
  embers(ctx, tSec, EMBER_COUNT, EMBER, EMBER_ALPHA, () => createRng(EMBER_SEED), EMBER_RISES);
}
