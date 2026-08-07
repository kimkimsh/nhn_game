/**
 * 업그레이드 카드 테이블의 타입 — 스펙 §11
 *
 * CardEffect가 31종 전부를 덮어야 한다. 덮지 못한 카드는 데이터로 적을 자리가 없어 sim/cards.ts에
 * 그 카드 전용 분기가 생기고, 그 순간 "카드는 데이터"라는 전제가 무너진다.
 * kind가 여럿인 이유는 표현 불가능이지 취향이 아니다 — 값 하나로 끝나는 24종은 전부 'stat'이다.
 *
 * 배럴은 ./types이며 config/의 다른 파일은 이 파일을 직접 import하지 않는다.
 */
import type {
  BulletId,
  CardHideCondition,
  CardRarity,
  ParryGradeId,
  StatTarget,
} from './ids';

/**
 * §11.3~§11.5 카드 효과 하나
 *
 * 'stat'이 24종을 덮는다. 나머지 열둘은 §11.6의 합산 규칙에 값 하나를 얹는 것이 아니라
 * 규칙 자체를 건드리므로 각자 모양이 다르다 — 에픽의 정의가 "게임 규칙을 바꿈"이다(§11.2).
 */
export type CardEffect =
  /**
   * 수치 한 칸을 바꾼다. op가 'set'인 것은 E05의 GREAT 데미지 배수 하나뿐이다 —
   * 3.5에 무엇을 더하는 것이 아니라 5.0으로 갈아 끼운다.
   */
  | {
      readonly kind: 'stat';
      readonly target: StatTarget;
      readonly op: 'addPercent' | 'addFlat' | 'set';
      readonly value: number;
    }
  /**
   * N14 회복 · R06 철벽. 스냅샷 필드를 올리는 것이 아니라 RunState의 life를 한 번 올린다.
   * 즉발이라 카드를 제거해도 되돌아가지 않는다(§18.4).
   */
  | { readonly kind: 'instantLife'; readonly value: number }
  /**
   * R01 쌍검 · E01 학익진. §11.6 4단계의 분열 계수이고 마지막에 곱연산한다.
   * 둘을 함께 보유하면 총 6발, 각 계수 0.65 × 0.55 = 0.3575다.
   */
  | {
      readonly kind: 'splitReflect';
      readonly count: number;
      readonly spreadDeg: number;
      readonly damageRatio: number;
    }
  /** R04 되받아치기. §11.6 3단계의 조건부 배수다 — 2단계의 가산 %와 다른 자리에 곱한다 */
  | {
      readonly kind: 'conditionalDamage';
      readonly on: 'parryGreat';
      readonly damageMul: number;
    }
  /**
   * R05 연격. 값이 콤보에 종속되므로 정적 스냅샷 필드가 될 수 없다 —
   * sim/stats.ts가 reflectDamageMulFor(combo)로 노출한다(12_통합_계약.md §10 E-05).
   */
  | {
      readonly kind: 'comboDamage';
      readonly perCombo: number;
      readonly addPercentPerStep: number;
      readonly maxAddPercent: number;
    }
  /**
   * R07 시간 늦추기. 대상이 스냅샷 필드가 아니라 월드의 적 탄환 전부이고 지속 시간이 있다.
   * 반사탄은 느려지지 않는다(§11.4).
   */
  | {
      readonly kind: 'timedGlobal';
      readonly on: 'parryGreat';
      readonly durationSec: number;
      readonly bulletSpeedMul: number;
    }
  /** R08 파편. 파생 발사체도 반사탄이라 플레이어에게 유효하고 자해 유예 0.15초가 그대로 붙는다(§7.1) */
  | {
      readonly kind: 'shardBurst';
      readonly on: 'reflectHit';
      readonly count: number;
      readonly damageRatio: number;
    }
  /**
   * R10 무쌍. §11.6 8단계에 자리가 없고 쿨다운 수치를 건드리지도 않는다 —
   * 성립했을 때만 쿨다운을 지우고 최소 간격만 남긴다. 빈 패리는 정상 쿨다운을 그대로 받는다.
   */
  | {
      readonly kind: 'cooldownReset';
      readonly on: 'parrySuccess';
      readonly minGapSec: number;
    }
  /** E02 신기전. 값을 바꾸는 것이 아니라 반사 자체를 다른 발사체로 교체한다 */
  | {
      readonly kind: 'replaceReflect';
      readonly on: 'parryGreat';
      readonly bullet: BulletId;
      readonly count: number;
      readonly spreadDeg: number;
      readonly damageRatio: number;
    }
  /**
   * E03 거북선 등껍질. 스테이지 시작마다 chargesPerStage만큼 충전되므로 카드 목록이 그대로여도
   * 값이 변한다. 능력치는 여기, 현재 충전 수는 RunState다(05_시스템_설계.md §5).
   */
  | {
      readonly kind: 'shield';
      readonly maxCharges: number;
      readonly chargesPerStage: number;
      /** 보호막 소모 시 라이프는 줄지 않고 이 시간만큼 무적만 준다 */
      readonly invulnSec: number;
    }
  /** E04 이순신의 판단. 수치가 아니라 보스전 진입 시 한 번 일어나는 사건이다 */
  | {
      readonly kind: 'onBossEnter';
      readonly action: 'autoParryAll';
      readonly grade: ParryGradeId;
    }
  /**
   * E06 화공. 파생 개체를 생성한다. 이 장판은 플레이어에게도 유효하고 §9.6·§10.5의
   * 동시 6개 상한을 P9와 공유한다(§11.5).
   */
  | {
      readonly kind: 'spawnZone';
      readonly on: 'reflectHit';
      readonly radiusU: number;
      readonly durationSec: number;
      /** 적에게 주는 초당 데미지 = 반사탄 데미지 × 이 비율 */
      readonly dpsRatio: number;
    }
  /**
   * E07 무한 검로. §11.6 7단계의 INV-1을 건너뛰는 유일한 카드다.
   * 쿨다운이 활성 시간 + lockoutSec가 되며, INV-2는 그대로 적용된다(§11.5).
   */
  | {
      readonly kind: 'invariantOverride';
      readonly rule: 'INV-1';
      readonly lockoutSec: number;
    };

