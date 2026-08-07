/**
 * 「현재 값 → 선택 후 값」이 읽는 숫자 — 스펙 §15.2 · §11.6. 08_화면과_UI.md §3.2.
 *
 * 카드를 고르기 **전과 후의 스냅샷 두 개**를 sim/stats.ts에서 받아 차이를 낸다. 문구의
 * 명목값(+15%)을 두 번 더하는 것이 아니다 — 밴드 경계·쿨다운·무적은 INV-1·INV-2와 개별
 * 상한이 값을 자르므로 명목값과 실효값이 갈리고, 카드 화면이 §11.6의 보정 결과를
 * 플레이어에게 처음 보여 주는 자리다. 08 §8.4의 치트 메뉴 실효 수치 표와 **같은 데이터원**이다.
 *
 * 값이 안 움직인 자리는 잘렸다는 뜻이고, 이유는 `EffectiveStats.clamps`가 갖는다 —
 * step · rule · field · after 네 필드가 그 계약이다(12 §8-17). 아래 표가 target마다 field
 * 이름을 함께 들고 있는 것이 그 계약을 쓰는 자리다.
 *
 * 이 파일은 스냅샷을 **읽기만** 한다. 카드가 실제로 보유 목록에 들어가는 것은 확정 뒤
 * sim/run.ts의 pickCard이고, 여기서 만든 임시 목록은 화면 밖으로 나가지 않는다.
 */

import { CARDS } from '../config/cards';
import type { CardId, ParryGradeId, StatTarget } from '../config/ids';
import type { CardDef } from '../config/types';
import { addCard, stackOf, type CardInventory } from '../sim/cards';
import { computeStats, type EffectiveStats } from '../sim/stats';
import type { StatClamp } from '../sim/world';

/** 카드 문구가 쓰는 것과 같은 빼기 기호(U+2212). ASCII 하이픈과 폭이 달라 섞으면 표가 어긋난다 */
const MINUS_SIGN = '−';

const SECONDS_DECIMALS = 2;
const MULTIPLIER_DECIMALS = 2;
/** 거리(u)·속도(u/s)·개수·라이프 칸은 전부 정수 자리까지만 읽는다 */
const WHOLE_DECIMALS = 0;

