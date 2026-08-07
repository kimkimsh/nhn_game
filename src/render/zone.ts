/**
 * 장판 — 목업 engine.js drawZone 이식 (06_렌더링과_게임필.md §1.4)
 *
 * **패리 불가 위협은 탄환과 실루엣을 공유하지 않는다.** 탄환은 전부 원과 호인데 장판은
 * 각진 7각형이고, 그 안이 대각 빗금으로 채워져 있다. §17이 "패리 불가 대상은 패리 가능
 * 탄환과 형태로 구분되어야 한다. 색만으로 구분하지 않는다"를 요구했고, 채움색 탁적(#7a2b1e)은
 * 적 탄환의 적(#e23c2e)과 계열이 같아 색만으로는 실제로 구분되지 않는다. 형태가 신호다.
 *
 * **7각형은 한 픽셀도 바꾸지 않는다.** 목업의 반경이 꼭짓점마다 z.r의 0.86 ~ 1.085로 흔들려
 * 표시 경계가 피해 판정 반경과 −14% / +8.5% 어긋났다(engine.js:295). §17이 "피해 판정 범위와
 * 표시 범위가 일치해야 한다"를 요구하므로 **고치는 쪽은 그림이 아니라 판정이다** —
 * sim/zones.ts가 여기서 그리는 외곽선 자체를 판정으로 쓴다(12_통합_계약.md §8-6,
 * 10_스펙_목업_불일치.md A20 ⓐ). 계수 재조정과 z.r 실선 원 추가는 취소된 안이다.
 *
 * 그래서 이 파일과 sim/zones.ts는 **같은 꼭짓점**을 만들어야 하고, 유일한 소스가
 * config/feel.ts의 ZONE이다. 아래 buildZonePolygon의 두 줄이 그 파일 머리말에 적힌 식
 * 그대로이며, 곱셈 순서까지 같아야 두 쪽의 부동소수 결과가 비트 단위로 일치한다.
 *
 * 좌표는 월드 프레임이다. 호출부(render/frame.ts)가 흔들림 변환만 걸어 둔 상태를 가정한다.
 */

import { ZONE } from '../config/feel';
import { PALETTE } from '../config/palette';
import { glow, hatch, hexA, poly } from './primitives';
import type { PolyPoint } from './primitives';

/**
 * sim이 들고 있는 장판 하나를 render가 읽는 모양. 필드는 전부 readonly다 — render는 sim
 * 상태를 한 줄도 바꾸지 않는다(HR-06).
 */
export interface ZoneView {
  /** 장판 중심 (u) */
  readonly xU: number;
  readonly yU: number;
  /** §6.1 P9는 90u, §11.5 E06 화공 장판은 60u. 다각형 반경 계수가 이 값에 곱해진다 */
  readonly radiusU: number;
  /** 생성 후 경과한 sim 시간 (초). 맥동의 위상이 여기서 나온다 */
  readonly ageSec: number;
}

/** 목업은 각도를 6.2832로 한 바퀴 돈다(engine.js:293). 2π로 적어도 같은 7각형이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;

/**
 * 채움 알파의 맥동 (engine.js:289). 0.82 ± 0.18을 초당 6rad — 약 1.05Hz — 로 오간다.
 * 맥동이 있는 이유는 장판이 **지속되는** 위협이기 때문이다. 정지한 반투명 도형은 배경 소품으로
 * 읽히고, 그러면 §17의 "경계가 명확해야 한다"가 경계선만으로 버텨야 한다.
 */
const PULSE_BASE = 0.82;
const PULSE_AMPLITUDE = 0.18;
const PULSE_RATE_RAD_PER_SEC = 6;

/**
 * 채움 알파의 기준값. 0.55는 06 §2가 레이어 3층을 정할 때 쓴 값이다 — 이 위에 오는 층은
 * 전부 이 반투명을 통과해 보인다. 불투명하게 만들면 장판 위의 탄환이 사라진다.
 */
const FILL_ALPHA = 0.55;

/** 빗금 알파. 형태 축을 나르되 그 위의 탄환을 가리지 않는 선 */
const HATCH_ALPHA = 0.16;

/**
 * 외곽선. 이 점선이 §17이 요구한 "명확한 경계"이자 sim/zones.ts의 판정 경계 그 자체다.
 * setLineDash가 가변 배열만 받으므로 모듈에 한 벌 두고 재사용한다.
 */
