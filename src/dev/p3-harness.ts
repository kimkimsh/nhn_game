/**
 * P3-B 게이트를 눈으로 확인하는 임시 하네스.
 *
 * 화면(screens/)도 렌더러(render/)도 적 스폰(sim/enemies.ts)도 아직 없으므로, 그 셋이 붙기
 * 전까지 sim이 실제로 도는지 볼 방법이 없다. 여기서 그리는 도형은 stand-in이고 승인된 목업의
 * 외형과 아무 관계가 없다 — P4·P5·P6이 붙으면 이 파일은 지운다.
 *
 * dev/는 render/와 boot/를 import할 수 없으므로 캔버스 준비와 그리기를 직접 갖는다. 대신
 * 게임 규칙은 한 줄도 갖지 않는다: 적 배치와 발사 주기까지 전부 sim의 공개 함수를 부른다.
 */
import { ENEMIES } from '../config/enemies';
import { STAGE_SCALING } from '../config/difficulty';
import { HITSTOP_BUDGET_PER_SEC } from '../config/feel';
import type { EnemyId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PARRY } from '../config/parry';
import { PLAYER } from '../config/player';
import { PLAYFIELD } from '../config/playfield';
import { bus, type FeedbackEventOf } from '../core/bus';
import { createClock } from '../core/clock';
import { attachInput, createInput } from '../core/input';
import { createLoop } from '../core/loop';
import { aimAt } from '../core/vec';
import { fireEnemyBullet } from '../sim/bullets';
import { acquireEnemySlot } from '../sim/caps';
import { stepWorld, createWorld, type Enemy, type World } from '../sim/world';

const HARNESS_STAGE_ID = 1;
const HARNESS_SEED = 20260808;
const MS_PER_SEC = 1000;
/** 눌림 소비 상한이 프레임 시각보다 이만큼 이상 뒤처지지 않게 한다 (ms) */
const MAX_PRESS_LAG_MS = 34;
const RESPAWN_SEC = 2.0;
const GRADE_POPUP_SEC = 0.6;
const HUD_FONT = '28px ui-monospace, monospace';
const HUD_LINE_HEIGHT_U = 38;
const HUD_MARGIN_U = 28;

interface Post {
  readonly enemyId: EnemyId;
  readonly xU: number;
  readonly yU: number;
  enemy: Enemy | null;
  fireTimerSec: number;
  respawnTimerSec: number;
}

const POST_SPECS: readonly { enemyId: EnemyId; xU: number; yU: number; firstShotSec: number }[] = [
  { enemyId: 'E-A', xU: 300, yU: 300, firstShotSec: 0.8 },
  { enemyId: 'E-A', xU: 780, yU: 300, firstShotSec: 1.6 },
  { enemyId: 'E-E', xU: 540, yU: 200, firstShotSec: 1.2 },
];

const posts: Post[] = POST_SPECS.map((spec) => ({
  enemyId: spec.enemyId,
  xU: spec.xU,
  yU: spec.yU,
  enemy: null,
  fireTimerSec: spec.firstShotSec,
  respawnTimerSec: 0,
}));

let lastGradeText = '';
let gradePopupSec = 0;
let whiffPopupSec = 0;

function spawnPost(world: World, post: Post): void {
  const enemy = acquireEnemySlot(world);
  if (enemy === null) {
    return;
  }
  const def = ENEMIES[post.enemyId];
  enemy.xU = post.xU;
  enemy.yU = post.yU;
  enemy.prevXU = post.xU;
  enemy.prevYU = post.yU;
  enemy.hitRadiusU = def.hitRadiusU;
  enemy.hp = def.hp * STAGE_SCALING[HARNESS_STAGE_ID].enemyHpMul;
  enemy.maxHp = enemy.hp;
  enemy.scoreValue = def.score;
  enemy.contactDamage = def.contactDamage;
  enemy.frontShieldIntact = false;
  post.enemy = enemy;
}

/**
 * sim/enemies.ts(P4)가 할 일의 최소 대역. 발사 자체는 sim의 fireEnemyBullet이 하므로
 * §3.2 상한 억제와 HR-09 억제 거리는 여기서 다시 판단하지 않는다.
 */
function runPosts(world: World, dtSec: number): void {
  for (const post of posts) {
    const enemy = post.enemy;
    if (enemy === null || enemy.hp <= 0 || !world.enemies.active.includes(enemy)) {
      post.enemy = null;
      post.respawnTimerSec -= dtSec;
      if (post.respawnTimerSec <= 0) {
        post.respawnTimerSec = RESPAWN_SEC;
        spawnPost(world, post);
      }
      continue;
    }
    const def = ENEMIES[post.enemyId];
    post.fireTimerSec -= dtSec;
    if (post.fireTimerSec > 0) {
      continue;
    }
    post.fireTimerSec = def.fireCycleSec;
    const bulletId = def.bullet;
    if (bulletId === null) {
      continue;
    }
    fireEnemyBullet(world, {
      bulletId,
      xU: enemy.xU,
      yU: enemy.yU,
      angleRad: aimAt(enemy.xU, enemy.yU, world.player.xU, world.player.yU),
      hasTelegraph: false,
    });
  }
}

