/**
 * 노량 밤바다 (S5) — 목업 engine.js `BG.noryang`(1600-1649) 이식 (06 §1.9 · §3.2)
 *
 * 폭풍과 비, 그리고 이미 불타고 있는 함대. 스펙 §9.7의 최종 스테이지이고, 06 §3.2가
 * "최악 프레임의 배경"으로 지목한 그 배경이다.
 *
 * **원본 한 함수가 여기서 셋으로 갈린다.** 06 §3.2가 시간에 안 걸리는 레이어를 스테이지 진입
 * 시 1080×1920 오프스크린에 한 번 굽도록 정했다. `drawNoryangStatic`이 그 굽기에 들어가는
 * 것이고 `drawNoryangDynamic`이 매 프레임 그 위에 얹히는 것이다. 어느 줄이 어디로 갔는지는
 * 06 §3.2의 S5 표가 원본이고, 아래 두 함수의 머리말이 그 표를 그대로 따른다.
 *
 * **번개는 셋째 갈래다.** 목업 주석이 "이 프레임에 붙잡은 한 장의 판 번개"라고 적었다
 * (engine.js:1608). 정지 화면이라 정적으로 그려도 됐지만, 매 프레임 같은 자리에 붙어 있으면
 * 그건 번개가 아니라 배경 무늬다. 06 §1.9가 간헐 이벤트로 승격시켰고 별도 additive 패스로
 * 뺐다 — `drawNoryangLightning`이다.
 *
 * **이 배경이 담고 있는 게임 규칙은 「안 보이게 하지 않는다」 하나다.** 파문 0.07/0.05,
 * 포말 0.07, 문살 0.022, 빗줄기 0.055/0.03 — 알파가 전부 소수점 둘째 자리다. S5 조총탄 P2는
 * 반경 6u이고 제출 영상의 450px 축소에서 2.5px 점이다(12 §8-13). 이 알파들을 올리면 그 점이
 * 배경 무늬에 묻히고, §17이 "예고 없는 발사가 아니라 불공정한 발사"라고 부른 상태가 된다.
 * 예뻐 보이게 진하게 만들지 말 것.
 */

import { GLOW_BAKE_COLORS, PALETTE } from '../../config/palette';
import { PLAYFIELD } from '../../config/playfield';
import { easeOutCubic } from '../../core/math';
import { deriveStream } from '../../core/rng';
import { glow, hexA } from '../primitives';
import type { GradientStop } from './primitives';
import {
  cloud, embers, foam, lattice, ridge, seigaiha, vgrad, wakoShipGlow, wakoShipHull,
} from './primitives';

const PLAYFIELD_WIDTH_U = PLAYFIELD.widthU;
const PLAYFIELD_HEIGHT_U = PLAYFIELD.heightU;

/**
 * 구운 글로우 스프라이트가 있는 색만 담는 타입.
 *
 * `glow()`는 색을 키로 굽힌 스프라이트를 찾고, 목록에 없으면 dev에서 던지고 제출 빌드에서는
 * 1×1 빈 스프라이트를 낸다(render/primitives.ts getGlowSprite). 즉 목록과 어긋나면 **화면이
 * 조용히 어두워질 뿐 아무 신호도 안 난다.** 아래 두 상수에 이 타입을 붙여 그 실패를 빌드
 * 에러로 끌어올린다 — palette.ts의 `GLOW_BAKE_COLORS`에서 색이 빠지는 순간 이 파일이 깨진다.
 */
type BakedGlowColor = (typeof GLOW_BAKE_COLORS)[number];

/**
 * 배경 구조물 전용 색 — backgrounds/primitives.ts와 같은 임시 거처다.
 *
 * palette.ts는 "색 하나에 규칙 하나, 규칙 없는 색은 추가하지 않는다"를 계약으로 걸었고(03 §7)
 * 아래 넷은 게임 규칙을 하나도 나르지 않는다. `config/`에 `BACKGROUND_COLORS` 같은 자리가
 * 생기면 그리로 옮긴다. export하지 않는 것이 그 준비다.
 */
