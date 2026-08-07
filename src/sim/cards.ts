/**
 * 카드를 읽는 일 전부 — 스펙 §11.1 · §11.2. 05_시스템_설계.md §10.4.
 *
 * 제시·획득·문구, 그리고 CardEffect 13종을 정규화된 통에 붓는 일(collectCardEffects)까지가
 * 여기다. 그 통을 §11.6의 9단계로 접는 것은 sim/stats.ts이고, 라이프·리롤 잔여·오염 표시 같은
 * 런 상태는 sim/run.ts가 갖는다. 나누는 축은 "카드를 한 장 늘릴 때 여는 파일"과 "INV-1을 고칠
 * 때 여는 파일"이 다르다는 것이다. 그래서 여기 함수는 전부 인자만 보고 답한다 — 세계도 런도 모른다.
 *
 * ── 리롤에 전용 함수가 없다 ─────────────────────────────────────────────────────
 *
 * §11.1의 리롤은 "제시된 3장을 버리고 추첨 절차를 처음부터 다시 실행한다"이고 **등급부터**
 * 다시 뽑는다. drawOffer가 부를 때마다 3장의 등급을 새로 뽑으므로 리롤은 drawOffer를 한 번 더
 * 부르는 것과 정확히 같다. 카드만 다시 뽑는 경로를 따로 두면 노말 3장이 나온 화면에서 리롤해도
 * 노말 3장이 다시 나오고, 그 고장은 화면에서 티가 나지 않는다.
 *
 * 난수는 sim 스트림을 인자로 받는다 (D-05). 한 장을 뽑는 데 float 1회 + pick 1회를 쓰고 그
 * 횟수는 제시 가능한 카드 수와 무관하게 일정하다 — 보유 카드가 달라도 소비 횟수가 같아야
 * 같은 시드의 뒤쪽 추첨이 밀리지 않는다.
 */
import { CARDS, CARD_POOLS } from '../config/cards';
import { DRAW, RARITY_WEIGHTS } from '../config/cards/draw-table';
import type {
  BulletId,
  CardHideCondition,
  CardId,
  CardRarity,
  ParryGradeId,
  StatTarget,
} from '../config/ids';
import type { CardDef, CardEffect } from '../config/types';
import type { Rng } from '../core/rng';

export interface CardStack {
  readonly id: CardId;
  readonly stack: number;
}

/**
 * §11.1 보유 카드. 순서는 처음 획득한 순서다 — 결과·일시정지 화면이 그 순서로 칩을 늘어놓고,
 * 중첩은 칩 하나에 접힌다(10_스펙_목업_불일치.md A2).
 */
export type CardInventory = readonly CardStack[];

/** §11.2 회차. 직전에 클리어한 스테이지 번호이자 가중치 표의 키다 */
export type CardRound = keyof typeof RARITY_WEIGHTS;

export interface CardOfferContext {
  readonly round: CardRound;
  readonly held: CardInventory;
  /** §11.2 지금 성립하는 「효과가 무의미한 경우」. 런 상태를 봐야 알아 답만 받는다 */
  readonly hideConditions: readonly CardHideCondition[];
}

/** 누적 가중치를 도는 순서. draw-table.ts의 키 순서가 바뀌어도 같은 시드가 같은 결과를 내게 한다 */
const RARITY_ORDER = ['NORMAL', 'RARE', 'EPIC'] as const satisfies readonly CardRarity[];

/**
 * §11.2 등급 풀이 비었을 때의 탐색 순서. "한 단계 아래로, 노말이 비면 위로"가 세 줄의 모양을
 * 정한다 — 노말에서 시작한 탐색만 위로 향한다.
 */
const RARITY_FALLBACK = {
  EPIC: ['EPIC', 'RARE', 'NORMAL'],
  RARE: ['RARE', 'NORMAL', 'EPIC'],
  NORMAL: ['NORMAL', 'RARE', 'EPIC'],
} as const satisfies Record<CardRarity, readonly CardRarity[]>;

