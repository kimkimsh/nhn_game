/**
 * 반사 — 스펙 §5.5 반사 방향 · §7.1 반사탄의 일생 · §7.2 데미지 계산 순서 · §7.4 재패리.
 * 09_검증_전략.md §3.2.
 *
 * `v' · n > 0`이 이 파일의 중심이다. HR-07이 반사탄을 플레이어에게 유해하게 만들었는데도 반사
 * 즉시 자기 탄에 맞지 않는 근거가 그 부등식 하나뿐이라, 개별 케이스가 아니라 각도 전체에 건다.
 *
 * 데미지는 세계를 통해서만 잰다. 스펙 §7.2의 6단계를 계산하는 함수가 따로 있지 않고
 * sim/reflect.ts의 대입 한 줄이 그 순서 전체라, 그 줄을 부르지 않으면 검사할 대상이 없다.
 *
 * 기대값은 스펙의 숫자를 그대로 적는다. config에서 읽어 오면 표를 잘못 고쳤을 때 테스트가
 * 함께 따라가 초록불이 된다 — 이 파일이 대조하는 상대는 구현이 아니라 스펙이다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BULLETS } from '../src/config/bullets';
import type { BulletId } from '../src/config/ids';
import type { BulletDef } from '../src/config/types';
import { bus } from '../src/core/bus';
import { createInput, type Input } from '../src/core/input';
import { FIXED_DT_SEC } from '../src/core/loop';
import { createVec2, dot, lengthOf, reflectAboutCenterInto } from '../src/core/vec';
import { bulletSpeedUPerSec, decayReflectGrace, type Projectile } from '../src/sim/bullets';
import { consumeParryInput, resolveParry } from '../src/sim/parry';
import { stepWorld } from '../src/sim/step';
import { createBaseStats, createWorld, type World } from '../src/sim/world';

const HORIZON_MS = 1e9;
const PARRY_KEY = 'Space';

function setup(stageId: 1 | 5 = 1): { world: World; input: Input } {
  const world = createWorld({ stageId, seed: 1 });
  const input = createInput();
  input.beginFrame(HORIZON_MS);
  return { world, input };
}

function press(input: Input): void {
  input.pressKey({ code: PARRY_KEY, atMs: 0, shiftHeld: false, repeat: false });
  input.releaseKey(PARRY_KEY);
}

/**
 * 플레이어 기준 (dxU, dyU)에 플레이어 쪽으로 곧게 향하는 적 탄환을 놓는다.
 * 여기 적은 오프셋이 그대로 판정 거리가 된다 — 적분을 거치지 않기 때문이다.
 */
function placeApproaching(world: World, bulletId: BulletId, dxU: number, dyU: number): Projectile {
  const projectile = world.enemyBullets.acquire();
  if (projectile === null) {
    throw new Error('적 탄환 풀이 비었다');
  }
  const def: BulletDef = BULLETS[bulletId];
  const distU = lengthOf(dxU, dyU);
  const speedUPerSec = bulletSpeedUPerSec(world, bulletId);
  projectile.bulletId = bulletId;
  projectile.owner = 'enemy';
  projectile.xU = world.player.xU + dxU;
  projectile.yU = world.player.yU + dyU;
  projectile.prevXU = projectile.xU;
  projectile.prevYU = projectile.yU;
  projectile.vxUPerSec = (-dxU / distU) * speedUPerSec;
  projectile.vyUPerSec = (-dyU / distU) * speedUPerSec;
  projectile.radiusU = def.radiusU;
  projectile.brp = def.brp;
  projectile.isParryable = def.isParryable;
  projectile.lifeRemainingSec = Number.POSITIVE_INFINITY;
  return projectile;
}

/** 8번(적분)이 지난 자리가 (dxU, dyU)가 되도록 같은 반직선 위 한 스텝 뒤에 놓는다 */
function placeIncoming(world: World, bulletId: BulletId, dxU: number, dyU: number): Projectile {
  const distU = lengthOf(dxU, dyU);
  const backU = bulletSpeedUPerSec(world, bulletId) * FIXED_DT_SEC;
  const scale = (distU + backU) / distU;
  return placeApproaching(world, bulletId, dxU * scale, dyU * scale);
}

/** 05 §1의 2번과 9번만. 8번을 건너뛰므로 배치한 거리가 그대로 판정 거리다 */
function parryNow(world: World, input: Input): void {
  press(input);
  consumeParryInput(world, input, HORIZON_MS);
  resolveParry(world, input);
  world.bus.flush();
}

function step(world: World, input: Input, count: number): void {
  for (let index = 0; index < count; index += 1) {
    stepWorld(world, FIXED_DT_SEC, { input, untilMs: HORIZON_MS });
  }
}

/**
 * 잡몹을 매 스텝 비우고 도는 스텝. 5번이 세운 개체는 진입 시작 지점에 선 채로 사라지므로
 * 반사탄의 항로에 아무것도 남지 않는다 — 반사탄이 명중이 아니라 다른 이유로 사라지는 것을
 * 보는 케이스가 쓴다.
 */
