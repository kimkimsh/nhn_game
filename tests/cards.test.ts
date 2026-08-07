/**
 * §11.6 보정 순서와 최악 조합 — 09_검증_전략.md §3.3.
 *
 * 9단계는 순서가 곧 규칙이다. 같은 카드 목록으로도 순서 한 칸이 뒤바뀌면 결과 숫자가 그럴듯해서
 * 눈으로 못 잡는다 — 그래서 단계마다 "그 단계가 아니면 나올 수 없는 값"을 하나씩 못 박는다.
 * 가산과 곱연산이 갈리는 자리(1·2단계)는 두 계산의 답이 다르다는 것 자체가 판정이다.
 *
 * 검산 두 건의 기대값은 스펙 §11.6의 코드 블록에서 그대로 옮긴 리터럴이다. config/에서 유도해
 * 적으면 구현과 같은 식을 두 번 쓰는 것이 되어 순서가 틀려도 통과한다.
 *
 * 여기서 못 보는 것 둘. 6단계의 보정 함수 자체는 sim/stats.ts 안에 있어 합성 입력을 직접 먹일
 * 수 없고(§3.3.1), R10의 쿨다운 즉시 종료가 실제로 도는지는 sim/parry.ts의 동작이라 이 파일이
 * 보는 것은 파생값 r10ActiveMinGapSec까지다.
 */
import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/config/cards';
import type { CardId } from '../src/config/ids';
import { HARD_LIMITS, INV_1_MARGIN_SEC, PARRY } from '../src/config/parry';
import { addCard, canOffer, instantLifeOf, type CardInventory } from '../src/sim/cards';
import { clearStage, createRun, pickCard, setCards } from '../src/sim/run';
import { computeStats } from '../src/sim/stats';

const SEED = 20260808;

function held(...entries: readonly (readonly [CardId, number])[]): CardInventory {
  return entries.map(([id, stack]) => ({ id, stack }));
}

/** §11.6 최악 조합 검산 1의 보유 목록. 검산 2는 여기에 E07만 얹는다 */
const WORST_1 = held(['N04', 3], ['N05', 3], ['N10', 1], ['R10', 1]);
const WORST_2 = held(['E07', 1], ['N04', 3], ['N05', 3], ['N10', 1], ['R10', 1]);

describe('§11.6 1단계 — 같은 카드 중첩은 가산이다', () => {
  it('N01 3중첩은 +45%이지 ×1.15³이 아니다', () => {
    expect(computeStats(held(['N01', 3])).reflectDamageMulFor(0)).toBeCloseTo(1.45, 6);
  });
});

describe('§11.6 2단계 — 카드 간 %는 가산 후 1회 곱연산', () => {
  it('N01(+15%)과 E07(−25%)은 ×0.90이지 ×1.15 × 0.75가 아니다', () => {
    const mul = computeStats(held(['N01', 1], ['E07', 1])).reflectDamageMulFor(0);
    expect(mul).toBeCloseTo(0.9, 6);
    expect(mul).not.toBeCloseTo(1.15 * 0.75, 6);
  });
});

describe('§11.6 3단계 — 조건부 배수는 2단계의 곱 뒤에 다시 곱한다', () => {
  const stats = computeStats(held(['R04', 1], ['N01', 3]));

  it('R04는 GREAT에만 붙는다', () => {
    expect(stats.conditionalDamageMulFor('GREAT')).toBeCloseTo(1.5, 6);
    expect(stats.conditionalDamageMulFor('GOOD')).toBe(1);
    expect(stats.conditionalDamageMulFor('NOT_BAD')).toBe(1);
  });

  it('가산 %와 섞이지 않는다 — 둘은 따로 나온다', () => {
    expect(stats.reflectDamageMulFor(0)).toBeCloseTo(1.45, 6);
  });
});

describe('§11.6 4단계 — 분열 계수는 마지막에 곱연산', () => {
  const stats = computeStats(held(['R01', 1], ['E01', 1]));

  it('R01 + E01은 2 × 3 = 6발이다', () => {
    const count = stats.reflectSplits.reduce((total, split) => total * split.count, 1);
    expect(count).toBe(6);
  });

  it('각 계수는 0.65 × 0.55 = 0.3575다', () => {
    expect(stats.reflectSplitDamageRatio).toBeCloseTo(0.3575, 6);
  });
});

describe('§11.6 5단계 — 개별 상한', () => {
  it('N13의 빈 패리 쿨다운이 하한 0.15초에 걸린다', () => {
    expect(computeStats(held(['N13', 1])).clamps).toContainEqual({
      step: 5, rule: 'hardLimit', field: 'whiffCooldownSec', after: HARD_LIMITS.cooldownMinSec,
    });
  });

  it('반경·이동 속도 상한은 현재 카드 표로 도달할 수 없다 — 회귀 감시다', () => {
    const stats = computeStats(held(['N03', 3], ['R09', 1], ['N02', 3]));
    expect(stats.parryRadiusU).toBeLessThan(HARD_LIMITS.parryRadiusMaxU);
    expect(stats.moveSpeedUPerSec).toBeLessThan(HARD_LIMITS.moveSpeedMaxUPerSec);
    expect(stats.clamps.filter((clamp) => clamp.rule === 'hardLimit')).toEqual([]);
  });
});

