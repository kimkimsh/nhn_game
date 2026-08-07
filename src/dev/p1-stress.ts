/**
 * P1 게이트용 스트레스 씬의 그리기와 진입 — 06_렌더링과_게임필.md §3.7.2
 *
 * 씬의 상태와 갱신은 p1-stress-scene.ts에 있다. 이 파일은 그것을 어떤 호출로 내보내는가만 갖는다.
 *
 * **여기서 그리는 잡몹·장판·배경은 stand-in이다.** render/enemy.ts·zone.ts·backgrounds/는
 * P4 소유라 아직 없다. 대신 그 층들이 06 §3.5에 신고한 **호출 수와 종류**를 그대로 내보낸다.
 * 안 채우면 게이트가 실제보다 20% 가벼운 프레임을 재게 되고, 그 측정으로는 아무것도 판정할 수 없다.
 *
 * 층 순서는 06 §2의 레이어 계약을 따른다 — 배경 → 장판 → 적 → 탄환 → 임팩트 프레임 →
 * 파티클. 플레이어와 HUD는 잔여 예산 대역이 대신 낸다.
 */

import { BULLETS } from '../config/bullets';
import { IMPACT_FRAME, PARTICLES, SPEED_LINES, ZONE } from '../config/feel';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { beginFrame, drawOverlay, endFrame, instrumentContext, resetSamples } from './overlay';
import {
  CHAIN_LINK_COUNT,
  DRAW_TARGET_COUNT,
  ENEMY_BAKE_SCALE,
  ENEMY_WIDTH_U,
  SPEED_LINE_COUNT,
  backdrop,
  batch,
  buildScene,
  chainTime,
  currentChainLink,
  enemies,
  enemySprite,
  paintEnemyBody,
  particleXU,
  particleYU,
  sceneTime,
  update,
  withAlpha,
  zones,
  type StressRenderApi,
  type StressView,
} from './p1-stress-scene';

/** §3.5 잡몹 개당 25회 = 헤더 글로우 2 + 예비동작 글로우 1 + 본체 19 + 그림자 1 + HP바 2 */
const ENEMY_HEADER_GLOWS = 2;
const ENEMY_HEADER_GLOW_ALPHA = 0.32;
const ENEMY_CHARGE_RATE = 6;
const ENEMY_HP_BAR_WIDTH_U = 70;
const ENEMY_HP_BAR_HEIGHT_U = 7;

/**
 * 굽기 미적용 경로가 목업 그대로 쓰는 값 — engine.js:181·184-186.
 * render/sprites.ts에도 같은 숫자가 있고 그것이 A/B의 조건이다 — 두 경로가 다른 값을 쓰면
 * 재는 것이 굽기의 효과가 아니라 두 설정의 차이가 된다.
 */
const UNBAKED_GLOW_SCALE = 1.6;
const UNBAKED_GLOW_BASE_U = 26;
const UNBAKED_GLOW_ALPHA_ENEMY = 0.42;
const UNBAKED_GLOW_ALPHA_REFLECT = 0.6;
const UNBAKED_STREAK_ALPHA = 0.35;
const UNBAKED_STREAK_WIDTH = 1.1;
const UNBAKED_STREAK_LENGTH = 3;

const PARTICLE_SIZE_U = 6;
const ZONE_PULSE_RATE = 6;
const ZONE_PULSE_BASE = 0.82;
const ZONE_PULSE_SWING = 0.18;
const ZONE_FILL_ALPHA = 0.55;
const ZONE_HATCH_ALPHA = 0.16;
const ZONE_GLOW_SCALE = 1.4;
const ZONE_GLOW_ALPHA = 0.5;
const ZONE_DASH_U = [16, 9];
const ZONE_OUTLINE_U = 3;

/**
 * §3.5 예산 표에서 이 씬이 직접 그리지 않는 층 — 전부 P4·P5·P6 소유다.
 * 종류와 개수만 맞춰 내보낸다. 합계 522회이고, 씬이 직접 내는 2,146회와 더해 2,668이 된다.
 */