/** 문구의 자리 표시자. 숫자의 단일 소스는 effects이고 부호와 단위는 템플릿이 갖는다 */
const VALUE_TOKEN = '{value}';

export function stackOf(held: CardInventory, id: CardId): number {
  for (const entry of held) {
    if (entry.id === id) {
      return entry.stack;
    }
  }
  return 0;
}

/**
 * §11.2 제시 가능 조건.
 *
 * "최대 중첩 도달"과 "중첩 불가 카드를 이미 보유"는 한 검사다 — maxStack이 1인 카드를 들고
 * 있으면 그 자체로 도달이다. 남는 셋째만 hideWhen이 따로 표현한다.
 */
export function canOffer(
  held: CardInventory,
  id: CardId,
  hideConditions: readonly CardHideCondition[],
): boolean {
  const def: CardDef = CARDS[id];
  if (stackOf(held, id) >= def.maxStack) {
    return false;
  }
  if (def.hideWhen !== undefined && hideConditions.includes(def.hideWhen)) {
    return false;
  }
  return true;
}

function drawRarity(round: CardRound, rng: Rng): CardRarity {
  const weights = RARITY_WEIGHTS[round];
  let total = 0;
  for (const rarity of RARITY_ORDER) {
    total += weights[rarity];
  }
  let roll = rng.float() * total;
  // 마지막 칸으로 끝나는 것은 부동소수 오차로 roll이 총합을 못 밑돌 때다. 초기값은 첫 회에
  // 반드시 덮이므로 자리만 채운다
  let chosen: CardRarity = 'NORMAL';
  for (const rarity of RARITY_ORDER) {
    chosen = rarity;
    roll -= weights[rarity];
    if (roll < 0) {
      break;
    }
  }
  return chosen;
}

function offerablePool(
  rarity: CardRarity,
  context: CardOfferContext,
  offered: readonly CardId[],
): CardId[] {
  const pool: CardId[] = [];
  for (const id of CARD_POOLS[rarity]) {
    // §11.1 같은 화면 안의 중복만 금지된다. 직전 화면에 나왔던 카드는 다시 나와도 된다
    if (offered.includes(id)) {
      continue;
    }
    if (!canOffer(context.held, id, context.hideConditions)) {
      continue;
    }
    pool.push(id);
  }
  return pool;
}

function drawOne(context: CardOfferContext, offered: readonly CardId[], rng: Rng): CardId {
  const rarity = drawRarity(context.round, rng);
  for (const candidate of RARITY_FALLBACK[rarity]) {
    const pool = offerablePool(candidate, context, offered);
    if (pool.length > 0) {
      return rng.pick(pool);
    }
  }
  throw new Error('제시 가능한 카드가 없다 — 세 등급 풀이 모두 비었다');
}

/**
 * §11.2 추첨 절차. 3장 각각의 등급을 독립 추첨하고, 그 등급 풀에서 제시 가능한 카드만 남겨
 * 균등 확률로 하나를 뽑는다.
 *
 * 등급을 장마다 새로 뽑는 것이 리롤을 의미 있게 만든다 — 위 파일 주석을 참조.
 */
export function drawOffer(context: CardOfferContext, rng: Rng): readonly CardId[] {
  const offered: CardId[] = [];
  for (let slot = 0; slot < DRAW.offerCount; slot += 1) {
    offered.push(drawOne(context, offered, rng));
  }
  return offered;
}

/**
 * §11.1 한 장 획득. 최대 중첩을 넘기는 호출은 계약 위반이라 던진다 — 추첨은 도달한 카드를
 * 애초에 제시하지 않고, §18.4의 치트 지정도 같은 상한 안에서만 부른다(05 §14).
 *
 * 새 배열을 돌려주는 것은 스냅샷을 다시 계산해야 하는 시점을 호출자가 놓치지 않게 하려는 것이다.
 */
export function addCard(held: CardInventory, id: CardId): CardInventory {
  const def: CardDef = CARDS[id];
  const current = stackOf(held, id);
  if (current >= def.maxStack) {
    throw new Error(`${id}는 이미 최대 중첩이다 (${current} / ${def.maxStack})`);
  }
  if (current === 0) {
    return [...held, { id, stack: 1 }];
  }
  return held.map((entry) => (entry.id === id ? { id, stack: entry.stack + 1 } : entry));
}