/**
 * §11.3~§11.5 카드 한 장
 *
 * text가 아니라 textTemplate인 이유는 숫자의 소스를 하나로 만들기 위해서다. sim/cards.ts가
 * {value}를 effects[0].value의 절대값으로 채우고 부호와 단위는 템플릿이 갖는다. 문구에 숫자를
 * 직접 적으면 계수를 고칠 때 카드 화면만 옛 숫자를 계속 보여준다(12_통합_계약.md §8-12).
 */
export type CardDef = {
  readonly name: string;
  readonly rarity: CardRarity;
  /** §11.2 이 수에 도달하면 제시 풀에서 빠진다. N14는 Infinity다 */
  readonly maxStack: number;
  /** 예: '반사탄 데미지 +{value}%' */
  readonly textTemplate: string;
  readonly effects: readonly CardEffect[];
  /** §11.2 효과가 무의미해지는 런 상태. 그 상태에서는 제시 풀에서 뺀다 */
  readonly hideWhen?: CardHideCondition;
};

/** §11.2 한 회차의 등급 추첨 가중치. 세 값의 합이 100이어야 할 이유는 없다 — 비율로만 쓴다 */
export type RarityWeights = { readonly [K in CardRarity]: number };

/** §11.1 추첨 절차 */
export type DrawConfig = {
  readonly offerCount: number;
  /** 획득 시점은 S1~S4 클리어 직후다. RARITY_WEIGHTS의 회차 수와 같아야 한다 */
  readonly acquisitionCount: number;
  /** §11.1 스테이지 1은 언제나 카드 0장으로 시작한다 */
  readonly startingCards: number;
  readonly rerollsPerRun: number;
  /**
   * §11.1 등급까지 다시 뽑는 것이 리롤의 핵심이다. 카드만 다시 뽑으면 노말 3장이 나온 화면에서
   * 리롤해도 노말 3장이 다시 나와 리롤이 사실상 무의미해진다.
   */
  readonly rerollRedrawsRarity: boolean;
};