const OUTLINE_WIDTH_U = 3;
const OUTLINE_DASH: number[] = [16, 9];
const NO_DASH: number[] = [];

/** 글로우는 판정 밖으로 번진다. 그래서 위의 점선 경계가 반드시 있어야 한다 */
const GLOW_RADIUS_SCALE = 1.4;
const GLOW_ALPHA = 0.5;

/**
 * 꼭짓점 버퍼. 장판은 동시 6개까지 있고(§9.6) 프레임마다 다시 계산되므로, 매번 배열을 새로
 * 만들면 프레임당 최대 42개가 GC로 간다. drawZone이 한 장판을 다 그린 뒤에야 다음 장판으로
 * 넘어가므로 한 벌을 돌려 써도 겹치지 않는다.
 */
const polygonScratch: [number, number][] = Array.from(
  { length: ZONE.polyVertices },
  (): [number, number] => [0, 0],
);

/**
 * 이식: engine.js drawZone의 꼭짓점 루프 (292-297) — 계수를 config/feel.ts ZONE으로 뺐다.
 *
 * 목업이 인라인으로 갖고 있던 루프를 이름 있는 함수로 꺼낸 이유는 이 식이 그림이 아니라
 * **판정 도형**이기 때문이다. sim/zones.ts가 같은 식을 만들어야 하고, 그 사실이 호출부
 * 한복판의 for문 안에 묻히면 한쪽만 고쳐진다.
 *
 * 반환값은 위 buffer 그 자체다 — 다음 호출이 덮어쓰므로 보관하면 안 된다.
 */
function buildZonePolygon(radiusU: number): readonly PolyPoint[] {
  for (let i = 0; i < ZONE.polyVertices; i += 1) {
    const vertex = polygonScratch[i];
    if (vertex === undefined) {
      continue;
    }
    const angleRad = (i / ZONE.polyVertices) * FULL_TURN_RAD + ZONE.polyStartAngleRad;
    const ratio =
      ZONE.polyBaseRatio + ((i * ZONE.polyStrideIndex) % ZONE.polyModulus) * ZONE.polyStepRatio;
    const vertexRadiusU = radiusU * ratio;
    vertex[0] = Math.cos(angleRad) * vertexRadiusU;
    vertex[1] = Math.sin(angleRad) * vertexRadiusU;
  }
  return polygonScratch;
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawZone (288-315) — 그대로
 *
 * 그리는 순서가 채움 → 빗금 → 외곽선인 것은 앞의 둘이 뒤엣것에 덮이면 안 되기 때문이다.
 * 경계선이 맨 위에 있어야 반투명 채움이 배경과 섞여도 경계가 남는다.
 */
export function drawZone(ctx: CanvasRenderingContext2D, z: ZoneView): void {
  const pulse = PULSE_BASE + Math.sin(z.ageSec * PULSE_RATE_RAD_PER_SEC) * PULSE_AMPLITUDE;
  ctx.save();
  ctx.translate(z.xU, z.yU);
  const points = buildZonePolygon(z.radiusU);
  poly(ctx, points);
  ctx.fillStyle = hexA(PALETTE.takjeok, FILL_ALPHA * pulse);
  ctx.fill();

  ctx.save();
  // fill()이 경로를 지우지 않으므로 방금 그 7각형이 그대로 클립이 된다
  ctx.clip();
  ctx.globalAlpha = HATCH_ALPHA;
  ctx.fillStyle = hatch();
  // 빗금 사각형이 ±z.r인데 꼭짓점은 최대 z.r × 1.085까지 나간다. 그래서 바깥으로 나간 꼭짓점
  // 끝에는 빗금이 안 걸린다 — 목업 그대로다(engine.js:304). 사각형을 키우면 승인된 그림이 바뀐다
  ctx.fillRect(-z.radiusU, -z.radiusU, z.radiusU * 2, z.radiusU * 2);
  ctx.restore();

  ctx.strokeStyle = PALETTE.jeok;
  ctx.lineWidth = OUTLINE_WIDTH_U;
  ctx.setLineDash(OUTLINE_DASH);
  poly(ctx, points);
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.restore();

  glow(ctx, z.xU, z.yU, z.radiusU * GLOW_RADIUS_SCALE, PALETTE.takjeok, GLOW_ALPHA);
}