const RESIDUAL_ROWS: readonly { kind: string; count: number }[] = [
  { kind: 'arcStroke', count: 276 },   // cheonghae wave, two layers
  { kind: 'arcStroke', count: 28 },    // foam
  { kind: 'stripImage', count: 4 },    // burning ship glow
  { kind: 'arcFill', count: 46 },      // embers
  { kind: 'lineStroke', count: 54 },   // rain
  { kind: 'lineStroke', count: 16 },   // telegraphs
  { kind: 'arcFill', count: 51 },      // player
  { kind: 'text', count: 4 },          // grade popups
  { kind: 'stripImage', count: 1 },    // vignette
  { kind: 'text', count: 42 },         // HUD
];
/** 06 §3.6 2순위 손잡이 — 청해파문+포말 304 stroke이 18 drawImage가 된다 */
const WAVE_STROKE_TOTAL = 304;
const WAVE_STRIP_ROWS = 18;
const RESIDUAL_ALPHA = 0.14;
const RESIDUAL_FONT_PX = 20;
const RESIDUAL_STROKE_U = 2;
const RESIDUAL_ARC_BASE_U = 60;
const RESIDUAL_ARC_STEP_U = 12;
const RESIDUAL_EMBER_RU = 4;
const RESIDUAL_RAIN_DX_U = 18;
const RESIDUAL_RAIN_DY_U = 90;
const RESIDUAL_STRIP_DIVISOR = 8;
const RESIDUAL_SCATTER = 7;
const RESIDUAL_ARC_VARIANTS = 9;

const SPEED_LINE_WIDTH_STEPS = 11;
const SPEED_LINE_ORIGIN_Y_RATIO = 0.4;
const MAX_STEP_SEC = 0.05;

interface Toggles {
  bakedBullets: boolean;
  bakedEnemies: boolean;
  residualBand: boolean;
  wavesAsStrips: boolean;
  paused: boolean;
}

const toggles: Toggles = {
  bakedBullets: true, bakedEnemies: false, residualBand: true, wavesAsStrips: false, paused: false,
};

let previousPixelsPerUnit = 0;

function drawEnemies(ctx: CanvasRenderingContext2D, api: StressRenderApi): void {
  const sprite = enemySprite();
  const now = sceneTime();
  for (const enemy of enemies) {
    for (let i = 0; i < ENEMY_HEADER_GLOWS; i += 1) {
      api.glow(ctx, enemy.xU, enemy.yU, ENEMY_WIDTH_U * (1 + i * 0.4), PALETTE.jeok, ENEMY_HEADER_GLOW_ALPHA);
    }
    // 씬의 잡몹은 전부 발사 예비동작 중이다 — 예비동작 글로우가 다 켜진 프레임이 최악 프레임이다
    const charge = 0.5 + Math.sin(now * ENEMY_CHARGE_RATE + enemy.phase) * 0.4;
    api.glow(ctx, enemy.xU, enemy.yU, ENEMY_WIDTH_U * 0.9, PALETTE.jeokHot, charge);

    ctx.save();
    ctx.translate(enemy.xU, enemy.yU);
    if (toggles.bakedEnemies) {
      const half = sprite.width / (2 * ENEMY_BAKE_SCALE);
      ctx.drawImage(sprite, -half, -half, half * 2, half * 2);
    } else {
      paintEnemyBody(ctx);
    }
    ctx.restore();

    // HP 바는 hp 종속이라 굽기 대상이 아니다 (06 §3.5). 두 모드 모두 2회를 낸다
    const barX = enemy.xU - ENEMY_HP_BAR_WIDTH_U / 2;
    const barY = enemy.yU - ENEMY_WIDTH_U * 0.9;
    ctx.fillStyle = PALETTE.ink800;
    ctx.fillRect(barX, barY, ENEMY_HP_BAR_WIDTH_U, ENEMY_HP_BAR_HEIGHT_U);
    ctx.fillStyle = PALETTE.jeok;
    ctx.fillRect(barX, barY, ENEMY_HP_BAR_WIDTH_U * enemy.hpRatio, ENEMY_HP_BAR_HEIGHT_U);
  }
}

/** 이식: engine.js drawZone (288-315) 축약본. 꼭짓점은 config/feel.ts의 ZONE 계수로 만든다 */
function drawZones(ctx: CanvasRenderingContext2D, api: StressRenderApi): void {
  for (const zone of zones) {
    const pulse = ZONE_PULSE_BASE + Math.sin(zone.age * ZONE_PULSE_RATE) * ZONE_PULSE_SWING;
    const points: [number, number][] = [];
    for (let i = 0; i < ZONE.polyVertices; i += 1) {
      const angle = (i / ZONE.polyVertices) * Math.PI * 2 + ZONE.polyStartAngleRad;
      const step = ((i * ZONE.polyStrideIndex) % ZONE.polyModulus) * ZONE.polyStepRatio;
      const reach = zone.radiusU * (ZONE.polyBaseRatio + step);
      points.push([zone.xU + Math.cos(angle) * reach, zone.yU + Math.sin(angle) * reach]);
    }
    ctx.save();
    api.poly(ctx, points);
    ctx.fillStyle = withAlpha(PALETTE.takjeok, ZONE_FILL_ALPHA * pulse);
    ctx.fill();
    ctx.clip();
    ctx.globalAlpha = ZONE_HATCH_ALPHA;
    ctx.fillStyle = api.hatch();
    ctx.fillRect(zone.xU - zone.radiusU, zone.yU - zone.radiusU, zone.radiusU * 2, zone.radiusU * 2);
    ctx.restore();
    ctx.strokeStyle = PALETTE.jeok;
    ctx.lineWidth = ZONE_OUTLINE_U;
    ctx.setLineDash(ZONE_DASH_U);
    api.poly(ctx, points);
    ctx.stroke();
    ctx.setLineDash([]);
    api.glow(ctx, zone.xU, zone.yU, zone.radiusU * ZONE_GLOW_SCALE, PALETTE.takjeok, ZONE_GLOW_ALPHA);
  }
}

