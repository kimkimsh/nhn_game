/**
 * 탄환 층 — 목업 engine.js drawBullet의 이식처 (06_렌더링과_게임필.md §1.4 · §2의 6층)
 *
 * 목업의 `drawBullet`은 발 하나를 통째로 그리는 함수였다. 여기서는 그것이 두 조각으로 갈린다.
 *
 * - **모양·글로우·streak·P4 spin·P7 도화선** — `render/sprites.ts`의 두 패스가 갖는다(P1).
 *   굽기(§3.1)가 그 조각들을 프레임 밖으로 뺐고, 남은 것은 발마다 다시 도는 stroke 하나
 *   (반사탄 streak)와 additive drawImage 둘(글로우 · P7 도화선)뿐이다.
 * - **발마다 상태를 읽어야 그려지는 것** — 자해 유예 링(C3)과 재패리 라벨 — 이 파일이 갖는다.
 *   굽지 못하는 이유가 같다: `graceRemainingSec`과 재패리 횟수가 프레임마다 다르다.
 *
 * 그래서 이 파일의 `drawBullets`가 목업 `drawBullet`에 1:1로 대응한다. 층 하나를 통째로
 * 내보내는 함수가 그것 하나뿐이라는 뜻이고, 층 안의 순서(글로우 → 본체 → 유예 링 → 라벨)를
 * 아는 곳도 여기뿐이다.
 *
 * **두 패스를 지킨다.** 글로우 전부를 `lighter`로 내보내고 모드를 한 번 바꾼 뒤 본체 전부를
 * `source-over`로 내보낸다. 발마다 왕복하면 프레임당 합성 모드 전환이 1,040회다(06 §3.5).
 * 유예 링과 라벨은 본체 패스가 남긴 `source-over` 위에 이어 그리므로 전환을 더 늘리지 않는다.
 *
 * P12 관통 대창(`drawLance`)이 같은 파일에 있는 것은 그것도 6층이기 때문이다. 예고선은
 * 4층(`render/telegraph.ts`)이고 수명도 판정도 다르다(06 §5.4).
 */

