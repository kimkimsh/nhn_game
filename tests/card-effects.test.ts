/**
 * 카드가 sim에 실제로 닿는지 — 스펙 §11.3~§11.5.
 *
 * 이 파일이 잡는 고장은 값이 틀린 것이 아니라 **스냅샷에는 있는데 읽는 곳이 없는 것**이다.
 * 카드 선택 화면은 스냅샷의 델타를 그대로 보여 주므로, 소비자가 없으면 화면에는 적용된 것처럼
 * 보이고 게임에서는 아무 일도 일어나지 않는다 — 그 종류의 결함은 값 단언으로 안 잡힌다.
 * 그래서 각 항목이 「카드가 없을 때」와 「있을 때」의 차이 자체를 본다.
 *
 * 기대값은 스펙의 숫자를 적는다. config에서 읽어 오면 표를 잘못 고쳤을 때 테스트가 함께
 * 따라가 초록불이 된다.
 */
import { describe, expect, it } from 'vitest';
import { BULLETS } from '../src/config/bullets';
import type { BulletId, CardId } from '../src/config/ids';
import type { BulletDef } from '../src/config/types';
import { createInput, type Input } from '../src/core/input';
import { FIXED_DT_SEC } from '../src/core/loop';
import { lengthOf } from '../src/core/vec';
import { createBossState } from '../src/sim/boss';
import { resolveBossHits } from '../src/sim/boss-hits';
import { bulletSpeedUPerSec, integrateProjectiles, type Projectile } from '../src/sim/bullets';
import type { CardStack } from '../src/sim/cards';
import { applyPlayerHit, resolveReflectHits } from '../src/sim/collision';
import { consumeParryInput, resolveParry } from '../src/sim/parry';
import { flushReflectHitEffects } from '../src/sim/reflect-effects';
import { computeStats } from '../src/sim/stats';
import { autoParryOnBossEnter } from '../src/sim/parry';
import { createWorld, type Enemy, type World } from '../src/sim/world';

const HORIZON_MS = 1e9;
const PARRY_KEY = 'Space';

/** GREAT 밴드 안쪽. §5.3 GREAT은 28u 이내다 */
const GREAT_DIST_U = 20;
/** NOT BAD 밴드. 기본 패리 반경 78u 바로 안쪽이다 */
const NOT_BAD_DIST_U = 70;

function setup(cards: readonly CardId[], stageId: 1 | 4 = 1): { world: World; input: Input } {
  const world = createWorld({ stageId, seed: 11 });
  const held: CardStack[] = cards.map((id) => ({ id, stack: 1 }));
  world.stats = computeStats(held);
  const input = createInput();
  input.beginFrame(HORIZON_MS);
  return { world, input };
}

/** 플레이어 위쪽 distU에 아래로 내려오는 적 탄환 하나 */
function placeApproaching(world: World, bulletId: BulletId, distU: number): Projectile {
  const projectile = world.enemyBullets.acquire();
  if (projectile === null) {
    throw new Error('적 탄환 풀이 비었다');
  }
  const def: BulletDef = BULLETS[bulletId];
  projectile.bulletId = bulletId;
  projectile.owner = 'enemy';
  projectile.xU = world.player.xU;
  projectile.yU = world.player.yU - distU;
  projectile.prevXU = projectile.xU;
  projectile.prevYU = projectile.yU;
  projectile.vxUPerSec = 0;
  projectile.vyUPerSec = bulletSpeedUPerSec(world, bulletId);
  projectile.radiusU = def.radiusU;
  projectile.brp = def.brp;
  projectile.isParryable = def.isParryable;
  projectile.lifeRemainingSec = Number.POSITIVE_INFINITY;
  return projectile;
}

/** 05 §1의 2번과 9번만. 8번을 건너뛰므로 배치한 거리가 그대로 판정 거리다 */
function parryNow(world: World, input: Input): void {
  input.pressKey({ code: PARRY_KEY, atMs: 0, shiftHeld: false, repeat: false });
  input.releaseKey(PARRY_KEY);
  consumeParryInput(world, input, HORIZON_MS);
  resolveParry(world, input);
  world.bus.flush();
}

function placeEnemy(world: World, xU: number, yU: number, hp: number): Enemy {
  const enemy = world.enemies.acquire();
  if (enemy === null) {
    throw new Error('잡몹 풀이 비었다');
  }
  enemy.xU = xU;
  enemy.yU = yU;
  enemy.prevXU = xU;
  enemy.prevYU = yU;
  enemy.hitRadiusU = 24;
  enemy.hp = hp;
  enemy.maxHp = hp;
  enemy.scoreValue = 0;
  enemy.contactDamage = false;
  enemy.frontShieldIntact = false;
  return enemy;
}

