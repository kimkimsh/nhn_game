/**
 * P1 스트레스 씬이 무엇으로 이루어져 있는가 — 06_렌더링과_게임필.md §3.7.2, 12 §10 E-16
 *
 * 개체 786(잡몹 20 + 적 탄환 280 + 반사탄 240 + 장판 6 + 파티클 240)의 상태와 갱신, 그리고
 * P4가 아직 안 만든 층을 대신하는 오프스크린 자산이 여기 있다. 게임 규칙은 없다.
 * 배치는 시드 난수라 매번 같은 장면이 나온다 — 같은 장면이 아니면 A/B가 두 설정이 아니라
 * 두 난수를 비교하게 된다.
 *
 * **연쇄 20링크가 도는 구간이 반드시 들어간다.** 없으면 게이트가 재는 프레임이 실제 최악
 * 프레임이 아니다 — 연쇄 중에만 파티클이 상한 240에 닿고 집중선 100 stroke이 겹친다.
 *
 * 프레임마다 내보내는 호출은 p1-stress.ts가 갖는다. 한 파일 400줄 상한(03 §6) 때문에 갈랐고,
 * 가른 축은 "부팅 시 한 번"과 "프레임마다"다.
 */

import { BULLETS } from '../config/bullets';
import { CHAIN_STAGGER_SEC, PARTICLES, SPEED_LINES, ZONE } from '../config/feel';
import type { ParryableBulletId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { createRng, type Rng } from '../core/rng';

/** render/sprites.ts의 같은 이름 타입과 구조가 같아야 한다. 문자열이라 순서 계약이 없다 */
export type BulletSpriteState = 'enemy' | 'reflectGrace' | 'reflect';

export interface StressBulletBatch {
  readonly count: number;
  readonly bulletId: readonly ParryableBulletId[];
  readonly state: readonly BulletSpriteState[];
  readonly xU: Float32Array;
  readonly yU: Float32Array;
  readonly angleRad: Float32Array;
  readonly spinRad: Float32Array;
}

/**
 * boot/sprite-bake.ts가 render/에서 묶어 넘기는 것.
 * dev/는 render/와 boot/를 import할 수 없어서(03 §5) 구조로만 맞춘다.
 */
export interface StressRenderApi {
  // 배율 인자가 없다. 두 패스가 들어올 때의 ctx 변환을 기준으로 쓴다 (render/sprites.ts)
  drawBulletGlowPass(ctx: CanvasRenderingContext2D, batch: StressBulletBatch): void;
  drawBulletBodyPass(ctx: CanvasRenderingContext2D, batch: StressBulletBatch): void;
  paintBulletShape(ctx: CanvasRenderingContext2D, id: ParryableBulletId, state: BulletSpriteState): void;
  glow(ctx: CanvasRenderingContext2D, xU: number, yU: number, radiusU: number, color: string, alpha: number): void;
  hatch(): CanvasPattern;
  poly(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]): void;
  invalidateViewCaches(): void;
}

/** boot/canvas.ts의 CanvasView와 구조가 같다. pixelsPerUnit은 리사이즈마다 바뀐다 */
export interface StressView {
  readonly ctx: CanvasRenderingContext2D;
  readonly logicalWidthU: number;
  readonly logicalHeightU: number;
  readonly pixelsPerUnit: number;
}

export interface Enemy { xU: number; yU: number; phase: number; hpRatio: number }
export interface Zone { xU: number; yU: number; radiusU: number; age: number }

/** 스펙 §14.1 S5 동시 적 탄환 상한. config/difficulty.ts(P2-5)가 생기면 그쪽에서 읽는다 */
const ENEMY_BULLET_COUNT = 280;
export const BULLET_COUNT = ENEMY_BULLET_COUNT + PLAYFIELD.maxReflectBullets;
export const DRAW_TARGET_COUNT =
  BULLET_COUNT + PLAYFIELD.maxEnemies + ZONE.maxConcurrent + PARTICLES.maxAlive;

