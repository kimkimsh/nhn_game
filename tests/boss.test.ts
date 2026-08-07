/**
 * 보스 구간에서 규칙이 깨지던 자리들 — §10.1 정위치(HR-08) · §10.5 상단 낙하 · §12.1 배수.
 *
 * 셋 다 「값이 틀렸다」가 아니라 **한 발도 안 나가거나 한 스텝도 못 넘긴다**는 종류라, 수치를
 * 재는 단언이 아니라 존재와 경계를 본다. 그래서 여기의 기대값은 전부 0 또는 경계 자체다.
 */
import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_COMMON } from '../src/config/bosses';
import { PLAYFIELD } from '../src/config/playfield';
import { STAGES } from '../src/config/stages';
import type { BossPattern } from '../src/config/types';
import { SCORING } from '../src/config/scoring';
import { FIXED_DT_SEC } from '../src/core/loop';
import { applyBossDamage, createBossState, stepBoss, type BossState } from '../src/sim/boss';
import { fireBarrageShot, type BarragePattern } from '../src/sim/boss-shots';
import { integrateProjectiles } from '../src/sim/bullets';
import { checkHR05, checkHR08, checkStep, createGuardState } from '../src/sim/guards';
import { createRun, disposeRun, stepRun } from '../src/sim/run';
import { addCombo } from '../src/sim/score';
import { wavePhase } from '../src/sim/waves';
import { createWorld, type World } from '../src/sim/world';
import type { ZoneWorld } from '../src/sim/zones';

/**
 * §10.5 B4 페이즈 1 「불화살 비」와 §10.6 B5 페이즈 4 「화공 총공세」.
 * B5 쪽은 곡사와 동시 진행이라 `parallel`의 parts 안에 들어 있어 중첩까지 훑는다.
 */