function firstReflect(world: World): Projectile {
  const shot = world.reflectBullets.active[0];
  if (shot === undefined) {
    throw new Error('반사탄이 없다');
  }
  return shot;
}

describe('§11.3 N06 강궁 반사 — 반사탄 속도 +20%', () => {
  it('같은 등급에서 속도가 1.2배다', () => {
    const plain = setup([]);
    placeApproaching(plain.world, 'P1', NOT_BAD_DIST_U);
    parryNow(plain.world, plain.input);
    const baseSpeed = lengthOf(firstReflect(plain.world).vxUPerSec, firstReflect(plain.world).vyUPerSec);

    const carded = setup(['N06']);
    placeApproaching(carded.world, 'P1', NOT_BAD_DIST_U);
    parryNow(carded.world, carded.input);
    const cardSpeed = lengthOf(firstReflect(carded.world).vxUPerSec, firstReflect(carded.world).vyUPerSec);

    expect(cardSpeed / baseSpeed).toBeCloseTo(1.2, 6);
  });
});

describe('§11.3 N12 곧은 칼날 — 적 명중 판정 +25%', () => {
  /** 반사탄 반경의 25%만큼만 밖에 세운 적. 카드가 없으면 안 맞고 있으면 맞는다 */
  function reachTest(cards: readonly CardId[]): number {
    const { world, input } = setup(cards);
    placeApproaching(world, 'P1', NOT_BAD_DIST_U);
    parryNow(world, input);
    const shot = firstReflect(world);
    const enemy = placeEnemy(world, shot.xU, shot.yU - (enemyReachU(shot) + 1), 999);
    resolveReflectHits(world);
    return enemy.hp;
  }

  function enemyReachU(shot: Projectile): number {
    return 24 + shot.radiusU;
  }

  it('플레이어 피격 판정은 그대로다', () => {
    const { world } = setup(['N12']);
    // HR-07. 스냅샷의 배수는 적 명중에만 걸리고 collision.ts의 피격 판정은 원래 반경을 쓴다
    expect(world.stats.reflectHitRadiusMul).toBeCloseTo(1.25, 6);
  });

  it('카드가 없으면 닿지 않는 거리에 닿는다', () => {
    expect(reachTest([])).toBe(999);
    expect(reachTest(['N12'])).toBeLessThan(999);
  });

  /**
   * 보스 본체에도 걸린다. 부하 원형 판정에만 걸려 있으면 이 카드가 보스전에서만 조용히
   * 안 듣는데, 스펙 §11.3은 「적에게 명중하는 판정에만」이라고만 적었고 보스도 적이다.
   */
  function bossReachTest(cards: readonly CardId[]): number {
    const { world, input } = setup(cards, 4);
    placeApproaching(world, 'P1', NOT_BAD_DIST_U);
    parryNow(world, input);
    const shot = firstReflect(world);
    const boss = createBossState('B4');
    world.boss = boss;
    // 히트박스 반폭 밖으로 반사탄 반경의 12%만큼만 비켜 세운다 — 1.0배면 빗나가고 1.25배면 맞는다
    boss.xU = shot.xU + boss.def.hitBox.wU / 2 + shot.radiusU * 1.12;
    boss.yU = shot.yU;
    boss.prevXU = boss.xU;
    boss.prevYU = boss.yU;
    const before = boss.hp;
    resolveBossHits(world, boss);
    return before - boss.hp;
  }

  it('보스 본체 판정에도 걸린다', () => {
    expect(bossReachTest([])).toBe(0);
    expect(bossReachTest(['N12'])).toBeGreaterThan(0);
  });
});

describe('§11.4 R03 자석 반사 — 유도가 붙는다', () => {
  it('카드가 없으면 반사탄에 유도가 남지 않는다', () => {
    const { world, input } = setup([]);
    placeApproaching(world, 'P11', NOT_BAD_DIST_U);
    parryNow(world, input);
    expect(firstReflect(world).homingRemainingSec).toBe(0);
  });

  it('가장 가까운 적 쪽으로 선회한다', () => {
    const { world, input } = setup(['R03']);
    placeApproaching(world, 'P1', NOT_BAD_DIST_U);
    parryNow(world, input);
    const shot = firstReflect(world);
    expect(shot.homingRemainingSec).toBeGreaterThan(0);
    expect(shot.homingTurnRateDegPerSec).toBe(180);

    // 반사탄은 위로 나갔다. 적을 오른쪽에 두면 x 속도가 그쪽으로 붙어야 한다
    placeEnemy(world, world.player.xU + 400, world.player.yU - 400, 999);
    shot.graceRemainingSec = 0;
    integrateProjectiles(world, FIXED_DT_SEC);
    expect(shot.vxUPerSec).toBeGreaterThan(0);
  });
});

