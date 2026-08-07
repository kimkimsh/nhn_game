import { describe, expect, it } from 'vitest';
import { BULLETS } from '../src/config/bullets';
import { ENEMIES } from '../src/config/enemies';
import { PARRY } from '../src/config/parry';
import { PLAYER } from '../src/config/player';
import { createInput, type Input } from '../src/core/input';
import { FIXED_DT_SEC } from '../src/core/loop';
import type { Projectile } from '../src/sim/bullets';
import { acquireEnemySlot } from '../src/sim/caps';
import { stepWorld } from '../src/sim/step';
import { createWorld, type World } from '../src/sim/world';

const HORIZON_MS = 1e9;

function setup(): { world: World; input: Input } {
  const world = createWorld({ stageId: 1, seed: 1 });
  const input = createInput();
  input.beginFrame(HORIZON_MS);
  return { world, input };
}

function step(world: World, input: Input, count: number): void {
  for (let i = 0; i < count; i += 1) {
    stepWorld(world, FIXED_DT_SEC, { input, untilMs: HORIZON_MS });
  }
}

function press(input: Input): void {
  input.pressKey({ code: 'Space', atMs: 0, shiftHeld: false, repeat: false });
  input.releaseKey('Space');
}

/** 적분(8번) 뒤에 정확히 distU가 되도록 플레이어 위쪽에 놓는다 */
function placeIncoming(world: World, bulletId: 'P2' | 'P5' | 'P11', distU: number): Projectile {
  const p = world.enemyBullets.acquire();
  if (p === null) {
    throw new Error('pool');
  }
  const def = BULLETS[bulletId];
  const speed = def.speedUPerSec;
  p.bulletId = bulletId;
  p.owner = 'enemy';
  p.xU = world.player.xU;
  p.yU = world.player.yU - distU - speed * FIXED_DT_SEC;
  p.prevXU = p.xU;
  p.prevYU = p.yU;
  p.vxUPerSec = 0;
  p.vyUPerSec = speed;
  p.radiusU = def.radiusU;
  p.brp = def.brp;
  p.isParryable = def.isParryable;
  p.lifeRemainingSec = Number.POSITIVE_INFINITY;
  return p;
}