/**
 * §11.3 N14 · §11.4 R06. 즉발 회복은 스냅샷 필드를 올리는 것이 아니라 RunState의 라이프를
 * 한 번 올린다. 카드를 제거해도 되돌아가지 않는다(§18.4).
 */
export function instantLifeOf(id: CardId): number {
  const def: CardDef = CARDS[id];
  let total = 0;
  for (const effect of def.effects) {
    if (effect.kind === 'instantLife') {
      total += effect.value;
    }
  }
  return total;
}

/**
 * 12_통합_계약.md §8-12. 문구의 {value}를 첫 효과의 값으로 채운다. 부호와 단위는 템플릿이
 * 갖고 있으므로 절대값을 넣는다 — R06처럼 자리가 둘이면 둘 다 같은 값으로 찬다.
 */
export function cardText(id: CardId): string {
  const def: CardDef = CARDS[id];
  if (!def.textTemplate.includes(VALUE_TOKEN)) {
    return def.textTemplate;
  }
  const first = def.effects[0];
  if (first === undefined || !('value' in first)) {
    throw new Error(`${id}의 문구가 ${VALUE_TOKEN}를 요구하는데 첫 효과에 value가 없다`);
  }
  return def.textTemplate.replaceAll(VALUE_TOKEN, String(Math.abs(first.value)));
}

/** R01 · E01. 분열은 서로를 배제하지 않는다 — 둘 다 들면 이 배열이 두 칸이고 발수가 곱해진다 */
export interface ReflectSplit {
  readonly count: number;
  readonly spreadDeg: number;
}

/** E02. GREAT 패리가 반사탄 대신 이 발사체를 낸다 */
export interface ReflectReplacement {
  readonly bullet: BulletId;
  readonly count: number;
  readonly spreadDeg: number;
  readonly damageRatio: number;
}

/** R07. 대상은 월드에 살아 있는 적 탄환 전부이고 반사탄은 느려지지 않는다 */
export interface EnemyBulletSlow {
  readonly durationSec: number;
  readonly speedMul: number;
}

/** R08. 파편도 반사탄이라 플레이어에게 유효하고 자해 유예가 그대로 붙는다 */
export interface ShardBurst {
  readonly count: number;
  readonly damageRatio: number;
}

/** E06. dpsRatio는 반사탄 데미지에 대한 비율이라 카드로 데미지가 오르면 장판도 같이 오른다 */
export interface ReflectZone {
  readonly radiusU: number;
  readonly durationSec: number;
  readonly dpsRatio: number;
}

/** §11.6 1·2단계를 target별로 모아 두는 통. %는 %끼리, 상수는 상수끼리 더한다 */
export interface CardStatAccum {
  pct: number;
  flat: number;
  /** op가 'set'인 자리는 E05의 GREAT 데미지 배수 하나뿐이다. 더하는 것이 아니라 갈아 끼운다 */
  setTo: number | null;
}

/** 수치 한 칸으로 접히지 않아 스냅샷에 자기 자리를 요구하는 효과들 */
export interface CardSpecialEffects {
  splits: ReflectSplit[];
  splitDamageRatio: number;
  greatDamageMul: number;
  combo: { perCombo: number; addPercentPerStep: number; maxAddPercent: number } | null;
  slow: EnemyBulletSlow | null;
  shard: ShardBurst | null;
  zone: ReflectZone | null;
  replacement: ReflectReplacement | null;
  autoParryGrade: ParryGradeId | null;
  shieldMaxCharges: number;
  shieldChargesPerStage: number;
  shieldInvulnSec: number;
  r10MinGapSec: number | null;
  e07LockoutSec: number | null;
}

export interface CardEffectTotals {
  readonly stats: ReadonlyMap<StatTarget, CardStatAccum>;
  readonly specials: CardSpecialEffects;
}