const SKY_TOP = '#1a070c'; // 화염이 구름 밑면을 물들인 상단
const SKY_MID = '#0a0710'; // 중단. 능선 채우기도 같은 색이라 능선이 하늘에서 오려낸 것으로 읽힌다
const SKY_BOTTOM = '#03040a'; // 수평선 아래. 화면에서 가장 어두운 값
const WRECK_INK = '#1a0d0c'; // 수면 잔해
const EMBER_INK = '#8c2f1a'; // 불티
const LIGHTNING_BOLT_INK = '#c3d2e8'; // 번개 줄기

/**
 * 파문 색. **값이 `PALETTE.takjeok`과 같지만 그쪽을 참조하지 않는다.**
 *
 * `takjeok`은 팔레트에서 「패리 불가」에 배정된 색이고(§4.3 장판), 그 배정이 바뀌면 색도 바뀐다.
 * 여기서 참조하면 패리 불가 색을 조정한 날 S5의 바다가 같이 다시 칠해진다 — 규칙이 없는 자리가
 * 규칙 있는 색에 끌려가는 것이고, 06 §5.2가 치트 오염 띠에서 같은 이유로 `takjeok` 재사용을
 * 취소했다. 값이 같은 것은 목업의 우연이지 계약이 아니다.
 */
const SEA_INK = '#7a2b1e';

/** engine.js:1609 · 1632 — 번개 후광과 왜선 화염. 둘 다 굽힌 목록 안에 있어야 한다 */
const LIGHTNING_GLOW_INK: BakedGlowColor = '#9fb6d8';
const FIRELIGHT_INK: BakedGlowColor = '#e2531f';

/** engine.js:1601-1606 — 세로 그라디언트 3단 */
const SKY_MID_STOP = 0.3;
const SKY_STOPS: readonly GradientStop[] = [
  [0, SKY_TOP],
  [SKY_MID_STOP, SKY_MID],
  [1, SKY_BOTTOM],
];

/** engine.js:1621 — 능선 하나. 봉우리 높이 80u에 위상 4.2 */
const RIDGE_BASE_Y_U = 190;
const RIDGE_AMP_U = 80;
const RIDGE_PHASE = 4.2;

/** engine.js:1626-1631 — 불타는 왜선 4척. 홀수 번째가 34u 뒤로 물러나며 30u 작아진다 */
const SHIP_X_U = [140, 420, 700, 970] as const;
const SHIP_BASE_Y_U = 214;
const SHIP_Y_STAGGER_U = 34;
const SHIP_BASE_WIDTH_U = 190;
const SHIP_WIDTH_STAGGER_U = 30;

/** engine.js:1627 — 화염 글로우의 맥동. 배마다 위상을 1.7씩 밀어 넷이 같이 뛰지 않게 한다 */
const SHIP_GLOW_BASE = 0.5;
const SHIP_GLOW_SWING = 0.16;
const SHIP_GLOW_RATE = 4.4;
const SHIP_GLOW_PHASE_STEP = 1.7;

/** engine.js:1629-1630 — 불탄 선체 아래 수면에 뜬 잔해 판자 */
const WRECK_ALPHA = 0.8;
const WRECK_X_BACK_U = 70;
const WRECK_X_STEP_U = 23;
const WRECK_X_SPREAD_U = 40;
const WRECK_BASE_Y_U = 300;
const WRECK_Y_STEP_U = 40;
const WRECK_Y_CYCLE = 3;
const WRECK_WIDTH_U = 90;
const WRECK_HEIGHT_U = 8;

/** engine.js:1632 — 구름무늬 3개. 화염색이라 구름이 아니라 연기로 읽힌다 */
const CLOUD_COUNT = 3;
const CLOUD_X0_U = 220;
const CLOUD_X_STEP_U = 380;
const CLOUD_Y0_U = 120;
const CLOUD_Y_STAGGER_U = 46;
const CLOUD_SIZE_U = 78;
const CLOUD_ALPHA = 0.1;

