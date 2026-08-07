/**
 * §3.2 동시 존재 상한 셋 — 09_검증_전략.md §3.4.
 *
 * 이 파일이 보는 것은 상한값이 아니라 **상한에 닿았을 때의 처리가 서로 다르다는 사실**이다.
 * 셋을 하나의 "상한 처리"로 묶어도 개수 단언은 전부 통과하고 감각만 틀어진다. 그래서 개수만
 * 세지 않고 매번 슬롯의 **동일성**까지 본다 — 지워졌는지 남았는지는 그것으로만 갈린다.
 *
 *   적 탄환  신규 발사만 거부한다. 활성 목록은 원소도 순서도 그대로여야 한다
 *   반사탄    신규가 실패하지 않는다. 대신 가장 오래된 슬롯이 활성 목록에서 빠진다
 *   잡몹      신규 스폰만 거부한다. 편성은 부르는 쪽에 남고 자리가 나면 그대로 나온다
 *
 * 잡몹의 대기열 자체는 sim/waves.ts가 갖는데 그 파일이 아직 없다. 여기서는 caps.ts가 그
 * 대기열이 성립할 조건 — 거절이 풀을 건드리지 않고, 시간이 지나도 만료되지 않는 것 — 을
 * 지키는지까지만 본다.
 */
import { describe, expect, it } from 'vitest';
import { BULLETS } from '../src/config/bullets';
import { STAGE_SCALING } from '../src/config/difficulty';
import { ENEMIES } from '../src/config/enemies';
import type { EnemyId, StageId } from '../src/config/ids';
import { PLAYFIELD } from '../src/config/playfield';
import { createInput, type Input } from '../src/core/input';
import { FIXED_DT_SEC } from '../src/core/loop';
import {
  createEnemyBulletPool,
  fireEnemyBullet,
  type EnemyShot,
  type Projectile,
} from '../src/sim/bullets';
import {
  acquireEnemySlot,
  acquireReflectSlot,
  canFireEnemyBullet,
  canSpawnEnemy,
} from '../src/sim/caps';
import { stepWorld } from '../src/sim/step';
import { createWorld, type Enemy, type World } from '../src/sim/world';

/** 눌림 소비 상한. 큐에 넣은 것을 전부 이번 스텝이 가져가게 하는 값이다 */
const HORIZON_MS = 1e9;

/** 발사원의 y. 플레이어에서 충분히 멀어 HR-09 억제 거리에 걸리지 않는다 */
const SHOOTER_YU = 200;

const STAGE_IDS = Object.keys(STAGE_SCALING).map(Number) as StageId[];

function setup(stageId: StageId): { world: World; input: Input } {
  const world = createWorld({ stageId, seed: 1 });
  const input = createInput();
  input.beginFrame(HORIZON_MS);
  return { world, input };
}

function step(world: World, input: Input, count: number): void {
  for (let i = 0; i < count; i += 1) {
    stepWorld(world, FIXED_DT_SEC, { input, untilMs: HORIZON_MS });
  }
}

function shotAt(index: number): EnemyShot {
  return {
    bulletId: 'P1',
    // 같은 자리에 겹쳐 두면 어느 슬롯이 어느 것인지 위치로 확인할 수 없다
    xU: PLAYFIELD.playerBounds.minXU + index,
    yU: SHOOTER_YU,
    angleRad: 0,
    hasTelegraph: true,
  };
}

/** 상한 직전까지 실제 발사 경로로 채운다. 풀에 직접 넣으면 억제 판정을 건너뛴다 */
function fillEnemyBullets(world: World): Projectile[] {
  const capacity = STAGE_SCALING[world.stageId].maxEnemyBullets;
  const filled: Projectile[] = [];
  for (let i = 0; i < capacity; i += 1) {
    const projectile = fireEnemyBullet(world, shotAt(i));
    if (projectile === null) {
      throw new Error(`상한 아래에서 발사가 거부됐다: ${i}`);
    }
    // 적분으로 화면 밖에 나가 저절로 사라지면 상한 검사가 아니라 소멸 검사가 된다
    projectile.vxUPerSec = 0;
    projectile.vyUPerSec = 0;
    filled.push(projectile);
  }
  return filled;
}