/** 굽기 미적용 A/B — 목업 drawBullet 그대로. 발당 save/rotate와 path 작도가 살아난다 */
function drawBulletsUnbaked(ctx: CanvasRenderingContext2D, api: StressRenderApi): void {
  for (let i = 0; i < batch.count; i += 1) {
    const id = batch.bulletId[i]!;
    const state = batch.state[i]!;
    const r = BULLETS[id].radiusU;
    const angle = batch.angleRad[i]!;
    ctx.save();
    ctx.translate(batch.xU[i]!, batch.yU[i]!);
    api.glow(
      ctx, 0, 0, r * UNBAKED_GLOW_SCALE + UNBAKED_GLOW_BASE_U,
      state === 'enemy' ? PALETTE.jeok : PALETTE.hwang,
      state === 'enemy' ? UNBAKED_GLOW_ALPHA_ENEMY : UNBAKED_GLOW_ALPHA_REFLECT,
    );
    if (state !== 'enemy') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(PALETTE.hwang, UNBAKED_STREAK_ALPHA);
      ctx.lineWidth = r * UNBAKED_STREAK_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-Math.cos(angle) * r * UNBAKED_STREAK_LENGTH, -Math.sin(angle) * r * UNBAKED_STREAK_LENGTH);
      ctx.stroke();
      ctx.restore();
    }
    ctx.rotate(angle + Math.PI / 2 + (id === 'P4' ? batch.spinRad[i]! : 0));
    api.paintBulletShape(ctx, id, state);
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = PALETTE.hwang;
  for (let i = 0; i < PARTICLES.maxAlive; i += 1) {
    ctx.fillRect(particleXU[i]!, particleYU[i]!, PARTICLE_SIZE_U, PARTICLE_SIZE_U);
  }
}

/**
 * 링크 1의 0.15초 창에서만 그린다 — §3.5가 최악 프레임에 얹은 집중선 100 stroke과
 * 임팩트 프레임 1 fillRect가 정확히 이 자리다.
 */
function drawChainEffects(ctx: CanvasRenderingContext2D): void {
  const elapsed = chainTime();
  if (elapsed > SPEED_LINES.parryGreat.durationSec) {
    return;
  }
  const originX = PLAYFIELD.widthU / 2;
  const originY = PLAYFIELD.heightU * SPEED_LINE_ORIGIN_Y_RATIO;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = SPEED_LINES.alpha;
  ctx.strokeStyle = PALETTE.baek;
  for (let i = 0; i < SPEED_LINE_COUNT; i += 1) {
    const angle = (Math.PI * 2 * i) / SPEED_LINE_COUNT + Math.sin(i) * SPEED_LINES.angleJitterRad;
    ctx.lineWidth = SPEED_LINES.widthBaseU
      + ((i * RESIDUAL_SCATTER) % SPEED_LINE_WIDTH_STEPS) * (SPEED_LINES.widthRandU / SPEED_LINE_WIDTH_STEPS);
    ctx.beginPath();
    ctx.moveTo(
      originX + Math.cos(angle) * SPEED_LINES.startRadiusU,
      originY + Math.sin(angle) * SPEED_LINES.startRadiusU,
    );
    ctx.lineTo(
      originX + Math.cos(angle) * SPEED_LINES.endRadiusU,
      originY + Math.sin(angle) * SPEED_LINES.endRadiusU,
    );
    ctx.stroke();
  }
  ctx.restore();

  if (elapsed <= IMPACT_FRAME.durationSec) {
    ctx.save();
    ctx.fillStyle = PALETTE.baek;
    ctx.globalAlpha = IMPACT_FRAME.alphaHigh;
    ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
    ctx.restore();
  }
}

/**
 * 아직 없는 층들의 호출만 낸다. 그림이 아니라 부하이고, 맞추는 것은 종류와 개수다.
 * 청해파문 A/B는 arcStroke 두 행(304회)을 18 drawImage로 바꾼다.
 */