/** engine.js:1634 */
const LATTICE_ALPHA = 0.022;
const LATTICE_STEP_U = 180;

/** engine.js:1622-1623 — 청해파문 2층. 먼 층이 더 성기고 더 옅고 반대로 흐른다 */
const SEIGAIHA_NEAR = { y0U: 560, rows: 8, stepU: 240, alpha: 0.07, rate: 0.9 } as const;
const SEIGAIHA_FAR = { y0U: 1240, rows: 6, stepU: 300, alpha: 0.05, rate: -0.7 } as const;

/** engine.js:1624 */
const FOAM_Y0_U = 700;
const FOAM_ROWS = 4;
const FOAM_STEP_U = 320;
const FOAM_ALPHA = 0.07;

/** engine.js:1635 — 불티 46개. 상승 모드다 */
const EMBER_COUNT = 46;
const EMBER_ALPHA = 0.4;
const EMBER_RISE = true;
const EMBER_STREAM_LABEL = 'bg/s5/embers';

/** 빗줄기 한 층. engine.js:1637-1648의 두 루프가 이 값들만 다르다 */
interface RainLayerSpec {
  readonly count: number;
  readonly alpha: number;
  readonly lineWidthU: number;
  /** 줄 사이 가로 간격. 화면 폭과 서로소에 가까워야 줄이 뭉치지 않는다 */
  readonly pitchU: number;
  readonly speedU: number;
  /** 위에서 아래로 내려오는 동안의 가로 밀림. 이것이 바람의 방향이다 */
  readonly slantU: number;
}

const RAIN_FINE: RainLayerSpec = {
  count: 40, alpha: 0.055, lineWidthU: 2, pitchU: 137, speedU: 340, slantU: 52,
};
const RAIN_HEAVY: RainLayerSpec = {
  count: 14, alpha: 0.03, lineWidthU: 4, pitchU: 311, speedU: 620, slantU: 74,
};

/** engine.js:1640 — 감기 폭이 화면 폭보다 340u 넓다. 줄이 화면 밖에서 나타나고 사라진다 */
const RAIN_WRAP_MARGIN_U = 340;
const RAIN_ENTRY_OFFSET_U = 170;
const RAIN_TOP_U = -20;
const RAIN_BOTTOM_MARGIN_U = 20;

/** engine.js:1609-1619 — 번개. 좌표는 목업 그대로이고 발동 시점만 새로 설계했다 */
const LIGHTNING_GLOW_X_U = 240;
const LIGHTNING_GLOW_Y_U = 60;
const LIGHTNING_GLOW_RADIUS_U = 620;
const LIGHTNING_GLOW_ALPHA = 0.1;
const LIGHTNING_BOLT_ALPHA = 0.4;
const LIGHTNING_MAIN_WIDTH_U = 3;
const LIGHTNING_FORK_WIDTH_U = 1.6;
/** 줄기 꺾임점 넷. 첫 점이 화면 위로 나가 있어 번개의 시작이 안 보인다 */
const LIGHTNING_MAIN_PATH = [
  [196, -10], [232, 92], [198, 106], [246, 210],
] as const;
/** 갈래는 줄기의 둘째 꺾임점에서 갈라진다 */
const LIGHTNING_FORK_PATH = [[232, 92], [288, 150]] as const;

/**
 * 번개의 간헐 발동 — 06 §1.9가 지시한 승격의 실체다. 목업에 대응하는 값이 없어 새로 정했다.
 *
 * 시간을 `LIGHTNING_SLOT_SEC` 칸으로 자르고 칸마다 한 번 친다. 칸 안 어디서 치는지와 얼마나
 * 밝은지는 시드에서 나오므로 **간격이 일정하지 않고, 그러면서 같은 시드에서 항상 같다**(D-05).
 * 고정 주기로 하면 메트로놈이 되고, 그건 승격시킨 이유를 도로 없애는 것이다.
 *
 * 이 넷도 자리가 생기면 `config/`로 간다. `config/feel.ts`가 게임필 수치를 갖지만 배경 연출은
 * 그 파일의 관심사가 아니고, 이 파일의 소유자가 그 파일을 열 권한도 없다.
 */