/**
 * 반사탄 풀을 세워 둔 반사탄으로 채운다. 유예를 남겨 두는 것이 핵심이다 —
 * 유예 중에는 패리 후보도 피격 원인도 아니라서, 이번에 세는 것이 상한 처리뿐이 된다.
 */
function fillReflectBullets(world: World): Projectile[] {
  const filled: Projectile[] = [];
  for (let i = 0; i < PLAYFIELD.maxReflectBullets; i += 1) {
    const projectile = acquireReflectSlot(world);
    projectile.owner = 'player';
    projectile.xU = PLAYFIELD.playerBounds.minXU + i;
    projectile.yU = SHOOTER_YU;
    projectile.prevXU = projectile.xU;
    projectile.prevYU = projectile.yU;
    projectile.vxUPerSec = 0;
    projectile.vyUPerSec = 0;
    projectile.radiusU = BULLETS.P1.radiusU;
    projectile.lifeRemainingSec = Number.POSITIVE_INFINITY;
    projectile.graceRemainingSec = Number.POSITIVE_INFINITY;
    filled.push(projectile);
  }
  return filled;
}

function placeEnemy(enemy: Enemy, enemyId: EnemyId, xU: number, yU: number): void {
  const def = ENEMIES[enemyId];
  enemy.xU = xU;
  enemy.yU = yU;
  enemy.prevXU = xU;
  enemy.prevYU = yU;
  enemy.hitRadiusU = def.hitRadiusU;
  enemy.hp = def.hp;
  enemy.maxHp = def.hp;
  enemy.scoreValue = def.score;
}

function fillEnemies(world: World): Enemy[] {
  const filled: Enemy[] = [];
  for (let i = 0; i < PLAYFIELD.maxEnemies; i += 1) {
    const enemy = acquireEnemySlot(world);
    if (enemy === null) {
      throw new Error(`상한 아래에서 스폰이 거부됐다: ${i}`);
    }
    placeEnemy(enemy, 'E-A', PLAYFIELD.playerBounds.minXU + i, SHOOTER_YU);
    filled.push(enemy);
  }
  return filled;
}

/** 적분(8번) 뒤에 정확히 distU가 되도록 플레이어 바로 위에 다가오는 탄을 놓는다 */
function placeIncoming(world: World, distU: number): Projectile {
  const projectile = world.enemyBullets.acquire();
  if (projectile === null) {
    throw new Error('적 탄환 풀에 자리가 없다');
  }
  const def = BULLETS.P2;
  projectile.bulletId = 'P2';
  projectile.owner = 'enemy';
  projectile.xU = world.player.xU;
  projectile.yU = world.player.yU - distU - def.speedUPerSec * FIXED_DT_SEC;
  projectile.prevXU = projectile.xU;
  projectile.prevYU = projectile.yU;
  projectile.vxUPerSec = 0;
  projectile.vyUPerSec = def.speedUPerSec;
  projectile.radiusU = def.radiusU;
  projectile.brp = def.brp;
  projectile.isParryable = def.isParryable;
  projectile.lifeRemainingSec = Number.POSITIVE_INFINITY;
  return projectile;
}

function press(input: Input): void {
  input.pressKey({ code: 'Space', atMs: 0, shiftHeld: false, repeat: false });
  input.releaseKey('Space');
}

/** 활성 목록을 슬롯 동일성으로 비교한다. toEqual은 값만 보므로 회수·재사용을 못 잡는다 */
function sameSlots(active: readonly unknown[], expected: readonly unknown[]): boolean {
  return active.length === expected.length && expected.every((item, i) => active[i] === item);
}

