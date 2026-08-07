/**
 * 부팅 굽기 — 탄환 스프라이트 30장 + 글로우 13색
 * — 06_렌더링과_게임필.md §3.1, 02_아키텍처.md §5.2, 12_통합_계약.md §1 C-04
 *
 * 여기서 굽는 것이 전부다. **지연 생성은 없다.** 전투 중 첫 등장 시점의 radial gradient
 * fill 한 번이 그 프레임을 튀게 하고, 그 프레임이 패리 프레임이면 판정 실패로 나타난다.
 *
 * 목업 drawBullet(engine.js:172-284)의 shape 분기가 이 파일의 paintBulletShape로 옮겨 왔다.
 * 프레임에서 그 분기를 다시 도는 코드는 없어야 한다 — 있으면 굽기가 아무것도 아꼈다는 뜻이다.
 */

import { BULLETS } from '../config/bullets';
import type { ParryableBulletId } from '../config/ids';
import { GLOW_BAKE_COLORS, PALETTE } from '../config/palette';
import {
  assertGlowSpritesBaked,
  glow,
  hatch,
  hexA,
  invalidateHatchPattern,
  poly,
  registerGlowSprite,
  type PolyPoint,
} from '../render/primitives';
import {
  BULLET_SPRITE_STATES,
  PARRYABLE_BULLET_IDS,
  assertBulletSpritesBaked,
  drawBulletBodyPass,
  drawBulletGlowPass,
  registerBulletSprite,
  type BulletSpriteState,
} from '../render/sprites';
import type { CanvasView } from './canvas';

/** 02 §5.2 — 논리 크기의 4배로 구워 확대 시 뭉개지지 않게 한다 */
const BAKE_SCALE = 4;

/** 반올림과 안티에일리어싱이 잘리지 않게 두는 여유 (u) */
const SPRITE_MARGIN_U = 2;

/** engine.js:271-277 적색 rim. 반사탄 정상 상태에만 붙는다 */
const RIM_OFFSET_U = 4;
const RIM_STROKE_U = 2.6;

/** 12 §7.2 반사탄 중앙의 불투명 점. additive 클리핑은 위로만 올리므로 이 구멍은 남는다 */
const REFLECT_CORE_DOT_SCALE = 0.45;

/** engine.js:96-111 글로우 스프라이트. glow()가 언제나 r=128로 부르므로 색당 한 장이다 */
const GLOW_SPRITE_RADIUS_PX = 128;
const GLOW_STOP_MID = 0.35;
const GLOW_STOP_MID_ALPHA = 0.42;

/** engine.js:203-269의 모양별 계수. 이름은 목업의 shape 키를 그대로 쓴다 */
const FULL_TURN_RAD = 6.2832;
const SHARD_TIP = 2.1;
const SHARD_WAIST = 0.6;
const SHARD_TAIL = 1.5;
const SHARD_HOT_TIP = 1.5;
const SHARD_HOT_SIDE = 0.4;
const SHARD_HOT_TAIL = 0.7;
const FIRE_TAIL_START = 1.4;
const FIRE_TAIL_END = 3.2;
const FIRE_TAIL_SIDE = 0.7;
const FIRE_TAIL_MID = 2.4;
const FIRE_TAIL_ALPHA = 0.65;
const NEEDLE_TIP = 3.4;
const NEEDLE_SIDE = 0.9;
const NEEDLE_BACK = 1.2;
const DART_TIP = 2.6;
const DART_SIDE = 0.8;
const DART_BACK = 1.1;
const DART_NOTCH = 0.4;
const DOT_HOT_SCALE = 0.45;
const STAR_POINTS = 8;
const STAR_OUTER = 1.5;
const STAR_INNER = 0.42;
const CRESCENT_CENTER_Y = 1.1;
const CRESCENT_RADIUS = 1.9;
const CRESCENT_WIDTH = 0.66;
const CRESCENT_FROM_RAD = Math.PI * 1.18;
const CRESCENT_TO_RAD = Math.PI * 1.82;
const CRESCENT_HOT_WIDTH = 0.22;
const CRESCENT_HOT_ALPHA = 0.5;
const ORB_INNER = 0.6;
const ORB_STROKE_U = 3;
const BOMB_FUSE_X = 0.5;
const BOMB_FUSE_Y = -1.7;
const BOMB_FUSE_STROKE_U = 4;
const SEEKER_STROKE_U = 3;
const SEEKER_TRAIL_ALPHA = 0.45;
const SEEKER_CENTER_Y = 3.4;
const SEEKER_RADIUS = 3.6;
const SEEKER_FROM_RAD = -Math.PI * 0.78;
const SEEKER_TO_RAD = -Math.PI * 0.22;

