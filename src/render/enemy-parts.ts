/**
 * 적 부품 — 잡몹과 보스가 함께 쓰는 그리기 조각 (06_렌더링과_게임필.md §1.5 · §1.6)
 *
 * 앞의 다섯은 목업 함수 하나가 여기 함수 하나에 대응한다. 좌표는 개체 로컬 프레임이다 —
 * 원점이 개체 중심이고 `ctx.translate(e.x, e.y)`는 호출부가 이미 걸어 둔 상태여야 한다
 * (engine.js:401). 뒤의 HP 바 둘만 그 밖, 즉 월드 좌표를 받는다(engine.js:829 `ctx.restore()` 뒤).
 *
 * **HP 바가 실루엣 부품과 한 파일에 있는 이유.** 잡몹(render/enemy.ts)과 보스 부위
 * (render/boss.ts)가 같은 바를 쓰는데 두 파일은 서로를 import할 수 없다. 12_통합_계약.md §2가
 * 그 충돌을 여기로 옮겼고, 이 파일은 이미 두 파일의 선행이다.
 *
 * **이 함수들은 ctx 상태를 되돌리지 않는다. save/restore로 감싸면 승인된 그림이 바뀐다.**
 * 목업의 case 코드가 부품이 남긴 fillStyle·strokeStyle·lineWidth 위에서 이어 그린다 —
 * 예를 들어 gunner 몸통의 fill/stroke(engine.js:439-440)는 429-430이 정한 body/hot이 아니라
 * 바로 앞 sashimono(438)가 남긴 값이다. 상태 누수가 결과물의 일부다.
 *
 * 실루엣 좌표의 계수(0.42 · 1.35 · 0.075 …)는 이름을 주지 않고 목업 그대로 둔다.
 * 아트 경로의 제어점이라 이름을 붙여도 뜻이 늘지 않고, 원본과의 줄 단위 대조만 끊긴다
 * (03_파일_구조.md §2.3). 규칙을 나르는 값 — HP 바 치수와 색 — 만 이름을 갖는다.
 */

import { PALETTE } from '../config/palette';
import { UI } from '../config/ui';
import { clamp01, lerp } from '../core/math';
import { hexA, label } from './primitives';
import type { LabelStyle } from './primitives';

/** 목업은 원을 6.284로 닫는다(engine.js:377·384·394). 2π로 적어도 같은 원이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;

/**
 * 진가사 챙 밑면과 마스크 판의 검정. 목업은 `rgba(5,7,12,0.55)`(332)와 `#05070c`(344)를
 * 직접 적었는데 render/에 색 리터럴을 둘 수 없어 ink900으로 읽는다. 채널 차이는 (1,0,2)다.
 * 둘 다 실루엣에 뚫린 구멍이 바탕 검정으로 읽히게 하는 자리라 바탕색과 같은 토큰이 맞다.
 */
const BRIM_UNDERSIDE = hexA(PALETTE.ink900, 0.55);

/** 지름을 4번 그으므로 살은 8개다. 각 간격이 π/4인 것이 그 뜻이다 (engine.js:386-387) */
const WHEEL_DIAMETER_COUNT = 4;

/** 사시모노 깃발. 세 알파가 서로 다른 위계를 만든다 — 천 < 테두리 < 문장 */
const BANNER_CLOTH = hexA(PALETTE.jeokDim, 0.55);
const BANNER_EDGE = hexA(PALETTE.jeok, 0.7);
const BANNER_CREST = hexA(PALETTE.jeok, 0.85);

/**
 * 잡몹 HP 바 (engine.js:831-836). 폭·높이가 실루엣 폭 `def.w`의 배수라 config/ui.ts에 없다 —
 * 그 파일은 화면 좌표를 들고, 실루엣 폭은 render/enemy.ts가 소유한다(config/enemies.ts 머리말).
 */
const HP_BAR_WIDTH_SCALE = 1.2;
const HP_BAR_OFFSET_Y_SCALE = 0.9;
const HP_BAR_HEIGHT_U = 5;
const HP_BAR_TRACK = hexA(PALETTE.baek, 0.16);

/**
 * 부위 게이지 라벨. 굵기 500은 §15.1의 다른 보조 라벨(점수 라벨·스테이지·보스 이름)과 같은 단이다.
 * 매 프레임 새 객체를 만들지 않도록 모듈 상수로 한 벌만 든다(primitives.ts LabelStyle 주석).
 */
const PART_GAUGE_LABEL: LabelStyle = {
  color: PALETTE.baekMute,
  sizePx: UI.hud.partGauge.labelPx,
  weight: 500,
  align: 'center',
};

/** 파괴된 포문의 라벨. 숫자가 '0 / 300'이 아니라 이 글자로 바뀌는 것이 색 밖의 구분축이다 */
const PART_DESTROYED_TEXT = '파괴';

/**
 * 이식: docs/sample_image/_shared/engine.js jingasa (322-339) — 그대로
 *
 * 진가사 — 잡몹 전원이 공유하는 세 신호 중 첫째다. 챙 밑면을 한 번 더 칠하는 것은 모자에
 * 두께를 주기 위해서이고, 이것이 없으면 챙이 몸통에 그려진 선으로 보인다.
 */
