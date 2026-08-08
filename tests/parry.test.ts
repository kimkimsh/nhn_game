/**
 * 패리 — 스펙 §5.2 성립 조건 · §5.3 등급 판정 · §5.4 빈 패리. 09_검증_전략.md §3.1.
 *
 * 케이스가 두 갈래로 갈린다.
 *
 * 밴드 경계와 C1~C5는 05 §1의 2번(입력 소비)과 9번(판정)만 직접 부른다. 8번(적분)을 함께
 * 태우면 한 스텝의 이동량이 판정 거리에 섞여 d = 28.0과 d = 28.001이 같은 자리에 도착한다 —
 * 경계를 찍는 것이 목적인 케이스에서 그 이동량은 잡음이다.
 *
 * 순서(9번이 10번보다 먼저)와 빈 패리만 stepWorld를 통째로 돌린다. 그 둘이 잠그는 것이
 * 단계 사이의 순서 자체라, 단계를 골라 부르면 검사할 대상 자체가 사라진다.
 *
 * 기대값은 스펙의 숫자를 그대로 적는다. config에서 읽어 오면 표를 잘못 고쳤을 때 테스트가
 * 함께 따라가 초록불이 된다 — 이 파일이 대조하는 상대는 구현이 아니라 스펙이다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BULLETS } from '../src/config/bullets';
import type { BulletId, ParryGradeId } from '../src/config/ids';
import { PARRY } from '../src/config/parry';
import { PLAYER } from '../src/config/player';
import type { BulletDef } from '../src/config/types';
import { bus, type FeedbackEventKind, type FeedbackEventOf } from '../src/core/bus';
import { createInput, type Input } from '../src/core/input';
import { FIXED_DT_SEC } from '../src/core/loop';
import { lengthOf } from '../src/core/vec';
import { bulletSpeedUPerSec, decayReflectGrace, type Projectile } from '../src/sim/bullets';
import { consumeParryInput, resolveParry } from '../src/sim/parry';
import { stepWorld } from '../src/sim/step';
import { addCombo } from '../src/sim/score';
import { createWorld, type World } from '../src/sim/world';

/** 눌림 큐의 소비 상한. 실시간에 기대지 않도록 모든 눌림을 언제나 접수 가능하게 둔다 */
const HORIZON_MS = 1e9;
const PARRY_KEY = 'Space';

function setup(): { world: World; input: Input } {
  const world = createWorld({ stageId: 1, seed: 1 });
  const input = createInput();
  input.beginFrame(HORIZON_MS);
  return { world, input };
}