/**
 * 상태별 색 — 이식: engine.js bulletPaint (166-170).
 *
 * 반사탄이 황색 본체에 적색 rim을 두르는 것은 HR-07 때문이다. 그 탄은 이제 내 데미지원이지만
 * 나에게도 여전히 치명적이라, 두 진영의 색을 한 발이 같이 갖는다. 예뻐 보이게 고치면 규칙이
 * 지워진다.
 *
 * rim이 null인 상태가 둘인데 뜻이 다르다 — 'enemy'는 애초에 rim이 없고,
 * 'reflectGrace'는 자해 유예 0.15초 동안 rim을 **뺀** 것이다 (06 §5.3).
 */
const SPRITE_PAINT: Record<BulletSpriteState, { body: string; hot: string; rim: string | null }> = {
  enemy: { body: PALETTE.jeok, hot: PALETTE.jeokHot, rim: null },
  reflectGrace: { body: PALETTE.hwang, hot: PALETTE.hwangHot, rim: null },
  reflect: { body: PALETTE.hwang, hot: PALETTE.hwangHot, rim: PALETTE.jeok },
};

/**
 * 모양이 반경 r의 몇 배까지 벋는가. 각 값은 engine.js의 좌표에서 직접 나온 것이고
 * 옆의 절대 여유는 선폭의 절반이다.
 */
const SHAPE_EXTENT: Record<string, { scale: number; padU: number }> = {
  dot: { scale: 1, padU: 0 },
  shard: { scale: SHARD_TIP, padU: 0 },
  fireshard: { scale: FIRE_TAIL_END, padU: 0 },
  needle: { scale: NEEDLE_TIP, padU: 0 },
  dart: { scale: DART_TIP, padU: 0 },
  star: { scale: STAR_OUTER, padU: 0 },
  // 호의 |x| 최대는 끝점의 1.9·cos(212.4°) = 1.604r이고 둥근 캡이 0.33r을 더한다
  crescent: { scale: 1.94, padU: 0 },
  orb: { scale: 1, padU: ORB_STROKE_U / 2 },
  bomb: { scale: -BOMB_FUSE_Y, padU: BOMB_FUSE_STROKE_U / 2 },
  // 꼬리 호의 |x| 최대는 3.6·cos(140.4°) = 2.774r이다
  seeker: { scale: 2.78, padU: SEEKER_STROKE_U / 2 },
};

interface Offscreen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

function createOffscreen(widthPx: number, heightPx: number): Offscreen {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('오프스크린 2d 컨텍스트를 얻지 못했다');
  }
  return { canvas, ctx };
}

/** 이식: engine.js glowSprite (96-111) — 색·반경 키의 지연 캐시를 고정 목록 굽기로 바꿨다 */
function bakeGlowSprite(color: string): void {
  const diameter = GLOW_SPRITE_RADIUS_PX * 2;
  const { canvas, ctx } = createOffscreen(diameter, diameter);
  const gradient = ctx.createRadialGradient(
    GLOW_SPRITE_RADIUS_PX, GLOW_SPRITE_RADIUS_PX, 0,
    GLOW_SPRITE_RADIUS_PX, GLOW_SPRITE_RADIUS_PX, GLOW_SPRITE_RADIUS_PX,
  );
  gradient.addColorStop(0, color);
  gradient.addColorStop(GLOW_STOP_MID, hexA(color, GLOW_STOP_MID_ALPHA));
  gradient.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, diameter, diameter);
  registerGlowSprite(color, canvas);
}

function halfExtentU(id: ParryableBulletId): number {
  const def = BULLETS[id];
  const extent = SHAPE_EXTENT[def.shape];
  if (extent === undefined) {
    throw new Error(`모양의 크기표가 없다: ${def.shape}`);
  }
  const shapeU = def.radiusU * extent.scale + extent.padU;
  const rimU = def.radiusU + RIM_OFFSET_U + RIM_STROKE_U / 2;
  return Math.max(shapeU, rimU) + SPRITE_MARGIN_U;
}

