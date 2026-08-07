/**
 * 카드 → 능력치 스냅샷 — 스펙 §11.6. 05_시스템_설계.md §10.1~§10.3.
 *
 * 9단계는 순서가 곧 규칙이다. 1~4단계는 §7.2의 데미지 계산 순서와 **같은 순서**이고 스펙이 두
 * 곳을 대조할 수 있게 일부러 맞춰 둔 것이라, 어긋나게 구현하면 §7.2 쪽을 읽을 때도 혼란이 생긴다.
 * 잘린 자리는 전부 clamps에 남는다 — INV-1이 쿨다운을 되돌리는 것 같은 상호작용은 숫자로
 * 보이지 않으면 실측 중에 원인을 잘못 짚는다(§18.4).
 *
 * ── 필드가 아닌 것 둘 ────────────────────────────────────────────────────────────
 *
 * parryCooldownSec와 reflectDamageMul은 필드가 아니다. 전자는 빈 패리 여부(N13), 후자는 콤보
 * (R05)에 따라 값이 갈리므로 **호출 시점의 상태 없이는 값이 없는 것**이고, 필드로 두면 그
 * 사실이 감춰진다. 카드 목록이 그대로여도 값이 변하는 넷이 R05 · N13 · R10 · E03이다
 * (12_통합_계약.md §10 E-05).
 *
 * ── 정적 스냅샷을 다시 계산하는 시점 ────────────────────────────────────────────
 *
 * 카드 획득, 치트 메뉴 조작, 런 시작 셋뿐이다. 그 밖에서 값이 변하는 것은 위 넷이고 그것들은
 * 필드가 아니라 함수이거나 RunState에 있다.
 */
import type { ParryGradeId, StatTarget } from '../config/ids';
import {
  HARD_LIMITS,
  INV_1_MARGIN_E07_SEC,
  INV_1_MARGIN_SEC,
  INV_2_RATIO,
  PARRY,
  PARRY_BANDS,
} from '../config/parry';
import { PLAYER } from '../config/player';
import { REFLECT } from '../config/reflect';
import { COMBO } from '../config/scoring';
import { collectCardEffects } from './cards';
import type { CardInventory, CardStatAccum } from './cards';
import type { EffectiveParryBand, EffectiveStats, StatClamp } from './world';

/**
 * 카드 효과의 정규화된 모양은 sim/cards.ts가 갖는다. EffectiveStats를 읽는 쪽이 그 파일까지
 * 알 필요는 없으므로 여기서 다시 내보낸다 — 스냅샷의 필드 타입이 곧 이 다섯이다.
 */
export type {
  EnemyBulletSlow,
  ReflectReplacement,
  ReflectSplit,
  ReflectZone,
  ShardBurst,
} from './cards';

/**
 * §11.6의 9단계가 만드는 스냅샷. 형태는 world.ts가 갖는다 — 카드가 있든 없든 같은 계약이고,
 * 여기서 확장하면 「카드 필드가 있는 스냅샷」과 「없는 스냅샷」 두 형태가 생겨 소비자가
 * 무엇을 읽을 수 있는지 호출 경로마다 달라진다.
 */
export type { EffectiveStats } from './world';

interface MutableBand {
  id: ParryGradeId;
  maxDistU: number;
  damageMul: number;
  speedMul: number;
  hitstopSec: number;
  score: number;
}

function percentOf(accums: ReadonlyMap<StatTarget, CardStatAccum>, target: StatTarget): number {
  return accums.get(target)?.pct ?? 0;
}

/**
 * §11.6 1·2단계를 한 식으로 편다. 1단계(같은 카드 중첩 가산)는 값을 넣을 때 중첩 수를 곱해
 * 이미 끝났고, 여기서 하는 것이 2단계(카드 간 가산 → **1회** 곱연산)다.
 *
 * 상수 가산과 % 가산을 함께 받는 대상은 지금 하나도 없다 — 있었다면 어느 쪽이 먼저인지 스펙이
 * 정해 줘야 하고, 그 답이 없는 채로 순서를 고르는 것은 추측이다.
 */
function foldStat(
  accums: ReadonlyMap<StatTarget, CardStatAccum>,
  target: StatTarget,
  baseValue: number,
): number {
  const accum = accums.get(target);
  if (accum === undefined) {
    return baseValue;
  }
  if (accum.setTo !== null) {
    return accum.setTo;
  }
  return baseValue * (1 + accum.pct / 100) + accum.flat;
}

function capAt(
  clamps: StatClamp[],
  step: number,
  rule: StatClamp['rule'],
  field: string,
  value: number,
  maxValue: number,
): number {
  if (value <= maxValue) {
    return value;
  }
  clamps.push({ step, rule, field, after: maxValue });
  return maxValue;
}

function raiseTo(
  clamps: StatClamp[],
  step: number,
  rule: StatClamp['rule'],
  field: string,
  value: number,
  minValue: number,
): number {
  if (value >= minValue) {
    return value;
  }
  clamps.push({ step, rule, field, after: minValue });
  return minValue;
}