function bootCanvasElement(): HTMLCanvasElement {
  const element = document.getElementById('stage');
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error('canvas #stage가 없다');
  }
  return element;
}

function fitCanvas(canvas: HTMLCanvasElement): number {
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const fit = Math.min(
    window.innerWidth / PLAYFIELD.widthU,
    window.innerHeight / PLAYFIELD.heightU,
  );
  const widthPx = Math.max(1, Math.floor(PLAYFIELD.widthU * fit * dpr));
  const pixelsPerUnit = widthPx / PLAYFIELD.widthU;
  const heightPx = Math.max(1, Math.round(PLAYFIELD.heightU * pixelsPerUnit));
  canvas.style.width = `${widthPx / dpr}px`;
  canvas.style.height = `${heightPx / dpr}px`;
  canvas.width = widthPx;
  canvas.height = heightPx;
  return pixelsPerUnit;
}

function fillCircle(ctx: CanvasRenderingContext2D, xU: number, yU: number, radiusU: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(xU, yU, radiusU, 0, Math.PI * 2);
  ctx.fill();
}

function strokeCircle(ctx: CanvasRenderingContext2D, xU: number, yU: number, radiusU: number, color: string, widthU: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = widthU;
  ctx.beginPath();
  ctx.arc(xU, yU, radiusU, 0, Math.PI * 2);
  ctx.stroke();
}