function createSpecials(): CardSpecialEffects {
  return {
    splits: [],
    splitDamageRatio: 1,
    greatDamageMul: 1,
    combo: null,
    slow: null,
    shard: null,
    zone: null,
    replacement: null,
    autoParryGrade: null,
    shieldMaxCharges: 0,
    shieldChargesPerStage: 0,
    shieldInvulnSec: 0,
    r10MinGapSec: null,
    e07LockoutSec: null,
  };
}

function accumOf(accums: Map<StatTarget, CardStatAccum>, target: StatTarget): CardStatAccum {
  const existing = accums.get(target);
  if (existing !== undefined) {
    return existing;
  }
  const created: CardStatAccum = { pct: 0, flat: 0, setTo: null };
  accums.set(target, created);
  return created;
}

/** 중첩 수를 곱하는 것은 'stat'뿐이다 — 나머지 열둘은 maxStack이 1이거나 스냅샷에 자리가 없다 */
function applyEffect(
  effect: CardEffect,
  stack: number,
  accums: Map<StatTarget, CardStatAccum>,
  specials: CardSpecialEffects,
): void {
  switch (effect.kind) {
    case 'stat': {
      const accum = accumOf(accums, effect.target);
      if (effect.op === 'addPercent') {
        accum.pct += effect.value * stack;
      } else if (effect.op === 'addFlat') {
        accum.flat += effect.value * stack;
      } else {
        accum.setTo = effect.value;
      }
      return;
    }
    // 즉발이라 스냅샷에 자리가 없다. RunState의 라이프를 올리는 값은 instantLifeOf가 따로 준다
    case 'instantLife':
      return;
    case 'splitReflect':
      specials.splits.push({ count: effect.count, spreadDeg: effect.spreadDeg });
      specials.splitDamageRatio *= effect.damageRatio;
      return;
    case 'conditionalDamage':
      specials.greatDamageMul *= effect.damageMul;
      return;
    case 'comboDamage':
      specials.combo = {
        perCombo: effect.perCombo,
        addPercentPerStep: effect.addPercentPerStep,
        maxAddPercent: effect.maxAddPercent,
      };
      return;
    case 'timedGlobal':
      specials.slow = { durationSec: effect.durationSec, speedMul: effect.bulletSpeedMul };
      return;
    case 'shardBurst':
      specials.shard = { count: effect.count, damageRatio: effect.damageRatio };
      return;
    case 'cooldownReset':
      specials.r10MinGapSec = effect.minGapSec;
      return;
    case 'replaceReflect':
      specials.replacement = {
        bullet: effect.bullet,
        count: effect.count,
        spreadDeg: effect.spreadDeg,
        damageRatio: effect.damageRatio,
      };
      return;
    case 'shield':
      specials.shieldMaxCharges = effect.maxCharges;
      specials.shieldChargesPerStage = effect.chargesPerStage;
      specials.shieldInvulnSec = effect.invulnSec;
      return;
    case 'onBossEnter':
      specials.autoParryGrade = effect.grade;
      return;
    case 'spawnZone':
      specials.zone = {
        radiusU: effect.radiusU,
        durationSec: effect.durationSec,
        dpsRatio: effect.dpsRatio,
      };
      return;
    case 'invariantOverride':
      specials.e07LockoutSec = effect.lockoutSec;
      return;
    default: {
      // 새 kind가 생기면 여기서 컴파일이 멈춘다. 없으면 그 카드는 조용히 아무 일도 하지 않는다
      const unhandled: never = effect;
      throw new Error(`알 수 없는 카드 효과: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** §11.6 1단계(같은 카드 중첩 가산)까지 끝낸 형태로 읽는다. 2단계부터는 sim/stats.ts다 */
export function collectCardEffects(held: CardInventory): CardEffectTotals {
  const stats = new Map<StatTarget, CardStatAccum>();
  const specials = createSpecials();
  for (const entry of held) {
    const def: CardDef = CARDS[entry.id];
    for (const effect of def.effects) {
      applyEffect(effect, entry.stack, stats, specials);
    }
  }
  return { stats, specials };
}