/** P2 위주에 큰 글로우(P5·P6·P7)를 섞는다 — §3.7.2의 씬 구성 */
const ENEMY_BULLET_MIX: readonly (readonly [ParryableBulletId, number])[] = [
  ['P2', 170], ['P1', 30], ['P10', 20], ['P3', 10], ['P8', 10],
  ['P5', 10], ['P4', 10], ['P11', 10], ['P6', 6], ['P7', 4],
];
const REFLECT_BULLET_MIX: readonly (readonly [ParryableBulletId, number])[] = [
  ['P2', 145], ['P1', 26], ['P10', 17], ['P3', 9], ['P8', 9],
  ['P5', 9], ['P4', 9], ['P11', 9], ['P6', 5], ['P7', 2],
];
/** 반사탄 넷 중 하나는 자해 유예 중이다 — rim 없는 스프라이트가 실제로 화면에 나오게 한다 */
const GRACE_EVERY = 4;

const SCENE_SEED = 0x5e3d0c;
const SPIN_RATE_RAD_PER_SEC = 4.2;
const BULLET_MARGIN_U = 120;
const ZONE_START_AGE_SPREAD_SEC = 4;
const ENEMY_HP_MIN_RATIO = 0.2;
const ENEMY_HP_RANGE_RATIO = 0.7;

/** 잡몹 stand-in의 형태 — §3.5의 개당 본체 19회를 만드는 부품 수다 */
export const ENEMY_WIDTH_U = 54;
const ENEMY_RIVET_COUNT = 9;
const ENEMY_SEAM_COUNT = 4;
const ENEMY_SHOULDER_COUNT = 2;
const ENEMY_SEAM_STROKE_U = 2;
const ENEMY_ARM_STROKE_U = 3;
export const ENEMY_BAKE_SCALE = 2;

/** 연쇄 20링크 = 잡몹 상한(= 최대 연쇄 길이). 링크 간격은 config의 스태거다 */
export const CHAIN_LINK_COUNT = PLAYFIELD.maxEnemies;
export const SPEED_LINE_COUNT = SPEED_LINES.parryGreat.count + SPEED_LINES.chainStart.count;
const CHAIN_PERIOD_SEC = 1.2;
const CHAIN_EARLY_LINKS = 3;

const bulletId: ParryableBulletId[] = [];
const bulletState: BulletSpriteState[] = [];

export const batch: StressBulletBatch = {
  count: BULLET_COUNT,
  bulletId,
  state: bulletState,
  xU: new Float32Array(BULLET_COUNT),
  yU: new Float32Array(BULLET_COUNT),
  angleRad: new Float32Array(BULLET_COUNT),
  spinRad: new Float32Array(BULLET_COUNT),
};
export const enemies: Enemy[] = [];
export const zones: Zone[] = [];
export const particleXU = new Float32Array(PARTICLES.maxAlive);
export const particleYU = new Float32Array(PARTICLES.maxAlive);
const particleVxU = new Float32Array(PARTICLES.maxAlive);
const particleVyU = new Float32Array(PARTICLES.maxAlive);
const particleLifeSec = new Float32Array(PARTICLES.maxAlive);
let particleCursor = 0;

let rng: Rng = createRng(SCENE_SEED);
let sceneTimeSec = 0;
let chainTimeSec = 0;
let backdropCanvas: HTMLCanvasElement | null = null;
let enemyCanvas: HTMLCanvasElement | null = null;

/**
 * render/primitives.ts hexA의 dev쪽 사본. dev/는 render/를 import할 수 없다(03 §5)는
 * 계층 규칙이 만든 중복이고, 대안은 팔레트 색을 rgba 리터럴로 다시 적는 것뿐이다.
 */
export function withAlpha(hex: string, alpha: number): string {
  const packed = parseInt(hex.slice(1), 16);
  return `rgba(${(packed >> 16) & 255},${(packed >> 8) & 255},${packed & 255},${alpha})`;
}