function stepEmptyField(world: World, input: Input, count: number): void {
  for (let index = 0; index < count; index += 1) {
    world.enemies.releaseAll();
    stepWorld(world, FIXED_DT_SEC, { input, untilMs: HORIZON_MS });
  }
}

/** 시간만 민다. 8번을 부르지 않으므로 발사체는 제자리에 남고 재입력 제한만 비켜난다 */
function elapse(world: World, input: Input, elapsedSec: number): void {
  world.simTimeSec += elapsedSec;
  input.decayParryBuffer(elapsedSec);
  decayReflectGrace(world, elapsedSec);
  world.parry.cooldownUntilSec = world.simTimeSec;
}

/** 반사탄을 플레이어 쪽으로 되돌려 세운다 — §7.4가 말하는 "앞질렀을 때"의 상태다 */
function turnBack(world: World, projectile: Projectile, distU: number): void {
  projectile.xU = world.player.xU;
  projectile.yU = world.player.yU - distU;
  projectile.prevXU = projectile.xU;
  projectile.prevYU = projectile.yU;
  projectile.vxUPerSec = 0;
  projectile.vyUPerSec = Math.abs(projectile.vyUPerSec);
}

function onlyReflect(world: World): Projectile {
  const projectile = world.reflectBullets.active[0];
  if (projectile === undefined) {
    throw new Error('반사탄이 생기지 않았다');
  }
  return projectile;
}

beforeEach(() => {
  bus.reset();
});

describe('§5.5 반사 공식', () => {
  it('정면으로 받으면 쏜 방향으로 되돌아간다', () => {
    const out = createVec2();
    // 탄환이 플레이어 바로 위 → n = (0, −1), v는 아래로 내려오는 중
    reflectAboutCenterInto(out, 0, 760, 0, -50, 0, 0);

    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(-760, 6);
  });

  it('가장자리로 받으면 크게 꺾이고 속력은 보존된다', () => {
    const out = createVec2();
    // n = (0.6, −0.8)이 되도록 그 방향으로 50u 떨어진 자리에 둔다
    reflectAboutCenterInto(out, 0, 760, 30, -40, 0, 0);

    expect(out.x).toBeCloseTo(729.6, 3);
    expect(out.y).toBeCloseTo(-212.8, 3);
    expect(lengthOf(out.x, out.y)).toBeCloseTo(760, 3);
  });

  it('v · n < 0인 어떤 속도도 반사 뒤에는 v′ · n > 0이다', () => {
    const out = createVec2();
    for (let deg = 0; deg < 360; deg += 7) {
      const rad = (deg * Math.PI) / 180;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);
      // 접근 성분 −500에 접선 성분 300을 얹는다. C2를 통과하는 임의의 속도다
      const vx = -nx * 500 + ny * 300;
      const vy = -ny * 500 - nx * 300;
      reflectAboutCenterInto(out, vx, vy, nx * 40, ny * 40, 0, 0);

      expect(dot(out.x, out.y, nx, ny)).toBeGreaterThan(0);
    }
  });

  it('어느 방향에서 받아도 반사탄은 플레이어에게서 멀어지며 출발한다', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const { world, input } = setup();
      placeApproaching(world, 'P2', Math.cos(rad) * 30, Math.sin(rad) * 30);
      parryNow(world, input);
      const reflected = onlyReflect(world);

      const awayXU = reflected.xU - world.player.xU;
      const awayYU = reflected.yU - world.player.yU;
      expect(dot(reflected.vxUPerSec, reflected.vyUPerSec, awayXU, awayYU)).toBeGreaterThan(0);
    }
  });
});

