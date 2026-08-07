/**
 * 배경 프리미티브 — 목업 engine.js 이식 (06_렌더링과_게임필.md §1.8)
 *
 * 스테이지 배경 5종이 이 함수들만 조합해 그린다. 여기에 스테이지는 없다 — 어느 무늬를
 * 어디에 어떤 색으로 놓는지는 backgrounds/의 스테이지 파일이 정하고, 이 파일은 무늬 하나를
 * 그리는 법만 안다.
 *
 * **정적과 동적이 갈린다(06 §3.2).** 시간에 안 걸리는 함수는 스테이지 진입 시 1080×1920
 * 오프스크린에 한 번 굽고, 시간에 걸리는 함수만 매 프레임 다시 그린다. 어느 쪽인지는 함수마다
 * 머리말에 적혀 있고, **그것을 지키는 것은 부르는 쪽이다** — 이 파일은 강제할 수단이 없다.
 * 정적 함수를 매 프레임 부르면 gradient 객체 생성과 수백 개의 path op이 프레임에 그대로 들어온다.
 *
 * `vignette`만 이 규칙 밖이다. 매 프레임 전면에 그리지만 굽기가 함수 안에 들어 있고,
 * 부르는 자리는 레이어 10의 `render/frame.ts`다(12 §2).
 */

import { PALETTE } from '../../config/palette';
import { PLAYFIELD } from '../../config/playfield';
import type { Rng } from '../../core/rng';
import { glow, hexA, poly } from '../primitives';

/**
 * §3.1 논리 해상도 (u). 아래 거의 모든 함수가 화면 폭·높이 전체를 훑으므로 먼저 이름을 준다.
 * 숫자는 playfield.ts에만 산다.
 */
const PLAYFIELD_WIDTH_U = PLAYFIELD.widthU;
const PLAYFIELD_HEIGHT_U = PLAYFIELD.heightU;

/**
 * 배경 구조물 전용 색 — 여기가 임시 거처다.
 *
 * `config/palette.ts`는 "색 하나에 규칙 하나, 규칙 없는 색은 추가하지 않는다"를 계약으로 걸었고
 * (03 §7), 아래 여섯은 게임 규칙을 하나도 나르지 않는 순수 구조물 색이라 그 계약에 걸려 들어갈
 * 자리가 없다. 같은 사정의 배경 전용 글로우 6색은 palette.ts가 `GLOW_BAKE_COLORS`라는 별도
 * 목록으로 받아 줬는데, 채우기·선 색에는 아직 그런 목록이 없다.
 *
 * 그래서 이것들은 `config/`에 `BACKGROUND_COLORS` 같은 자리가 생기면 그리로 옮겨 가야 한다.
 * export하지 않는 것이 그 준비다 — 이 파일 밖에 참조가 생기면 옮기는 일이 한 파일 작업이 아니게 된다.
 */
const STONE_FACE_TOP = '#232936'; // 석성 위쪽 면. 아래쪽은 PALETTE.ink700이 받는다
const STONE_BLOCK_TINT = '#ffffff'; // 블록별 명도 요동. 알파만 난수로 흔든다
const STONE_JOINT = '#04060a'; // 줄눈. 배경보다 어두워야 블록이 개별로 읽힌다
const SHIP_HULL = '#0d111a'; // 왜선 선체
const SHIP_SAIL = '#141a25'; // 왜선 돛
const VIGNETTE_INK = '#000000'; // 비네트. 색이 아니라 감광이다

/** 호를 한 바퀴 도는 각. 목업이 2π 대신 쓴 값이라 그대로 옮긴다 (engine.js:1176 등) */
const FULL_TURN_RAD = 6.284;

/**
 * 호출마다 **같은 시드에서 새로 시작하는** 스트림을 낸다 (D-05).
 *
 * `Rng` 인스턴스를 그냥 받으면 안 되는 이유가 `embers`에 있다 — 목업은 매 호출 `rng(seed)`로
 * 수열을 처음부터 다시 돌려 불티의 기준 위치를 고정하고, 움직임은 `t`만으로 만든다.
 * 인스턴스를 넘기면 프레임마다 수열이 이어져 불티 46개가 매 프레임 다른 자리로 순간이동한다.
 *
 * 부르는 쪽은 `() => deriveStream(runSeed, 'bg/s5/embers')`처럼 라벨에 묶어 넘긴다.
 * 어떤 라벨이 존재하는지는 게임 규칙이므로 core/도 render/도 아니고 배경 파일이 정한다.
 */
export type SeededStreamFactory = () => Rng;

/** engine.js:1077·1081 — 문살은 홑선이 아니라 15u 간격의 겹선이다 */
const LATTICE_TWIN_OFFSET_U = 15;
const LATTICE_LINE_WIDTH_U = 1;

/**
 * 이식: docs/sample_image/_shared/engine.js lattice (1070-1084) — 그대로. **정적.**
 *
 * 창호 문살. 평범한 격자가 하는 일(바닥면을 읽히게 한다)을 모눈종이로 보이지 않게 한다.
 */