export function jingasa(
  ctx: CanvasRenderingContext2D,
  brimYU: number,
  halfSpanU: number,
  dropU: number,
  hotColor: string,
): void {
  ctx.fillStyle = hotColor;
  ctx.beginPath();
  ctx.moveTo(-halfSpanU, brimYU);
  ctx.quadraticCurveTo(-halfSpanU * 0.42, brimYU - dropU * 1.35, 0, brimYU - dropU);
  ctx.quadraticCurveTo(halfSpanU * 0.42, brimYU - dropU * 1.35, halfSpanU, brimYU);
  ctx.quadraticCurveTo(0, brimYU + dropU * 0.42, -halfSpanU, brimYU);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BRIM_UNDERSIDE;
  ctx.beginPath();
  ctx.moveTo(-halfSpanU, brimYU);
  ctx.quadraticCurveTo(0, brimYU + dropU * 0.42, halfSpanU, brimYU);
  ctx.quadraticCurveTo(0, brimYU + dropU * 0.68, -halfSpanU, brimYU);
  ctx.closePath();
  ctx.fill();
}

/**
 * 이식: docs/sample_image/_shared/engine.js visor (343-349) — 그대로
 *
 * 마스크 판에 눈구멍 둘. 두 구멍이 `hotColor`라서 §15.1의 발사 예비동작이 얼굴에서도 읽힌다 —
 * 호출부가 `e.charge > 0`일 때 jeokHot을 넘기므로 이 판이 본체와 함께 밝아진다(engine.js:425).
 */
export function visor(
  ctx: CanvasRenderingContext2D,
  widthU: number,
  topYU: number,
  hotColor: string,
): void {
  ctx.fillStyle = PALETTE.ink900;
  ctx.fillRect(-widthU * 0.23, topYU, widthU * 0.46, widthU * 0.15);
  ctx.fillStyle = hotColor;
  ctx.fillRect(-widthU * 0.18, topYU + widthU * 0.05, widthU * 0.1, widthU * 0.05);
  ctx.fillRect(widthU * 0.08, topYU + widthU * 0.05, widthU * 0.1, widthU * 0.05);
}

/**
 * 이식: docs/sample_image/_shared/engine.js lamellae (352-361) — 그대로
 *
 * 찰갑 — 가로 엮음줄. `halfWidthU`는 반폭이다(원본이 `-w`에서 `w`까지 긋는다).
 * 줄은 `rowCount`개이고 위아래 끝에는 놓이지 않는다 — `i / (rowCount + 1)`이 그 뜻이다.
 */
export function lamellae(
  ctx: CanvasRenderingContext2D,
  halfWidthU: number,
  topYU: number,
  bottomYU: number,
  rowCount: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  for (let i = 1; i <= rowCount; i += 1) {
    const yU = lerp(topYU, bottomYU, i / (rowCount + 1));
    ctx.beginPath();
    ctx.moveTo(-halfWidthU, yU);
    ctx.lineTo(halfWidthU, yU);
    ctx.stroke();
  }
}

/**
 * 이식: docs/sample_image/_shared/engine.js sashimono (364-379) — 그대로
 *
 * 사시모노 — 등에 세운 깃발. `widthU`·`heightU`는 개체의 전체 폭·높이이고 깃대는 오른쪽으로만
 * 선다. 좌우 대칭이 아닌 유일한 부품이라 실루엣의 방향이 여기서 정해진다.
 */
export function sashimono(
  ctx: CanvasRenderingContext2D,
  widthU: number,
  heightU: number,
  poleColor: string,
): void {
  ctx.strokeStyle = poleColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(widthU * 0.36, -heightU * 0.1);
  ctx.lineTo(widthU * 0.36, -heightU * 0.78);
  ctx.stroke();
  ctx.fillStyle = BANNER_CLOTH;
  ctx.fillRect(widthU * 0.36, -heightU * 0.78, widthU * 0.32, heightU * 0.36);
  ctx.strokeStyle = BANNER_EDGE;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(widthU * 0.36, -heightU * 0.78, widthU * 0.32, heightU * 0.36);
  ctx.fillStyle = BANNER_CREST;
  ctx.beginPath();
  ctx.arc(widthU * 0.52, -heightU * 0.6, widthU * 0.075, 0, FULL_TURN_RAD);
  ctx.fill();
}

/**
 * 이식: docs/sample_image/_shared/engine.js spokedWheel (381-395) — 그대로
 *
 * 수레바퀴 — 좌표가 로컬 원점이 아니라 인자로 온다. E-E 화포병이 좌우 두 짝을 부르기 때문이다
 * (engine.js:560-561).
 */
export function spokedWheel(
  ctx: CanvasRenderingContext2D,
  xU: number,
  yU: number,
  radiusU: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(xU, yU, radiusU, 0, FULL_TURN_RAD);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < WHEEL_DIAMETER_COUNT; i += 1) {
    const angleRad = (i / WHEEL_DIAMETER_COUNT) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(xU - Math.cos(angleRad) * radiusU, yU - Math.sin(angleRad) * radiusU);
    ctx.lineTo(xU + Math.cos(angleRad) * radiusU, yU + Math.sin(angleRad) * radiusU);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(xU, yU, radiusU * 0.22, 0, FULL_TURN_RAD);
  ctx.fill();
}