describe('§11.4 R01 쌍검 · §11.5 E01 학익진 — 분열', () => {
  function reflectCount(cards: readonly CardId[]): number {
    const { world, input } = setup(cards);
    placeApproaching(world, 'P1', NOT_BAD_DIST_U);
    parryNow(world, input);
    return world.reflectBullets.activeCount;
  }

  it('R01은 2발, E01은 3발, 둘 다 들면 6발이다', () => {
    expect(reflectCount([])).toBe(1);
    expect(reflectCount(['R01'])).toBe(2);
    expect(reflectCount(['E01'])).toBe(3);
    expect(reflectCount(['R01', 'E01'])).toBe(6);
  });

  it('§11.6 분열 계수는 곱연산 한 번이다', () => {
    const plain = setup([]);
    placeApproaching(plain.world, 'P1', NOT_BAD_DIST_U);
    parryNow(plain.world, plain.input);
    const baseDamage = firstReflect(plain.world).damage;

    const both = setup(['R01', 'E01']);
    placeApproaching(both.world, 'P1', NOT_BAD_DIST_U);
    parryNow(both.world, both.input);
    // 0.65 × 0.55 = 0.3575 (스펙 §11.6 상호작용 표)
    expect(firstReflect(both.world).damage).toBe(Math.floor(baseDamage * 0.3575));
  });
});

describe('§11.5 E02 신기전 — GREAT에서 반사탄을 교체한다', () => {
  it('GREAT은 P10 5발, 그 아래 등급은 원래 반사탄이다', () => {
    const great = setup(['E02']);
    placeApproaching(great.world, 'P1', GREAT_DIST_U);
    parryNow(great.world, great.input);
    expect(great.world.reflectBullets.activeCount).toBe(5);
    for (const shot of great.world.reflectBullets.active) {
      expect(shot.bulletId).toBe('P10');
    }

    const notBad = setup(['E02']);
    placeApproaching(notBad.world, 'P1', NOT_BAD_DIST_U);
    parryNow(notBad.world, notBad.input);
    expect(notBad.world.reflectBullets.activeCount).toBe(1);
    expect(firstReflect(notBad.world).bulletId).toBe('P1');
  });
});

describe('§11.4 R07 시간 늦추기 — GREAT 뒤 0.35초', () => {
  it('적 탄환만 40% 속도로 움직인다', () => {
    const { world, input } = setup(['R07']);
    const other = placeApproaching(world, 'P1', 400);
    placeApproaching(world, 'P1', GREAT_DIST_U);
    parryNow(world, input);

    const beforeYU = other.yU;
    const reflect = firstReflect(world);
    const reflectBeforeYU = reflect.yU;
    integrateProjectiles(world, FIXED_DT_SEC);

    const expectedU = other.vyUPerSec * FIXED_DT_SEC * 0.4;
    expect(other.yU - beforeYU).toBeCloseTo(expectedU, 6);
    // 반사탄은 느려지지 않는다(§11.4 R07)
    expect(Math.abs(reflect.yU - reflectBeforeYU)).toBeCloseTo(
      Math.abs(reflect.vyUPerSec) * FIXED_DT_SEC,
      6,
    );
  });
});

describe('§11.4 R08 파편 · §11.5 E06 화공 — 명중이 남기는 것', () => {
  function hitOnce(cards: readonly CardId[]): World {
    const { world, input } = setup(cards);
    placeApproaching(world, 'P1', NOT_BAD_DIST_U);
    parryNow(world, input);
    const shot = firstReflect(world);
    placeEnemy(world, shot.xU, shot.yU, 999);
    resolveReflectHits(world);
    flushReflectHitEffects(world);
    return world;
  }

  it('R08은 명중 지점에 6발을 남긴다', () => {
    expect(hitOnce([]).reflectBullets.activeCount).toBe(0);
    expect(hitOnce(['R08']).reflectBullets.activeCount).toBe(6);
  });

  it('E06은 초당 데미지가 반사탄 데미지의 30%인 장판을 남긴다', () => {
    expect(hitOnce([]).zones.activeCount).toBe(0);
    const world = hitOnce(['E06']);
    expect(world.zones.activeCount).toBe(1);
    const zone = world.zones.active[0]!;
    expect(zone.radiusU).toBe(60);
    expect(zone.enemyDamagePerSec).toBeGreaterThan(0);
  });
});