/**
 * §3.3.1. 밴드를 건드리는 카드는 넷뿐이고 GREAT의 도달 최댓값 44u가 GOOD의 도달 최솟값 48u에
 * 못 미친다 — 6단계는 현재 표에서 구조적으로 발동하지 않는다. 나중에 GOOD을 내리는 카드가
 * 붙으면 이 테스트가 먼저 빨간불이 되고 그때 6단계가 처음으로 살아 있는 코드가 된다.
 */
function everyLegalBandBuild(): CardInventory[] {
  const builds: CardInventory[] = [];
  for (let n07 = 0; n07 <= CARDS.N07.maxStack; n07 += 1) {
    for (let n08 = 0; n08 <= CARDS.N08.maxStack; n08 += 1) {
      for (let e05 = 0; e05 <= CARDS.E05.maxStack; e05 += 1) {
        for (let r09 = 0; r09 <= CARDS.R09.maxStack; r09 += 1) {
          const entries: [CardId, number][] = [];
          if (n07 > 0) entries.push(['N07', n07]);
          if (n08 > 0) entries.push(['N08', n08]);
          if (e05 > 0) entries.push(['E05', e05]);
          if (r09 > 0) entries.push(['R09', r09]);
          builds.push(held(...entries));
        }
      }
    }
  }
  return builds;
}

describe('§11.6 6단계 — 밴드 순서 보정', () => {
  it.each(everyLegalBandBuild().map((build) => [build.map((c) => `${c.id}×${c.stack}`).join('+') || '(없음)', build] as const))(
    '%s — GREAT < GOOD < 반경이고 6단계가 발동하지 않는다',
    (_name, build) => {
      const stats = computeStats(build);
      const [great, good, notBad] = stats.bands;
      expect(great!.maxDistU).toBeLessThan(good!.maxDistU);
      expect(good!.maxDistU).toBeLessThan(notBad!.maxDistU);
      expect(notBad!.maxDistU).toBe(stats.parryRadiusU);
      expect(stats.clamps.map((clamp) => clamp.step)).not.toContain(6);
    },
  );
});

describe('§11.6 최악 조합 검산 1 — E07 없음', () => {
  const stats = computeStats(WORST_1);

  it('활성 0.18초 / 쿨다운 0.23초 — INV-1이 0.197초를 되돌린다', () => {
    expect(stats.parryActiveSec).toBeCloseTo(0.18, 6);
    expect(stats.cooldownSecFor('hit')).toBeCloseTo(0.23, 6);
  });

  it('무적 0.17초는 INV-2 상한 0.1725초를 통과한다', () => {
    expect(stats.parryInvulnSec).toBeCloseTo(0.17, 6);
    expect(stats.clamps.map((clamp) => clamp.rule)).not.toContain('INV-2');
  });

  it('어느 단계가 값을 되돌렸는지 흔적이 남는다', () => {
    expect(stats.clamps).toContainEqual(
      expect.objectContaining({ step: 7, rule: 'INV-1', field: 'parryCooldownSec' }),
    );
  });
});

describe('§11.6 최악 조합 검산 2 — E07 포함', () => {
  const stats = computeStats(WORST_2);

  it('E07 예외가 INV-1의 0.23초를 건너뛰고 0.22초로 고정한다', () => {
    expect(stats.cooldownSecFor('hit')).toBeCloseTo(0.22, 6);
    // 0.22는 INV-1이 요구하는 하한 0.23보다 **낮다**. 그 부등식이 성립한다는 것 자체가 7단계를
    // 건너뛴 증거다 — clamps에 무엇이 적혔는지를 보는 것보다 이쪽이 규칙을 직접 잰다
    expect(stats.cooldownSecFor('hit')).toBeLessThan(stats.parryActiveSec + INV_1_MARGIN_SEC);
    expect(stats.cooldownSecFor('empty')).toBeLessThan(stats.parryActiveSec + INV_1_MARGIN_SEC);
  });

  it('INV-2는 E07 보유 시에도 그대로 적용되어 무적을 0.165초로 자른다', () => {
    expect(stats.parryInvulnSec).toBeCloseTo(0.165, 6);
    expect(stats.clamps).toContainEqual(
      expect.objectContaining({ step: 8, rule: 'INV-2', field: 'parryInvulnSec', after: 0.165 }),
    );
  });
});

describe('§11.6 9단계 — 스냅샷 확정은 아무것도 자르지 않는다', () => {
  it.each([['검산 1', WORST_1], ['검산 2', WORST_2]] as const)('%s의 clamps는 1~8단계뿐이다', (_name, build) => {
    for (const clamp of computeStats(build).clamps) {
      expect(clamp.step).toBeGreaterThanOrEqual(1);
      expect(clamp.step).toBeLessThanOrEqual(8);
    }
  });
});

