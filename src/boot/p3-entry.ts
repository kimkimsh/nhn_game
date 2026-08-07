/**
 * P3 하네스를 진짜 렌더러에 잇는 다리. `p3.html`이 부르는 유일한 함수가 여기 있다.
 *
 * **이 파일이 존재하는 이유는 계층 규칙 하나다.** `dev/`는 `render/`를 import할 수 없고
 * (03 §5, eslint가 강제) `render/`는 `sim/`의 타입만 읽는다. 그래서 「World를 읽어 FrameView를
 * 만들고 drawFrame을 부르는」 일은 둘 중 어느 쪽도 할 수 없고, 양쪽을 다 볼 수 있는 `boot/`가
 * 한다 — `boot/sprite-bake.ts`가 P1 스트레스 씬에 그리기 함수를 묶어 넘기는 것과 같은 형태다.
 *
 * **P6-1의 `screens/play.ts`가 생기면 이 파일과 `dev/p3-harness.ts`는 함께 지운다.** 여기 있는
 * 뷰 만들기는 그 파일이 할 일의 최소 대역이고, 아직 없는 축(적 예비동작·히트스톱 진동·보스·
 * 콤보 잔여 시간)은 전부 기본값으로 채운다.
 */

import { STAGES } from '../config/stages/index';
import { PLAYFIELD } from '../config/playfield';
import { PARRY } from '../config/parry';
import { PLAYER } from '../config/player';
import { ENEMIES } from '../config/enemies';
import { BULLETS } from '../config/bullets';
import type { ParryableBulletId, StageId } from '../config/ids';
import { bus } from '../core/bus';
import { deriveStream } from '../core/rng';
import type { Enemy, World } from '../sim/world';
import { bakeStageBackground } from '../render/backgrounds/index';
import type { BulletLayerBatch } from '../render/bullet';
import { createCamera } from '../render/camera';
import type { EnemyView } from '../render/enemy';
import { drawFrame } from '../render/frame';
import type { FrameDeps, FrameEnemy, FrameView } from '../render/frame';
import { createHudAnim } from '../render/hud';
import { createImpactLayer } from '../render/impact';
import { createParticleLayer } from '../render/particles';
import { createPlayerFx, notifyPlayerFx } from '../render/player';
import { bootCanvas, type CanvasView } from './canvas';
import { bakeSprites, handleViewChanged } from './sprite-bake';

const CANVAS_ELEMENT_ID = 'stage';
const HARNESS_STAGE_ID: StageId = 1;
const HARNESS_SEED = 20260808;

/** 배치 배열의 칸 수. 적 탄환 상한이 스테이지마다 다르므로 넉넉히 반사탄 상한의 두 배로 둔다 */
const BULLET_CAPACITY = PLAYFIELD.maxReflectBullets * 2;

/** 하네스에는 웨이브 타이머가 없다. HUD가 빈 문자열을 그리지 않게 자리만 채운다 */
const HARNESS_WAVE_LABEL = 'P3';

function emptyBatch(): BulletLayerBatch & {
  bulletId: ParryableBulletId[];
  state: BulletLayerBatch['state'][number][];
  count: number;
} {
  return {
    count: 0,
    bulletId: new Array<ParryableBulletId>(BULLET_CAPACITY).fill('P2'),
    state: new Array<BulletLayerBatch['state'][number]>(BULLET_CAPACITY).fill('enemy'),
    xU: new Float32Array(BULLET_CAPACITY),
    yU: new Float32Array(BULLET_CAPACITY),
    angleRad: new Float32Array(BULLET_CAPACITY),
    spinRad: new Float32Array(BULLET_CAPACITY),
    graceRemainingSec: new Float32Array(BULLET_CAPACITY),
    reparryCount: new Int32Array(BULLET_CAPACITY),
  };
}

/**
 * 프레임마다 배열을 새로 만들지 않는다. 이 하네스가 재는 것은 sim이지만, 렌더가 프레임마다
 * 520칸짜리 배열 여섯을 버리면 그 GC가 프레임 시간에 그대로 얹혀 무엇을 보고 있는지 흐려진다.
 */
const batch = emptyBatch();

/** 목업이 `P9`·`P12`를 탄환으로 안 그린다 — switch에 case가 없다(12 §1 C-04) */
function isParryableId(id: string): id is ParryableBulletId {
  return id !== 'P9' && id !== 'P12' && id in BULLETS;
}

function fillBatch(world: World): BulletLayerBatch {
  let n = 0;
  const push = (
    projectile: { bulletId: string; xU: number; yU: number; vxUPerSec: number; vyUPerSec: number; graceRemainingSec: number },
    state: BulletLayerBatch['state'][number],
  ): void => {
    if (n >= BULLET_CAPACITY || !isParryableId(projectile.bulletId)) {
      return;
    }
    batch.bulletId[n] = projectile.bulletId;
    batch.state[n] = state;
    batch.xU[n] = projectile.xU;
    batch.yU[n] = projectile.yU;
    batch.angleRad[n] = Math.atan2(projectile.vyUPerSec, projectile.vxUPerSec);
    batch.spinRad[n] = 0;
    batch.graceRemainingSec[n] = projectile.graceRemainingSec;
    batch.reparryCount[n] = 0;
    n += 1;
  };
  for (const projectile of world.enemyBullets.active) {
    push(projectile, 'enemy');
  }
  for (const projectile of world.reflectBullets.active) {
    push(projectile, projectile.graceRemainingSec > 0 ? 'reflectGrace' : 'reflect');
  }
  batch.count = n;
  return batch;
}

/**
 * `sim/enemies.ts`(P5)가 붙기 전이라 World의 Enemy에는 실루엣 키가 없다. 하네스가 스폰할 때
 * 기록해 둔 아키타입을 읽는다 — 판정은 `hitRadiusU` 하나로 이미 끝나 있고 그림만 이 값을 쓴다.
 */