/**
 * 이식: engine.js drawBullet의 shape 분기 (202-277) — 원점 중심, 논리 단위, 회전 없음.
 *
 * 굽기와 A/B 비교(굽기 미적용 경로)가 같은 함수를 쓴다. 두 벌로 나뉘면 A/B가 재는 것이
 * 굽기의 효과가 아니라 두 구현의 차이가 된다.
 *
 * 여기 없는 것 둘 — P4 수리검의 자체 회전은 본체 패스의 변환이 얹고, P7 도화선 글로우는
 * 회전 프레임 안의 additive라 sprites.ts의 글로우 패스가 절대 좌표로 그린다 (06 §1.4).
 */
export function paintBulletShape(
  ctx: CanvasRenderingContext2D,
  id: ParryableBulletId,
  state: BulletSpriteState,
): void {
  const def = BULLETS[id];
  const r = def.radiusU;
  const paint = SPRITE_PAINT[state];
  ctx.fillStyle = paint.body;
  ctx.strokeStyle = paint.body;

  switch (def.shape) {
    case 'dot':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, FULL_TURN_RAD);
      ctx.fill();
      ctx.fillStyle = paint.hot;
      ctx.beginPath();
      ctx.arc(0, 0, r * DOT_HOT_SCALE, 0, FULL_TURN_RAD);
      ctx.fill();
      break;
    case 'shard':
    case 'fireshard': {
      const outer: PolyPoint[] = [
        [0, -r * SHARD_TIP], [r, r * SHARD_WAIST], [0, r * SHARD_TAIL], [-r, r * SHARD_WAIST],
      ];
      poly(ctx, outer);
      ctx.fill();
      ctx.fillStyle = paint.hot;
      const inner: PolyPoint[] = [
        [0, -r * SHARD_HOT_TIP], [r * SHARD_HOT_SIDE, 0],
        [0, r * SHARD_HOT_TAIL], [-r * SHARD_HOT_SIDE, 0],
      ];
      poly(ctx, inner);
      ctx.fill();
      if (def.shape === 'fireshard') {
        ctx.globalAlpha = FIRE_TAIL_ALPHA;
        ctx.fillStyle = PALETTE.hwang;
        const tail: PolyPoint[] = [
          [0, r * FIRE_TAIL_START], [r * FIRE_TAIL_SIDE, r * FIRE_TAIL_END],
          [0, r * FIRE_TAIL_MID], [-r * FIRE_TAIL_SIDE, r * FIRE_TAIL_END],
        ];
        poly(ctx, tail);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'needle':
      poly(ctx, [
        [0, -r * NEEDLE_TIP], [r * NEEDLE_SIDE, r * NEEDLE_BACK], [-r * NEEDLE_SIDE, r * NEEDLE_BACK],
      ]);
      ctx.fill();
      break;
    case 'dart':
      poly(ctx, [
        [0, -r * DART_TIP], [r * DART_SIDE, r * DART_BACK],
        [0, r * DART_NOTCH], [-r * DART_SIDE, r * DART_BACK],
      ]);
      ctx.fill();
      break;
    case 'star':
      ctx.beginPath();
      for (let i = 0; i < STAR_POINTS; i += 1) {
        const angle = (i / STAR_POINTS) * FULL_TURN_RAD;
        const reach = i % 2 ? r * STAR_INNER : r * STAR_OUTER;
        if (i === 0) {
          ctx.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        } else {
          ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        }
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'crescent':
      ctx.lineWidth = r * CRESCENT_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, r * CRESCENT_CENTER_Y, r * CRESCENT_RADIUS, CRESCENT_FROM_RAD, CRESCENT_TO_RAD);
      ctx.stroke();
      ctx.globalAlpha = CRESCENT_HOT_ALPHA;
      ctx.strokeStyle = paint.hot;
      ctx.lineWidth = r * CRESCENT_HOT_WIDTH;
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case 'orb':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, FULL_TURN_RAD);
      ctx.fill();
      ctx.strokeStyle = paint.hot;
      ctx.lineWidth = ORB_STROKE_U;
      ctx.beginPath();
      ctx.arc(0, 0, r * ORB_INNER, 0, FULL_TURN_RAD);
      ctx.stroke();
      break;
    case 'bomb':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, FULL_TURN_RAD);
      ctx.fill();
      ctx.strokeStyle = PALETTE.hwang;
      ctx.lineWidth = BOMB_FUSE_STROKE_U;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * BOMB_FUSE_X, r * BOMB_FUSE_Y);
      ctx.stroke();
      break;
    case 'seeker':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, FULL_TURN_RAD);
      ctx.fill();
      ctx.strokeStyle = hexA(paint.body, SEEKER_TRAIL_ALPHA);
      ctx.lineWidth = SEEKER_STROKE_U;
      ctx.beginPath();
      ctx.arc(0, r * SEEKER_CENTER_Y, r * SEEKER_RADIUS, SEEKER_FROM_RAD, SEEKER_TO_RAD);
      ctx.stroke();
      break;
  }

  if (state !== 'enemy') {
    ctx.fillStyle = PALETTE.ink800;
    ctx.beginPath();
    ctx.arc(0, 0, r * REFLECT_CORE_DOT_SCALE, 0, FULL_TURN_RAD);
    ctx.fill();
  }
  if (paint.rim !== null) {
    ctx.strokeStyle = paint.rim;
    ctx.lineWidth = RIM_STROKE_U;
    ctx.beginPath();
    ctx.arc(0, 0, r + RIM_OFFSET_U, 0, FULL_TURN_RAD);
    ctx.stroke();
  }
}

