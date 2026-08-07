/**
 * 예고 도형 — 목업 engine.js drawTelegraph 이식 (06_렌더링과_게임필.md §1.7)
 *
 * **여기 있는 세 도형이 HR-05가 허용하는 예고의 전부다.** 착탄 예고 원(P7) · 관통 예고선(P12) ·
 * 돌진 방향선(본체) 셋뿐이고, 셋의 공통점은 패리로 지울 수 없어 회피만이 대응책이라는 것이다
 * (스펙 §6.2). 반대로 **일반 탄환에는 어떤 예고 도형도 그리지 않는다** — 조준선도, 궤적선도,
 * 착탄 원도 없다. 날아오는 탄을 보고 받아치는 것이 이 게임의 기본 행위이고, 궤적을 그려 주면
 * 그 판단이 통째로 사라진다. 넷째 도형을 넣으려면 스펙 §2의 하드 규칙부터 고쳐야 한다.
 *
 * 예고와 예비동작은 다른 것이다. 예고는 **어디에** 닿을지를 도형으로 그리고, 예비동작은
 * **언제** 나올지만 적 본체의 상태 변화로 알린다(§15.1 · 12_통합_계약.md §7.5-정정).
 * 그래서 예비동작은 이 파일이 아니라 render/enemy.ts에 있다.
 *
 * pierceLine의 0.4초 관통 **본체**는 여기가 아니라 render/bullet.ts의 drawLance가 그린다.
 * 수명·판정·레이어가 다르기 때문이다 — 예고는 4번 층, 본체는 6번 층이다(06 §2 · §5.4).
 *
 * 좌표는 월드 프레임이다. 호출부(render/frame.ts)가 흔들림 변환만 걸어 둔 상태를 가정한다.
 */

