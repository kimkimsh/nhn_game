/**
 * 런이 실제로 진행되는가 — 09_검증_전략.md §3.8.
 *
 * 09 §1.2가 최악 실패 모드를 「테스트 초록불 + 게임 플레이 불가」로 못 박았다. 이 파일이 덮는
 * 다섯 자리는 전부 그 모습으로 온다 — 깨져도 예외가 안 나고, 화면에는 뭔가 그려지고, 나머지
 * 테스트가 전부 통과한다.
 *
 *   ⓐ 웨이브가 시간으로 넘어가고 잔존 적이 남는가 (§9.1)
 *   ⓑ 보스 페이즈 전환이 정확히 1회인가 — 두 트리거를 둘 다 만족시켜도 (§10.4)
 *   ⓒ boss-runner가 모르는 kind에서 던지는가 (12 §4.1)
 *   ⓓ 포문 좌표의 반사탄이 본체가 아니라 포문 HP를 깎는가 (05 §8.3)
 *   ⓔ 콤보 배수 상한이 3.0인가 (§12.2)
 *
 * 그리고 마지막 describe가 P5 게이트다: S1 클리어 → 카드 3장 → 1장 선택 → S2 시작.
 *
 * 기대값은 config가 아니라 스펙의 숫자를 그대로 적는다. config에서 읽어 오면 표를 잘못 고쳤을
 * 때 테스트가 함께 따라가 초록불이 된다 — 이 파일이 대조하는 상대는 구현이 아니라 스펙이다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BossDef, BossPattern, BossPhase } from '../src/config/types';
import { bus } from '../src/core/bus';
import { FIXED_DT_SEC } from '../src/core/loop';
import { deriveStream } from '../src/core/rng';
import { applyBossDamage, createBossState, type BossState } from '../src/sim/boss';
import { resolveBossHits } from '../src/sim/boss-hits';
import { stepRunner } from '../src/sim/boss-runner';
import { drawOffer, type CardRound } from '../src/sim/cards';
import { stepEnemies, stepEnemySpawns } from '../src/sim/enemies';
import { clearStage, createRun, disposeRun, pickCard, type Run } from '../src/sim/run';
import { comboMul } from '../src/sim/score';
import { pendingSpawnCount, stepWaves, wavePhase } from '../src/sim/waves';
import { comboMultiplier, createWorld, type World } from '../src/sim/world';
import { createZonePool, type ZoneWorld } from '../src/sim/zones';

/**
 * 05 §1의 4·5·6번만 도는 부분 스텝.
 *
 * stepWorld를 부르지 않는 것은 그 함수의 4·5·6·7·12번이 아직 빈 자리이기 때문이다
 * (src/sim/world.ts:301-322). 웨이브·적·보스가 stepRun 경로에 아직 안 붙어 있어서, 진행을
 * 보려면 순서를 여기서 세우는 수밖에 없다. 배선이 붙으면 이 헬퍼는 stepRun 호출 하나로 줄어든다.
 */
function advanceField(world: World, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT_SEC);
  for (let index = 0; index < steps; index += 1) {
    world.simTimeSec += FIXED_DT_SEC;
    stepWaves(world, FIXED_DT_SEC);
    stepEnemySpawns(world);
    stepEnemies(world, FIXED_DT_SEC);
    world.bus.flush();
  }
}

/** 05 §1의 12번이 붙기 전까지 보스 쪽 함수가 요구하는 형태를 테스트가 직접 세운다 */
function createZoneWorld(stageId: 1 | 2 | 3 | 4 | 5, seed: number): ZoneWorld {
  return { ...createWorld({ stageId, seed }), zones: createZonePool() };
}

beforeEach(() => {
  bus.reset();
});

describe('§9.1 웨이브는 시간으로 넘어가고 잔존 적은 남는다', () => {
  it('W1 종료 시각을 넘기면 W2가 나오고, 아무도 죽지 않았는데 전환된다', () => {
    const world = createWorld({ stageId: 1, seed: 20260808 });

    // §9.3 W1은 0:00~0:13, 조총병 4기뿐이다
    advanceField(world, 12.9);
    const survivors = [...world.enemies.active];
    expect(survivors).toHaveLength(4);
    // 이 스테이지의 편성 합은 4 + 8 + 10이다(§9.3). W1만 나갔으므로 18건이 남아 있다
    expect(pendingSpawnCount(world)).toBe(18);
    expect(wavePhase(world)).toBe('waves');

    // 0:13 경계를 넘긴다. 처치 수는 그대로 0이다 — 전환의 근거가 시간뿐임이 여기서 갈린다
    advanceField(world, 0.2);

    expect(world.enemies.activeCount).toBeGreaterThan(survivors.length);
    expect(pendingSpawnCount(world)).toBeLessThan(18);
    // §9.7 잔존이 없으면 S5 W5가 동시 20기에 닿는 근거 자체가 사라진다
    for (const survivor of survivors) {
      expect(world.enemies.active).toContain(survivor);
    }
  });

  it('마지막 웨이브 뒤에 소강을 지나 보스 구간에 닿고, 잔존 잡몹은 유예가 끝날 때 사라진다', () => {
    const world = createWorld({ stageId: 1, seed: 20260808 });

    // §9.3 W3 종료 0:43. 그 앞까지는 아직 웨이브 구간이다
    advanceField(world, 42.9);
    expect(wavePhase(world)).toBe('waves');
    expect(world.enemies.activeCount).toBeGreaterThan(0);

    // §9.1 소강 3초. 신규 스폰이 멈추고 잔존 잡몹은 퇴장을 시작한다
    advanceField(world, 1);
    expect(wavePhase(world)).toBe('lull');

    // 유예 3초가 끝나는 0:46이 보스 진입 시각이다(§9.3)
    advanceField(world, 2.2);
    expect(wavePhase(world)).toBe('boss');
    expect(world.enemies.activeCount).toBe(0);
  });
});