export function lattice(ctx: CanvasRenderingContext2D, alpha: number, stepU: number): void {
  ctx.save();
  ctx.strokeStyle = hexA(PALETTE.cheong, alpha);
  ctx.lineWidth = LATTICE_LINE_WIDTH_U;
  for (let x = 0; x <= PLAYFIELD_WIDTH_U; x += stepU) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, PLAYFIELD_HEIGHT_U);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + LATTICE_TWIN_OFFSET_U, 0);
    ctx.lineTo(x + LATTICE_TWIN_OFFSET_U, PLAYFIELD_HEIGHT_U);
    ctx.stroke();
  }
  for (let y = 0; y <= PLAYFIELD_HEIGHT_U; y += stepU) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PLAYFIELD_WIDTH_U, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y + LATTICE_TWIN_OFFSET_U);
    ctx.lineTo(PLAYFIELD_WIDTH_U, y + LATTICE_TWIN_OFFSET_U);
    ctx.stroke();
  }
  ctx.restore();
}

/** engine.js:1093-1099 청해파문의 행 간격·가로 밀림·아치 반경 */
const SEIGAIHA_ROW_PITCH = 0.44;
const SEIGAIHA_ROW_PHASE_STEP = 0.4;
const SEIGAIHA_SWAY_U = 10;
const SEIGAIHA_ARC_SCALE = 0.2;
const SEIGAIHA_ARC_COUNT = 3;
const SEIGAIHA_LINE_WIDTH_U = 2;

/**
 * 이식: engine.js seigaiha (1088-1104) — 그림은 그대로, **정적 굽기 대상에서 뺐다. 동적이다.**
 *
 * 청해파문. 조선 직물이 바다를 그릴 때 쓰는 겹비늘이고, 흔한 사인 곡선 물결을 대신한다.
 *
 * `phase`가 매 프레임 바뀐다(06 §1.8). 그래서 스테이지 굽기에 넣으면 물결이 멈춘다.
 * 대신 S5에서 이 함수 둘이 프레임당 276 stroke을 내고, 그것이 배경 호출 수의 68%다(06 §3.2).
 * 줄이는 손잡이는 아래 `bakeSeigaihaStrip`이고, **기본은 여기 stroke다** — 스트립은 목업과의
 * 1:1 대조가 끊기므로 P1 게이트가 실패했을 때만 켠다(06 §3.6 손잡이 2순위, −286).
 */