import type { TelegraphId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { clamp01 } from '../core/math';
import { hatch, hexA, poly } from './primitives';
import type { PolyPoint } from './primitives';

/**
 * sim이 들고 있는 예고 하나를 render가 읽는 모양. 필드는 전부 readonly다 — render는 sim
 * 상태를 한 줄도 바꾸지 않는다(HR-06).
 *
 * 목업의 `g` 객체(engine.js:1026)를 그대로 옮긴 평평한 구조다. 종류별로 읽는 칸이 다르고,
 * 안 읽는 칸의 값은 무시된다. 판별 union으로 쪼개지 않은 것은 sim의 예고가 풀에서 나온
 * 가변 구조체 하나이기 때문이다(sim/bullets.ts Projectile과 같은 형태).
 */
export interface TelegraphView {
  /** §6.2 예고 3종. config/ids.ts의 TelegraphId가 유일 소스다 */
  readonly kind: TelegraphId;
  /** 도형이 뜬 뒤 경과한 sim 시간 (초) */
  readonly ageSec: number;
  /**
   * 이 도형이 떠 있는 총 시간 (초). 유일 소스는 config/telegraph.ts의
   * TELEGRAPH.shapes[kind].durationSec이고 sim이 그 표에서 읽어 넣는다.
   * render가 직접 표를 읽지 않는 것은 남은 시간의 소유자가 sim이기 때문이다.
   */
  readonly durationSec: number;
  /** 도형의 기준점 (u). impactCircle은 착탄 중심, dash는 돌진 시작점 */
  readonly xU: number;
  readonly yU: number;
  /** impactCircle만 읽는다 — 착탄 원의 반경 (u). 이 원이 곧 폭발 반경이다 */
  readonly radiusU: number;
  /** pierceLine만 읽는다 — 예고선의 폭 (u). §6.1이 40u로 못 박았다 */
  readonly widthU: number;
  /** dash만 읽는다 — 돌진 방향 (rad)과 방향선 길이 (u) */
  readonly angleRad: number;
  readonly lengthU: number;
}

/** 목업은 원을 6.284로 닫는다(engine.js:1035). 2π로 적어도 같은 원이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;

/**
 * 진행률이 이 값을 넘으면 백색이 적색으로 바뀐다 — §15.1의 "발동 직전 강조"가 이 한 줄이다.
 * 0.82는 1.2초 원에서 0.22초, 0.8초 예고선에서 0.14초 전이다. 색이 바뀌는 것은 도형이
 * 사라지는 순간이 아니라 **피할 수 있는 마지막 순간**을 알리기 위해서다.
 */
const IMMINENT_RATIO = 0.82;

/**
 * 점선. 예고 도형이 실선을 안 쓰는 것이 형태 축의 첫째다 — §17이 "패리 불가 대상은 패리 가능
 * 탄환과 형태로 구분되어야 한다. 색만으로 구분하지 않는다"를 요구했고, 탄환은 어느 것도
 * 점선 윤곽을 갖지 않는다. setLineDash가 가변 배열만 받으므로 모듈에 한 벌 두고 재사용한다 —
 * 매 호출 리터럴로 적으면 프레임마다 배열이 생긴다.
 */
const TELEGRAPH_DASH: number[] = [14, 10];
const NO_DASH: number[] = [];

/** 점선이 흐르는 속도 (u/s). 정지한 점선은 배경 패턴으로 읽히고, 흐르면 "지금 켜져 있다"가 된다 */
const DASH_MARCH_U_PER_SEC = 40;

/** 윤곽선 폭 (u)과 알파. 알파가 진행률과 함께 0.45 → 0.95로 오른다 */
const OUTLINE_WIDTH_U = 3;
const OUTLINE_ALPHA_BASE = 0.45;
const OUTLINE_ALPHA_GAIN = 0.5;

/** 착탄 원 안쪽 채움 알파. 0.10 → 0.24 */
const CIRCLE_FILL_ALPHA_BASE = 0.1;
const CIRCLE_FILL_ALPHA_GAIN = 0.14;

/**
 * 예고선이 화면 위아래로 더 나가는 길이 (u). 대창은 **끝이 없는 직선**이라는 것이 형태 규칙이고
 * (06 §5.4), 화면 안에서 끊기면 그 규칙이 깨진다. 총 높이는 PLAYFIELD.heightU + 이 값 × 2다.
 */
const LANCE_OVERHANG_U = 60;

/** 예고선 안쪽 빗금 알파. 0.10 → 0.20 */
const LANCE_HATCH_ALPHA_BASE = 0.1;
const LANCE_HATCH_ALPHA_GAIN = 0.1;

/** 돌진 방향선 끝의 화살촉 알파 */
const ARROW_ALPHA = 0.8;

/**
 * 화살촉 삼각형 (engine.js:1058). 좌표는 방향선 끝점을 원점으로 하고 돌진 방향으로 회전한
 * 프레임의 값이라 화면 좌표가 아니다 — 실루엣 제어점이므로 이름을 주지 않고 목업 그대로 둔다
 * (03_파일_구조.md §2.3, render/enemy-parts.ts 머리말과 같은 판단).
 */
const DASH_ARROW: readonly PolyPoint[] = [
  [0, 0],
  [-34, -17],
  [-34, 17],
];

/**
 * 이식: docs/sample_image/_shared/engine.js drawTelegraph (1026-1063) — 그대로
 *
 * 세 갈래 전부가 하나의 save/restore 안에서 끝나므로 호출부의 ctx 상태는 보존된다.
 * 점선·선폭·색은 갈래 앞에서 한 번만 정하고, 각 갈래는 그 위에서 이어 그린다.
 */
export function drawTelegraph(ctx: CanvasRenderingContext2D, g: TelegraphView): void {
  const k = clamp01(g.ageSec / g.durationSec);
  // 백색은 §6.2가 예고 3종에 배정한 색이다. 적색으로 바뀌는 순간이 곧 발동 예고다
  const col = k > IMMINENT_RATIO ? PALETTE.jeok : PALETTE.baek;
  ctx.save();
  ctx.strokeStyle = hexA(col, OUTLINE_ALPHA_BASE + k * OUTLINE_ALPHA_GAIN);
  ctx.lineWidth = OUTLINE_WIDTH_U;
  ctx.setLineDash(TELEGRAPH_DASH);
  ctx.lineDashOffset = -g.ageSec * DASH_MARCH_U_PER_SEC;

  switch (g.kind) {
    case 'impactCircle': {
      // 바깥 점선이 폭발 반경 그 자체다 — §17의 "피해 판정 범위와 표시 범위가 일치"가 걸린 자리다
      ctx.beginPath();
      ctx.arc(g.xU, g.yU, g.radiusU, 0, FULL_TURN_RAD);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      // 안쪽 채움이 반경 r×k로 자란다. 바깥 점선에 닿는 순간이 터지는 순간이므로,
      // 남은 시간을 숫자 없이 거리로 읽는다
      ctx.fillStyle = hexA(col, CIRCLE_FILL_ALPHA_BASE + k * CIRCLE_FILL_ALPHA_GAIN);
      ctx.beginPath();
      ctx.arc(g.xU, g.yU, g.radiusU * k, 0, FULL_TURN_RAD);
      ctx.fill();
      break;
    }
    case 'pierceLine': {
      // 이 사각형의 폭이 0.4초 뒤 관통 판정의 폭과 같다(config/telegraph.ts activeSec 주석).
      // 예고보다 좁게 그리면 "예고 밖인데 맞았다"가 되고, 넓게 그리면 반대가 된다
      const topYU = -LANCE_OVERHANG_U;
      const heightU = PLAYFIELD.heightU + LANCE_OVERHANG_U * 2;
      ctx.strokeRect(g.xU - g.widthU / 2, topYU, g.widthU, heightU);
      ctx.setLineDash(NO_DASH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.xU - g.widthU / 2, topYU, g.widthU, heightU);
      ctx.clip();
      // 빗금은 장판과 공유하는 "패리 불가" 표기다(render/zone.ts). 색이 아니라 결이 신호다
      ctx.globalAlpha = LANCE_HATCH_ALPHA_BASE + k * LANCE_HATCH_ALPHA_GAIN;
      ctx.fillStyle = hatch();
      ctx.fillRect(g.xU - g.widthU / 2, topYU, g.widthU, heightU);
      ctx.restore();
      break;
    }
    case 'dash': {
      // 선의 끝점이 돌진이 멈추는 자리다. HR-04가 요구한 안전 지대는 이 선 밖의 화면 전부다
      const endXU = g.xU + Math.cos(g.angleRad) * g.lengthU;
      const endYU = g.yU + Math.sin(g.angleRad) * g.lengthU;
      ctx.beginPath();
      ctx.moveTo(g.xU, g.yU);
      ctx.lineTo(endXU, endYU);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.fillStyle = hexA(col, ARROW_ALPHA);
      ctx.save();
      ctx.translate(endXU, endYU);
      ctx.rotate(g.angleRad);
      poly(ctx, DASH_ARROW);
      ctx.fill();
      ctx.restore();
      break;
    }
  }
  ctx.restore();
}