describe('P3-B 최소 전투 루프', () => {
  it('등급이 거리로 갈린다', () => {
    for (const [distU, grade] of [[20, 'GREAT'], [40, 'GOOD'], [60, 'NOT_BAD']] as const) {
      const { world, input } = setup();
      placeIncoming(world, 'P2', distU);
      press(input);
      step(world, input, 1);
      expect(world.reflectBullets.activeCount).toBe(1);
      expect(world.reflectBullets.active[0]?.lastGrade).toBe(grade);
    }
  });

  it('반사탄은 플레이어에게서 멀어지고 유도를 잃는다', () => {
    const { world, input } = setup();
    const p = placeIncoming(world, 'P11', 30);
    p.homingRemainingSec = 1.2;
    p.homingTurnRateDegPerSec = 120;
    press(input);
    step(world, input, 1);
    const reflected = world.reflectBullets.active[0];
    expect(reflected?.vyUPerSec).toBeLessThan(0);
    expect(reflected?.homingRemainingSec).toBe(0);
  });

  it('데미지는 언제나 BRP에서 다시 시작한다', () => {
    const { world, input } = setup();
    placeIncoming(world, 'P2', 20);
    press(input);
    step(world, input, 1);
    expect(world.reflectBullets.active[0]?.damage).toBe(Math.floor(BULLETS.P2.brp * 3.5));
  });

  it('빈 패리는 무적을 주지 않는다', () => {
    const { world, input } = setup();
    press(input);
    step(world, input, Math.ceil(PARRY.activeSec / FIXED_DT_SEC) + 1);
    expect(world.player.parryInvulnUntilSec).toBe(0);
    expect(world.parry.sessionParryCount).toBe(0);
  });

  it('패리가 성립하면 무적이 붙는다', () => {
    const { world, input } = setup();
    placeIncoming(world, 'P2', 20);
    press(input);
    step(world, input, 1);
    expect(world.player.parryInvulnUntilSec).toBeGreaterThan(world.simTimeSec);
  });

  it('9번이 10번보다 먼저다 — 코어를 덮은 대형 탄환도 GREAT가 난다', () => {
    const { world, input } = setup();
    // P5 반경 34 + 코어 10 = 44 > 20이므로 순서가 뒤집히면 이 스텝은 피격이 된다
    placeIncoming(world, 'P5', 20);
    press(input);
    step(world, input, 1);
    expect(world.player.lives).toBe(PLAYER.startLife);
    expect(world.reflectBullets.active[0]?.lastGrade).toBe('GREAT');
  });

  it('되받아친 탄이 적을 죽인다', () => {
    const { world, input } = setup();
    const enemy = acquireEnemySlot(world);
    if (enemy === null) {
      throw new Error('enemy');
    }
    const def = ENEMIES['E-A'];
    enemy.xU = world.player.xU;
    enemy.yU = 300;
    enemy.prevXU = enemy.xU;
    enemy.prevYU = enemy.yU;
    enemy.hitRadiusU = def.hitRadiusU;
    enemy.hp = def.hp;
    enemy.maxHp = def.hp;
    enemy.scoreValue = def.score;
    // 05 §1의 4·5번이 붙은 뒤로 이 200스텝 사이에 W1 편성이 함께 들어온다. 남은 기수로도
    // 객체 동일성으로도 볼 수 없다 — 풀이 죽은 슬롯을 그 자리에서 다시 내주므로 죽은 그 기가
    // 곧 새로 들어온 기가 된다. 처치 사건의 좌표가 세워 둔 자리와 같은지가 유일한 증거다
    const placedYU = enemy.yU;
    const kills: number[] = [];
    const off = world.bus.on('enemyKilled', (event) => void kills.push(event.yU));
    placeIncoming(world, 'P2', 20);
    press(input);
    step(world, input, 200);
    off();
    expect(kills).toContain(placedYU);
    expect(world.run.score).toBeGreaterThan(0);
  });

  it('피격은 적 탄환만 지우고 반사탄은 남긴다', () => {
    const { world, input } = setup();
    const reflected = world.reflectBullets.acquire();
    if (reflected === null) {
      throw new Error('pool');
    }
    reflected.owner = 'player';
    reflected.xU = world.player.xU + 100;
    reflected.yU = world.player.yU;
    reflected.prevXU = reflected.xU;
    reflected.prevYU = reflected.yU;
    reflected.radiusU = 6;
    reflected.lifeRemainingSec = 3;
    reflected.graceRemainingSec = 0.15;
    placeIncoming(world, 'P2', 4);
    world.enemyBullets.acquire();
    const spare = world.enemyBullets.active[1];
    if (spare === undefined) {
      throw new Error('pool');
    }
    spare.xU = world.player.xU + 50;
    spare.yU = world.player.yU;
    spare.prevXU = spare.xU;
    spare.prevYU = spare.yU;
    spare.radiusU = 6;
    spare.lifeRemainingSec = Number.POSITIVE_INFINITY;

    step(world, input, 1);
    expect(world.player.lives).toBe(PLAYER.startLife - 1);
    expect(world.enemyBullets.activeCount).toBe(0);
    expect(world.reflectBullets.activeCount).toBe(1);
    expect(world.run.combo).toBe(0);
  });

  it('재패리는 등급을 다시 매기고 데미지는 BRP에서 다시 시작한다', () => {
    const { world, input } = setup();
    placeIncoming(world, 'P2', 60);
    press(input);
    step(world, input, 1);
    const reflected = world.reflectBullets.active[0];
    if (reflected === undefined) {
      throw new Error('reflect');
    }
    expect(reflected.lastGrade).toBe('NOT_BAD');
    const notBadDamage = reflected.damage;

    // 유예를 끝내고 다시 다가오게 돌려 세운다 — 추격해 앞지른 상황과 같다
    reflected.graceRemainingSec = 0;
    reflected.yU = world.player.yU - 20 - Math.abs(reflected.vyUPerSec) * FIXED_DT_SEC;
    reflected.vyUPerSec = Math.abs(reflected.vyUPerSec);
    world.parry.isActive = false;
    world.parry.cooldownUntilSec = world.simTimeSec;
    press(input);
    step(world, input, 1);

    expect(reflected.lastGrade).toBe('GREAT');
    expect(reflected.damage).toBe(Math.floor(BULLETS.P2.brp * 3.5));
    expect(reflected.damage).toBeGreaterThan(notBadDamage);
  });

  it('같은 활성 구간에서 두 번 패리되지 않는다 (C4)', () => {
    const { world, input } = setup();
    placeIncoming(world, 'P2', 40);
    press(input);
    step(world, input, 1);
    const reflected = world.reflectBullets.active[0];
    if (reflected === undefined) {
      throw new Error('reflect');
    }
    reflected.graceRemainingSec = 0;
    reflected.yU = world.player.yU - 20;
    reflected.vyUPerSec = Math.abs(reflected.vyUPerSec);
    step(world, input, 1);
    expect(reflected.lastGrade).toBe('GOOD');
  });

  it('히트스톱은 활성 구간당 한 번만 승인된다', () => {
    const { world, input } = setup();
    placeIncoming(world, 'P2', 20);
    press(input);
    step(world, input, 1);
    const afterFirst = world.clock.budgetUsedSec(world.simTimeSec);
    expect(afterFirst).toBeGreaterThan(0);
    placeIncoming(world, 'P2', 20);
    step(world, input, 1);
    expect(world.clock.budgetUsedSec(world.simTimeSec)).toBe(afterFirst);
    expect(world.run.combo).toBe(2);
  });

  it('콤보는 처리한 발사체 개수만큼 오른다', () => {
    const { world, input } = setup();
    const left = placeIncoming(world, 'P2', 20);
    left.xU -= 15;
    const right = placeIncoming(world, 'P2', 40);
    right.xU += 15;
    press(input);
    step(world, input, 1);
    expect(world.run.combo).toBe(2);
  });
});