describe('§10.4 보스 페이즈 전환은 정확히 1회', () => {
  function watchPhases(): number[] {
    const seen: number[] = [];
    bus.on('bossPhase', (event) => void seen.push(event.phase));
    return seen;
  }

  it('한 발이 임계값 둘을 한꺼번에 지나도 페이즈는 한 칸만 오른다', () => {
    const world = createWorld({ stageId: 3, seed: 1 });
    const boss = createBossState('B3');
    const seen = watchPhases();

    // §10.4 B3 본체 HP 2000, 페이즈 진입 비율 0.60 / 0.35. 1600을 깎으면 둘 다 아래로 지난다
    applyBossDamage(world, boss, null, 1600);
    world.bus.flush();

    expect(seen).toEqual([2]);
    expect(boss.phaseIndex).toBe(1);
    // §10.1 전환 연출 1.2초 무적. 두 칸을 건너뛰면 이 무적이 겹쳐 영구 무적이 된다
    expect(boss.mode).toBe('phaseTransition');
  });

  it('HP 조건과 포문 조건을 같은 순간에 둘 다 만족시켜도 전환은 한 번이다', () => {
    const world = createWorld({ stageId: 3, seed: 1 });
    const boss = createBossState('B3');
    const seen = watchPhases();

    // §10.4 포문 HP 300 × 4. 하나를 부순 시점에는 어느 조건도 성립하지 않는다
    applyBossDamage(world, boss, boss.parts[0]!, 300);
    world.bus.flush();
    expect(seen).toEqual([]);
    expect(boss.phaseIndex).toBe(0);

    // 「선착」 두 트리거가 같은 호출에서 함께 참이 되는 상태를 만든다 —
    // HP는 이미 0.60 아래이고, 그 호출이 두 번째 포문을 부숴 파괴 수가 2에 닿는다
    boss.hp = 1000;
    applyBossDamage(world, boss, boss.parts[1]!, 300);
    world.bus.flush();

    expect(seen).toEqual([2]);
    expect(boss.phaseIndex).toBe(1);

    // 전환 연출 중에는 어떤 피해도 안 들어오므로 두 번째 전환이 이어 붙지 않는다
    applyBossDamage(world, boss, null, 900);
    world.bus.flush();
    expect(seen).toEqual([2]);
    expect(boss.hp).toBe(1000);
  });
});

describe('12 §4.1 boss-runner는 모르는 kind에서 조용히 넘어가지 않는다', () => {
  it('미등록 kind는 던진다', () => {
    const world = createZoneWorld(1, 1);
    const boss = createBossState('B1');
    const rogue = { kind: 'nope', name: '미등록' } as unknown as BossPattern;
    const phase: BossPhase = { hpThreshold: 1, onEnter: null, patterns: [rogue] };
    // def는 읽기 전용이다. 데이터가 런타임에 낯선 kind를 들고 오는 상황이 타입으로는 만들어지지
    // 않으므로, 그 상황 자체가 이 테스트의 입력이다
    (boss as unknown as { def: BossDef }).def = { ...boss.def, phases: [phase] };

    expect(() => stepRunner(world, boss, FIXED_DT_SEC)).toThrow(/unhandled nope/);
  });
});