/**
 * 이식: docs/sample_image/_shared/engine.js HP 바 (830-836) — 파일만 옮겼다 (06 §1.6)
 *
 * **월드 좌표로 부른다.** 개체 로컬 변환 밖, 즉 목업의 `ctx.restore()`(829) 뒤 자리다.
 *
 * 그리지 않는 갈래 셋이 전부 규칙이다.
 * - `noBar` — 보스 본체는 §15.1대로 화면 상단 바를 쓴다(drawHud 1703-1718). B1 부하 조총병
 *   5기도 여기 걸린다: HP를 개별로 갖지 않고 B1 단일 풀을 공유한다(12 §8-16).
 * - `maxHp <= 0` — HP가 없는 개체다.
 * - `hp >= maxHp` — 온전한 적에는 바를 띄우지 않는다. 바가 뜬 것 자체가 "이건 이미 때렸다"는
 *   신호이고, 전 화면에 상시로 깔면 그 신호가 사라진다.
 *
 * 굽기 대상이 아니다. 채움 폭이 `hp / maxHp` 종속이라 프레임마다 다르고, 06 §3.5의 드로우 콜
 * 예산은 이 함수가 개체당 2회를 쓰는 것으로 잡혀 있다. 늘리지 않는다.
 */
export function drawEnemyHpBar(
  ctx: CanvasRenderingContext2D,
  xU: number,
  yU: number,
  silhouetteWidthU: number,
  hp: number,
  maxHp: number,
  noBar: boolean,
): void {
  if (noBar || maxHp <= 0 || hp >= maxHp) {
    return;
  }
  const barWidthU = silhouetteWidthU * HP_BAR_WIDTH_SCALE;
  const leftU = xU - barWidthU / 2;
  const topU = yU - silhouetteWidthU * HP_BAR_OFFSET_Y_SCALE;
  ctx.fillStyle = HP_BAR_TRACK;
  ctx.fillRect(leftU, topU, barWidthU, HP_BAR_HEIGHT_U);
  ctx.fillStyle = PALETTE.jeok;
  // 과잉 피해로 hp가 음수가 된 프레임에도 채움은 [0, 전체] 안이다. 막대의 표시 계약이다
  ctx.fillRect(leftU, topU, barWidthU * clamp01(hp / maxHp), HP_BAR_HEIGHT_U);
}

/**
 * 신규: 파괴 가능 부위의 개별 게이지 — 스펙 §15.1 · 06 §1.6 `port`
 *
 * §15.1이 "B3 포문처럼 개별 HP를 가진 부위는 개별 게이지 표시"를 요구한다. 위의 잡몹 바와
 * 같은 갈래를 부위에 적용한 것인데, 세 가지가 다르다.
 *
 * - **온전해도 그린다.** 포문 4기 중 몇을 부쉈는지가 §10.4의 P2 진입 조건(포문 2개 파괴)
 *   그 자체라서, 아직 안 때린 포문이 안 보이면 남은 목표를 셀 수 없다.
 * - **파괴돼도 지우지 않는다.** 같은 이유다 — 빈 바 + 「파괴」가 진행도를 남긴다(config/ui.ts).
 * - **숫자를 붙인다.** 포문 HP는 300 고정이고(§10.4), 반사탄 한 발이 몇 %인지를 눈금 없는
 *   막대로는 못 읽는다.
 *
 * `centerXU`·`centerYU`는 부위 중심이다. 게이지는 부위에 붙어 다니므로 화면 흔들림 **안쪽**에
 * 그린다 — 호출부가 흔들림 변위를 이미 건 프레임에서 부르면 그렇게 된다(10 A22).
 * 회전이 걸린 변환 안에서 부르면 라벨이 함께 돈다. B3 선체는 순수 평행이동이라 걸리지 않는다.
 */
export function drawPartHpGauge(
  ctx: CanvasRenderingContext2D,
  centerXU: number,
  centerYU: number,
  hp: number,
  maxHp: number,
): void {
  const gauge = UI.hud.partGauge;
  const leftU = centerXU - gauge.widthU / 2;
  const topU = centerYU + gauge.offsetYU;
  ctx.fillStyle = HP_BAR_TRACK;
  ctx.fillRect(leftU, topU, gauge.widthU, gauge.heightU);
  ctx.fillStyle = PALETTE.jeok;
  ctx.fillRect(leftU, topU, gauge.widthU * clamp01(hp / maxHp), gauge.heightU);

  // 올림이라 0.4가 남은 포문은 '0'이 아니라 '1'로 뜬다. 살아 있는데 0으로 읽히면 안 된다
  const remaining = Math.ceil(hp);
  const text = remaining > 0 ? `${remaining} / ${maxHp}` : PART_DESTROYED_TEXT;
  label(ctx, centerXU, centerYU + gauge.labelOffsetYU, text, PART_GAUGE_LABEL);
}
