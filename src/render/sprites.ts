/**
 * 구운 탄환 스프라이트의 보관소와, 탄환 층을 두 패스로 내보내는 헬퍼
 * — 06_렌더링과_게임필.md §3.1 · §1.4, 12_통합_계약.md §1 C-04 · §7.2 · §10 E-14
 *
 * 굽는 것은 boot/sprite-bake.ts이고 이 파일은 조회와 그리기만 한다.
 * 글로우 스프라이트는 primitives.ts가 갖는다 — 그 파일 머리말에 이유가 있다.
 *
 * **두 패스가 이 파일의 존재 이유다.** 발마다 `글로우(lighter) → 본체(source-over)`로
 * 그리면 520발에서 합성 모드가 1,040번 왕복한다. 글로우 전부를 먼저 내보내고 모드를
 * 한 번만 바꾸면 2번이 된다. 층 안의 재배열이라 06 §2의 레이어 계약은 건드리지 않는다 —
 * 그 계약이 규정하는 것은 층 사이의 순서다.
 */

import { BULLETS } from '../config/bullets';
import type { ParryableBulletId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { getGlowSprite, hexA } from './primitives';

/**
 * 스프라이트를 굽는 10종 — 12 §1 C-04.
 *
 * P9 화염 장판과 P12 관통 대창이 빠진 것은 목업 drawBullet의 shape 분기에 case가 없고
 * (engine.js:202-269) §6.1이 둘을 패리 불가로 두어 반사탄이 되지 않기 때문이다.
 * 배열 순서 자체는 계약이 아니다 — 조회는 전부 id 문자열로 한다.
 */
export const PARRYABLE_BULLET_IDS: readonly ParryableBulletId[] = [
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P10', 'P11',
];

/**
 * 한 종류가 갖는 3상태 — 02_아키텍처.md §5.2.
 *
 * 'reflectGrace'가 따로 있는 것은 자해 유예 0.15초 동안 적색 rim을 그리지 않기 때문이다
 * (06 §5.3). §17이 요구한 유예 구분이 rim의 유무 그 자체라 상태가 2가 아니라 3이다.
 */
export type BulletSpriteState = 'enemy' | 'reflectGrace' | 'reflect';

export const BULLET_SPRITE_STATES: readonly BulletSpriteState[] = [
  'enemy', 'reflectGrace', 'reflect',
];

/** 구운 한 장. halfExtentU는 논리 단위의 반변이고 그리기가 이 값으로 배치한다 */
export interface BakedBulletSprite {
  readonly image: CanvasImageSource;
  readonly halfExtentU: number;
}

/**
 * 탄환 층 한 프레임분. 배열은 프레임마다 새로 만들지 않고 재사용한다 —
 * 520발이면 프레임당 객체 520개가 GC로 가고, 그 GC가 p99에 그대로 나타난다.
 *
 * 불변 조건: 아래 모든 배열의 유효 구간은 [0, count)이다.
 */
export interface BulletBatch {
  readonly count: number;
  readonly bulletId: readonly ParryableBulletId[];
  readonly state: readonly BulletSpriteState[];
  readonly xU: Float32Array;
  readonly yU: Float32Array;
  /** 속도 방향 atan2(vy, vx) (rad). 본체 회전은 여기에 +π/2가 붙는다 */
  readonly angleRad: Float32Array;
  /** P4 수리검의 자체 회전 (rad). 나머지 종류는 0이다 */
  readonly spinRad: Float32Array;
}

/** engine.js:181 — 소형탄은 후광이 없으면 안 보이고, 대형탄은 반경 비례 후광이 형태를 지운다 */
const GLOW_RADIUS_SCALE = 1.6;
const GLOW_RADIUS_BASE_U = 26;
const GLOW_ALPHA_ENEMY = 0.42;
const GLOW_ALPHA_REFLECT = 0.6;

/** engine.js:183-195 반사탄 모션 스트릭 */
const STREAK_ALPHA = 0.35;
const STREAK_WIDTH_SCALE = 1.1;
const STREAK_LENGTH_SCALE = 3;
const STREAK_COLOR = hexA(PALETTE.hwang, STREAK_ALPHA);

/** engine.js:260-262 P7 도화선. 회전 프레임 안의 additive라 스프라이트에 굽지 못한다 */
const BOMB_FUSE_ID: ParryableBulletId = 'P7';
const BOMB_FUSE_OFFSET_X_SCALE = 0.5;
const BOMB_FUSE_OFFSET_Y_SCALE = -1.7;
const BOMB_FUSE_GLOW_RADIUS_U = 22;
const BOMB_FUSE_GLOW_ALPHA = 0.9;

/** engine.js:196 — 목업의 모양은 전부 −y를 향해 그려져 있다 */
const BODY_ANGLE_OFFSET_RAD = Math.PI / 2;

const bulletSprites = new Map<string, BakedBulletSprite>();

function spriteKey(id: ParryableBulletId, state: BulletSpriteState): string {
  return `${id}|${state}`;
}

export function registerBulletSprite(
  id: ParryableBulletId,
  state: BulletSpriteState,
  sprite: BakedBulletSprite,
): void {
  bulletSprites.set(spriteKey(id, state), sprite);
}

export function getBulletSprite(id: ParryableBulletId, state: BulletSpriteState): BakedBulletSprite {
  const sprite = bulletSprites.get(spriteKey(id, state));
  if (sprite === undefined) {
    throw new Error(`탄환 스프라이트가 안 구워졌다: ${id} ${state}`);
  }
  return sprite;
}

/** 30장이 다 있는지 부팅 마지막에 확인한다. 한 장이라도 빠지면 그 종류가 전투 중에 던진다 */
export function assertBulletSpritesBaked(): void {
  const expected = PARRYABLE_BULLET_IDS.length * BULLET_SPRITE_STATES.length;
  if (bulletSprites.size !== expected) {
    throw new Error(`탄환 스프라이트가 ${expected}장이어야 하는데 ${bulletSprites.size}장이다`);
  }
}

function glowAlphaFor(state: BulletSpriteState): number {
  return state === 'enemy' ? GLOW_ALPHA_ENEMY : GLOW_ALPHA_REFLECT;
}

function glowColorFor(state: BulletSpriteState): string {
  return state === 'enemy' ? PALETTE.jeok : PALETTE.hwang;
}

/**
 * 글로우 패스 — 탄환 층의 첫 번째. `lighter` 하나로 전부 내보낸다.
 *
 * 글로우 스프라이트는 radial gradient라 회전 대칭이므로 변환이 필요 없다. 반사탄 스트릭도
 * 가산이라 같은 패스에 합류하고, **절대 좌표로 계산해서** 그린다 — 회전 프레임에 두면
 * P4 수리검의 꼬리가 탄과 함께 돈다 (12 §7.2).
 *
 * **기준 변환을 스스로 세우지 않는다.** 들어올 때의 `ctx` 변환이 곧 논리 단위 프레임이고,
 * 거기에는 render/camera.ts의 흔들림 변위가 이미 걸려 있다. 배율을 숫자로 받아
 * `setTransform(pixelsPerUnit, …)`을 걸면 그 변위가 통째로 지워져 **탄환 층만 흔들림 밖으로
 * 빠져나간다** — 06 §2가 "흔들림이 1~9층을 감싼다"고 못 박은 자리다.
 *
 * 호출 순서 제약: 끝난 뒤 drawBulletBodyPass가 바로 이어져야 한다 —
 * 합성 모드를 `lighter`로 둔 채 돌려준다.
 */
export function drawBulletGlowPass(
  ctx: CanvasRenderingContext2D,
  batch: BulletBatch,
): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = STREAK_COLOR;
  ctx.lineCap = 'round';

  let currentAlpha = Number.NaN;
  for (let i = 0; i < batch.count; i += 1) {
    // count ≤ 배열 길이가 BulletBatch의 불변 조건이라 인덱스는 항상 유효하다.
    // noUncheckedIndexedAccess가 typed array 접근에도 걸리므로 여기서만 벗긴다
    const id = batch.bulletId[i]!;
    const state = batch.state[i]!;
    const x = batch.xU[i]!;
    const y = batch.yU[i]!;
    const radiusU = BULLETS[id].radiusU;

    const alpha = glowAlphaFor(state);
    if (alpha !== currentAlpha) {
      ctx.globalAlpha = alpha;
      currentAlpha = alpha;
    }
    const glowRadiusU = radiusU * GLOW_RADIUS_SCALE + GLOW_RADIUS_BASE_U;
    ctx.drawImage(
      getGlowSprite(glowColorFor(state)),
      x - glowRadiusU,
      y - glowRadiusU,
      glowRadiusU * 2,
      glowRadiusU * 2,
    );

    const angle = batch.angleRad[i]!;
    if (state !== 'enemy') {
      ctx.lineWidth = radiusU * STREAK_WIDTH_SCALE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x - Math.cos(angle) * radiusU * STREAK_LENGTH_SCALE,
        y - Math.sin(angle) * radiusU * STREAK_LENGTH_SCALE,
      );
      ctx.stroke();
    }

    if (id === BOMB_FUSE_ID) {
      // 도화선은 본체와 함께 도므로 회전을 손으로 적용한다. 본체 패스의 각도와 같아야 한다
      const bodyAngle = angle + BODY_ANGLE_OFFSET_RAD;
      const cos = Math.cos(bodyAngle);
      const sin = Math.sin(bodyAngle);
      const localX = radiusU * BOMB_FUSE_OFFSET_X_SCALE;
      const localY = radiusU * BOMB_FUSE_OFFSET_Y_SCALE;
      const fuseX = x + localX * cos - localY * sin;
      const fuseY = y + localX * sin + localY * cos;
      if (BOMB_FUSE_GLOW_ALPHA !== currentAlpha) {
        ctx.globalAlpha = BOMB_FUSE_GLOW_ALPHA;
        currentAlpha = BOMB_FUSE_GLOW_ALPHA;
      }
      ctx.drawImage(
        getGlowSprite(PALETTE.hwang),
        fuseX - BOMB_FUSE_GLOW_RADIUS_U,
        fuseY - BOMB_FUSE_GLOW_RADIUS_U,
        BOMB_FUSE_GLOW_RADIUS_U * 2,
        BOMB_FUSE_GLOW_RADIUS_U * 2,
      );
    }
  }
}