describe('§3.2 적 탄환 상한 — 억제이지 삭제가 아니다', () => {
  it('상한에 닿으면 신규 발사만 거부하고 화면의 탄은 한 발도 안 지운다', () => {
    const { world } = setup(1);
    const before = fillEnemyBullets(world);
    const positionsBefore = before.map((projectile) => `${projectile.xU},${projectile.yU}`);

    expect(canFireEnemyBullet(world)).toBe(false);
    expect(fireEnemyBullet(world, shotAt(0))).toBeNull();

    expect(world.enemyBullets.activeCount).toBe(before.length);
    expect(sameSlots(world.enemyBullets.active, before)).toBe(true);
    expect(world.enemyBullets.active.map((p) => `${p.xU},${p.yU}`)).toEqual(positionsBefore);
  });

  it('억제는 그 발사 하나만 취소한다 — 자리가 나면 다음 발사가 나간다', () => {
    const { world } = setup(1);
    const before = fillEnemyBullets(world);
    expect(fireEnemyBullet(world, shotAt(0))).toBeNull();

    const oldest = before[0];
    if (oldest === undefined) {
      throw new Error('채운 목록이 비었다');
    }
    world.enemyBullets.release(oldest);
    expect(canFireEnemyBullet(world)).toBe(true);

    const fired = fireEnemyBullet(world, shotAt(0));
    expect(fired).not.toBeNull();
    expect(world.enemyBullets.activeCount).toBe(before.length);
    // 회수된 슬롯은 목록의 끝에 붙는다. 앞에 끼워 넣으면 획득 순서가 어긋난다
    expect(world.enemyBullets.active[world.enemyBullets.activeCount - 1]).toBe(fired);
  });

  it('상한은 스테이지마다 다르다 — 유일 소스가 difficulty.ts다 (E-13)', () => {
    for (const stageId of STAGE_IDS) {
      const capacity = STAGE_SCALING[stageId].maxEnemyBullets;
      expect(createEnemyBulletPool(stageId).capacity).toBe(capacity);

      const { world } = setup(stageId);
      fillEnemyBullets(world);
      expect(world.enemyBullets.activeCount).toBe(capacity);
      expect(canFireEnemyBullet(world)).toBe(false);
    }
  });
});

describe('§3.2 반사탄 상한 — 최오래 소멸. 신규는 버리지 않는다', () => {
  it('상한에서도 슬롯을 내주고, 나가는 것은 가장 오래된 것이다', () => {
    const { world } = setup(1);
    const before = fillReflectBullets(world);
    const oldest = before[0];
    const second = before[1];
    if (oldest === undefined || second === undefined) {
      throw new Error('채운 목록이 비었다');
    }

    const slot = acquireReflectSlot(world);

    expect(world.reflectBullets.activeCount).toBe(PLAYFIELD.maxReflectBullets);
    // 회수된 슬롯이 그대로 신규가 된다. 새 객체가 나오면 런 중 할당이 생긴 것이다.
    // 그래서 "지워졌다"를 동일성으로 물을 수 없다 — 자리와 초기화 여부가 그 답이다
    expect(slot).toBe(oldest);
    expect(world.reflectBullets.active[0]).toBe(second);
    expect(world.reflectBullets.active[world.reflectBullets.activeCount - 1]).toBe(slot);
    expect(slot.owner).toBe('enemy');
    expect(slot.graceRemainingSec).toBe(0);
    expect(slot.lifeRemainingSec).toBe(Number.POSITIVE_INFINITY);
  });

  it('상한에 닿아 있어도 패리는 성립한다 — 신규 반사탄이 버려지지 않는다', () => {
    const { world, input } = setup(1);
    const before = fillReflectBullets(world);
    const oldest = before[0];
    const second = before[1];
    if (oldest === undefined || second === undefined) {
      throw new Error('채운 목록이 비었다');
    }
    const source = placeIncoming(world, 20);

    press(input);
    step(world, input, 1);

    expect(world.run.combo).toBe(1);
    expect(world.reflectBullets.activeCount).toBe(PLAYFIELD.maxReflectBullets);
    // 가장 오래된 것이 목록 앞에서 빠지고 그 슬롯이 신규 반사탄이 됐다
    expect(world.reflectBullets.active[0]).toBe(second);
    const born = world.reflectBullets.active[world.reflectBullets.activeCount - 1];
    expect(born).toBe(oldest);
    // 적 탄환 슬롯은 반납되고 반사탄 슬롯이 그 탄을 물려받는다
    expect(world.enemyBullets.active.includes(source)).toBe(false);
    expect(born?.owner).toBe('player');
    expect(born?.lastGrade).toBe('GREAT');
    expect(born?.damage).toBeGreaterThan(0);
  });
});