/** 씬 시각 (초). 잡몹 예비동작 맥동이 이 값을 읽는다 */
export function sceneTime(): number {
  return sceneTimeSec;
}

/** 연쇄 주기 안의 경과 시간 (초). 집중선·임팩트 프레임의 창 판정이 이 값을 읽는다 */
export function chainTime(): number {
  return chainTimeSec;
}

/** 지금 몇 번째 링크인지. 주기의 앞 0.8초에서만 진행하고 그 밖에서는 −1이다 */
export function currentChainLink(): number {
  const link = Math.floor(chainTimeSec / CHAIN_STAGGER_SEC);
  return link < CHAIN_LINK_COUNT ? link : -1;
}

/** §4.3의 균등 링 + 지터. 상한에 닿으면 커서가 가장 오래된 슬롯을 덮는다 */
function spawnParticle(xU: number, yU: number, spread: number, indexInBurst: number, burstCount: number): void {
  const slot = particleCursor;
  particleCursor = (particleCursor + 1) % PARTICLES.maxAlive;
  const angle = (Math.PI * 2 * indexInBurst) / burstCount + rng.float() * PARTICLES.angleJitterRad;
  const speed = spread * (PARTICLES.distanceMinRatio + rng.float() * PARTICLES.distanceRandRatio);
  particleXU[slot] = xU;
  particleYU[slot] = yU;
  particleVxU[slot] = Math.cos(angle) * speed;
  particleVyU[slot] = Math.sin(angle) * speed + PARTICLES.initialKickUPerSec;
  particleLifeSec[slot] = PARTICLES.lifetimeBaseSec + rng.float() * PARTICLES.lifetimeRandSec;
}

function fillMix(
  mix: readonly (readonly [ParryableBulletId, number])[],
  state: BulletSpriteState,
  offset: number,
): number {
  let index = offset;
  for (const [id, count] of mix) {
    for (let i = 0; i < count; i += 1) {
      bulletId[index] = id;
      // 반사탄 일부만 유예 상태로 둔다. 적 탄환에는 이 갈래가 없다
      bulletState[index] = state !== 'enemy' && index % GRACE_EVERY === 0 ? 'reflectGrace' : state;
      batch.xU[index] = rng.float() * PLAYFIELD.widthU;
      batch.yU[index] = rng.float() * PLAYFIELD.heightU;
      batch.angleRad[index] = rng.float() * Math.PI * 2;
      batch.spinRad[index] = rng.float() * Math.PI * 2;
      index += 1;
    }
  }
  return index;
}

/** 시드부터 다시 만든다. 두 번 불러도 같은 장면이 나와야 한다 */
export function buildScene(): void {
  rng = createRng(SCENE_SEED);
  sceneTimeSec = 0;
  chainTimeSec = 0;
  bulletId.length = 0;
  bulletState.length = 0;
  fillMix(REFLECT_BULLET_MIX, 'reflect', fillMix(ENEMY_BULLET_MIX, 'enemy', 0));

  enemies.length = 0;
  for (let i = 0; i < PLAYFIELD.maxEnemies; i += 1) {
    enemies.push({
      xU: rng.float() * PLAYFIELD.widthU,
      yU: rng.float() * PLAYFIELD.enemyBounds.maxYU,
      phase: rng.float() * Math.PI * 2,
      hpRatio: ENEMY_HP_MIN_RATIO + rng.float() * ENEMY_HP_RANGE_RATIO,
    });
  }
  zones.length = 0;
  for (let i = 0; i < ZONE.maxConcurrent; i += 1) {
    zones.push({
      xU: rng.float() * PLAYFIELD.widthU,
      yU: rng.float() * PLAYFIELD.heightU,
      radiusU: BULLETS.P9.radiusU,
      age: rng.float() * ZONE_START_AGE_SPREAD_SEC,
    });
  }
  particleCursor = 0;
  for (let i = 0; i < PARTICLES.maxAlive; i += 1) {
    spawnParticle(
      rng.float() * PLAYFIELD.widthU, rng.float() * PLAYFIELD.heightU,
      PARTICLES.large.spreadUPerSec, i, PARTICLES.maxAlive,
    );
  }
}