/**
 * 본체 패스 — 탄환 층의 두 번째. `source-over` 하나로 전부 내보낸다.
 *
 * save/restore 대신 기준 변환 복원 + translate + rotate를 직접 쓴다. 상태 스택 push/pop
 * 1,040회가 여기서 사라지고, 실측상 상태 호출 자체는 비용이 없다 (13 §4.3).
 *
 * **기준 변환은 들어올 때의 `ctx` 변환이다.** 배율 숫자로 다시 세우면 흔들림 변위가 지워진다
 * (drawBulletGlowPass의 머리말 참고). 그래서 한 번만 읽어 두고 발마다 그 위에 얹는다 —
 * `setTransform(base)`은 같은 객체를 넘기므로 발당 할당이 없다.
 *
 * 호출 순서 제약: drawBulletGlowPass 바로 뒤에만 부른다. 끝난 뒤 기준 변환을 되돌려 준다.
 */
export function drawBulletBodyPass(
  ctx: CanvasRenderingContext2D,
  batch: BulletBatch,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const base = ctx.getTransform();

  for (let i = 0; i < batch.count; i += 1) {
    const id = batch.bulletId[i]!;
    const sprite = getBulletSprite(id, batch.state[i]!);
    const angle = batch.angleRad[i]! + BODY_ANGLE_OFFSET_RAD + batch.spinRad[i]!;
    ctx.setTransform(base);
    ctx.translate(batch.xU[i]!, batch.yU[i]!);
    ctx.rotate(angle);
    const half = sprite.halfExtentU;
    ctx.drawImage(sprite.image, -half, -half, half * 2, half * 2);
  }

  ctx.setTransform(base);
}