/** 부동소수 오차를 표시에서 걷어낸다. 0.15000000000000002 → '0.15' */
function trim(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

function asPercent(value: number): string {
  return `${value < 0 ? MINUS_SIGN : '+'}${trim(Math.abs(value), WHOLE_DECIMALS)}%`;
}

/**
 * 초와 배수는 자릿수를 고정한다. 뒤의 0을 떼면 `0.24초 → 0.2초`가 되어 전후 두 값이 다른
 * 해상도로 읽히고, 0.04초가 줄었는지 0.004초가 줄었는지를 그 자리에서 셀 수 없다.
 */
function asSeconds(value: number): string {
  return `${value.toFixed(SECONDS_DECIMALS)}초`;
}

function asMultiplier(value: number): string {
  return `×${value.toFixed(MULTIPLIER_DECIMALS)}`;
}

function asDistanceU(value: number): string {
  return `${trim(value, WHOLE_DECIMALS)}u`;
}

function asSpeedU(value: number): string {
  return `${trim(value, WHOLE_DECIMALS)}u/s`;
}

function asDegPerSec(value: number): string {
  return `${trim(value, WHOLE_DECIMALS)}°/s`;
}

function asEnemyCount(value: number): string {
  return `${trim(value, WHOLE_DECIMALS)}기`;
}

function asLifeSlots(value: number): string {
  return `${trim(value, WHOLE_DECIMALS)}칸`;
}

function bandDistU(stats: EffectiveStats, id: ParryGradeId): number {
  return stats.bands.find((band) => band.id === id)?.maxDistU ?? 0;
}

function bandDamageMul(stats: EffectiveStats, id: ParryGradeId): number {
  return stats.bands.find((band) => band.id === id)?.damageMul ?? 0;
}

/**
 * 한 target이 어느 스냅샷 값으로 읽히고 어떤 이름으로 잘리는가.
 *
 * clampField가 null인 자리는 §11.6의 5~8단계가 손대지 않는 값이라 clamps에 이름이 생길 수
 * 없다. null을 두는 것과 안 쓰는 이름을 적어 두는 것은 다르다 — 후자는 상한이 있는데 못 찾는
 * 것처럼 읽힌다.
 */
interface StatReader {
  readonly read: (stats: EffectiveStats) => number;
  readonly format: (value: number) => string;
  readonly clampField: string | null;
}

/**
 * §11.6 9단계가 target을 스냅샷 필드에 매핑한 것을 화면 쪽에서 되짚는 표.
 *
 * reflectDamage와 parryCooldown이 필드가 아니라 함수인 것은 값이 콤보(R05)와 빈 패리 여부
 * (N13)에 종속되기 때문이다(12 §10 E-05). 카드 화면은 콤보가 0인 시점이므로 그 상태의
 * 값을 읽는다 — R05의 콤보 가산이 0인 자리가 곧 카드가 실제로 보태는 몫이다.
 */
const STAT_READERS: Readonly<Record<StatTarget, StatReader>> = {
  reflectDamage: {
    read: (stats) => (stats.reflectDamageMulFor(0) - 1) * 100,
    format: asPercent,
    clampField: null,
  },
  reflectSpeed: { read: (stats) => stats.reflectSpeedMul, format: asMultiplier, clampField: null },
  reflectPierce: {
    read: (stats) => stats.reflectPierceCount,
    format: asEnemyCount,
    clampField: null,
  },
  reflectHitRadius: {
    read: (stats) => stats.reflectHitRadiusMul,
    format: asMultiplier,
    clampField: null,
  },
  reflectHomingDegPerSec: {
    read: (stats) => stats.reflectHomingDegPerSec,
    format: asDegPerSec,
    clampField: null,
  },
  moveSpeed: {
    read: (stats) => stats.moveSpeedUPerSec,
    format: asSpeedU,
    clampField: 'moveSpeedUPerSec',
  },
  parryRadius: { read: (stats) => stats.parryRadiusU, format: asDistanceU, clampField: 'parryRadiusU' },
  parryCooldown: {
    read: (stats) => stats.cooldownSecFor('hit'),
    format: asSeconds,
    clampField: 'parryCooldownSec',
  },
  parryActive: { read: (stats) => stats.parryActiveSec, format: asSeconds, clampField: null },
  parryInvuln: {
    read: (stats) => stats.parryInvulnSec,
    format: asSeconds,
    clampField: 'parryInvulnSec',
  },
  whiffCooldown: {
    read: (stats) => stats.cooldownSecFor('empty'),
    format: asSeconds,
    clampField: 'whiffCooldownSec',
  },
  hitInvuln: { read: (stats) => stats.hitInvulnSec, format: asSeconds, clampField: null },
  greatBandMaxDist: {
    read: (stats) => bandDistU(stats, 'GREAT'),
    format: asDistanceU,
    clampField: 'bands.GREAT.maxDistU',
  },
  goodBandMaxDist: {
    read: (stats) => bandDistU(stats, 'GOOD'),
    format: asDistanceU,
    clampField: 'bands.GOOD.maxDistU',
  },
  greatDamageMul: {
    read: (stats) => bandDamageMul(stats, 'GREAT'),
    format: asMultiplier,
    clampField: null,
  },
  comboHold: { read: (stats) => stats.comboHoldSec, format: asSeconds, clampField: null },
  maxLife: { read: (stats) => stats.maxLife, format: asLifeSlots, clampField: 'maxLife' },
};

/** clamps의 rule을 화면 문구로. 규칙 이름 자체(INV-1·INV-2)는 스펙 용어라 번역하지 않는다 */
export const CLAMP_RULE_LABELS: Readonly<Record<StatClamp['rule'], string>> = {
  'INV-1': 'INV-1',
  'INV-2': 'INV-2',
  hardLimit: '개별 상한',
  bandOrder: '밴드 순서',
};

/**
 * 「현재 값 → 선택 후 값」 한 줄.
 *
 * changed가 false면 이 카드를 골라도 실효 수치가 움직이지 않는다 — 카드가 약한 것이 아니라
 * 상한에 이미 닿아 있는 것이고, 그 구분이 화면에 없으면 플레이어가 계수를 의심한다.
 */
export interface CardDelta {
  readonly beforeText: string;
  readonly afterText: string;
  readonly changed: boolean;
  /** changed가 false일 때 그 값을 자른 §11.6 단계의 규칙. 자른 자리를 못 찾으면 null */
  readonly cappedRule: StatClamp['rule'] | null;
}

/** 같은 field를 여러 단계가 자르면 마지막이 실효값을 정한다 — 뒤에서부터 찾는다 */
function cappedRuleOf(clamps: readonly StatClamp[], field: string | null): StatClamp['rule'] | null {
  if (field === null) {
    return null;
  }
  for (let index = clamps.length - 1; index >= 0; index -= 1) {
    const clamp = clamps[index];
    if (clamp !== undefined && clamp.field === field) {
      return clamp.rule;
    }
  }
  return null;
}

/**
 * §11.3 N14는 스냅샷이 아니라 RunState의 라이프를 올린다 — 즉발이라 §11.6에 자리가 없다.
 * 그래서 이 카드만 보유 목록이 아니라 현재 라이프를 기준으로 전후를 만든다.
 */
function instantLifeDelta(gain: number, lives: number, maxLife: number): CardDelta {
  const now = Math.min(lives, maxLife);
  const next = Math.min(lives + gain, maxLife);
  return {
    beforeText: asLifeSlots(now),
    afterText: asLifeSlots(next),
    changed: next !== now,
    cappedRule: next === now ? 'hardLimit' : null,
  };
}

/**
 * 카드 한 장을 지금 고르면 어느 수치가 어디로 가는가.
 *
 * null을 내는 것은 첫 효과가 수치 한 칸으로 접히지 않는 카드다(분열·보호막·자동 패리 등
 * 열둘). 그 열둘은 전부 maxStack이 1이라 「현재 → 선택 후」 판이 붙을 일 자체가 없고,
 * 문구가 이미 규칙 전체를 적고 있다.
 */
export function cardDeltaOf(id: CardId, held: CardInventory, lives: number): CardDelta | null {
  const def: CardDef = CARDS[id];
  if (stackOf(held, id) >= def.maxStack) {
    return null;
  }
  const first = def.effects[0];
  if (first === undefined) {
    return null;
  }
  const before = computeStats(held);
  if (first.kind === 'instantLife') {
    return instantLifeDelta(first.value, lives, before.maxLife);
  }
  if (first.kind !== 'stat') {
    return null;
  }
  const reader = STAT_READERS[first.target];
  const after = computeStats(addCard(held, id));
  const beforeValue = reader.read(before);
  const afterValue = reader.read(after);
  return {
    beforeText: reader.format(beforeValue),
    afterText: reader.format(afterValue),
    changed: beforeValue !== afterValue,
    cappedRule:
      beforeValue === afterValue ? cappedRuleOf(after.clamps, reader.clampField) : null,
  };
}