function enemyViewOf(enemy: Enemy, archetypeOf: (enemy: Enemy) => keyof typeof ENEMIES): EnemyView {
  const def = ENEMIES[archetypeOf(enemy)];
  return {
    shape: def.shape,
    // hitRadiusU가 목업 실루엣 폭 × 0.6이라 되돌린다 (config/enemies.ts 머리말)
    widthU: def.hitRadiusU / 0.6,
    xU: enemy.xU,
    yU: enemy.yU,
    windup01: 0,
    windupRemainingSec: 0,
    aimXU: enemy.xU,
    aimYU: enemy.yU,
    flash01: 0,
    frontShieldIntact: enemy.frontShieldIntact,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    noHpBar: false,
    noContactShadow: false,
    partGauge: false,
  };
}

function buildView(
  world: World,
  elapsedSec: number,
  archetypeOf: (enemy: Enemy) => keyof typeof ENEMIES,
): FrameView {
  const enemies: FrameEnemy[] = [];
  for (const enemy of world.enemies.active) {
    enemies.push({ view: enemyViewOf(enemy, archetypeOf), shake: null });
  }
  const cooldownLeftSec = Math.max(0, world.parry.cooldownUntilSec - world.simTimeSec);
  const parryLeftSec = world.parry.isActive
    ? Math.max(0, world.parry.activeUntilSec - world.simTimeSec)
    : 0;
  return {
    backgroundId: STAGES[HARNESS_STAGE_ID].background,
    backgroundTimeSec: elapsedSec,
    renderSeed: HARNESS_SEED,
    paint: null,
    zones: [],
    telegraphs: [],
    enemies,
    boss: null,
    bullets: fillBatch(world),
    lance: null,
    player: {
      xU: world.player.xU,
      yU: world.player.yU,
      parryRadiusU: world.stats.parryRadiusU,
      parryActive: { remainSec: parryLeftSec, totalSec: world.stats.parryActiveSec },
      cooldown: { remainSec: cooldownLeftSec, totalSec: PARRY.cooldownSec },
      parryInvuln: {
        remainSec: Math.max(0, world.player.parryInvulnUntilSec - world.simTimeSec),
        totalSec: world.stats.parryInvulnSec,
      },
      hitInvuln: {
        remainSec: Math.max(0, world.player.hitInvulnUntilSec - world.simTimeSec),
        totalSec: world.stats.hitInvulnSec,
      },
    },
    hud: {
      life: world.player.lives,
      maxLife: PLAYER.maxLife,
      score: world.run.score,
      stage: HARNESS_STAGE_ID,
      progress: 0,
      wave: HARNESS_WAVE_LABEL,
      boss: null,
      combo: world.run.combo > 0
        ? {
            count: world.run.combo,
            multiplier: 1,
            remainSec: Math.max(0, world.run.comboUntilSec - world.simTimeSec),
            holdSec: world.stats.comboHoldSec,
          }
        : null,
      muted: false,
      cheated: false,
    },
    overlay: null,
  };
}

function createDeps(): Omit<FrameDeps, 'realDtSec'> {
  const deps = {
    camera: createCamera({ bus, rng: deriveStream(HARNESS_SEED, 'render/camera') }),
    particles: createParticleLayer({ bus, rng: deriveStream(HARNESS_SEED, 'render/particles') }),
    impact: createImpactLayer({ bus, rng: deriveStream(HARNESS_SEED, 'render/impact') }),
    playerFx: createPlayerFx(),
    hudAnim: createHudAnim(),
  };
  // player.ts는 버스를 직접 구독하지 않는다 — 화면마다 수명이 다른 상태라 소유자가 넘긴다
  bus.on('parry', (event) => notifyPlayerFx(deps.playerFx, event));
  bus.on('parryWhiff', (event) => notifyPlayerFx(deps.playerFx, event));
  bus.on('cooldownReady', (event) => notifyPlayerFx(deps.playerFx, event));
  bus.on('playerHit', (event) => notifyPlayerFx(deps.playerFx, event));
  return deps;
}

/**
 * `booted`가 오면 캔버스와 스프라이트 굽기가 이미 끝난 것이다 — `main.ts`가 그 둘을 먼저 하고
 * 화면 매니저가 없을 때만 여기로 넘어온다. `p3.html`은 부팅 사슬을 안 타므로 인자 없이 부르고,
 * 그때만 이 함수가 캔버스를 잡고 굽는다. 두 번 굽으면 스프라이트 43장을 버리고 다시 만든다.
 */
export async function startP3Entry(booted?: CanvasView): Promise<void> {
  let view = booted;
  if (view === undefined) {
    view = bootCanvas({
      canvasId: CANVAS_ELEMENT_ID,
      logicalWidthU: PLAYFIELD.widthU,
      logicalHeightU: PLAYFIELD.heightU,
      onViewChanged: handleViewChanged,
    });
    await bakeSprites(view);
  }
  bakeStageBackground(STAGES[HARNESS_STAGE_ID].background, HARNESS_SEED);

  const deps = createDeps();
  const harness = await import('../dev/p3-harness');
  let elapsedSec = 0;

  harness.startP3Harness({
    canvas: view.canvas,
    stageId: HARNESS_STAGE_ID,
    seed: HARNESS_SEED,
    render(world: World, realDtSec: number): void {
      elapsedSec += realDtSec;
      view.ctx.setTransform(view.pixelsPerUnit, 0, 0, view.pixelsPerUnit, 0, 0);
      drawFrame(view.ctx, buildView(world, elapsedSec, harness.enemyArchetypeOf), {
        ...deps,
        realDtSec,
      });
    },
  });
}