function drawEnemies(ctx: CanvasRenderingContext2D, world: World): void {
  for (const enemy of world.enemies.active) {
    fillCircle(ctx, enemy.xU, enemy.yU, enemy.hitRadiusU, PALETTE.jeok);
    const ratio = enemy.maxHp === 0 ? 0 : Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = PALETTE.ink700;
    ctx.fillRect(enemy.xU - 40, enemy.yU - enemy.hitRadiusU - 20, 80, 8);
    ctx.fillStyle = PALETTE.hwang;
    ctx.fillRect(enemy.xU - 40, enemy.yU - enemy.hitRadiusU - 20, 80 * ratio, 8);
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, world: World): void {
  for (const projectile of world.enemyBullets.active) {
    fillCircle(ctx, projectile.xU, projectile.yU, projectile.radiusU, PALETTE.jeok);
  }
  for (const projectile of world.reflectBullets.active) {
    // 자해 유예 중인 반사탄은 아직 나에게 무해하다. 그 사실이 색으로 읽혀야 추격 판단이 선다
    const color = projectile.graceRemainingSec > 0 ? PALETTE.hwangHot : PALETTE.hwang;
    fillCircle(ctx, projectile.xU, projectile.yU, projectile.radiusU, color);
    fillCircle(ctx, projectile.xU, projectile.yU, projectile.radiusU * 0.35, PALETTE.ink800);
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, world: World): void {
  const player = world.player;
  const parry = world.parry;
  if (parry.isActive) {
    strokeCircle(ctx, player.xU, player.yU, world.stats.parryRadiusU, PALETTE.cheong, 4);
    for (const band of world.stats.bands) {
      strokeCircle(ctx, player.xU, player.yU, band.maxDistU, PALETTE.cheongDim, 1.5);
    }
  }
  const invulnUntilSec = Math.max(player.hitInvulnUntilSec, player.parryInvulnUntilSec);
  if (world.simTimeSec < invulnUntilSec) {
    strokeCircle(ctx, player.xU, player.yU, PLAYER.visualSizeU / 2, PALETTE.baek, 3);
  }
  const cooldownLeftSec = Math.max(0, parry.cooldownUntilSec - world.simTimeSec);
  const readyRatio = 1 - cooldownLeftSec / PARRY.cooldownSec;
  ctx.strokeStyle = PALETTE.cheongDim;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(player.xU, player.yU, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * readyRatio);
  ctx.stroke();
  fillCircle(ctx, player.xU, player.yU, PLAYER.hitRadiusU, PALETTE.cheong);
}

function drawHud(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.font = HUD_FONT;
  ctx.textBaseline = 'top';
  const lines = [
    `LIFE ${world.player.lives}   SCORE ${world.run.score}   COMBO ${world.run.combo}`,
    `적탄 ${world.enemyBullets.activeCount}/${STAGE_SCALING[HARNESS_STAGE_ID].maxEnemyBullets}` +
      `   반사탄 ${world.reflectBullets.activeCount}/${PLAYFIELD.maxReflectBullets}` +
      `   잡몹 ${world.enemies.activeCount}/${PLAYFIELD.maxEnemies}`,
    world.isGameOver ? 'GAME OVER — R 다시 시작' : 'WASD 이동 · Space 패리 · R 다시 시작',
  ];
  ctx.fillStyle = PALETTE.baekMute;
  for (let index = 0; index < lines.length; index += 1) {
    ctx.fillText(lines[index] ?? '', HUD_MARGIN_U, HUD_MARGIN_U + index * HUD_LINE_HEIGHT_U);
  }
  if (gradePopupSec > 0) {
    ctx.fillStyle = PALETTE.hwang;
    ctx.fillText(lastGradeText, world.player.xU + 60, world.player.yU - 90);
  }
  if (whiffPopupSec > 0) {
    ctx.fillStyle = PALETTE.baekFaint;
    ctx.fillText('헛침', world.player.xU + 60, world.player.yU - 50);
  }
}

function subscribePopups(): void {
  bus.on('parry', (event: FeedbackEventOf<'parry'>) => {
    lastGradeText = event.count > 1 ? `${event.grade} ×${event.count}` : event.grade;
    gradePopupSec = GRADE_POPUP_SEC;
  });
  bus.on('parryWhiff', () => {
    whiffPopupSec = GRADE_POPUP_SEC;
  });
}

export function startP3Harness(): void {
  const canvas = bootCanvasElement();
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx === null) {
    throw new Error('CanvasRenderingContext2D를 얻지 못했다');
  }
  let pixelsPerUnit = fitCanvas(canvas);
  window.addEventListener('resize', () => {
    pixelsPerUnit = fitCanvas(canvas);
  });

  const clock = createClock(HITSTOP_BUDGET_PER_SEC);
  const input = createInput();
  attachInput(input, {
    target: canvas,
    logicalWidthU: PLAYFIELD.widthU,
    logicalHeightU: PLAYFIELD.heightU,
  });
  subscribePopups();

  let world = createWorld({ stageId: HARNESS_STAGE_ID, seed: HARNESS_SEED, clock });
  function restart(): void {
    world = createWorld({ stageId: HARNESS_STAGE_ID, seed: HARNESS_SEED, clock });
    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const spec = POST_SPECS[index];
      if (post === undefined || spec === undefined) {
        continue;
      }
      post.enemy = null;
      post.respawnTimerSec = 0;
      post.fireTimerSec = spec.firstShotSec;
      spawnPost(world, post);
    }
    input.reset();
    // 게이트 확인은 화면만으로 끝나지 않는다 — 상한 도달·자해 유예·등급 분포는 숫자를 봐야
    // 판정되는데 이 하네스에는 그 숫자를 꺼낼 통로가 없다
    (globalThis as unknown as { p3World: World }).p3World = world;
  }
  restart();
  // 게임오버가 곧 막다른 길이 되지 않게 한다. core/input의 키 표를 거치지 않는 것은 그 표가
  // R을 리롤로 이미 쓰고 있고, 그 눌림은 세계가 소비해 버리기 때문이다
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code === 'KeyR' && !event.ctrlKey && !event.metaKey) {
      restart();
    }
  });

  let frameNowMs = 0;
  let pressHorizonMs = 0;

  const loop = createLoop({
    clock,
    hooks: {
      beginFrame(): void {
        input.beginFrame(frameNowMs);
        pressHorizonMs = Math.max(pressHorizonMs, frameNowMs - MAX_PRESS_LAG_MS);
      },
      step(fixedDtSec: number): void {
        pressHorizonMs += fixedDtSec * MS_PER_SEC;
        // 게임오버 뒤의 화면 전환은 screens/의 일이라 여기서는 세계를 세우기만 한다
        if (world.isGameOver) {
          return;
        }
        runPosts(world, fixedDtSec);
        stepWorld(world, fixedDtSec, { input, untilMs: pressHorizonMs });
      },
      render(_alpha: number, realDtSec: number): void {
        gradePopupSec = Math.max(0, gradePopupSec - realDtSec);
        whiffPopupSec = Math.max(0, whiffPopupSec - realDtSec);
        ctx.setTransform(pixelsPerUnit, 0, 0, pixelsPerUnit, 0, 0);
        ctx.fillStyle = PALETTE.ink900;
        ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
        ctx.strokeStyle = PALETTE.ink700;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          PLAYFIELD.playerBounds.minXU,
          PLAYFIELD.playerBounds.minYU,
          PLAYFIELD.playerBounds.maxXU - PLAYFIELD.playerBounds.minXU,
          PLAYFIELD.playerBounds.maxYU - PLAYFIELD.playerBounds.minYU,
        );
        drawEnemies(ctx, world);
        drawProjectiles(ctx, world);
        drawPlayer(ctx, world);
        drawHud(ctx, world);
      },
    },
  });

  let previousMs = Number.NaN;
  const onFrame = (nowMs: number): void => {
    requestAnimationFrame(onFrame);
    frameNowMs = nowMs;
    const elapsedRealSec = Number.isNaN(previousMs) ? 0 : (nowMs - previousMs) / MS_PER_SEC;
    previousMs = nowMs;
    loop.runFrame(elapsedRealSec);
  };
  requestAnimationFrame(onFrame);
}