export function seigaiha(
  ctx: CanvasRenderingContext2D,
  y0U: number,
  rows: number,
  stepU: number,
  color: string,
  alpha: number,
  phase: number,
): void {
  ctx.save();
  ctx.strokeStyle = hexA(color, alpha);
  ctx.lineWidth = SEIGAIHA_LINE_WIDTH_U;
  for (let row = 0; row < rows; row += 1) {
    const y = y0U + row * stepU * SEIGAIHA_ROW_PITCH;
    const offsetU = seigaihaRowOffsetU(row, stepU, phase);
    for (let x = -stepU; x <= PLAYFIELD_WIDTH_U + stepU; x += stepU) {
      for (let k = 1; k <= SEIGAIHA_ARC_COUNT; k += 1) {
        ctx.beginPath();
        ctx.arc(x + offsetU, y, stepU * SEIGAIHA_ARC_SCALE * k, Math.PI, 0);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * engine.js:1094 — 홀수 행을 반 칸 밀고 거기에 위상 흔들림을 얹는다.
 *
 * 행마다 **가로 밀림만** 다르고 아치 자체는 똑같다는 것이 스트립 굽기가 성립하는 근거다.
 */
function seigaihaRowOffsetU(row: number, stepU: number, phase: number): number {
  return (row % 2) * stepU / 2 + Math.sin(phase + row * SEIGAIHA_ROW_PHASE_STEP) * SEIGAIHA_SWAY_U;
}

/** 구운 청해파문 한 행. `stepU`가 들어 있는 것은 그리기가 행 간격을 여기서 읽기 때문이다 */
export interface SeigaihaStrip {
  readonly image: CanvasImageSource;
  readonly stepU: number;
  readonly widthU: number;
  readonly heightU: number;
}

/**
 * 06 §3.2의 조건부 최적화 — 청해파문 한 행을 구운다. **기본안이 아니다.**
 *
 * 한 행은 `off`만큼 가로로 밀린 동일한 아치 열이므로 한 장이면 전부 덮는다. S5 기준
 * 276 stroke이 14 `drawImage`가 된다(−286, 06 §3.6 손잡이 2순위). fill은 0.15M px에서
 * 1.9M px로 13배 늘지만 실측 fill-rate 여유가 10.5배라 대가가 아니다(13 §4.1).
 *
 * **켜는 대가는 성능이 아니라 대조다.** 이걸 쓰면 화면에 나온 물결이 목업의 어느 stroke에서
 * 왔는지 눈으로 못 따라간다(03 §2.3). P1 게이트가 통과하면 이 함수는 안 쓰인다.
 *
 * 스트립은 논리 단위 1:1로 굽는다. 확대 화면에서는 stroke보다 무르게 나오고, `off`가 실수라
 * 가로 위치도 픽셀에 안 맞는다 — A/B 항목인 이유가 성능만이 아니다.
 */
export function bakeSeigaihaStrip(stepU: number, color: string, alpha: number): SeigaihaStrip {
  const widthU = PLAYFIELD_WIDTH_U + stepU * 2;
  const arcReachU = stepU * SEIGAIHA_ARC_SCALE * SEIGAIHA_ARC_COUNT;
  // 위로 arcReachU만큼 벋고 선폭 절반이 위아래로 삐져나온다. 기준선을 아래에서 1u 띄운다
  const heightU = arcReachU + SEIGAIHA_LINE_WIDTH_U;
  const baselineU = arcReachU + SEIGAIHA_LINE_WIDTH_U / 2;

  const { canvas, ctx } = createOffscreen(widthU, heightU);
  ctx.strokeStyle = hexA(color, alpha);
  ctx.lineWidth = SEIGAIHA_LINE_WIDTH_U;
  // 스트립 안의 x는 월드 x에 stepU를 더한 값이다. 좌우 끝 아치가 잘리지만 그 부분은 화면 밖이다
  for (let x = 0; x <= PLAYFIELD_WIDTH_U + stepU * 2; x += stepU) {
    for (let k = 1; k <= SEIGAIHA_ARC_COUNT; k += 1) {
      ctx.beginPath();
      ctx.arc(x, baselineU, stepU * SEIGAIHA_ARC_SCALE * k, Math.PI, 0);
      ctx.stroke();
    }
  }
  return { image: canvas, stepU, widthU, heightU };
}

/**
 * 구운 스트립으로 `seigaiha`를 대신 그린다. 행 위치와 밀림 식은 원본과 같은 것을 쓴다 —
 * 갈라지면 A/B가 재는 것이 굽기의 효과가 아니라 두 구현의 차이가 된다.
 */
export function drawSeigaihaStrip(
  ctx: CanvasRenderingContext2D,
  strip: SeigaihaStrip,
  y0U: number,
  rows: number,
  phase: number,
): void {
  const baselineU = strip.heightU - SEIGAIHA_LINE_WIDTH_U / 2;
  for (let row = 0; row < rows; row += 1) {
    const y = y0U + row * strip.stepU * SEIGAIHA_ROW_PITCH;
    const offsetU = seigaihaRowOffsetU(row, strip.stepU, phase);
    ctx.drawImage(
      strip.image,
      -strip.stepU + offsetU, y - baselineU,
      strip.widthU, strip.heightU,
    );
  }
}

/** engine.js:1110-1116 능선. 파장이 다른 사인 둘을 겹쳐 붓질처럼 보이게 한다 */
const RIDGE_SAMPLE_STEP_U = 16;
const RIDGE_SKIRT_SCALE = 3;
const RIDGE_WAVE_LONG_U = 300;
const RIDGE_WAVE_SHORT_U = 97;
const RIDGE_SHORT_PHASE_SCALE = 2.3;
const RIDGE_SHORT_AMP_SCALE = 0.3;
const RIDGE_STROKE_WIDTH_U = 2;

/**
 * 이식: engine.js ridge (1107-1120) — 그대로. **정적.**
 *
 * 수묵 능선. `strokeColor`를 생략하면 채우기만 하고, 목업의 능선 호출은 전부 그쪽이다.
 */
export function ridge(
  ctx: CanvasRenderingContext2D,
  baseYU: number,
  ampU: number,
  k: number,
  fillColor: string,
  strokeColor?: string,
): void {
  ctx.beginPath();
  ctx.moveTo(0, baseYU + ampU * RIDGE_SKIRT_SCALE);
  for (let x = 0; x <= PLAYFIELD_WIDTH_U; x += RIDGE_SAMPLE_STEP_U) {
    ctx.lineTo(
      x,
      baseYU
        - Math.abs(Math.sin(x / RIDGE_WAVE_LONG_U + k)) * ampU
        - Math.abs(Math.sin(x / RIDGE_WAVE_SHORT_U + k * RIDGE_SHORT_PHASE_SCALE))
          * ampU * RIDGE_SHORT_AMP_SCALE,
    );
  }
  ctx.lineTo(PLAYFIELD_WIDTH_U, baseYU + ampU * RIDGE_SKIRT_SCALE);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor !== undefined) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = RIDGE_STROKE_WIDTH_U;
    ctx.stroke();
  }
}

/** engine.js:1126-1140 구름무늬. 세 갈래 여의두 아래에 꼬리선 하나 */
const CLOUD_LINE_WIDTH_MIN_U = 2;
const CLOUD_LINE_WIDTH_SCALE = 0.09;
const CLOUD_LOBES = [
  { dx: -0.78, dy: 0.06, r: 0.36, from: 0.92, to: 2.15 },
  { dx: 0, dy: -0.14, r: 0.5, from: 0.86, to: 2.2 },
  { dx: 0.8, dy: 0.04, r: 0.34, from: 0.86, to: 2.1 },
] as const;
const CLOUD_TAIL = { fromX: -1.22, toX: 1.2, dy: 0.3 } as const;

/** 이식: engine.js cloud (1123-1142) — 그대로. **정적.** 구름무늬(여의두) */
export function cloud(
  ctx: CanvasRenderingContext2D,
  cxU: number,
  cyU: number,
  sizeU: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(CLOUD_LINE_WIDTH_MIN_U, sizeU * CLOUD_LINE_WIDTH_SCALE);
  for (const lobe of CLOUD_LOBES) {
    ctx.beginPath();
    ctx.arc(
      cxU + sizeU * lobe.dx, cyU + sizeU * lobe.dy, sizeU * lobe.r,
      Math.PI * lobe.from, Math.PI * lobe.to,
    );
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cxU + sizeU * CLOUD_TAIL.fromX, cyU + sizeU * CLOUD_TAIL.dy);
  ctx.lineTo(cxU + sizeU * CLOUD_TAIL.toX, cyU + sizeU * CLOUD_TAIL.dy);
  ctx.stroke();
  ctx.restore();
}

/** engine.js:1147-1155 기와 지붕의 처마 곡선 */
const ROOF_EAVE_OVERHANG = 0.07;
const ROOF_EAVE_DROP = 0.16;
const ROOF_CONTROL_DROP = 0.12;
const ROOF_CONTROL_X = 0.5;
const ROOF_BASE_INSET = 0.84;
const ROOF_TRIM_WIDTH_U = 3;

/**
 * 이식: engine.js tiledRoof (1145-1157) — 그대로. **정적.**
 *
 * 기와 지붕. 실루엣만으로 조선 건물을 읽히게 하는 가장 강한 단서다.
 * 보스 B3·B5의 `warship` case도 이 함수를 부른다(engine.js:776) — 배경 전용이 아니다.
 */
export function tiledRoof(
  ctx: CanvasRenderingContext2D,
  cxU: number,
  yU: number,
  widthU: number,
  heightU: number,
  fillColor: string,
  trimColor?: string,
): void {
  const halfW = widthU / 2;
  ctx.beginPath();
  ctx.moveTo(cxU - halfW - widthU * ROOF_EAVE_OVERHANG, yU - heightU * ROOF_EAVE_DROP);
  ctx.quadraticCurveTo(
    cxU - halfW * ROOF_CONTROL_X, yU - heightU * ROOF_CONTROL_DROP,
    cxU, yU - heightU,
  );
  ctx.quadraticCurveTo(
    cxU + halfW * ROOF_CONTROL_X, yU - heightU * ROOF_CONTROL_DROP,
    cxU + halfW + widthU * ROOF_EAVE_OVERHANG, yU - heightU * ROOF_EAVE_DROP,
  );
  ctx.lineTo(cxU + halfW * ROOF_BASE_INSET, yU);
  ctx.lineTo(cxU - halfW * ROOF_BASE_INSET, yU);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (trimColor !== undefined) {
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = ROOF_TRIM_WIDTH_U;
    ctx.stroke();
  }
}

/** engine.js:1162-1178 왜선. 선체 사다리꼴 · 돛 사각형 · 일장 원반 · 돛대 */
const SHIP_HULL_HEIGHT = 0.24;
const SHIP_HULL_BOTTOM_INSET = 0.38;
const SHIP_HULL_STROKE_ALPHA = 0.22;
const SHIP_SAIL_WIDTH = 0.44;
const SHIP_SAIL_HEIGHT = 0.42;
const SHIP_SAIL_STROKE_ALPHA = 0.35;
const SHIP_DISC_ALPHA = 0.62;
const SHIP_DISC_SCALE = 0.2;
const SHIP_MAST_ALPHA = 0.14;
const SHIP_MAST_HEIGHT = 1.3;
const SHIP_LINE_WIDTH_U = 2;
const SHIP_GLOW_RADIUS_SCALE = 0.7;

/**
 * 이식: engine.js wakoShip의 선체·돛·일장 원반 (1163-1178) — **정적.**
 *
 * 목업의 `wakoShip` 하나를 둘로 쪼갠 앞쪽이다(06 §1.8). 뒤쪽은 `wakoShipGlow`이고,
 * 쪼갠 이유는 S5에서 글로우만 `sin(t*4.4)`로 맥동해서 배 자체는 구울 수 있기 때문이다.
 * S1은 글로우 없이 이 함수만 6번 부른다(engine.js:1308-1313).
 *
 * 돛에 일장 원반이 붙는 것이 규칙이다 — 실루엣 크기에서 적선을 아군 배로 오인하면 안 된다.
 *
 * 목업이 그랬듯 `fillStyle`·`strokeStyle`·`lineWidth`를 복구하지 않는다. 부르는 쪽이 다음
 * 도형의 색을 반드시 다시 지정한다는 전제이고, 그 전제는 목업의 모든 호출부가 지키고 있다.
 */
export function wakoShipHull(
  ctx: CanvasRenderingContext2D,
  cxU: number,
  yU: number,
  widthU: number,
): void {
  const hullH = widthU * SHIP_HULL_HEIGHT;
  ctx.fillStyle = SHIP_HULL;
  poly(ctx, [
    [cxU - widthU / 2, yU],
    [cxU + widthU / 2, yU],
    [cxU + widthU * SHIP_HULL_BOTTOM_INSET, yU + hullH],
    [cxU - widthU * SHIP_HULL_BOTTOM_INSET, yU + hullH],
  ]);
  ctx.fill();
  ctx.strokeStyle = hexA(PALETTE.jeok, SHIP_HULL_STROKE_ALPHA);
  ctx.lineWidth = SHIP_LINE_WIDTH_U;
  ctx.stroke();

  const sailW = widthU * SHIP_SAIL_WIDTH;
  const sailH = widthU * SHIP_SAIL_HEIGHT;
  ctx.fillStyle = SHIP_SAIL;
  ctx.fillRect(cxU - sailW / 2, yU - sailH, sailW, sailH);
  ctx.strokeStyle = hexA(PALETTE.jeok, SHIP_SAIL_STROKE_ALPHA);
  ctx.strokeRect(cxU - sailW / 2, yU - sailH, sailW, sailH);
  ctx.fillStyle = hexA(PALETTE.jeok, SHIP_DISC_ALPHA);
  ctx.beginPath();
  ctx.arc(cxU, yU - sailH / 2, sailW * SHIP_DISC_SCALE, 0, FULL_TURN_RAD);
  ctx.fill();

  ctx.strokeStyle = hexA(PALETTE.baek, SHIP_MAST_ALPHA);
  ctx.lineWidth = SHIP_LINE_WIDTH_U;
  ctx.beginPath();
  ctx.moveTo(cxU, yU - sailH);
  ctx.lineTo(cxU, yU - sailH * SHIP_MAST_HEIGHT);
  ctx.stroke();
}

/**
 * 이식: engine.js wakoShip의 글로우 한 줄 (1179) — **동적.**
 *
 * `color`가 인자인 것이 목업과 다른 유일한 자리다. 목업은 `'#e2531f'`를 함수 안에 적었는데,
 * 그 문자열은 `glow()`가 구운 스프라이트를 찾는 키이고 진짜 소유자는 `config/palette.ts`의
 * `GLOW_BAKE_COLORS`다(06 §3.1). 여기 한 벌 더 적으면 두 소스가 언젠가 갈라지고, 갈라진
 * 날 이 글로우는 조용히 사라진다(목록 밖 색 = dev 오류 · 제출 빌드에선 빈 스프라이트).
 */
export function wakoShipGlow(
  ctx: CanvasRenderingContext2D,
  cxU: number,
  yU: number,
  widthU: number,
  color: string,
  amount: number,
): void {
  glow(ctx, cxU, yU, widthU * SHIP_GLOW_RADIUS_SCALE, color, amount);
}

/** engine.js:1192-1204 석성. 블록 폭 110u에 2u 줄눈, 홀수 행은 반 칸 어긋난다 */
const STONE_BLOCK_PITCH_U = 110;
const STONE_BLOCK_INSET_U = 2;
const STONE_BLOCK_FACE_U = 106;
const STONE_COLUMN_FROM = -1;
const STONE_COLUMN_TO = 11;
const STONE_TINT_MAX_ALPHA = 0.022;
const STONE_JOINT_ALPHA = 0.75;
const STONE_JOINT_WIDTH_U = 2;

/**
 * 이식: engine.js stoneWall (1183-1205) — 난수를 주입식으로 바꿨다(D-05). **정적.**
 *
 * 블록마다 명도를 흔들어야 벽돌 채우기가 아니라 석축으로 읽힌다.
 *
 * `rng(seed)` 자리가 `makeStream()`이 됐다. **그림은 안 바뀐다** — 부르는 쪽이 같은 라벨로
 * 파생하면 같은 시드에서 같은 수열이 나오고, 이 함수는 목업과 똑같은 순서로 소비한다.
 *
 * 목업이 알파를 `toFixed(3)`으로 잘랐던 것은 옮기지 않았다. 알파 상한이 0.022라 흰색 기여가
 * 최대 5.6/255이고, 0.001 차이는 0.26/255 — 8비트 양자화 아래라 픽셀이 안 달라진다.
 */
export function stoneWall(
  ctx: CanvasRenderingContext2D,
  y0U: number,
  y1U: number,
  courseU: number,
  makeStream: SeededStreamFactory,
): void {
  const stream = makeStream();
  // 정적 굽기 전용이라 스테이지당 1회다. 매 프레임 부르면 여기서 gradient 객체가 매번 생긴다
  const gradient = ctx.createLinearGradient(0, y0U, 0, y1U);
  gradient.addColorStop(0, STONE_FACE_TOP);
  gradient.addColorStop(1, PALETTE.ink700);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y0U, PLAYFIELD_WIDTH_U, y1U - y0U);

  let row = 0;
  for (let y = y0U; y < y1U; y += courseU, row += 1) {
    const rowShiftU = (row % 2) * STONE_BLOCK_PITCH_U / 2;
    for (let c = STONE_COLUMN_FROM; c < STONE_COLUMN_TO; c += 1) {
      const x = c * STONE_BLOCK_PITCH_U + rowShiftU;
      ctx.fillStyle = hexA(STONE_BLOCK_TINT, stream.float() * STONE_TINT_MAX_ALPHA);
      ctx.fillRect(
        x + STONE_BLOCK_INSET_U, y + STONE_BLOCK_INSET_U,
        STONE_BLOCK_FACE_U, courseU - STONE_BLOCK_INSET_U * 2,
      );
    }
    ctx.strokeStyle = hexA(STONE_JOINT, STONE_JOINT_ALPHA);
    ctx.lineWidth = STONE_JOINT_WIDTH_U;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PLAYFIELD_WIDTH_U, y);
    ctx.stroke();
    for (let c = STONE_COLUMN_FROM; c < STONE_COLUMN_TO; c += 1) {
      const x = c * STONE_BLOCK_PITCH_U + rowShiftU;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + courseU);
      ctx.stroke();
    }
  }
}