function record<K extends FeedbackEventKind>(kind: K): FeedbackEventOf<K>[] {
  const events: FeedbackEventOf<K>[] = [];
  bus.on(kind, (event) => {
    events.push(event);
  });
  return events;
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

/** 8번(적분)이 지난 자리가 distU가 되도록 한 스텝만큼 뒤에 놓는다. stepWorld를 도는 케이스용 */
function placeIncoming(world: World, bulletId: BulletId, distU: number): Projectile {
  const backU = bulletSpeedUPerSec(world, bulletId) * FIXED_DT_SEC;
  return placeApproaching(world, bulletId, 0, -(distU + backU));
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
 * 시간만 민다. 8번을 부르지 않으므로 발사체는 제자리에 남는다.
 * §5.1 재입력 제한을 함께 지우는 것은 그것이 C5와 무관한 조건이기 때문이다 —
 * 남겨 두면 다음 판정이 열리지 않아 C5가 아니라 쿨다운을 재게 된다.
 */
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

describe('§5.3 등급 밴드 경계', () => {
  /** 경계마다 양쪽 끝을 찍는다. 부등호가 < 와 ≤ 사이에서 밀리면 위쪽 값만 무너진다 */
  const BAND_CASES: [number, ParryGradeId | null][] = [
    [28.0, 'GREAT'],
    [28.001, 'GOOD'],
    [28.01, 'GOOD'],
    [48.0, 'GOOD'],
    [48.001, 'NOT_BAD'],
    [48.01, 'NOT_BAD'],
    [120.0, 'NOT_BAD'],
    [120.001, null],
    [120.01, null],
  ];

  it.each(BAND_CASES)('d = %f → %s', (distU, expected) => {
    const { world, input } = setup();
    placeApproaching(world, 'P2', 0, -distU);
    parryNow(world, input);

    expect(world.reflectBullets.active[0]?.lastGrade ?? null).toBe(expected);
    expect(world.run.combo).toBe(expected === null ? 0 : 1);
  });
});

describe('§5.2 성립 조건', () => {
  it('C1 — 반경 밖은 아무 일도 일어나지 않는다', () => {
    const { world, input } = setup();
    const parries = record('parry');
    placeApproaching(world, 'P2', 0, -120.01);
    parryNow(world, input);

    expect(world.enemyBullets.activeCount).toBe(1);
    expect(world.reflectBullets.activeCount).toBe(0);
    expect(world.player.parryInvulnUntilSec).toBe(0);
    expect(parries).toHaveLength(0);
  });

  it('C2 — 이미 스쳐 지나간 발사체는 반경 안이어도 성립하지 않는다', () => {
    const { world, input } = setup();
    const projectile = placeApproaching(world, 'P2', 0, -30);
    // 방향만 뒤집는다 → v · n > 0. 위치도 거리도 그대로다
    projectile.vyUPerSec = -projectile.vyUPerSec;
    parryNow(world, input);

    expect(world.reflectBullets.activeCount).toBe(0);
    expect(world.run.combo).toBe(0);
  });

  it.each(['P9', 'P12'] as const)('C3 — %s는 반경 안이어도 패리되지 않는다', (bulletId) => {
    const { world, input } = setup();
    const projectile = placeApproaching(world, bulletId, 0, -20);
    // 두 탄은 속도가 0이라 C2가 먼저 걸러 낸다. 접근 속도를 주어 C3만 남긴다
    projectile.vyUPerSec = 400;
    parryNow(world, input);

    expect(world.enemyBullets.activeCount).toBe(1);
    expect(world.reflectBullets.activeCount).toBe(0);
    expect(world.run.combo).toBe(0);
  });

  it('C4 — 같은 활성 구간에서 두 번째 판정은 성립하지 않는다', () => {
    const { world, input } = setup();
    placeApproaching(world, 'P2', 0, -40);
    parryNow(world, input);
    const reflected = onlyReflect(world);
    expect(reflected.lastGrade).toBe('GOOD');

    // C5와 C2를 비켜 세워 C4만 남긴다. 활성 구간은 열린 채이므로 sessionId가 그대로다
    reflected.graceRemainingSec = 0;
    turnBack(world, reflected, 20);
    resolveParry(world, input);

    expect(reflected.lastGrade).toBe('GOOD');
    expect(world.run.combo).toBe(1);
  });

  it('C5 — 자해 유예가 남아 있으면 성립하지 않는다 (반사 후 0.14초)', () => {
    const { world, input } = setup();
    placeApproaching(world, 'P2', 0, -40);
    parryNow(world, input);
    const reflected = onlyReflect(world);

    turnBack(world, reflected, 20);
    elapse(world, input, 0.14);
    parryNow(world, input);

    expect(reflected.lastGrade).toBe('GOOD');
    expect(world.run.combo).toBe(1);
  });

  it('C5 — 자해 유예가 끝나면 성립한다 (반사 후 0.16초, 접근 중)', () => {
    const { world, input } = setup();
    placeApproaching(world, 'P2', 0, -40);
    parryNow(world, input);
    const reflected = onlyReflect(world);

    turnBack(world, reflected, 20);
    elapse(world, input, 0.16);
    parryNow(world, input);

    expect(reflected.lastGrade).toBe('GREAT');
    expect(world.run.combo).toBe(2);
  });
});

describe('§5.4 빈 패리', () => {
  it('무적도 점수도 히트스톱도 없고 콤보는 리셋되지 않는다', () => {
    const { world, input } = setup();
    const whiffs = record('parryWhiff');
    addCombo(world, 12);
    press(input);
    // 활성 구간이 닫히는 스텝까지 돈다 — 빈 패리는 그 자리에서만 확정된다
    step(world, input, Math.ceil(PARRY.activeSec / FIXED_DT_SEC) + 2);

    expect(world.player.parryInvulnUntilSec).toBe(0);
    expect(world.run.combo).toBe(12);
    expect(world.run.score).toBe(0);
    expect(world.clock.budgetUsedSec(world.simTimeSec)).toBe(0);
    expect(whiffs).toHaveLength(1);
  });
});

describe('§5.1 판정 순서 — 9번(패리)이 10번(피격)보다 먼저다', () => {
  it('참격파 P5를 d = 26에서 받으면 GREAT가 성립하고 피격은 없다', () => {
    const { world, input } = setup();
    // P5 반경 34u + 코어 10u = 44u이므로 탄 몸통이 이미 코어를 덮은 자리다.
    // 순서가 뒤집히면 이 스텝은 패리가 아니라 피격이 된다
    placeIncoming(world, 'P5', 26);
    press(input);
    step(world, input, 1);

    expect(world.player.lives).toBe(PLAYER.startLife);
    expect(onlyReflect(world).lastGrade).toBe('GREAT');
    expect(world.player.parryInvulnUntilSec).toBeCloseTo(world.simTimeSec + PARRY.invulnSec, 12);
  });
});

describe('§5.3 다중 패리 — 한 번의 패리가 여러 발을 동시에 반사한다', () => {
  it('등급은 발마다, 등급 종속 값은 최고 등급으로 1회, 콤보만 개수만큼', () => {
    const { world, input } = setup();
    const parries = record('parry');
    const launches = record('reflectLaunched');
    for (const distU of [20, 40, 60]) {
      placeApproaching(world, 'P2', 0, -distU);
    }
    parryNow(world, input);

    const grades = world.reflectBullets.active.map((projectile) => projectile.lastGrade);
    expect(grades).toEqual(['GREAT', 'GOOD', 'NOT_BAD']);
    expect(launches.map((event) => event.grade)).toEqual(['GREAT', 'GOOD', 'NOT_BAD']);

    // 세 등급의 합 0.06이 아니라 GREAT 1회다
    expect(world.clock.budgetUsedSec(world.simTimeSec)).toBeCloseTo(0.02, 6);
    // 400 + 150 + 50 = 600이 아니라 GREAT 1회다
    expect(world.run.score).toBe(400);
    // §12.2 — 콤보만 처리한 발사체 개수만큼 오른다
    expect(world.run.combo).toBe(3);

    expect(parries).toHaveLength(1);
    expect(parries[0]?.grade).toBe('GREAT');
    expect(parries[0]?.count).toBe(3);
    expect(parries[0]?.combo).toBe(3);
  });
});
