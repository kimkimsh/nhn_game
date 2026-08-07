/**
 * P3-B 게이트를 눈으로 확인하는 임시 하네스 — sim 쪽 절반만 여기 있다.
 *
 * 화면(screens/)과 적 스폰(sim/enemies.ts)이 아직 없으므로 그 둘의 최소 대역을 여기서 대신한다.
 * **그리기는 갖지 않는다.** dev/는 render/를 import할 수 없어서(03 §5) 프레임 하나를 그리는 일은
 * boot/p3-entry.ts가 주입한 `render` 콜백이 한다 — 그래서 이 하네스가 보여 주는 그림은 stand-in
 * 도형이 아니라 승인된 목업에서 이식한 진짜 렌더러의 출력이다.
 *
 * P4·P5·P6이 붙으면 이 파일과 boot/p3-entry.ts는 함께 지운다.
 */
import { ENEMIES } from '../config/enemies';
import { STAGE_SCALING } from '../config/difficulty';
import { HITSTOP_BUDGET_PER_SEC } from '../config/feel';
import type { EnemyId, StageId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import { createClock } from '../core/clock';
import { attachInput, createInput } from '../core/input';
import { createLoop } from '../core/loop';
import { aimAt } from '../core/vec';
import { fireEnemyBullet } from '../sim/bullets';
import { acquireEnemySlot } from '../sim/caps';
import { stepWorld } from '../sim/step';
import { createWorld, type Enemy, type World } from '../sim/world';

const MS_PER_SEC = 1000;
/** 눌림 소비 상한이 프레임 시각보다 이만큼 이상 뒤처지지 않게 한다 (ms) */
const MAX_PRESS_LAG_MS = 34;
const RESPAWN_SEC = 2.0;

/** boot/p3-entry.ts가 넘기는 것. 그리기와 시드는 그쪽이 갖는다 */
export interface P3HarnessHost {
  readonly canvas: HTMLCanvasElement;
  readonly stageId: StageId;
  readonly seed: number;
  /** 프레임 하나를 그린다. realDtSec는 연출 시간이라 sim의 FIXED_DT가 아니다 */
  render(world: World, realDtSec: number): void;
}

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

/**
 * 스폰할 때 기록한 아키타입. `sim/enemies.ts`(P5)가 붙으면 Enemy 자신이 이 값을 갖고 이 표는
 * 사라진다 — 그때까지 실루엣을 고를 수단이 없다. WeakMap이라 회수된 슬롯을 붙잡지 않는다.
 */
const enemyArchetypes = new WeakMap<Enemy, EnemyId>();

/** 표에 없는 슬롯은 조총병으로 그린다. POST_SPECS 밖에서 온 적은 이 하네스에 없다 */
export function enemyArchetypeOf(enemy: Enemy): EnemyId {
  return enemyArchetypes.get(enemy) ?? 'E-A';
}

function spawnPost(world: World, stageId: StageId, post: Post): void {
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
  enemy.hp = def.hp * STAGE_SCALING[stageId].enemyHpMul;
  enemy.maxHp = enemy.hp;
  enemy.scoreValue = def.score;
  enemy.contactDamage = def.contactDamage;
  enemy.frontShieldIntact = false;
  enemyArchetypes.set(enemy, post.enemyId);
  post.enemy = enemy;
}

/**
 * sim/enemies.ts(P4)가 할 일의 최소 대역. 발사 자체는 sim의 fireEnemyBullet이 하므로
 * §3.2 상한 억제와 HR-09 억제 거리는 여기서 다시 판단하지 않는다.
 */
function runPosts(world: World, stageId: StageId, dtSec: number): void {
  for (const post of posts) {
    const enemy = post.enemy;
    if (enemy === null || enemy.hp <= 0 || !world.enemies.active.includes(enemy)) {
      post.enemy = null;
      post.respawnTimerSec -= dtSec;
      if (post.respawnTimerSec <= 0) {
        post.respawnTimerSec = RESPAWN_SEC;
        spawnPost(world, stageId, post);
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

export function startP3Harness(host: P3HarnessHost): void {
  const clock = createClock(HITSTOP_BUDGET_PER_SEC);
  const input = createInput();
  attachInput(input, {
    target: host.canvas,
    logicalWidthU: PLAYFIELD.widthU,
    logicalHeightU: PLAYFIELD.heightU,
  });

  let world = createWorld({ stageId: host.stageId, seed: host.seed, clock });
  function restart(): void {
    world = createWorld({ stageId: host.stageId, seed: host.seed, clock });
    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const spec = POST_SPECS[index];
      if (post === undefined || spec === undefined) {
        continue;
      }
      post.enemy = null;
      post.respawnTimerSec = 0;
      post.fireTimerSec = spec.firstShotSec;
      spawnPost(world, host.stageId, post);
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
        runPosts(world, host.stageId, fixedDtSec);
        stepWorld(world, fixedDtSec, { input, untilMs: pressHorizonMs });
      },
      render(_alpha: number, realDtSec: number): void {
        host.render(world, realDtSec);
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