function advanceChain(dtSec: number): void {
  const previousLink = currentChainLink();
  chainTimeSec += dtSec;
  if (chainTimeSec >= CHAIN_PERIOD_SEC) {
    chainTimeSec -= CHAIN_PERIOD_SEC;
  }
  const link = currentChainLink();
  if (link < 0 || link === previousLink) {
    return;
  }
  const count = link < CHAIN_EARLY_LINKS ? PARTICLES.chainLinkCount : PARTICLES.chainLinkCountAfter4;
  const originX = rng.float() * PLAYFIELD.widthU;
  const originY = rng.float() * PLAYFIELD.enemyBounds.maxYU;
  for (let i = 0; i < count; i += 1) {
    spawnParticle(originX, originY, PARTICLES.large.spreadUPerSec, i, count);
  }
}

function advanceBullets(dtSec: number): void {
  const wrapWidth = PLAYFIELD.widthU + BULLET_MARGIN_U * 2;
  const wrapHeight = PLAYFIELD.heightU + BULLET_MARGIN_U * 2;
  for (let i = 0; i < BULLET_COUNT; i += 1) {
    // count ≤ 배열 길이가 불변 조건이므로 인덱스는 항상 유효하다.
    // noUncheckedIndexedAccess가 typed array 접근에도 걸려서 여기서 벗긴다
    const speed = BULLETS[bulletId[i]!].speedUPerSec;
    const angle = batch.angleRad[i]!;
    let x = batch.xU[i]! + Math.cos(angle) * speed * dtSec;
    let y = batch.yU[i]! + Math.sin(angle) * speed * dtSec;
    // 화면 밖으로 나가면 반대쪽으로 돌린다. 개수를 상한에 붙여 두는 것이 이 씬의 조건이다
    if (x < -BULLET_MARGIN_U) { x += wrapWidth; }
    if (x > PLAYFIELD.widthU + BULLET_MARGIN_U) { x -= wrapWidth; }
    if (y < -BULLET_MARGIN_U) { y += wrapHeight; }
    if (y > PLAYFIELD.heightU + BULLET_MARGIN_U) { y -= wrapHeight; }
    batch.xU[i] = x;
    batch.yU[i] = y;
    batch.spinRad[i] = batch.spinRad[i]! + SPIN_RATE_RAD_PER_SEC * dtSec;
  }
}

function advanceParticles(dtSec: number): void {
  for (let i = 0; i < PARTICLES.maxAlive; i += 1) {
    particleVyU[i] = particleVyU[i]! + PARTICLES.gravityUPerSec2 * dtSec;
    particleXU[i] = particleXU[i]! + particleVxU[i]! * dtSec;
    particleYU[i] = particleYU[i]! + particleVyU[i]! * dtSec;
    particleLifeSec[i] = particleLifeSec[i]! - dtSec;
    // 죽은 슬롯을 즉시 되살린다. 게이트가 재려는 것은 파티클이 상한에 붙어 있는 프레임이고,
    // 연쇄 사이 구간에서 개수가 줄면 그 프레임은 최악 프레임이 아니다
    if (particleLifeSec[i]! <= 0) {
      particleCursor = i;
      spawnParticle(
        rng.float() * PLAYFIELD.widthU, rng.float() * PLAYFIELD.heightU,
        PARTICLES.medium.spreadUPerSec, i, PARTICLES.maxAlive,
      );
    }
  }
}

function createOffscreen(widthPx: number, heightPx: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('stand-in 오프스크린 컨텍스트를 얻지 못했다');
  }
  return ctx;
}