const LIGHTNING_SLOT_SEC = 7;
const LIGHTNING_FLASH_SEC = 0.45;
const LIGHTNING_PEAK_MIN = 0.55;
const LIGHTNING_PEAK_SPAN = 0.45;
const LIGHTNING_STREAM_LABEL = 'bg/s5/lightning';

/**
 * 이식: docs/sample_image/_shared/engine.js BG.noryang 중 정적 레이어
 * (1601-1606 · 1621 · 1626 · 1629-1630 · 1632 · 1634) — 06 §3.2의 S5 정적 표 그대로.
 *
 * **스테이지 진입 시 오프스크린에 1회만 그린다.** 매 프레임 부르면 `vgrad`의 gradient 객체
 * 생성이 프레임마다 들어가고, 그것 하나가 Firefox에서 `fillRect` 대비 100배다(06 §3.3).
 *
 * `renderSeed`를 안 받는다. 공유 시그니처(`backgrounds/index.ts`)는 정적 레이어에 시드 잡음을
 * 쓰는 배경(S4 별자리)을 위해 그것을 넘기지만 노량의 정적 레이어에는 난수가 없다.
 *
 * **목업과 그리는 순서가 한 자리 다르다.** 목업은 배 하나를 그릴 때마다 그 배의 화염 글로우를
 * 얹고 그 위에 잔해 판자를 놓는다(1626-1631). 글로우가 동적으로 빠지면서 잔해 넷이 전부
 * 글로우 밑으로 내려갔다. 글로우는 `lighter`라 밑에 깔린 잔해를 지우지 않고 밝히기만 하므로
 * 판자가 사라지지는 않는다.
 */
export function drawNoryangStatic(ctx: CanvasRenderingContext2D): void {
  vgrad(ctx, SKY_STOPS);
  ridge(ctx, RIDGE_BASE_Y_U, RIDGE_AMP_U, RIDGE_PHASE, SKY_MID);

  for (let i = 0; i < SHIP_X_U.length; i += 1) {
    const shipXU = SHIP_X_U[i]!;
    wakoShipHull(ctx, shipXU, shipYU(i), shipWidthU(i));
    ctx.fillStyle = hexA(WRECK_INK, WRECK_ALPHA);
    ctx.fillRect(
      shipXU - WRECK_X_BACK_U + (i * WRECK_X_STEP_U) % WRECK_X_SPREAD_U,
      WRECK_BASE_Y_U + (i % WRECK_Y_CYCLE) * WRECK_Y_STEP_U,
      WRECK_WIDTH_U, WRECK_HEIGHT_U,
    );
  }

  for (let c = 0; c < CLOUD_COUNT; c += 1) {
    cloud(
      ctx,
      CLOUD_X0_U + c * CLOUD_X_STEP_U,
      CLOUD_Y0_U + (c % 2) * CLOUD_Y_STAGGER_U,
      CLOUD_SIZE_U, FIRELIGHT_INK, CLOUD_ALPHA,
    );
  }

  lattice(ctx, LATTICE_ALPHA, LATTICE_STEP_U);
}

/**
 * 이식: engine.js BG.noryang 중 동적 레이어 (1622-1624 · 1627 · 1635 · 1637-1648).
 *
 * 구운 정적 레이어 위에 매 프레임 그린다. 06 §3.5의 예산에서 이 함수가 408 호출 중 404를
 * 쓴다 — 파문 276 · 포말 28 · 화염 글로우 4 · 불티 46 · 빗줄기 54.
 *
 * `tSec`는 **스테이지 진입 기준 경과 시간이어야 한다.** 런 전체 누적을 넘기면 `embers`의
 * 상승 감기 식이 t > 288초부터 음수를 내고 불티가 화면 위로 사라진다
 * (backgrounds/primitives.ts embers 참조). 연출이므로 sim의 FIXED_DT가 아니라 realDt다.
 *
 * **번개가 여기서 정적 레이어 위에 온다.** 목업에서 번개는 능선(1621)보다 먼저 그려져 줄기의
 * 아래 3분의 2가 능선에 가려 있었다. 능선이 구운 한 장 안으로 들어간 이상 그 아래로 되돌릴
 * 방법은 오프스크린을 하나 더 굽는 것뿐이고, 06 §3.2가 배경 오프스크린을 스테이지당 한 장
 * 8.3MB로 못 박았다. 그래서 가려져 있던 줄기가 드러난다 — 목업과 다른 자리이고, 대가로 고른
 * 것이다.
 */