describe('§7.1 반사탄의 일생', () => {
  it('속도 상한 2400 u/s에서 잘린다 — 편전 P3 · S5 탄속 · GREAT', () => {
    const { world, input } = setup(5);
    // 880 × 1.34 × 2.6 = 3066. 상한이 없으면 이 값이 그대로 나온다
    placeApproaching(world, 'P3', 0, -20);
    parryNow(world, input);
    const reflected = onlyReflect(world);

    expect(reflected.lastGrade).toBe('GREAT');
    expect(lengthOf(reflected.vxUPerSec, reflected.vyUPerSec)).toBeCloseTo(2400, 6);
  });

  it('수명 3.0초가 지나면 소멸한다', () => {
    const { world, input } = setup();
    // 함포탄 P6를 NOT BAD로 받으면 390 u/s다. 3.0초 동안 소멸 경계에 닿지 못하므로
    // 사라지는 원인이 수명 하나로 좁혀진다
    placeIncoming(world, 'P6', 0, -60);
    press(input);
    step(world, input, 1);
    const reflected = onlyReflect(world);
    expect(reflected.lastGrade).toBe('NOT_BAD');
    expect(reflected.lifeRemainingSec).toBe(3.0);

    // 05 §1의 5번이 붙은 뒤로 W1 편성이 같은 세로줄로 내려온다. 비우지 않으면 반사탄이 수명
    // 전에 명중으로 사라져 이 케이스가 재는 것이 수명이 아니게 된다
    stepEmptyField(world, input, 350);
    expect(world.reflectBullets.activeCount).toBe(1);
    stepEmptyField(world, input, 15);
    expect(world.reflectBullets.activeCount).toBe(0);
  });

  it('S-12 — 반사되는 순간 유도를 잃고 이후 방향이 유지된다', () => {
    const { world, input } = setup();
    const bullet = placeIncoming(world, 'P11', -12, -16);
    bullet.homingRemainingSec = 0.8;
    bullet.homingTurnRateDegPerSec = BULLETS.P11.homing.turnRateDegPerSec;
    press(input);
    step(world, input, 1);
    const reflected = onlyReflect(world);

    expect(reflected.lastGrade).toBe('GREAT');
    expect(reflected.homingRemainingSec).toBe(0);

    const speedUPerSec = lengthOf(reflected.vxUPerSec, reflected.vyUPerSec);
    const dirX = reflected.vxUPerSec / speedUPerSec;
    const dirY = reflected.vyUPerSec / speedUPerSec;
    step(world, input, 30);
    const laterSpeedUPerSec = lengthOf(reflected.vxUPerSec, reflected.vyUPerSec);

    expect(laterSpeedUPerSec).toBeCloseTo(speedUPerSec, 9);
    expect(reflected.vxUPerSec / laterSpeedUPerSec).toBeCloseTo(dirX, 9);
    expect(reflected.vyUPerSec / laterSpeedUPerSec).toBeCloseTo(dirY, 9);
  });
});

describe('§7.4 재패리', () => {
  it('수명과 자해 유예를 다시 시작하고 점수는 등급 점수의 50%다', () => {
    const { world, input } = setup();
    placeIncoming(world, 'P6', 0, -60);
    press(input);
    step(world, input, 1);
    const reflected = onlyReflect(world);
    const scoreAfterFirst = world.run.score;
    expect(scoreAfterFirst).toBe(50);

    // 1.0초를 날려 수명을 깎은 뒤 추격해 앞지른 상태로 되돌려 세운다
    step(world, input, 120);
    expect(reflected.lifeRemainingSec).toBeLessThan(2.1);
    turnBack(world, reflected, 20);
    press(input);
    step(world, input, 1);

    expect(reflected.lastGrade).toBe('GREAT');
    expect(reflected.lifeRemainingSec).toBe(3.0);
    expect(reflected.graceRemainingSec).toBe(0.15);
    expect(world.run.score - scoreAfterFirst).toBe(200);
  });
});

describe('§7.2 데미지 계산 순서', () => {
  it('예시 1 — 조총탄 GREAT + N01 3중첩 + R04 → 106', () => {
    const { world, input } = setup();
    // N01(+45%)은 3단계 가산, R04(GREAT ×1.5)는 4단계 조건부 배수다. 지금 스냅샷이 카드 보정을
    // 내보내는 자리가 reflectDamageMulFor 하나뿐이라 두 단계의 곱을 그 자리에 넣는다
    world.stats = { ...createBaseStats(), reflectDamageMulFor: () => 1.45 * 1.5 };
    placeApproaching(world, 'P2', 0, -20);
    parryNow(world, input);

    // 14 × 3.5 × 1.45 × 1.5 = 106.575 → 6단계에서 내림
    expect(onlyReflect(world).damage).toBe(106);
  });

  it('예시 2 — 함포탄 NOT BAD 55, GREAT로 재패리해도 누적이 아니라 192', () => {
    const { world, input } = setup();
    placeApproaching(world, 'P6', 0, -60);
    parryNow(world, input);
    const reflected = onlyReflect(world);
    expect(reflected.lastGrade).toBe('NOT_BAD');
    expect(reflected.damage).toBe(55);

    turnBack(world, reflected, 20);
    elapse(world, input, 0.16);
    parryNow(world, input);

    expect(reflected.lastGrade).toBe('GREAT');
    expect(reflected.damage).toBe(192);
  });

  it('기준값은 언제나 BRP다 — GOOD 110을 GREAT로 재패리해도 385가 아니라 192다', () => {
    const { world, input } = setup();
    placeApproaching(world, 'P6', 0, -40);
    parryNow(world, input);
    const reflected = onlyReflect(world);
    expect(reflected.lastGrade).toBe('GOOD');
    expect(reflected.damage).toBe(110);

    turnBack(world, reflected, 20);
    elapse(world, input, 0.16);
    parryNow(world, input);

    // 직전 데미지 110에 3.5를 다시 곱하면 385가 나온다. 스펙 §7.2의 1번이 막는 자리다
    expect(reflected.damage).toBe(192);
  });
});