/**
 * 01 §4-C S-01 · S-02. 스펙 §11.6의 검산 두 건은 두 카드가 너프되기 전 숫자를 아직 들고 있다 —
 * 검산 본문이 아니라 §11.4 · §11.5 표가 확정된 쪽이라 값을 따로 못 박는다.
 */
describe('S-01 · S-02 — 검산 본문이 아니라 카드 표가 확정 값이다', () => {
  it('S-01 E07 반사탄 데미지는 −25%다 (−20%가 아니다)', () => {
    expect(computeStats(held(['E07', 1])).reflectDamageMulFor(0)).toBeCloseTo(0.75, 6);
  });

  it('S-02 R10 최소 간격은 0.12초다 (0.06초가 아니다)', () => {
    expect(computeStats(held(['R10', 1])).r10ActiveMinGapSec).toBeCloseTo(0.12, 6);
  });
});

/**
 * 12 §10 E-05. 카드 목록이 그대로여도 값이 변하는 넷. 필드로 접으면 그 사실이 감춰지므로
 * 스냅샷은 함수나 파라미터만 들고 있고, 실제 값은 호출 시점의 상태가 정한다.
 */
describe('R05 — 반사탄 데미지가 콤보에 따라 갈린다', () => {
  const stats = computeStats(held(['R05', 1], ['N01', 3]));

  it.each([
    [0, 1.45], [9, 1.45], [10, 1.55], [19, 1.55], [20, 1.65], [49, 1.85], [50, 1.95], [500, 1.95],
  ])('콤보 %i → ×%f', (combo, expected) => {
    expect(stats.reflectDamageMulFor(combo)).toBeCloseTo(expected, 6);
  });
});

describe('N13 — 빈 패리 쿨다운은 정상 쿨다운과 다른 값이다', () => {
  it.each([
    ['N13만', held(['N13', 1]), 0.24, 0.2],
    ['+ N05 ×3', held(['N13', 1], ['N05', 3]), 0.24, 0.23],
    ['+ N04 ×3 + N05 ×3', held(['N13', 1], ['N04', 3], ['N05', 3]), 0.23, 0.23],
  ] as const)('%s — 성립 %f초 / 빈 패리 %f초', (_name, build, hitSec, emptySec) => {
    const stats = computeStats(build);
    expect(stats.cooldownSecFor('hit')).toBeCloseTo(hitSec, 6);
    expect(stats.cooldownSecFor('empty')).toBeCloseTo(emptySec, 6);
  });

  it('명목 −40%는 어떤 빌드에서도 그대로 나오지 않는다 — INV-1 하한이 먼저 먹는다', () => {
    const nominalSec = PARRY.cooldownSec * 0.6;
    expect(computeStats(held(['N13', 1])).cooldownSecFor('empty')).toBeGreaterThan(nominalSec);
  });

  it('미보유면 두 쿨다운이 같은 값이다', () => {
    const stats = computeStats([]);
    expect(stats.cooldownSecFor('empty')).toBeCloseTo(stats.cooldownSecFor('hit'), 6);
  });
});

describe('E03 — 보호막은 스테이지가 시작될 때마다 충전된다', () => {
  it('스테이지를 넘길 때마다 1중씩 차오르고 최대 3중에서 멈춘다', () => {
    const run = createRun({ seed: SEED, stageId: 1 });
    setCards(run, held(['E03', 1]));
    expect(run.world.run.shieldCharges).toBe(0);

    const picks: CardId[] = ['N01', 'N02', 'N06', 'N11'];
    const observed: number[] = [];
    for (const cardId of picks) {
      clearStage(run);
      pickCard(run, cardId);
      observed.push(run.world.run.shieldCharges);
    }
    expect(observed).toEqual([1, 2, 3, 3]);
  });

  it('미보유 런은 스테이지를 넘겨도 0중이다', () => {
    const run = createRun({ seed: SEED, stageId: 1 });
    clearStage(run);
    pickCard(run, 'N01');
    expect(run.world.run.shieldCharges).toBe(0);
  });
});

describe('§11.1 · §11.2 중첩 상한 — 치트 모드에서도 같다 (§18.4)', () => {
  it('최대 중첩을 넘겨 요청하면 던진다', () => {
    let inventory: CardInventory = [];
    for (let n = 0; n < CARDS.N01.maxStack; n += 1) {
      inventory = addCard(inventory, 'N01');
    }
    expect(() => addCard(inventory, 'N01')).toThrow(/N01/);
  });

  it('중첩 불가 카드는 두 번 들 수 없다', () => {
    expect(() => addCard(held(['R04', 1]), 'R04')).toThrow(/R04/);
  });

  it('도달한 카드는 애초에 제시되지 않는다', () => {
    expect(canOffer(held(['R04', 1]), 'R04', [])).toBe(false);
    expect(canOffer(held(['N01', 2]), 'N01', [])).toBe(true);
    expect(canOffer(held(['N01', 3]), 'N01', [])).toBe(false);
  });

  it('N14는 무제한 중첩이고 즉발 라이프는 스냅샷이 아니다', () => {
    expect(instantLifeOf('N14')).toBe(1);
    expect(computeStats(held(['N14', 9])).maxLife).toBe(computeStats([]).maxLife);
  });
});