export function drawNoryangDynamic(
  ctx: CanvasRenderingContext2D,
  tSec: number,
  renderSeed: number,
): void {
  drawNoryangLightning(ctx, tSec, renderSeed);

  seigaiha(
    ctx, SEIGAIHA_NEAR.y0U, SEIGAIHA_NEAR.rows, SEIGAIHA_NEAR.stepU,
    SEA_INK, SEIGAIHA_NEAR.alpha, tSec * SEIGAIHA_NEAR.rate,
  );
  seigaiha(
    ctx, SEIGAIHA_FAR.y0U, SEIGAIHA_FAR.rows, SEIGAIHA_FAR.stepU,
    SEA_INK, SEIGAIHA_FAR.alpha, tSec * SEIGAIHA_FAR.rate,
  );
  foam(ctx, FOAM_Y0_U, FOAM_ROWS, FOAM_STEP_U, tSec, FOAM_ALPHA);

  for (let i = 0; i < SHIP_X_U.length; i += 1) {
    const flare = SHIP_GLOW_BASE
      + Math.sin(tSec * SHIP_GLOW_RATE + i * SHIP_GLOW_PHASE_STEP) * SHIP_GLOW_SWING;
    wakoShipGlow(ctx, SHIP_X_U[i]!, shipYU(i), shipWidthU(i), FIRELIGHT_INK, flare);
  }

  embers(
    ctx, tSec, EMBER_COUNT, EMBER_INK, EMBER_ALPHA,
    () => deriveStream(renderSeed, EMBER_STREAM_LABEL), EMBER_RISE,
  );

  drawRainLayer(ctx, tSec, RAIN_FINE);
  drawRainLayer(ctx, tSec, RAIN_HEAVY);
}

/**
 * 이식: engine.js BG.noryang의 판 번개 (1608-1619) — 그림은 그대로, 발동만 새로 설계했다.
 *
 * 후광 한 장 + 줄기 4점 + 갈래 1개다. 목업은 이것을 한 프레임에 붙잡아 정적으로 그렸고,
 * 06 §1.9가 간헐 이벤트로 승격시키면서 **별도 additive 패스**로 빼도록 정했다. 그래서
 * 줄기 stroke도 `lighter`다 — 목업은 `source-over`였지만 배경이 거의 검정이라 두 합성의
 * 결과 차이가 8비트 아래이고, 하나의 섬광이 한 번의 합성 모드 왕복으로 끝난다.
 *
 * 세기가 0이면 아무것도 안 그린다. 번개가 없는 프레임의 비용은 `Math.floor` 하나와
 * 스트림 파생 하나다.
 */
export function drawNoryangLightning(
  ctx: CanvasRenderingContext2D,
  tSec: number,
  renderSeed: number,
): void {
  const intensity = lightningIntensity(tSec, renderSeed);
  if (intensity <= 0) {
    return;
  }

  glow(
    ctx, LIGHTNING_GLOW_X_U, LIGHTNING_GLOW_Y_U, LIGHTNING_GLOW_RADIUS_U,
    LIGHTNING_GLOW_INK, LIGHTNING_GLOW_ALPHA * intensity,
  );

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hexA(LIGHTNING_BOLT_INK, LIGHTNING_BOLT_ALPHA * intensity);
  ctx.lineWidth = LIGHTNING_MAIN_WIDTH_U;
  strokePolyline(ctx, LIGHTNING_MAIN_PATH);
  ctx.lineWidth = LIGHTNING_FORK_WIDTH_U;
  strokePolyline(ctx, LIGHTNING_FORK_PATH);
  ctx.restore();
}