function findTopSpanBarrage(patterns: readonly BossPattern[]): BarragePattern | null {
  for (const pattern of patterns) {
    if (pattern.kind === 'barrage' && pattern.origin === 'topSpan') {
      return pattern;
    }
    const nested = (pattern as { readonly parts?: readonly BossPattern[] }).parts;
    const found = nested === undefined ? null : findTopSpanBarrage(nested);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function barrageOf(bossId: 'B4' | 'B5', phaseIndex: number): BarragePattern {
  const found = findTopSpanBarrage(BOSSES[bossId].phases[phaseIndex]!.patterns);
  if (found === null) {
    throw new Error(`${bossId} 페이즈 ${phaseIndex}에 topSpan 난사가 없다`);
  }
  return found;
}

describe('§10.5 상단 전역 낙하는 실제로 화면에 남는다', () => {
  it.each([
    ['B4', 4, 0] as const,
    ['B5', 5, 3] as const,
  ])('%s의 불화살이 생성 스텝의 적분을 넘긴다', (bossId, stageId, phaseIndex) => {
    const world = createWorld({ stageId, seed: 7 });
    const boss = createBossState(bossId);
    const pattern = barrageOf(bossId, phaseIndex);
    const origin = { xU: boss.xU, yU: boss.yU, followBoss: true };

    for (let index = 0; index < pattern.count; index += 1) {
      fireBarrageShot(world as ZoneWorld, boss, pattern, origin);
    }
    expect(world.enemyBullets.activeCount).toBe(pattern.count);

    // 05 §1의 8번이 같은 스텝에 바로 뒤따른다. 생성 y가 소멸 경계 밖이면 여기서 전부 회수된다
    integrateProjectiles(world, FIXED_DT_SEC);
    expect(world.enemyBullets.activeCount).toBe(pattern.count);

    for (const shot of world.enemyBullets.active) {
      expect(shot.yU).toBeGreaterThan(-PLAYFIELD.despawnMarginU);
      expect(shot.vyUPerSec).toBeGreaterThan(0);
    }
  });
});

describe('HR-08 — 돌진이 끊긴 자리에서 보스가 굳지 않는다', () => {
  /** 돌진 도중을 흉내 낸다. 실제 돌진 도착지가 정위치 아래 수백 u인 것이 이 상태다 */
  function chargedAway(bossId: 'B2'): { world: World; boss: BossState } {
    const world = createWorld({ stageId: 2, seed: 3 });
    const boss = createBossState(bossId);
    boss.positionOwnedByPattern = true;
    boss.xU = 540;
    boss.yU = 1500;
    return { world, boss };
  }

  it('페이즈 전환이 돌진을 끊어도 위반이 되지 않는다', () => {
    const { world, boss } = chargedAway('B2');
    world.boss = boss;
    applyBossDamage(world, boss, null, boss.hp * 0.5);
    expect(boss.mode).toBe('phaseTransition');

    // 전환이 확정된 그 스텝의 16번이 곧바로 본다
    expect(() =>
      checkHR08({ xU: boss.xU, yU: boss.yU, isCharging: boss.positionOwnedByPattern }),
    ).not.toThrow();
  });

  it('전환 연출이 끝나는 시점에는 이미 정위치 안이다', () => {
    const { world, boss } = chargedAway('B2');
    world.boss = boss;
    applyBossDamage(world, boss, null, boss.hp * 0.5);

    const steps = Math.ceil(BOSS_COMMON.phaseTransitionSec / FIXED_DT_SEC) + 1;
    for (let index = 0; index < steps; index += 1) {
      stepBoss(world as ZoneWorld, boss, FIXED_DT_SEC);
      checkHR08({ xU: boss.xU, yU: boss.yU, isCharging: boss.positionOwnedByPattern });
    }
    const home = PLAYFIELD.bossHomeBounds;
    expect(boss.positionOwnedByPattern).toBe(false);
    expect(boss.yU).toBeGreaterThanOrEqual(home.minYU);
    expect(boss.yU).toBeLessThanOrEqual(home.maxYU);
  });

  it('격파 연출도 같은 복귀를 쓴다', () => {
    const { world, boss } = chargedAway('B2');
    world.boss = boss;
    applyBossDamage(world, boss, null, boss.hp);
    expect(boss.mode).toBe('defeated');
    for (let index = 0; index < Math.ceil(BOSS_COMMON.deathSec / FIXED_DT_SEC); index += 1) {
      stepBoss(world as ZoneWorld, boss, FIXED_DT_SEC);
      checkHR08({ xU: boss.xU, yU: boss.yU, isCharging: boss.positionOwnedByPattern });
    }
  });
});

describe('첫 적 탄환 전 구간에서도 HR-03 말고는 전부 검사한다', () => {
  it('탄환이 0인 스텝에서 정위치 밖 보스가 잡힌다', () => {
    const world = createWorld({ stageId: 2, seed: 3 });
    const state = createGuardState();
    expect(world.enemyBullets.activeCount).toBe(0);
    expect(() =>
      checkStep(world, state, FIXED_DT_SEC, {
        hr03Exemption: null,
        boss: { xU: 540, yU: 1500, isCharging: false },
      }),
    ).toThrow(/HR-08/);
  });

  it('그 구간에서 HR-03은 아직 세지 않는다', () => {
    const world = createWorld({ stageId: 1, seed: 3 });
    const state = createGuardState();
    for (let index = 0; index < 600; index += 1) {
      checkStep(world, state, FIXED_DT_SEC, { hr03Exemption: null, boss: null });
    }
    expect(state.emptyBulletSec).toBe(0);
    expect(state.hr03Armed).toBe(false);
  });
});

describe('HR-05 — 방향선의 원인은 보스 돌진과 잡몹 돌진 둘이다', () => {
  it('E-D 돌격형의 방향선이 오탐이 되지 않는다', () => {
    expect(() => checkHR05('dash', 'enemyCharge')).not.toThrow();
    expect(() => checkHR05('dash', 'bossCharge')).not.toThrow();
  });

  it('짝이 어긋난 원인은 그대로 잡는다', () => {
    expect(() => checkHR05('impactCircle', 'enemyCharge')).toThrow(/HR-05/);
    expect(() => checkHR05('halo', 'P7')).toThrow(/HR-05/);
  });
});

describe('§12.1 배수는 패리·처치에만 걸린다', () => {
  it('페이즈 전환 점수는 콤보와 무관하다', () => {
    const world = createWorld({ stageId: 3, seed: 5 });
    const boss = createBossState('B3');
    world.boss = boss;
    addCombo(world, 200);
    applyBossDamage(world, boss, null, boss.hp * 0.5);
    expect(world.run.score).toBe(SCORING.bossPhaseChange);
  });

  it('보스 격파 점수에는 걸린다', () => {
    const world = createWorld({ stageId: 3, seed: 5 });
    const boss = createBossState('B3');
    world.boss = boss;
    addCombo(world, 200);
    const before = world.run.score;
    applyBossDamage(world, boss, null, boss.hp * 10);
    expect(world.run.score - before).toBeGreaterThan(SCORING.bossKill);
  });
});

describe('§18.3 진입 지점이 sim에 반영된다', () => {
  it('bossPhase로 들어가면 첫 스텝에 보스 구간이다', () => {
    const run = createRun({ seed: 4242, stageId: 5, at: { kind: 'bossPhase', phaseIndex: 3 } });
    // 지나친 편성이 한 스텝에 쏟아지면 §9의 밀도가 아니다
    stepRun(run, FIXED_DT_SEC);
    expect(wavePhase(run.world)).toBe('boss');
    expect(run.world.enemies.activeCount).toBe(0);
    expect(run.world.boss).not.toBeNull();
    expect(run.world.boss!.phaseIndex).toBe(3);
    expect(run.world.boss!.hp).toBeLessThan(run.world.boss!.maxHp);
    disposeRun(run);
  });

  it('wave로 들어가면 그 웨이브의 시작 시각이다', () => {
    const run = createRun({ seed: 4242, stageId: 1, at: { kind: 'wave', waveIndex: 2 } });
    expect(run.world.simTimeSec).toBe(STAGES[1].waves[2]!.startSec);
    expect(wavePhase(run.world)).toBe('waves');
    disposeRun(run);
  });

  it('정상 진행은 0초에서 시작한다', () => {
    const run = createRun({ seed: 4242, stageId: 1 });
    expect(run.world.simTimeSec).toBe(0);
    expect(run.world.entryBossPhaseIndex).toBe(0);
    disposeRun(run);
  });
});