/** engine.js:1212-1218 기와 결. 지붕면을 −6..6의 13갈래로 훑는다 */
const ROOF_TILE_HALF_COUNT = 6;
const ROOF_TILE_TOP_SPREAD = 0.06;
const ROOF_TILE_TOP_HEIGHT = 0.86;
const ROOF_TILE_MID_SPREAD = 0.3;
const ROOF_TILE_MID_HEIGHT = 0.4;
const ROOF_TILE_END_SPREAD = 0.52;
const ROOF_TILE_END_HEIGHT = 0.06;
const ROOF_TILE_WIDTH_U = 2;

/** 이식: engine.js roofTiles (1208-1220) — 그대로. **정적.** 지붕면을 타고 내리는 기와 골 */
export function roofTiles(
  ctx: CanvasRenderingContext2D,
  cxU: number,
  yU: number,
  widthU: number,
  heightU: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = ROOF_TILE_WIDTH_U;
  for (let i = -ROOF_TILE_HALF_COUNT; i <= ROOF_TILE_HALF_COUNT; i += 1) {
    const f = i / ROOF_TILE_HALF_COUNT;
    ctx.beginPath();
    ctx.moveTo(cxU + f * widthU * ROOF_TILE_TOP_SPREAD, yU - heightU * ROOF_TILE_TOP_HEIGHT);
    ctx.quadraticCurveTo(
      cxU + f * widthU * ROOF_TILE_MID_SPREAD, yU - heightU * ROOF_TILE_MID_HEIGHT,
      cxU + f * widthU * ROOF_TILE_END_SPREAD, yU - heightU * ROOF_TILE_END_HEIGHT,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * engine.js:1224 단청 4색. 둘째 칸은 `PALETTE.jeokDim`과 값이 같아 팔레트에서 읽는다 —
 * 그쪽 주석이 "형태 전용, 규칙 없음"이라 단청 띠와 같은 성격이고, 색의 단일 소스는 palette.ts다.
 */
const DANCHEONG_BANDS = ['#2e6b5e', PALETTE.jeokDim, '#c8bda6', '#2e6b5e'] as const;
const DANCHEONG_BAND_COUNT = 14;
const DANCHEONG_BAND_ALPHA = 0.32;
const DANCHEONG_BAND_GAP_U = 1;

/** 이식: engine.js dancheong (1223-1231) — 그대로. **정적.** 처마 밑 보에 두른 단청 띠 */
export function dancheong(
  ctx: CanvasRenderingContext2D,
  x0U: number,
  x1U: number,
  yU: number,
  heightU: number,
): void {
  const bandW = (x1U - x0U) / DANCHEONG_BAND_COUNT;
  for (let i = 0; i < DANCHEONG_BAND_COUNT; i += 1) {
    ctx.fillStyle = hexA(DANCHEONG_BANDS[i % DANCHEONG_BANDS.length]!, DANCHEONG_BAND_ALPHA);
    ctx.fillRect(x0U + i * bandW, yU, bandW - DANCHEONG_BAND_GAP_U, heightU);
  }
}

/** engine.js:1238-1247 불티. 상승 속도·가로 흔들림·크기·밝기가 전부 난수다 */
const EMBER_SPEED_MIN_U = 20;
const EMBER_SPEED_SPAN_U = 60;
const EMBER_RISE_WRAP_TURNS = 3;
const EMBER_SWAY_RATE = 0.6;
const EMBER_SWAY_U = 22;
const EMBER_ALPHA_FLOOR = 0.35;
const EMBER_ALPHA_SPAN = 0.65;
const EMBER_RADIUS_MIN_U = 1.1;
const EMBER_RADIUS_SPAN_U = 1.5;

/**
 * 이식: engine.js embers (1234-1250) — 난수를 주입식으로 바꿨다(D-05). **동적.**
 *
 * 떠다니는 티끌. 잔해가 아니라 공기에 적용한 Vlambeer식 잔존물이다.
 *
 * **`makeStream`은 인스턴스가 아니라 팩토리여야 한다.** 이 함수는 매 프레임 불리고, 매번
 * 수열을 처음부터 다시 돌려 티끌 n개의 기준 위치·속도·크기를 고정한다. 움직이는 것은 `t`뿐이다.
 * 인스턴스를 넘기면 프레임마다 수열이 이어져 티끌 전체가 매 프레임 순간이동한다.
 *
 * **`t`는 스테이지 진입 기준 경과 시간이어야 한다.** 상승 모드의 감기 식이
 * `(by − t·sp + PF.H·3) % PF.H`인데, JS의 `%`는 좌변이 음수면 음수를 낸다. 가장 느린 티끌
 * (sp = 20)에서 `t·sp`가 `PF.H·3 = 5760`을 넘는 순간, 즉 **t > 288초**부터 y가 음수로 나와
 * 티끌이 화면 위로 사라진다. 런 전체 누적 시간을 넘기면 후반 스테이지에서 배경이 비어 버린다.
 */
export function embers(
  ctx: CanvasRenderingContext2D,
  tSec: number,
  count: number,
  color: string,
  alpha: number,
  makeStream: SeededStreamFactory,
  rise: boolean,
): void {
  const stream = makeStream();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i += 1) {
    const baseX = stream.float() * PLAYFIELD_WIDTH_U;
    const baseY = stream.float() * PLAYFIELD_HEIGHT_U;
    const speed = EMBER_SPEED_MIN_U + stream.float() * EMBER_SPEED_SPAN_U;
    const y = rise
      ? (baseY - tSec * speed + PLAYFIELD_HEIGHT_U * EMBER_RISE_WRAP_TURNS) % PLAYFIELD_HEIGHT_U
      : (baseY + tSec * speed) % PLAYFIELD_HEIGHT_U;
    const x = baseX + Math.sin(tSec * EMBER_SWAY_RATE + i) * EMBER_SWAY_U;
    ctx.fillStyle = hexA(color, alpha * (EMBER_ALPHA_FLOOR + stream.float() * EMBER_ALPHA_SPAN));
    ctx.beginPath();
    ctx.arc(x, y, EMBER_RADIUS_MIN_U + stream.float() * EMBER_RADIUS_SPAN_U, 0, FULL_TURN_RAD);
    ctx.fill();
  }
  ctx.restore();
}

/** engine.js:1257-1265 포말. 물결 위에 얹는 짧은 밝은 호 */
const FOAM_LINE_WIDTH_U = 2.5;
const FOAM_MARGIN_U = 60;
const FOAM_PITCH_U = 190;
const FOAM_DRIFT_RATE = 0.7;
const FOAM_ROW_PHASE_STEP = 1.3;
const FOAM_DRIFT_U = 40;
const FOAM_ROW_SHIFT_U = 95;
const FOAM_ARC_RADIUS_U = 34;
const FOAM_ARC_FROM = 1.12;
const FOAM_ARC_TO = 1.88;

/**
 * 이식: engine.js foam (1253-1268) — 그대로. **동적.**
 *
 * 부서지는 물마루. `t`가 들어가므로 굽기 대상이 아니다. S5에서 프레임당 28 stroke이고,
 * 청해파문과 합쳐 배경 호출의 74%를 차지한다(06 §3.2).
 */
export function foam(
  ctx: CanvasRenderingContext2D,
  y0U: number,
  rows: number,
  stepU: number,
  tSec: number,
  alpha: number,
): void {
  ctx.save();
  ctx.strokeStyle = hexA(PALETTE.baek, alpha);
  ctx.lineWidth = FOAM_LINE_WIDTH_U;
  ctx.lineCap = 'round';
  for (let row = 0; row < rows; row += 1) {
    const y = y0U + row * stepU;
    const driftU = Math.sin(tSec * FOAM_DRIFT_RATE + row * FOAM_ROW_PHASE_STEP) * FOAM_DRIFT_U
      + (row % 2) * FOAM_ROW_SHIFT_U;
    for (let x = -FOAM_MARGIN_U; x < PLAYFIELD_WIDTH_U + FOAM_MARGIN_U; x += FOAM_PITCH_U) {
      ctx.beginPath();
      ctx.arc(x + driftU, y, FOAM_ARC_RADIUS_U, Math.PI * FOAM_ARC_FROM, Math.PI * FOAM_ARC_TO);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 세로 그라디언트의 한 정지점. 목업이 `[offset, color]` 배열을 쓰므로 그 형태를 유지한다 */
export type GradientStop = readonly [number, string];

/**
 * 이식: engine.js vgrad (1270-1275) — 그대로. **정적. 그리고 정적이어야만 한다.**
 *
 * 스테이지 하늘. `createLinearGradient`가 호출마다 객체를 하나 만들고, 06 §3.3이 "매 draw마다
 * gradient를 만들면 가비지가 생긴다"를 금지 목록에 올렸다. 그럼에도 목업 그대로 두는 근거는
 * 하나뿐이다 — **이 함수는 스테이지 진입 시 정적 굽기 안에서 1회만 돈다**(06 §3.2).
 * 매 프레임 경로에서 부르면 그 근거가 사라지고 금지 항목이 된다. 프레임당 gradient 생성 1회는
 * Firefox에서 `fillRect` 대비 100배다.
 */
export function vgrad(ctx: CanvasRenderingContext2D, stops: readonly GradientStop[]): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, PLAYFIELD_HEIGHT_U);
  for (const stop of stops) {
    gradient.addColorStop(stop[0], stop[1]);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PLAYFIELD_WIDTH_U, PLAYFIELD_HEIGHT_U);
}

/** engine.js:1660-1662 비네트의 중심·반경·가장자리 농도 */
const VIGNETTE_CENTER_Y_SCALE = 0.52;
const VIGNETTE_INNER_RADIUS_SCALE = 0.24;
const VIGNETTE_OUTER_RADIUS_SCALE = 0.72;
const VIGNETTE_EDGE_ALPHA = 0.55;

/** 06 §3.4 — 540×960으로 굽는다. 메모리 8.3MB가 2.1MB가 되고 확대 보간은 안 보인다 */
const VIGNETTE_BAKE_SCALE = 0.5;

/** 부팅에서 한 번 구워 계속 쓴다. 비어 있으면 다음 vignette() 호출이 굽는다 */
let vignetteSprite: CanvasImageSource | null = null;

/**
 * 이식: engine.js vignette (1659-1665) — 매 프레임 radial gradient fill을 구운 것 한 장으로
 * 바꿨다(06 §3.4). **호출은 여기가 아니라 `render/frame.ts`의 레이어 10이다**(12 §2).
 *
 * 모서리를 어둡게 해 아주 긴 세로 화면의 가운데로 눈을 모은다.
 *
 * 굽기는 논리 단위 고정이라 DPR이 바뀌어도 그림이 같지만, 06 §3.4가 DPR 변경 시 재굽기를
 * 지시했고 `boot/canvas.ts`의 `onViewChanged`가 구운 레이어를 한자리에서 버리므로
 * `invalidateVignette`을 같이 낸다. 다시 굽는 비용은 gradient fill 1회다.
 *
 * **사각 띠 4장으로 자르지 않는다.** 안쪽 반경 460.8u 안은 알파가 정확히 0이라 한 변 651.6u의
 * 정사각형을 비워도 화면이 안 달라지지만, 그러면 `fill`이 1회에서 4회로 는다. 실측은 픽셀이
 * 남아돌고(fill-rate 여유 10.5배) 호출이 모자란다고 말한다 — 남는 자원을 사고 모자란 자원을
 * 파는 거래라 순손해다(06 §3.4, 13 §4.1).
 */
export function vignette(ctx: CanvasRenderingContext2D): void {
  if (vignetteSprite === null) {
    vignetteSprite = bakeVignetteSprite();
  }
  ctx.drawImage(vignetteSprite, 0, 0, PLAYFIELD_WIDTH_U, PLAYFIELD_HEIGHT_U);
}

/** 부팅이 부른다. 안 부르면 첫 프레임이 굽느라 튄다 */
export function bakeVignette(): void {
  vignetteSprite = bakeVignetteSprite();
}

/** backing store를 다시 만든 직후 부른다. 다음 vignette() 호출이 새로 굽는다 */
export function invalidateVignette(): void {
  vignetteSprite = null;
}

function bakeVignetteSprite(): CanvasImageSource {
  const widthU = PLAYFIELD_WIDTH_U * VIGNETTE_BAKE_SCALE;
  const heightU = PLAYFIELD_HEIGHT_U * VIGNETTE_BAKE_SCALE;
  const { canvas, ctx } = createOffscreen(widthU, heightU);
  const centerX = widthU / 2;
  const centerY = heightU * VIGNETTE_CENTER_Y_SCALE;
  const gradient = ctx.createRadialGradient(
    centerX, centerY, heightU * VIGNETTE_INNER_RADIUS_SCALE,
    centerX, centerY, heightU * VIGNETTE_OUTER_RADIUS_SCALE,
  );
  gradient.addColorStop(0, hexA(VIGNETTE_INK, 0));
  gradient.addColorStop(1, hexA(VIGNETTE_INK, VIGNETTE_EDGE_ALPHA));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, widthU, heightU);
  return canvas;
}

interface Offscreen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

/** 캔버스 크기는 정수 픽셀이라 올림한다. 내림하면 오른쪽·아래 한 줄이 잘린다 */
function createOffscreen(widthU: number, heightU: number): Offscreen {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthU);
  canvas.height = Math.ceil(heightU);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('배경 오프스크린 2d 컨텍스트를 얻지 못했다');
  }
  return { canvas, ctx };
}