/**
 * 지금 프레임의 섬광 세기 (0이면 번개 없음).
 *
 * `(renderSeed, tSec)`만의 함수다 — 상태를 안 들고 있으므로 프레임을 건너뛰거나 되감아도 같은
 * 시각에 같은 번개가 나온다. 칸마다 별도 스트림을 파생하는 것이 그 성질의 값이고,
 * `deriveStream`이 순서와 무관해서 공짜다(core/rng.ts).
 */
function lightningIntensity(tSec: number, renderSeed: number): number {
  const slot = Math.floor(tSec / LIGHTNING_SLOT_SEC);
  const stream = deriveStream(renderSeed, `${LIGHTNING_STREAM_LABEL}/${slot}`);
  const startSec = slot * LIGHTNING_SLOT_SEC
    + stream.float() * (LIGHTNING_SLOT_SEC - LIGHTNING_FLASH_SEC);
  const elapsedSec = tSec - startSec;
  if (elapsedSec < 0 || elapsedSec >= LIGHTNING_FLASH_SEC) {
    return 0;
  }
  const peak = LIGHTNING_PEAK_MIN + stream.float() * LIGHTNING_PEAK_SPAN;
  // 즉시 최대로 켜졌다가 (1-u)³로 꺼진다. 켜지는 데 시간이 걸리면 번개가 아니라 조명이다
  return peak * (1 - easeOutCubic(elapsedSec / LIGHTNING_FLASH_SEC));
}

/** engine.js:1612-1615 · 1617-1619 — 열린 꺾은선. `poly`는 닫아 버리므로 쓸 수 없다 */
function strokePolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
): void {
  const first = points[0];
  if (first === undefined) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    ctx.lineTo(point[0], point[1]);
  }
  ctx.stroke();
}

/**
 * 이식: engine.js BG.noryang의 빗줄기 두 루프 (1637-1642 · 1643-1648) — 상수만 다른
 * 같은 루프라 하나로 합쳤다.
 *
 * 줄은 화면 위 밖에서 아래 밖까지 한 획이고 오른쪽에서 왼쪽으로 기운다. 세로로 흐르지 않고
 * **가로로 감긴다** — `x`가 시간에 비례해 늘다가 `PF.W + 340`에서 되감기므로, 비가 내리는
 * 것처럼 보이는 것은 기울어진 줄이 옆으로 흐르기 때문이다.
 */
function drawRainLayer(
  ctx: CanvasRenderingContext2D,
  tSec: number,
  spec: RainLayerSpec,
): void {
  ctx.save();
  ctx.strokeStyle = hexA(PALETTE.baek, spec.alpha);
  ctx.lineWidth = spec.lineWidthU;
  const wrapU = PLAYFIELD_WIDTH_U + RAIN_WRAP_MARGIN_U;
  for (let i = 0; i < spec.count; i += 1) {
    const x = ((i * spec.pitchU + tSec * spec.speedU) % wrapU) - RAIN_ENTRY_OFFSET_U;
    ctx.beginPath();
    ctx.moveTo(x, RAIN_TOP_U);
    ctx.lineTo(x - spec.slantU, PLAYFIELD_HEIGHT_U + RAIN_BOTTOM_MARGIN_U);
    ctx.stroke();
  }
  ctx.restore();
}

/** 선체와 화염 글로우가 같은 자리를 읽어야 한다. 두 패스로 갈렸으므로 식이 하나여야 한다 */
function shipYU(index: number): number {
  return SHIP_BASE_Y_U + (index % 2) * SHIP_Y_STAGGER_U;
}

function shipWidthU(index: number): number {
  return SHIP_BASE_WIDTH_U - (index % 2) * SHIP_WIDTH_STAGGER_U;
}