describe('§3.2 · §9.1 잡몹 상한 — 지연이지 취소가 아니다', () => {
  it('상한에 닿으면 스폰만 거부하고 이미 있는 잡몹은 한 기도 안 지운다', () => {
    const { world } = setup(1);
    const before = fillEnemies(world);

    expect(canSpawnEnemy(world)).toBe(false);
    expect(acquireEnemySlot(world)).toBeNull();

    expect(world.enemies.activeCount).toBe(PLAYFIELD.maxEnemies);
    expect(sameSlots(world.enemies.active, before)).toBe(true);
  });

  it('거절은 만료되지 않는다 — 시간이 흘러도 자리가 나면 같은 편성이 그대로 나온다', () => {
    const { world, input } = setup(1);
    fillEnemies(world);

    // 대기열은 sim/waves.ts 몫이라 아직 없다. 부르는 쪽이 편성을 들고 있는 형태만 세운다
    const pending: readonly { enemyId: EnemyId; xU: number; yU: number }[] = [
      { enemyId: 'E-E', xU: PLAYFIELD.playerBounds.maxXU, yU: SHOOTER_YU },
    ];
    let spawned: Enemy | null = null;

    function drainPending(): void {
      const next = pending[0];
      if (next === undefined || spawned !== null) {
        return;
      }
      const slot = acquireEnemySlot(world);
      if (slot === null) {
        return;
      }
      placeEnemy(slot, next.enemyId, next.xU, next.yU);
      spawned = slot;
    }

    for (let i = 0; i < 240; i += 1) {
      drainPending();
      step(world, input, 1);
    }
    expect(spawned).toBeNull();
    expect(world.enemies.activeCount).toBe(PLAYFIELD.maxEnemies);

    const leaving = world.enemies.active[0];
    if (leaving === undefined) {
      throw new Error('활성 목록이 비었다');
    }
    world.enemies.release(leaving);
    drainPending();

    expect(spawned).not.toBeNull();
    expect(world.enemies.activeCount).toBe(PLAYFIELD.maxEnemies);
    expect(world.enemies.active[world.enemies.activeCount - 1]).toBe(spawned);
    // 취소됐다면 편성의 값이 아니라 기본값이 남는다
    expect(spawned!.hitRadiusU).toBe(ENEMIES['E-E'].hitRadiusU);
    expect(spawned!.scoreValue).toBe(ENEMIES['E-E'].score);
  });
});

describe('§3.2 셋의 처리는 서로 다르다', () => {
  it('같은 스텝에 셋 다 상한인데, 반사탄만 신규를 내주고 반사탄만 하나를 잃는다', () => {
    const { world } = setup(1);
    const bullets = fillEnemyBullets(world);
    const reflects = fillReflectBullets(world);
    const enemies = fillEnemies(world);
    const secondReflect = reflects[1];
    if (secondReflect === undefined) {
      throw new Error('채운 목록이 비었다');
    }

    // 반환형이 셋 다 다르다는 것이 처리가 다르다는 사실의 코드상 표현이다
    const fired: Projectile | null = fireEnemyBullet(world, shotAt(0));
    const slot: Projectile = acquireReflectSlot(world);
    const enemy: Enemy | null = acquireEnemySlot(world);

    expect(fired).toBeNull();
    expect(enemy).toBeNull();
    expect(slot).toBeDefined();

    // 거부된 둘은 목록이 통째로 그대로다
    expect(sameSlots(world.enemyBullets.active, bullets)).toBe(true);
    expect(sameSlots(world.enemies.active, enemies)).toBe(true);
    // 성사된 하나만 목록이 한 칸 밀렸다
    expect(world.reflectBullets.activeCount).toBe(reflects.length);
    expect(world.reflectBullets.active[0]).toBe(secondReflect);
    expect(sameSlots(world.reflectBullets.active, reflects)).toBe(false);
  });
});