function drawResidualBand(ctx: CanvasRenderingContext2D): void {
  const strip = backdrop();
  ctx.save();
  ctx.globalAlpha = RESIDUAL_ALPHA;
  ctx.strokeStyle = PALETTE.cheongDim;
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `${RESIDUAL_FONT_PX}px monospace`;
  ctx.lineWidth = RESIDUAL_STROKE_U;
  const stripHeight = PLAYFIELD.heightU / RESIDUAL_STRIP_DIVISOR;
  for (const row of RESIDUAL_ROWS) {
    const asStrip = toggles.wavesAsStrips && row.kind === 'arcStroke';
    const count = asStrip ? Math.round((WAVE_STRIP_ROWS * row.count) / WAVE_STROKE_TOTAL) : row.count;
    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      const x = t * PLAYFIELD.widthU;
      const y = ((t * RESIDUAL_SCATTER) % 1) * PLAYFIELD.heightU;
      if (asStrip || row.kind === 'stripImage') {
        ctx.drawImage(strip, 0, y, PLAYFIELD.widthU, stripHeight);
      } else if (row.kind === 'arcStroke') {
        ctx.beginPath();
        ctx.arc(x, y, RESIDUAL_ARC_BASE_U + (i % RESIDUAL_ARC_VARIANTS) * RESIDUAL_ARC_STEP_U, 0, Math.PI);
        ctx.stroke();
      } else if (row.kind === 'arcFill') {
        ctx.beginPath();
        ctx.arc(x, y, RESIDUAL_EMBER_RU, 0, Math.PI * 2);
        ctx.fill();
      } else if (row.kind === 'lineStroke') {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + RESIDUAL_RAIN_DX_U, y + RESIDUAL_RAIN_DY_U);
        ctx.stroke();
      } else {
        ctx.fillText('0', x, y);
      }
    }
  }
  ctx.restore();
}

function draw(view: StressView, api: StressRenderApi): void {
  const ctx = view.ctx;
  const scale = view.pixelsPerUnit;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(backdrop(), 0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
  drawZones(ctx, api);
  drawEnemies(ctx, api);
  if (toggles.bakedBullets) {
    api.drawBulletGlowPass(ctx, batch);
    api.drawBulletBodyPass(ctx, batch);
  } else {
    drawBulletsUnbaked(ctx, api);
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  drawChainEffects(ctx);
  drawParticles(ctx);
  if (toggles.residualBand) {
    drawResidualBand(ctx);
  }
}

function statusLines(): readonly string[] {
  const link = currentChainLink();
  return [
    `연쇄 링크 ${link < 0 ? '-' : link + 1}/${CHAIN_LINK_COUNT}`,
    `[1] 탄환 굽기 ${toggles.bakedBullets ? 'ON' : 'OFF'}   [2] 잡몹 굽기 ${toggles.bakedEnemies ? 'ON' : 'OFF'}`,
    `[3] 잔여 예산 대역 ${toggles.residualBand ? 'ON' : 'OFF'}   [4] 청해파문 스트립 ${toggles.wavesAsStrips ? 'ON' : 'OFF'}`,
    `[R] 표본 초기화   [P] ${toggles.paused ? '재개' : '정지'}`,
  ];
}

function bindKeys(): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === '1') { toggles.bakedBullets = !toggles.bakedBullets; }
    else if (key === '2') { toggles.bakedEnemies = !toggles.bakedEnemies; }
    else if (key === '3') { toggles.residualBand = !toggles.residualBand; }
    else if (key === '4') { toggles.wavesAsStrips = !toggles.wavesAsStrips; }
    else if (key === 'p') { toggles.paused = !toggles.paused; return; }
    else if (key !== 'r') { return; }
    // 손잡이를 바꾸면 창을 비운다. 안 비우면 이전 설정의 표본이 백분위에 섞인다
    resetSamples();
  });
}

/** boot/sprite-bake.ts가 `index.html#p1-stress`에서만 부른다 */
export function startP1Stress(view: StressView, api: StressRenderApi): void {
  instrumentContext(view.ctx);
  buildScene();
  backdrop();
  enemySprite();
  bindKeys();
  previousPixelsPerUnit = view.pixelsPerUnit;

  let previousNowMs = Number.NaN;
  const step = (nowMs: number): void => {
    requestAnimationFrame(step);
    const dtSec = Number.isNaN(previousNowMs) ? 0 : Math.min((nowMs - previousNowMs) / 1000, MAX_STEP_SEC);
    previousNowMs = nowMs;
    if (view.pixelsPerUnit !== previousPixelsPerUnit) {
      previousPixelsPerUnit = view.pixelsPerUnit;
      api.invalidateViewCaches();
    }
    beginFrame(nowMs);
    if (!toggles.paused) {
      update(dtSec);
    }
    draw(view, api);
    // 계수를 얼린 뒤에 오버레이를 그린다. 순서가 뒤집히면 오버레이의 fillText가 자기 표시값에 섞인다
    endFrame(nowMs, DRAW_TARGET_COUNT);
    drawOverlay(view.ctx, statusLines());
  };
  requestAnimationFrame(step);
}