describe('§11.5 E03 거북선 등껍질 — 보호막 무적 1.5초', () => {
  it('라이프가 줄지 않고 카드가 정한 길이의 무적만 받는다', () => {
    const { world } = setup(['E03']);
    world.run.shieldCharges = 1;
    const lives = world.player.lives;
    applyPlayerHit(world, 'enemyBullet', null, 0, 1);
    expect(world.player.lives).toBe(lives);
    expect(world.run.shieldCharges).toBe(0);
    expect(world.player.hitInvulnUntilSec - world.simTimeSec).toBeCloseTo(1.5, 6);
  });
});

describe('§11.5 E04 이순신의 판단 — 보스전 진입 자동 GREAT 패리', () => {
  it('화면의 적 탄환이 전부 반사탄이 된다', () => {
    const { world } = setup(['E04'], 4);
    for (let index = 0; index < 5; index += 1) {
      placeApproaching(world, 'P1', 300 + index * 40);
    }
    expect(world.stats.autoParryGradeOnBossEnter).toBe('GREAT');

    world.boss = createBossState('B4');
    autoParryOnBossEnter(world);

    expect(world.enemyBullets.activeCount).toBe(0);
    expect(world.reflectBullets.activeCount).toBe(5);
    for (const shot of world.reflectBullets.active) {
      expect(shot.owner).toBe('player');
      expect(shot.lastGrade).toBe('GREAT');
    }
    // §12.2 콤보는 처리한 발사체 개수만큼 오른다
    expect(world.run.combo).toBe(5);
  });

  it('카드가 없으면 아무 일도 일어나지 않는다', () => {
    const { world } = setup([], 4);
    placeApproaching(world, 'P1', 300);
    world.boss = createBossState('B4');
    autoParryOnBossEnter(world);
    expect(world.enemyBullets.activeCount).toBe(1);
    expect(world.reflectBullets.activeCount).toBe(0);
  });

  it('일반 GREAT와 같은 것을 준다 — 점수 · 패리 무적 · 패리 사건', () => {
    const { world } = setup(['E04'], 4);
    placeApproaching(world, 'P1', 300);
    // 전역 버스라 앞 테스트가 남긴 큐가 있으면 이 구독이 그것까지 받는다
    world.bus.flush();
    const grades: string[] = [];
    world.bus.on('parry', (event) => void grades.push(event.grade));

    world.boss = createBossState('B4');
    autoParryOnBossEnter(world);
    world.bus.flush();

    // §12.1 GREAT 400점 × §12.2 콤보 1의 배수 1.0
    expect(world.run.score).toBeGreaterThan(0);
    // §5.3 패리 성공 무적. 자동이어도 패리이므로 붙는다
    expect(world.player.parryInvulnUntilSec).toBeGreaterThan(world.simTimeSec);
    // §17 「패리 성공」 신호. 이것이 없으면 화면이 조용하다
    expect(grades).toEqual(['GREAT']);
  });

  it('화면 밖 탄환은 대상이 아니다 — 스펙 문구가 「화면 내」다', () => {
    const { world } = setup(['E04'], 4);
    const inside = placeApproaching(world, 'P1', 300);
    const outside = placeApproaching(world, 'P1', 300);
    outside.yU = -80;
    outside.prevYU = outside.yU;

    world.boss = createBossState('B4');
    autoParryOnBossEnter(world);

    expect(world.reflectBullets.activeCount).toBe(1);
    expect(world.enemyBullets.active).toContain(outside);
    expect(world.enemyBullets.active).not.toContain(inside);
  });

  it('E04 + R01이면 자동 패리에서도 분열이 걸린다', () => {
    const { world } = setup(['E04', 'R01'], 4);
    placeApproaching(world, 'P1', 300);
    world.boss = createBossState('B4');
    autoParryOnBossEnter(world);

    // §11.4 R01 쌍검 — 한 발이 2발이 된다. 발사 효과가 안 걸리면 1발로 남는다
    expect(world.reflectBullets.activeCount).toBe(2);
  });
});