import { BULLETS } from '../config/bullets';
import type { ParryableBulletId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { REFLECT } from '../config/reflect';
import { TELEGRAPH } from '../config/telegraph';
import { clamp01, easeOutCubic, lerp } from '../core/math';
import type { ProjectileOwner } from '../sim/bullets';
import { getGlowSprite, hexA, label, type LabelStyle } from './primitives';
import {
  drawBulletBodyPass,
  drawBulletGlowPass,
  type BulletBatch,
  type BulletSpriteState,
} from './sprites';

/**
 * 한 프레임의 탄환 층. `BulletBatch`(sprites.ts)에 **굽지 못하는 두 상태**만 더한 것이다.
 *
 * 배열은 프레임마다 새로 만들지 않는다 — 520발이면 프레임당 객체 520개가 GC로 가고,
 * 그 GC가 p99에 그대로 나타난다. 불변 조건도 그대로다: 모든 배열의 유효 구간이 [0, count)다.
 *
 * 채우는 것은 이 파일이 아니라 `render/frame.ts`다. 월드를 훑는 자리가 거기 하나여야 하고,
 * 이 파일은 sim 상태를 한 줄도 건드리지 않는다(HR-06).
 */
export interface BulletLayerBatch extends BulletBatch {
  /**
   * §7.1 자해 유예 잔여 (s). 적 탄환과 유예가 끝난 반사탄은 0 이하다.
   * 링의 반경이 이 값 자체이므로(06 §5.3) 상태 세 갈래로는 부족하다 — 남은 시간이 필요하다.
   */
  readonly graceRemainingSec: Float32Array;
  /**
   * §7.4 이 발사체를 몇 번째로 쳐냈는가. 0이면 재패리가 아니다.
   *
   * **sim의 `Projectile`에는 이 칸이 없다.** `lastGrade`가 "한 번이라도 쳐냈다"만 말하고
   * 횟수는 아무도 세지 않는다. §17이 "그 발사체를 몇 번째로 쳐냈는지가 읽혀야 한다"를
   * 요구하므로 세는 자리는 sim이어야 하고, 그때까지 이 칸은 호출부가 채운다.
   */
  readonly reparryCount: Int32Array;
}

/** P12 관통 대창 한 줄. 세로 x 좌표와 관통 판정이 시작된 뒤의 경과 시간이 전부다 */
export interface LanceView {
  readonly centerXU: number;
  /** 관통 판정 시작 이후 경과 (s). sim의 판정 타이머와 같은 값이어야 한다 */
  readonly elapsedSec: number;
}

/**
 * 이식: docs/sample_image/_shared/engine.js 재패리 라벨 (280-283) — 그대로.
 *
 * 목업은 `label(..., 21)`이 그랬듯 굵기 600이 고정이었다(152-160). 정렬은 왼쪽(기본값)이라
 * 탄의 오른쪽 위로 흘러 나간다.
 *
 * 오프셋 두 값이 `config/ui.ts`에 없는 것은 그 파일이 화면 좌표를 갖기 때문이다. 이 둘은
 * 탄 반경에 붙는 상대 좌표라 소유자가 다르다 — `enemy-parts.ts`의 HP 바 치수와 같은 갈래다.
 */
const REPARRY_LABEL_OFFSET_X_U = 10;
const REPARRY_LABEL_OFFSET_Y_U = -8;
const REPARRY_LABEL_PREFIX = '재';
const REPARRY_LABEL_STYLE: LabelStyle = {
  color: PALETTE.hwang,
  sizePx: 21,
  weight: 600,
  align: 'left',
};

/**
 * 신규: 자해 유예 0.15초의 수축 링 — 06 §5.3 (스펙 §7.1 · §17).
 *
 * §17이 요구한 것은 둘이다 — 지금 무해하다는 사실, 그리고 **언제 유해해지는가**.
 * 앞의 것은 rim이 없다는 사실이 말하고(sprites.ts의 `reflectGrace` 스프라이트), 뒤의 것을
 * 이 링이 말한다. **링이 탄에 닿는 순간이 유예 종료다** — 그래서 별도의 타이머 표시가 없다.
 *
 * 구분 축이 색이 아니라 **운동**(수축)과 **형태**(점선)인 것이 핵심이다. 최악 프레임에서
 * 글로우가 전부 백색으로 클리핑되므로 백색 링의 색은 아무것도 구분하지 못한다(12 §7.2).
 *
 * 두께·점선 간격·알파는 06 §5.3이 정하지 않았다. 실선 2.6u인 유예 후 rim(sprite-bake.ts)보다
 * 가늘게 두어 둘이 같은 그림으로 안 읽히게 한다 — 유예 중과 유예 후를 닮게 만들면
 * "유예를 모른다"가 "유예 상태를 착각한다"로 바뀐다(10 §157).
 */
const GRACE_RING_START_OFFSET_U = 6;
const GRACE_RING_STROKE_U = 2;
const GRACE_RING_DASH_U: number[] = [7, 6];
const GRACE_RING_COLOR = hexA(PALETTE.baek, 0.9);
const GRACE_RING_NO_DASH: number[] = [];

/** 목업은 원을 6.284로 닫는다(engine.js:206 등). 2π로 적어도 같은 원이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;

/**
 * 신규: P12 관통 대창 본체 — 06 §5.4 (스펙 §6.1, 10 C4).
 *
 * 목업에는 예고선만 있다(`drawTelegraph`의 lance 분기, 1040-1048). 0.4초 관통 판정 구간의
 * 본체는 어디에도 안 그려진다. **예고선은 "아직 안 아프다"이고 본체는 "지금 아프다"이며,
 * 둘이 닮으면 장판과 같은 종류의 오독이 생긴다.**
 *
 * 세로 범위는 예고선과 같다 — 목업이 `-60`에서 `PF.H + 120`까지 그었다(1041). 같은 자리를
 * 덮어야 예고가 가리킨 곳과 판정이 온 곳이 같다는 것이 읽힌다.
 *
 * **패리 불가임이 형태로 읽힌다.** 대창은 끝이 없는 직선이다. 패리 가능한 어떤 탄환도 화면
 * 높이를 가로지르지 않으므로(가장 큰 P5도 폭 120u의 호다) "화면을 관통하는 것은 못 친다"가
 * 형태 규칙이 되고, §17의 "색만으로 구분하지 않는다"가 그것으로 지켜진다.
 */
const LANCE_OVERHANG_U = 60;
const LANCE_OPEN_SEC = 0.06;
const LANCE_FADE_SEC = 0.06;
const LANCE_OPEN_WIDTH_U = 4;
const LANCE_EDGE_STROKE_U = 2.5;
const LANCE_CORE_COLOR = hexA(PALETTE.jeokHot, 0.9);
const LANCE_EDGE_COLOR = hexA(PALETTE.baek, 0.7);
const LANCE_GLOW_ALPHA = 0.5;

/**
 * 광휘는 세로로 반복하는 additive `drawImage`다. 글로우 스프라이트는 원형 그라디언트라
 * 세로로 늘여 타원으로 쓴다 — 한 장을 기둥 전체 높이로 늘이면 화면 중앙만 밝아지고 위아래가
 * 꺼져서, 판정이 화면 전체에 걸려 있다는 사실과 그림이 어긋난다.
 *
 * 폭 120u는 판정 폭 40u 밖으로 좌우 40u씩 번진다는 뜻이다. 번지는 것이 목적이고, 그래서
 * 판정 경계를 확정하는 경계선이 반드시 함께 그려진다(06 §5.4).
 *
 * 간격을 높이의 절반으로 둔 것은 이웃한 두 장이 겹쳐야 세로 방향 밝기 띠가 안 생기기
 * 때문이다. 줄 하나당 `ceil(2040 / 300) + 1 = 8`장이고, 스테이지 5의 세 줄에서 24회다.
 */
const LANCE_GLOW_WIDTH_U = 120;
const LANCE_GLOW_HEIGHT_U = 600;
const LANCE_GLOW_STEP_U = LANCE_GLOW_HEIGHT_U / 2;

/**
 * 이식: docs/sample_image/_shared/engine.js bulletPaint (166-170) — **수정**.
 *
 * 목업은 색 네 개를 돌려줬다. 그 색은 이제 굽기가 갖고(boot/sprite-bake.ts의 SPRITE_PAINT)
 * 여기 남은 것은 **어느 스프라이트를 쓸 것인가**라는 같은 판단 하나다.
 *
 * `owner === 'reflect'`가 황색 코어에 적색 rim을 두르는 것은 HR-07 때문이다. 그 탄은 이제
 * 플레이어의 데미지원이지만 플레이어에게도 여전히 치명적이라, 두 진영의 색을 한 발이 같이
 * 갖는다. **예뻐 보이게 아군 색으로만 칠하면 안전하다고 오해한다.**
 *
 * 갈래가 목업의 둘이 아니라 셋인 것은 자해 유예 때문이다(06 §5.3) — 유예 중에는 rim을 빼서
 * "지금은 못 친다"와 "지금은 안 아프다"를 같은 그림 하나로 말한다.
 */
export function bulletPaint(owner: ProjectileOwner, graceRemainingSec: number): BulletSpriteState {
  if (owner === 'enemy') {
    return 'enemy';
  }
  return graceRemainingSec > 0 ? 'reflectGrace' : 'reflect';
}

/**
 * 유예 중인 반사탄의 수축 링. 본체 패스가 남긴 `source-over`를 그대로 쓴다.
 *
 * 점선을 끝에서 반드시 지운다 — 대시가 7층(플레이어)으로 새면 코어의 겉링이 점선이 된다.
 * `enemy-parts.ts`가 상태 누수를 결과물의 일부로 남긴 것과는 자리가 다르다. 저쪽은 승인된
 * 목업 안에서 이어 그리는 누수이고, 이것은 층을 넘는 누수다.
 */
function drawGraceRings(ctx: CanvasRenderingContext2D, batch: BulletLayerBatch): void {
  ctx.strokeStyle = GRACE_RING_COLOR;
  ctx.lineWidth = GRACE_RING_STROKE_U;
  // 점선은 첫 링을 그릴 때 켠다. 위에서 무조건 켜면 유예 중인 탄이 하나도 없는 프레임에서
  // 아래 되돌리기가 건너뛰어져 대시가 7층으로 샌다
  let drawn = false;
  for (let i = 0; i < batch.count; i += 1) {
    // count ≤ 배열 길이가 배치의 불변 조건이라 인덱스는 항상 유효하다.
    // noUncheckedIndexedAccess가 typed array 접근에도 걸리므로 여기서만 벗긴다
    const remainingSec = batch.graceRemainingSec[i]!;
    if (remainingSec <= 0 || batch.state[i]! !== 'reflectGrace') {
      continue;
    }
    const id: ParryableBulletId = batch.bulletId[i]!;
    // 유예 길이는 카드가 바꾸지 않는다(StatTarget에 칸이 없다) — §7.1의 0.15초가 단일 소스다
    const offsetU = GRACE_RING_START_OFFSET_U * clamp01(remainingSec / REFLECT.graceSec);
    if (!drawn) {
      ctx.setLineDash(GRACE_RING_DASH_U);
    }
    ctx.beginPath();
    ctx.arc(batch.xU[i]!, batch.yU[i]!, BULLETS[id].radiusU + offsetU, 0, FULL_TURN_RAD);
    ctx.stroke();
    drawn = true;
  }
  if (drawn) {
    ctx.setLineDash(GRACE_RING_NO_DASH);
  }
}

/**
 * 이식: docs/sample_image/_shared/engine.js 재패리 라벨 (280-283) — 그대로.
 *
 * **발사체 좌표에 그리므로 HUD가 아니다.** `render/hud.ts`로 보내려던 배정은 12 §2가
 * 취소했다. §5.7의 등급 상승 계단은 등급 팝업 옆에 그리는 별개 표시이고 여기 없다.
 */
function drawReparryLabels(ctx: CanvasRenderingContext2D, batch: BulletLayerBatch): void {
  for (let i = 0; i < batch.count; i += 1) {
    const count = batch.reparryCount[i]!;
    if (count <= 0) {
      continue;
    }
    const radiusU = BULLETS[batch.bulletId[i]!].radiusU;
    label(
      ctx,
      batch.xU[i]! + radiusU + REPARRY_LABEL_OFFSET_X_U,
      batch.yU[i]! - radiusU + REPARRY_LABEL_OFFSET_Y_U,
      `${REPARRY_LABEL_PREFIX}${count}`,
      REPARRY_LABEL_STYLE,
    );
  }
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawBullet (172-284) — **수정(가장 큰 것)**.
 *
 * 목업은 발마다 이 함수를 불렀다. 여기서는 층 전체를 한 번에 받는다 — 경로 그리기가 구운
 * 스프라이트 `drawImage`가 되면서 발 단위로 나눌 이유가 사라졌고, 두 패스가 발 단위 호출로는
 * 성립하지 않기 때문이다(06 §3.1).
 *
 * **`ctx` 변환을 들어온 그대로 돌려준다.** 두 패스가 각자 `setTransform`을 걸므로 이 함수가
 * 되돌리지 않으면 6.5층 이후가 흔들림 변위를 잃는다 — 06 §2는 흔들림이 1~9층을 감싸야
 * 한다고 못 박았고, 그것이 깨지면 카메라가 흔들린 게 아니라 물체만 미끄러지는 그림이 된다.
 *
 * 드로우 콜은 06 §3.5의 예산에 더해 **유예 중인 반사탄당 stroke 1회**가 붙는다. 유예가
 * 0.15초이고 패리 최대 주기가 0.24초라 정상 빌드에서는 상시 1발 미만이지만, R08 파편과
 * E01 분열탄은 한 번의 패리로 여러 발을 유예 상태로 만든다.
 */
export function drawBullets(
  ctx: CanvasRenderingContext2D,
  batch: BulletLayerBatch,
): void {
  const entryTransform = ctx.getTransform();
  drawBulletGlowPass(ctx, batch);
  drawBulletBodyPass(ctx, batch);
  drawGraceRings(ctx, batch);
  drawReparryLabels(ctx, batch);
  ctx.setTransform(entryTransform);
}

/**
 * 신규: P12 관통 대창 본체 — 06 §5.4 (스펙 §6.1, 10 C4).
 *
 * 세 겹이 각자 다른 일을 한다.
 * - **코어** 폭 40u 채움이 **판정 범위와 정확히 같다.** §17의 장판 규칙과 같은 원칙이다.
 * - **경계선**이 그 40u의 양 가장자리를 확정한다. 광휘가 번져도 맞는 곳은 이 선 안쪽뿐이다.
 * - **광휘**는 판정 밖으로 번진다. 그래서 경계선이 없으면 안 된다.
 *
 * 소멸 구간(0.34~0.40초)에 **폭을 줄이지 않는다.** 폭이 줄면 마지막 0.06초 동안 실제보다
 * 안전해 보이는데 판정은 0.40초 내내 40u다. 알파만 감쇠한다.
 *
 * 0.4초는 짧으므로 등장·소멸이 아니라 **존재하는 0.4초 자체가 읽혀야** 한다(10 C4).
 * 그래서 열림 0.06초를 뺀 0.28초가 폭도 알파도 변하지 않는 정지 구간이다.
 *
 * 호출부의 변환을 그대로 쓴다 — 논리 단위 프레임이고 흔들림 변위가 이미 걸린 상태다.
 */
export function drawLance(ctx: CanvasRenderingContext2D, lance: LanceView): void {
  const activeSec = TELEGRAPH.shapes.pierceLine.activeSec;
  if (activeSec === null || lance.elapsedSec < 0 || lance.elapsedSec >= activeSec) {
    return;
  }

  const fullWidthU = BULLETS.P12.radiusU * 2;
  const widthU =
    lance.elapsedSec >= LANCE_OPEN_SEC
      ? fullWidthU
      : lerp(LANCE_OPEN_WIDTH_U, fullWidthU, easeOutCubic(lance.elapsedSec / LANCE_OPEN_SEC));

  const fadeStartSec = activeSec - LANCE_FADE_SEC;
  const fade =
    lance.elapsedSec <= fadeStartSec
      ? 1
      : 1 - clamp01((lance.elapsedSec - fadeStartSec) / LANCE_FADE_SEC);

  const topU = -LANCE_OVERHANG_U;
  const heightU = PLAYFIELD.heightU + LANCE_OVERHANG_U * 2;
  const leftU = lance.centerXU - widthU / 2;
  const rightU = lance.centerXU + widthU / 2;

  ctx.globalAlpha = fade;
  ctx.fillStyle = LANCE_CORE_COLOR;
  ctx.fillRect(leftU, topU, widthU, heightU);

  // 두 가장자리를 한 경로에 담아 stroke 한 번으로 낸다. 줄당 호출 2회가 1회가 된다
  ctx.strokeStyle = LANCE_EDGE_COLOR;
  ctx.lineWidth = LANCE_EDGE_STROKE_U;
  ctx.beginPath();
  ctx.moveTo(leftU, topU);
  ctx.lineTo(leftU, topU + heightU);
  ctx.moveTo(rightU, topU);
  ctx.lineTo(rightU, topU + heightU);
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = LANCE_GLOW_ALPHA * fade;
  const sprite = getGlowSprite(PALETTE.jeok);
  const tileCount = Math.ceil(heightU / LANCE_GLOW_STEP_U) + 1;
  for (let i = 0; i < tileCount; i += 1) {
    const centerYU = topU + i * LANCE_GLOW_STEP_U;
    ctx.drawImage(
      sprite,
      lance.centerXU - LANCE_GLOW_WIDTH_U / 2,
      centerYU - LANCE_GLOW_HEIGHT_U / 2,
      LANCE_GLOW_WIDTH_U,
      LANCE_GLOW_HEIGHT_U,
    );
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