/** 배경 정적 굽기 자리를 채운다 — §3.7.2가 "S5 노량, 정적 굽기 적용"으로 못 박은 1 drawImage */
export function backdrop(): HTMLCanvasElement {
  if (backdropCanvas === null) {
    const ctx = createOffscreen(PLAYFIELD.widthU, PLAYFIELD.heightU);
    const gradient = ctx.createLinearGradient(0, 0, 0, PLAYFIELD.heightU);
    gradient.addColorStop(0, PALETTE.ink700);
    gradient.addColorStop(1, PALETTE.ink900);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
    backdropCanvas = ctx.canvas;
  }
  return backdropCanvas;
}

/**
 * 잡몹 본체 19회 + 그림자 1회 — §3.5가 신고한 개당 25회의 대부분이다.
 * 굽기 A/B의 양쪽이 같은 그림을 내야 비교가 성립하므로 굽기와 즉석 그리기가 이 함수를 공유한다.
 */
export function paintEnemyBody(ctx: CanvasRenderingContext2D): void {
  const w = ENEMY_WIDTH_U;
  ctx.fillStyle = PALETTE.ink900;
  ctx.beginPath();
  ctx.ellipse(0, w * 0.62, w * 0.5, w * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.ink700;
  ctx.fillRect(-w * 0.34, -w * 0.1, w * 0.68, w * 0.72);
  ctx.fillStyle = PALETTE.jeokDim;
  ctx.beginPath();
  ctx.arc(0, -w * 0.16, w * 0.42, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.ink900;
  ctx.fillRect(-w * 0.26, -w * 0.2, w * 0.52, w * 0.1);
  ctx.fillStyle = PALETTE.jeokDim;
  for (let i = 0; i < ENEMY_RIVET_COUNT; i += 1) {
    ctx.beginPath();
    ctx.arc(-w * 0.28 + (i % 3) * w * 0.28, w * 0.02 + Math.floor(i / 3) * w * 0.2, w * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = PALETTE.ink900;
  ctx.lineWidth = ENEMY_SEAM_STROKE_U;
  for (let i = 0; i < ENEMY_SEAM_COUNT; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.34, -w * 0.04 + i * w * 0.17);
    ctx.lineTo(w * 0.34, -w * 0.04 + i * w * 0.17);
    ctx.stroke();
  }
  ctx.fillStyle = PALETTE.ink700;
  for (let i = 0; i < ENEMY_SHOULDER_COUNT; i += 1) {
    ctx.beginPath();
    ctx.arc((i === 0 ? -1 : 1) * w * 0.4, w * 0.02, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = PALETTE.jeok;
  ctx.lineWidth = ENEMY_ARM_STROKE_U;
  ctx.beginPath();
  ctx.moveTo(w * 0.1, w * 0.1);
  ctx.lineTo(w * 0.62, -w * 0.2);
  ctx.stroke();
}

/** 06 §3.6 1순위 손잡이 — 본체 20회가 drawImage 1회가 된다 */
export function enemySprite(): HTMLCanvasElement {
  if (enemyCanvas === null) {
    const side = Math.ceil(ENEMY_WIDTH_U * 2 * ENEMY_BAKE_SCALE);
    const ctx = createOffscreen(side, side);
    ctx.setTransform(ENEMY_BAKE_SCALE, 0, 0, ENEMY_BAKE_SCALE, side / 2, side / 2);
    paintEnemyBody(ctx);
    enemyCanvas = ctx.canvas;
  }
  return enemyCanvas;
}

/** 호출 순서 제약: 프레임마다 그리기 **전에** 한 번. dtSec은 sim이 아니라 벽시계 간격이다 */
export function update(dtSec: number): void {
  sceneTimeSec += dtSec;
  advanceChain(dtSec);
  advanceBullets(dtSec);
  for (const zone of zones) {
    zone.age += dtSec;
  }
  advanceParticles(dtSec);
}