function bakeBulletSprite(id: ParryableBulletId, state: BulletSpriteState): void {
  const requestedHalfU = halfExtentU(id);
  const sidePx = Math.ceil(requestedHalfU * 2 * BAKE_SCALE);
  const { canvas, ctx } = createOffscreen(sidePx, sidePx);
  // 그린 뒤에 실제 반변을 다시 계산한다. ceil이 올린 만큼을 무시하면 스프라이트가 논리
  // 크기보다 크게 그려져 탄이 반경보다 굵어 보인다
  const bakedHalfU = sidePx / (2 * BAKE_SCALE);
  ctx.setTransform(BAKE_SCALE, 0, 0, BAKE_SCALE, sidePx / 2, sidePx / 2);
  paintBulletShape(ctx, id, state);
  registerBulletSprite(id, state, { image: canvas, halfExtentU: bakedHalfU });
}

/**
 * backing store를 다시 만든 뒤에 부른다 (02 §5.3).
 *
 * 탄환·글로우 스프라이트는 다시 굽지 않는다 — 논리 단위 고정 크기라 DPR과 무관하다.
 * 무효가 되는 것은 ctx에 묶이는 해칭 패턴 하나뿐이다.
 */
export function handleViewChanged(): void {
  invalidateHatchPattern();
}

/**
 * main.ts가 캔버스 부팅 직후 한 번 부른다. 이 함수가 돌아온 뒤에는 지연 생성이 남아 있지 않다.
 *
 * async인 것은 아래 dev 진입 하나 때문이다 — 스트레스 씬을 정적 import하면 제출 빌드에도
 * 그 코드가 들어간다.
 */
export async function bakeSprites(view: CanvasView): Promise<void> {
  for (const color of GLOW_BAKE_COLORS) {
    bakeGlowSprite(color);
  }
  for (const id of PARRYABLE_BULLET_IDS) {
    for (const state of BULLET_SPRITE_STATES) {
      bakeBulletSprite(id, state);
    }
  }
  assertGlowSpritesBaked();
  assertBulletSpritesBaked();
  await startStressSceneIfRequested(view);
}

/**
 * P1 게이트용 임시 진입. `index.html#p1-stress`로 열었을 때만 돈다.
 *
 * 여기 있는 것은 부팅 사슬에서 P1이 소유한 파일이 이것뿐이기 때문이다. screens/manager.ts
 * (P6-1)가 생기면 진입은 그쪽으로 가고 이 함수는 지운다 — 03 §2.4가 정한 dev/의 자리는
 * 화면 관리자 아래다.
 *
 * dev/는 render/와 boot/를 import할 수 없으므로(eslint no-restricted-imports) 스트레스 씬이
 * 쓰는 그리기 함수는 여기서 묶어 넘긴다.
 */
async function startStressSceneIfRequested(view: CanvasView): Promise<void> {
  if (!window.location.hash.includes('p1-stress')) {
    return;
  }
  const stress = await import('../dev/p1-stress');
  stress.startP1Stress(view, {
    drawBulletGlowPass,
    drawBulletBodyPass,
    paintBulletShape,
    glow,
    hatch,
    poly,
    invalidateViewCaches: handleViewChanged,
  });
}