/**
 * §11.6 6단계. 밴드는 좁은 것부터 나열되어 있으므로 뒤에서 앞으로 훑으며 뒤 밴드를 넘지 못하게
 * 자른다. 스펙이 적은 것은 `GREAT 상한 > GOOD 상한`뿐이지만 같은 고장이 `GOOD 상한 > 패리 반경`
 * 에서도 나므로 — 어느 쪽이든 등급 없는 고리가 생기고 데미지 배수·히트스톱·점수·무적이 전부
 * 미정의가 된다 — 한 번에 막는다.
 */
function orderBands(bands: MutableBand[], clamps: StatClamp[]): void {
  for (let index = bands.length - 2; index >= 0; index -= 1) {
    const band = bands[index];
    const wider = bands[index + 1];
    if (band === undefined || wider === undefined) {
      continue;
    }
    if (band.maxDistU > wider.maxDistU) {
      band.maxDistU = wider.maxDistU;
      clamps.push({
        step: 6,
        rule: 'bandOrder',
        field: `bands.${band.id}.maxDistU`,
        after: wider.maxDistU,
      });
    }
  }
}

/**
 * §11.6의 9단계. 정적 부분은 이 함수가 돌 때만 값이 바뀐다.
 *
 * clamps의 step은 1~8이다 — 9단계(스냅샷 확정)는 아무것도 자르지 않으므로 여기 나타날 수 없다
 * (12_통합_계약.md §8-17).
 */