describe('05 §8.3 B3 — 부위가 본체보다 먼저 판정된다', () => {
  /** 지정한 좌표를 한 스텝 동안 아래에서 위로 지나는 반사탄 한 발 */
  function launchReflect(world: World, xU: number, yU: number, damage: number): void {
    const projectile = world.reflectBullets.acquireRecyclingOldest();
    projectile.bulletId = 'P2';
    projectile.owner = 'player';
    projectile.prevXU = xU;
    projectile.prevYU = yU + 60;
    projectile.xU = xU;
    projectile.yU = yU - 5;
    projectile.radiusU = 12;
    projectile.damage = damage;
    projectile.pierceRemaining = 0;
  }

  function boundBoss(): { world: World; boss: BossState } {
    return { world: createWorld({ stageId: 3, seed: 1 }), boss: createBossState('B3') };
  }

  it('포문은 선체 히트박스 안에 있다 — 이 겹침이 목업을 고장 냈던 조건이다', () => {
    const { boss } = boundBoss();
    // §10.4 선체 860 × 250, 포문 넷의 offsetU. 겹치지 않으면 아래 두 케이스가 아무것도 증명하지 않는다
    for (const part of boss.parts) {
      expect(Math.abs(part.xU - boss.xU)).toBeLessThan(boss.def.hitBox.wU / 2);
      expect(Math.abs(part.yU - boss.yU)).toBeLessThan(boss.def.hitBox.hU / 2);
    }
  });

  it('포문 좌표에 맞은 반사탄은 포문 HP만 깎는다', () => {
    const { world, boss } = boundBoss();
    const port = boss.parts[0]!;

    launchReflect(world, port.xU, port.yU, 100);
    resolveBossHits(world, boss);

    // §10.4 포문 HP 300, 본체 HP 2000
    expect(port.hp).toBe(200);
    expect(port.destroyed).toBe(false);
    expect(boss.hp).toBe(2000);
    expect(world.reflectBullets.activeCount).toBe(0);
  });

  it('부순 포문 자리는 그때부터 본체 판정으로 넘어간다', () => {
    const { world, boss } = boundBoss();
    const port = boss.parts[0]!;
    port.hp = 0;
    port.destroyed = true;

    launchReflect(world, port.xU, port.yU, 100);
    resolveBossHits(world, boss);

    expect(boss.hp).toBe(1900);
  });
});

describe('§12.2 콤보 배수 상한 3.0', () => {
  // 배수 = 1.0 + floor(콤보 / 10) × 0.1, 상한 3.0. 상한에 닿는 콤보가 200이다
  it.each([
    [0, 1.0],
    [9, 1.0],
    [10, 1.1],
    [88, 1.8],
    [200, 3.0],
    [210, 3.0],
    [10_000, 3.0],
  ])('콤보 %i → ×%f', (combo, expected) => {
    expect(comboMul(combo)).toBeCloseTo(expected, 6);
    // 목업 HUD에는 클램프가 없었다(10 A10). 클램프의 소유자가 둘이면 한쪽만 고쳐진다
    expect(comboMultiplier(combo)).toBeCloseTo(expected, 6);
  });
});

describe('P5 게이트 — S1 클리어 → 카드 3장 → 1장 선택 → S2 시작', () => {
  const SEED = 20260808;

  function offerFor(run: Run): readonly string[] {
    const rng = deriveStream(SEED, `cards/screen/${run.cardScreenNo}`);
    return drawOffer(
      { round: run.cardScreenNo as CardRound, held: run.cards, hideConditions: [] },
      rng,
    );
  }

  it('네 상태 전이가 헤드리스로 성립한다', () => {
    const run = createRun({ seed: SEED, stageId: 1 });
    expect(run.phase).toBe('combat');
    expect(run.stageId).toBe(1);
    // §11.1 스테이지 1은 언제나 카드 0장으로 시작한다
    expect(run.cards).toEqual([]);

    run.world.run.score = 5_000;
    run.world.player.lives = 2;

    clearStage(run);

    expect(run.phase).toBe('cardSelect');
    // §11.2 회차는 직전에 클리어한 스테이지 번호다
    expect(run.cardScreenNo).toBe(1);
    // §12.1 클리어 보너스 = 남은 라이프 × 2000
    expect(run.world.run.score).toBe(9_000);

    const offer = offerFor(run);
    // §11.1 한 화면에 3장, 같은 화면 안의 중복은 없다
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);

    pickCard(run, offer[0] as never);

    expect(run.phase).toBe('combat');
    expect(run.stageId).toBe(2);
    expect(run.cards).toEqual([{ id: offer[0], stack: 1 }]);
    // §13.2 라이프와 점수는 스테이지를 넘고, 월드는 넘지 않는다
    expect(run.world.stageId).toBe(2);
    expect(run.world.player.lives).toBe(2);
    expect(run.world.run.score).toBe(9_000);
    expect(run.world.simTimeSec).toBe(0);
    expect(run.world.run.combo).toBe(0);
    expect(run.world.enemies.activeCount).toBe(0);

    disposeRun(run);
  });

  it('같은 시드는 같은 3장을 낸다 — D-05', () => {
    const first = createRun({ seed: SEED, stageId: 1 });
    clearStage(first);
    const a = offerFor(first);
    disposeRun(first);

    const second = createRun({ seed: SEED, stageId: 1 });
    clearStage(second);
    const b = offerFor(second);
    disposeRun(second);

    expect(b).toEqual(a);
  });

  it('S2가 시작된 뒤에도 웨이브가 스스로 돈다', () => {
    const run = createRun({ seed: SEED, stageId: 1 });
    clearStage(run);
    pickCard(run, offerFor(run)[0] as never);

    advanceField(run.world, 3);

    expect(run.world.enemies.activeCount).toBeGreaterThan(0);
    expect(run.phase).toBe('combat');
    disposeRun(run);
  });
});