export function computeStats(held: CardInventory): EffectiveStats {
  const clamps: StatClamp[] = [];
  // 1. 같은 카드 중첩 가산은 이 호출 안에서 끝난다. 2단계부터가 아래의 foldStat이다
  const { stats: accums, specials } = collectCardEffects(held);

  const parryActiveSec = foldStat(accums, 'parryActive', PARRY.activeSec);
  const parryInvulnRawSec = foldStat(accums, 'parryInvuln', PARRY.invulnSec);
  const cooldownRawSec = foldStat(accums, 'parryCooldown', PARRY.cooldownSec);
  // N13의 기준값은 상한을 거치기 전의 정상 쿨다운이다. 명목 −40%가 그대로 나오는 빌드는 하나도
  // 없다 — 7단계의 INV-1 하한이 실효를 먹는다. N13만 −17%, N05 3중첩과 함께면 −4%,
  // N04·N05를 다 쌓으면 정확히 0이다(config/cards/normal.ts의 N13 항목에 빌드별 표가 있다)
  const whiffRawSec = foldStat(accums, 'whiffCooldown', cooldownRawSec);

  // 3·4. 조건부 배수와 분열 계수는 곱해질 자리가 데미지 계산 시점이라 여기서는 값만 확정한다
  const splitDamageRatio = specials.splitDamageRatio;

  // 5. 개별 상한
  const parryRadiusU = capAt(
    clamps,
    5,
    'hardLimit',
    'parryRadiusU',
    foldStat(accums, 'parryRadius', PARRY.radiusU),
    HARD_LIMITS.parryRadiusMaxU,
  );
  const moveSpeedUPerSec = capAt(
    clamps,
    5,
    'hardLimit',
    'moveSpeedUPerSec',
    foldStat(accums, 'moveSpeed', PLAYER.moveSpeedUPerSec),
    HARD_LIMITS.moveSpeedMaxUPerSec,
  );
  let cooldownSec = raiseTo(
    clamps,
    5,
    'hardLimit',
    'parryCooldownSec',
    cooldownRawSec,
    HARD_LIMITS.cooldownMinSec,
  );
  let whiffCooldownSec = raiseTo(
    clamps,
    5,
    'hardLimit',
    'whiffCooldownSec',
    whiffRawSec,
    HARD_LIMITS.cooldownMinSec,
  );
  // 최대 라이프의 기준값은 초기 라이프이고 R06 중첩만이 올린다. PLAYER.maxLife는 그 도달점이라
  // 상한으로만 쓴다 — 기준값으로 쓰면 카드 0장에서 이미 5칸이 되어 §13.2의 회복 수단이 무의미해진다
  const maxLife = capAt(
    clamps,
    5,
    'hardLimit',
    'maxLife',
    foldStat(accums, 'maxLife', PLAYER.startLife),
    PLAYER.maxLife,
  );

  // 6. 밴드 순서 보정. 마지막 밴드의 상한을 실효 반경으로 채우는 것이 C1과 §5.3을 같은 값에
  //    묶는 유일한 자리다 — 채움은 자른 것이 아니므로 clamps에 남지 않는다
  const bands: MutableBand[] = [];
  for (const band of PARRY_BANDS) {
    let maxDistU = band.maxDistU ?? parryRadiusU;
    let damageMul: number = band.damageMul;
    if (band.id === 'GREAT') {
      maxDistU = foldStat(accums, 'greatBandMaxDist', maxDistU);
      damageMul = foldStat(accums, 'greatDamageMul', damageMul);
    } else if (band.id === 'GOOD') {
      maxDistU = foldStat(accums, 'goodBandMaxDist', maxDistU);
    }
    bands.push({
      id: band.id,
      maxDistU,
      damageMul,
      speedMul: band.speedMul,
      hitstopSec: band.hitstopSec,
      score: band.score,
    });
  }
  orderBands(bands, clamps);

  // 7. INV-1. E07은 하한이 아니라 고정이므로 위로도 아래로도 움직인다 — 재입력 불가 구간
  //    자체를 못 박는 카드라 정상 쿨다운과 빈 패리 쿨다운이 같은 값이 되고 N13이 완전히 죽는다
  if (specials.e07LockoutSec === null) {
    const inv1MinSec = parryActiveSec + INV_1_MARGIN_SEC;
    cooldownSec = raiseTo(clamps, 7, 'INV-1', 'parryCooldownSec', cooldownSec, inv1MinSec);
    whiffCooldownSec = raiseTo(clamps, 7, 'INV-1', 'whiffCooldownSec', whiffCooldownSec, inv1MinSec);
  } else {
    const fixedSec = parryActiveSec + INV_1_MARGIN_E07_SEC;
    if (fixedSec !== cooldownSec) {
      clamps.push({ step: 7, rule: 'INV-1', field: 'parryCooldownSec', after: fixedSec });
    }
    if (fixedSec !== whiffCooldownSec) {
      clamps.push({ step: 7, rule: 'INV-1', field: 'whiffCooldownSec', after: fixedSec });
    }
    cooldownSec = fixedSec;
    whiffCooldownSec = fixedSec;
  }

  // 8. INV-2. 기준은 정상 쿨다운이다 — 빈 패리에는 애초에 무적이 없다(§5.4)
  const parryInvulnSec = capAt(
    clamps,
    8,
    'INV-2',
    'parryInvulnSec',
    parryInvulnRawSec,
    cooldownSec * INV_2_RATIO,
  );

  // reflectDamage는 % 카드만 오는 자리이고 R05의 콤보 가산이 같은 통에 들어간다. 2단계의 곱
  // **전체**가 콤보 종속이라 접힌 값을 필드로 둘 수 없다
  const reflectDamagePct = percentOf(accums, 'reflectDamage');
  const comboRule = specials.combo;

  function reflectDamageMulFor(combo: number): number {
    let bonusPct = 0;
    if (comboRule !== null) {
      const steps = Math.floor(combo / comboRule.perCombo);
      bonusPct = Math.min(steps * comboRule.addPercentPerStep, comboRule.maxAddPercent);
    }
    return 1 + (reflectDamagePct + bonusPct) / 100;
  }

  function cooldownSecFor(outcome: 'hit' | 'empty'): number {
    return outcome === 'empty' ? whiffCooldownSec : cooldownSec;
  }

  function conditionalDamageMulFor(grade: ParryGradeId): number {
    return grade === 'GREAT' ? specials.greatDamageMul : 1;
  }

  // 9. 스냅샷 확정
  const frozenBands: readonly EffectiveParryBand[] = bands;
  return {
    parryRadiusU,
    parryActiveSec,
    parryInvulnSec,
    parryBufferSec: PARRY.bufferSec,
    bands: frozenBands,
    comboHoldSec: foldStat(accums, 'comboHold', COMBO.holdSec),
    moveSpeedUPerSec,
    hitInvulnSec: foldStat(accums, 'hitInvuln', PLAYER.hitInvulnSec),
    maxLife,
    reflectLifetimeSec: REFLECT.lifetimeSec,
    reflectGraceSec: REFLECT.graceSec,
    reflectSpeedMaxUPerSec: REFLECT.speedMaxUPerSec,
    reflectPierceCount: foldStat(accums, 'reflectPierce', REFLECT.pierceCount),
    clamps,

    reflectSpeedMul: foldStat(accums, 'reflectSpeed', 1),
    reflectHitRadiusMul: foldStat(accums, 'reflectHitRadius', 1),
    reflectHomingDegPerSec: foldStat(accums, 'reflectHomingDegPerSec', 0),
    reflectSplits: specials.splits,
    reflectSplitDamageRatio: splitDamageRatio,
    reflectReplaceOnGreat: specials.replacement,
    enemyBulletSlowOnGreat: specials.slow,
    shardOnReflectHit: specials.shard,
    zoneOnReflectHit: specials.zone,
    autoParryGradeOnBossEnter: specials.autoParryGrade,
    shieldChargesPerStage: specials.shieldChargesPerStage,
    shieldInvulnSec: specials.shieldInvulnSec,

    reflectDamageMulFor,
    cooldownSecFor,
    conditionalDamageMulFor,
    r10ActiveMinGapSec: specials.r10MinGapSec,
    shieldMaxCharges: specials.shieldMaxCharges,
  };
}
