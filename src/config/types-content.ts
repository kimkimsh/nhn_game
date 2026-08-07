/**
 * 편성 데이터 테이블의 타입 — 스펙 §8 · §9 · §10
 *
 * 잡몹·진입 형태·스테이지·웨이브·보스가 여기 있다. 이 파일의 타입이 덮지 못하는 스펙 문장이
 * 하나라도 남으면 그 패턴은 데이터로 적을 방법이 없고, boss-runner.ts가 해석할 대상 자체가
 * 사라진다 — 그래서 필드 하나하나가 §10.2~§10.6의 어느 줄을 표현하는지를 주석이 밝힌다.
 *
 * 배럴은 ./types이며 config/의 다른 파일은 이 파일을 직접 import하지 않는다.
 */
import type {
  BackgroundId,
  BossId,
  BossSpriteId,
  BulletId,
  EnemyBehaviorId,
  EnemyId,
  EnemySpriteId,
  FormationId,
  StageId,
  TelegraphId,
} from './ids';

/** 사각 히트박스. 보스와 파괴 가능 부위는 원이 아니라 AABB로 판정한다(12_통합_계약.md §10 E-04) */
export type HitBox = {
  readonly wU: number;
  readonly hU: number;
};

/**
 * §8.1 잡몹 아키타입 한 줄
 *
 * hp는 스테이지 1 기준이다. 실제 HP = hp × difficulty.ts의 enemyHpMul.
 * shape와 hitRadiusU가 여기 있어야 잡몹 추가가 config/ 안에서 끝난다 — 없으면 sim/collision.ts가
 * render/enemy.ts의 실루엣 폭을 읽어야 하고, 그건 계층 규칙 위반이다(12_통합_계약.md §10 E-04).
 */
export type EnemyDef = {
  readonly name: string;
  readonly shape: EnemySpriteId;
  /** 반사탄 명중 판정 반경. 목업의 실루엣 폭 × 0.6을 미리 계산해 둔 값이다 */
  readonly hitRadiusU: number;
  readonly hp: number;
  readonly moveSpeedUPerSec: number;
  readonly behavior: EnemyBehaviorId;
  /** 발사하지 않는 적은 null. E-C·E-D가 그렇다 */
  readonly bullet: BulletId | null;
  readonly shotsPerCycle: number;
  /** 부채꼴 반각(도). 360이면 등간격 링이다(E-G) */
  readonly spreadDeg: number;
  /** 발사 예비동작 시간을 포함한다. crossPass처럼 자체 스케줄을 쓰는 적은 0 */
  readonly fireCycleSec: number;
  /** HR-02 판정 기준. 모든 웨이브에 이 값이 참인 적이 최소 1기 있어야 한다 */
  readonly isRanged: boolean;
  readonly contactDamage: boolean;
  readonly score: number;
  /** §7.3 정면 반사탄 1회 무효화 후 파괴. E-C만 갖는다 */
  readonly frontShield?: boolean;
  /** §6.2 HR-05가 허용하는 예고 3종 중 하나. 예고가 붙는 적만 갖는다 */
  readonly telegraph?: TelegraphId;
  readonly note?: string;
};

/**
 * §8.2 진입 형태 한 줄
 *
 * 스펙이 여섯 형태를 문장으로만 적어 두었으므로 필드는 그 여섯 문장이 공통으로 요구하는 것에서
 * 뽑았다. stopYU가 null인 것이 F-6(측면 통과)이고, spawnIntervalSec가 0인 것이 F-5(즉시 배치)다.
 */
export type FormationDef = {
  readonly name: string;
  readonly entrySide: 'top' | 'left' | 'right' | 'bothSides';
  /** 개체 사이 진입 간격 (s). 0이면 동시에 나타난다 */
  readonly spawnIntervalSec: number;
  /** 개체 사이 간격 (u) */
  readonly spacingU: number;
  /** 정지하는 y (u). null이면 정지하지 않고 통과한다 */
  readonly stopYU: number | null;
  /** 진입 중 좌우 진폭 (u). 0이면 흔들지 않는다 */
  readonly amplitudeU: number;
  /**
   * 홀수번째 개체를 이만큼 아래로 내려 지그재그로 세운다 (u). 0이면 한 줄로 선다.
   *
   * spacingU와 같은 축이 아니다 — 저쪽은 개체 사이의 간격이고 이것은 그 간격을 유지한 채 한 칸
   * 걸러 내리는 오프셋이라, 하나로 합치면 「간격은 그대로인데 줄만 어긋난 배치」를 못 만든다.
   */
  readonly zigzagYU: number;
  readonly note: string;
};

/** §9.3~§9.7 한 웨이브가 부르는 아키타입 한 종과 그 수 */
export type SquadDef = {
  readonly enemy: EnemyId;
  readonly count: number;
};

/**
 * §9.7 관통 대창 광역 공격
 *
 * BossPattern이 아니다. S5 W4부터 배경 함대가 쏘고 B5 페이즈 4도 같은 것을 쓰므로,
 * sim/lance.ts 하나를 웨이브와 보스 페이즈가 같이 부른다(12_통합_계약.md §10 E-10).
 * 그래서 이 타입이 WaveDef와 BossPhase 양쪽에 붙는다.
 */
export type LanceDef = {
  /** 반복 간격 (s). 웨이브에서는 15초, 보스 페이즈에서는 패턴 차례마다 1회 */
  readonly intervalSec: number;
  /** 세로 줄 수. S5 W4는 2줄, B5 페이즈 4는 3줄 */
  readonly lanes: number;
  readonly telegraphSec: number;
  /** 예고선이 사라진 뒤 관통 판정이 살아 있는 시간 (s) */
  readonly activeSec: number;
  /** HR-04. 줄 사이에 반드시 남겨야 하는 안전 지대 폭 (u) */
  readonly safeCorridorU: number;
  /**
   * 줄 전체의 가로 중심 (u). 생략하면 플레이필드 가로 중심이다.
   *
   * 줄 사이 간격은 여전히 safeCorridorU가 정한다 — HR-04가 지키라는 것이 통로 폭이므로 그쪽에서
   * 좌표를 유도해야 규칙과 값이 어긋날 수 없다. 여기 있는 것은 그 묶음이 통째로 서는 자리이고,
   * 대칭이 아닌 배치를 담을 자리가 이 필드 하나뿐이다.
   */
  readonly centerXU?: number;
};

/**
 * §9.1 웨이브 한 구간
 *
 * 전환은 시간 기반이다. 이전 웨이브의 적이 남아 있어도 startSec에 다음 웨이브가 시작하고
 * 잔존 적은 그대로 유지되므로, concurrentMax는 이 웨이브의 편성이 아니라 잔존분까지 합친
 * 도달치다(§9.3).
 */
export type WaveDef = {
  readonly startSec: number;
  readonly endSec: number;
  /** 둘 이상이면 편성을 나눠 동시에 쓴다 — 스펙 §9.3~§9.7의 "F-3 + F-4" 표기 그대로다 */
  readonly formation: FormationId | readonly FormationId[];
  /** HR-02: isRanged가 참인 적이 최소 1기 있어야 한다. guards.test.ts가 전 웨이브를 훑는다 */
  readonly squads: readonly SquadDef[];
  readonly concurrentMax: number;
  /** §9.7 W4부터의 배경 함대 관통 대창. 그 밖의 웨이브는 갖지 않는다 */
  readonly lance?: LanceDef;
};

/** §9.2 스테이지 하나 */
export type StageDef = {
  readonly id: StageId;
  readonly name: string;
  readonly background: BackgroundId;
  readonly concept: string;
  readonly bossId: BossId;
  readonly waves: readonly WaveDef[];
  /** §9.1 소강 구간. 신규 적 탄환만 없을 뿐 무적 구간이 아니고 잔존 반사탄은 유효하다 */
  readonly lullSec: number;
  /**
   * §9.1 잔존 잡몹이 퇴장을 시작할 때까지의 유예 (s). 소강보다 길면 "적 탄환 없음"이 깨지므로
   * 스펙의 4초가 아니라 3초다(05_시스템_설계.md §7).
   */
  readonly stragglerGraceSec: number;
};

/**
 * §10 보스 패턴 프리미티브 9종 — volley · spread · ring · arc · charge · mortar · barrage ·
 * parallel · summon
 *
 * lance는 여기 없다. 웨이브 위협이라 LanceDef이고 sim/lance.ts가 돌린다(12 §10 E-10).
 * summon은 E-09가 지웠다가 E-09-정정이 되살렸다 — 스펙 :645가 연막 돌격을 순환 패턴으로
 * 못 박았고, 진입 훅으로 만들면 페이즈당 1회로 끝나 순환에서 빠진다.
 *
 * name은 모든 패턴의 공통 필드다. 페이즈의 patterns 배열을 읽을 때 이름이 없으면 어느 패턴인지
 * 알 수 없고, 치트 메뉴(§18.3)와 디버그 오버레이가 이 이름을 그대로 표시한다(12 §4).
 *
 * boss-runner.ts의 kind 분기는 never 대입으로 끝난다. 없으면 kind를 추가하고 해석기를 안 고쳐도
 * 컴파일이 통과하고 보스가 그 차례에 조용히 아무것도 안 한다(12 §4.1).
 */
type BossPatternBase = { readonly name: string };

export type BossPattern = BossPatternBase & (
  /**
   * 여러 발사원에서 동시 또는 연속 직선 발사. §10.2 일제사격·엄폐 전진·일제사격 강화,
   * §10.4 좌현 일제포격·갑판 조총 사격·교차 포격, §10.5 대통 직사, §10.6 총력 일제사격·전현 포격
   *
   * tellSec 계약 — volley · spread · ring이 공유한다.
   *   ① 값은 연사·세트 전체 앞에 한 번이다. repeat·sets마다 다시 붙지 않는다.
   *   ② 스펙이 그 패턴의 예비동작을 직접 준 경우 그 값을 쓴다.
   *   ③ 안 준 경우 발사 형태로 고른다 — 단발 직선은 §14.1의 스테이지 tellSec,
   *      확산·링은 0.4초 고정(§6.2 · 10_스펙_목업_불일치.md A15).
   *   ④ 이 값은 HR-09 억제 거리 검사와 무관하다. 억제는 발사 시점에 따로 본다.
   */
  | {
      readonly kind: 'volley';
      readonly bullet: BulletId;
      readonly count: number;
      readonly tellSec: number;
      readonly intervalSec: number;
      readonly repeat: number;
      readonly aim: 'player' | 'down';
      /** 발사원이 가로로 퍼지는 폭 (u). 0이면 한 점에서 나간다 */
      readonly sourceSpread: number;
      /**
       * §10.4 좌현 일제포격과 교차 포격은 본체가 아니라 살아남은 포문에서 나간다.
       * 'partsAlternating'이 교차 포격의 "좌우가 번갈아"다.
       */
      readonly from: 'boss' | 'parts' | 'partsAlternating';
      /** §10.2 페이즈 2 일제사격 강화가 탄속 ×1.1을 요구한다 */
      readonly speedMul?: number;
    }
  /**
   * 부채꼴 확산. §10.3 투척 수리검, §10.4 최후 포격의 함포 6발, §10.5 화차 일제사격
   *
   * 04_밸런스_데이터_설계.md §8.1의 "B4 대통 직사"와 "B5 최후 포격"은 둘 다 오기였다 —
   * 대통 직사는 volley(count 1 · repeat 3 · aim player)이고 최후 포격은 B3다(12 §10 E-11).
   */
  | {
      readonly kind: 'spread';
      readonly bullet: BulletId;
      readonly count: number;
      readonly halfAngleDeg: number;
      readonly tellSec: number;
      readonly sets: number;
      readonly setIntervalSec: number;
      /**
       * §10.5 화차 일제사격의 "좌 → 우 → 중앙 순". 세트마다의 발사원 x 오프셋 (u)이고,
       * 길이가 sets와 같아야 한다. 없으면 모든 세트가 본체 중심에서 나간다.
       */
      readonly setOriginsU?: readonly number[];
    }
  /** 등간격 전방위 링. §10.3 돌진 종료 링, §10.5 폭발 링, §10.6 전탄 발사·이도류 돌진 종료 링 */
  | {
      readonly kind: 'ring';
      readonly bullet: BulletId;
      readonly count: number;
      readonly tellSec: number;
      readonly startAngleDeg: number;
    }
  /** 초승달 참격파. §10.3 참격파·참격파 강화·이도류 난무, §10.6 총대장 등판 */
  | {
      readonly kind: 'arc';
      readonly bullet: 'P5';
      readonly count: number;
      /** §6.2 참격파의 백스윙은 스테이지와 무관하게 0.7초 고정이다 */
      readonly backswingSec: number;
      readonly intervalSec: number;
      /** 좌우 교차 발사 여부 */
      readonly alternate: boolean;
    }
  /**
   * 본체 돌진. 방향선 예고 필수(HR-05). §10.3 돌진 베기·돌진 베기 + 수리검,
   * §10.4 충각 돌진, §10.6 이도류 돌진·충각 돌진
   *
   * targetYU · holdSec · returnToStart가 없으면 §10.4("y=1100까지 내려온 뒤 3초 유지, 복귀")도
   * §10.6("y=1200, 2.5초 유지")도 쓸 수 없다. duringInterval은 §10.3 페이즈 3의 "돌진 중
   * 0.2초 간격으로 수리검"이다 — onEnd는 종료 시점만 주므로 돌진 도중을 표현하지 못한다
   * (12 §10 E-11).
   */
  | {
      readonly kind: 'charge';
      readonly telegraphSec: number;
      readonly speedUPerSec: number;
      /** HR-04. guards.ts가 0보다 큰지 검사한다 */
      readonly safeCorridorU: number;
      /** 도달 목표 y (u). null이면 플레이어 위치로 돌진한다(§10.3) */
      readonly targetYU: number | null;
      readonly holdSec: number;
      readonly returnToStart: boolean;
      readonly duringInterval?: { readonly bullet: BulletId; readonly intervalSec: number };
      readonly onEnd: BossPattern | null;
    }
  /**
   * 곡사 착탄. 착탄 예고 원 필수(HR-05). §10.5 곡사 포격·연쇄 포격·초토화,
   * §10.6 화공 총공세
   *
   * spawnsZone이 없으면 §10.5가 요구한 장판을 만들 방법이 없다 — 「각 폭발 지점에서 링 8발
   * 확산 + 장판 P9 생성」에서 링은 onImpact가 받지만 장판은 어느 kind도 못 만든다.
   */
  | {
      readonly kind: 'mortar';
      readonly count: number;
      readonly telegraphSec: number;
      readonly radiusU: number;
      /** 예고 원이 하나씩 뜨는 간격 (s). 0이면 전부 동시에 뜬다 */
      readonly sequentialSec: number;
      /** 참이면 예고 원을 플레이어 현재 위치에 붙여 배치한다(§10.5 연쇄 포격) */
      readonly trackPlayer: boolean;
      readonly onImpact: BossPattern | null;
      readonly spawnsZone?: { readonly bullet: 'P9'; readonly radiusU: number };
    }
  /**
   * 난사. §10.2 난사, §10.5 불화살 비, §10.6 난사 강화
   *
   * origin이 'topSpan'이면 발사원이 보스가 아니라 화면 상단 폭 spanU 구간이다.
   * §10.5의 불화살 비는 "상단 전역에서 순차 낙하"라서 보스 좌표에서 쏘면 위치 분포가
   * 통째로 달라진다 — 각도 무작위만으로는 표현되지 않는다(12 §10 E-11).
   */
  | {
      readonly kind: 'barrage';
      readonly bullet: BulletId;
      readonly count: number;
      readonly durationSec: number;
      readonly speedUPerSec: number;
      readonly origin: 'boss' | 'topSpan';
      readonly spanU?: number;
    }
  /**
   * 동시 실행 결합자. 자식들을 같은 시각에 스케줄하고 가장 긴 자식이 끝날 때 종료한다.
   * 05_시스템_설계.md §8.2의 "패턴은 겹치지 않는다"는 이제 패턴 사이에만 적용된다.
   *
   * 사용처 넷 — §10.6 전탄 발사, §10.5 초토화, §10.6 화공 총공세, §10.4 최후 포격.
   * charge.onEnd와 mortar.onImpact는 후속을 하나만 붙일 수 있어 병렬을 못 만든다(12 §10 E-08).
   */
  | { readonly kind: 'parallel'; readonly parts: readonly BossPattern[] }
  /**
   * §10.2 B1 페이즈 2 연막 돌격 — E-D 4기 진입 후 돌진 방향선 1.0초 → 돌진.
   * 방향선 시간은 E-D 자신의 behavior가 갖고 있으므로 여기서 다시 적지 않는다.
   */
  | {
      readonly kind: 'summon';
      readonly enemy: EnemyId;
      readonly count: number;
      readonly formation: FormationId;
    }
);

/**
 * §10 페이즈 진입 시 한 번만 실행하는 패턴. 순환에는 들어가지 않는다
 *
 * B1 연막 돌격이 여기 있었다가 patterns 배열로 돌아갔다 — 훅은 페이즈당 1회라 스펙 :645의
 * 순환 요구를 표현하지 못한다(12 §10 E-09-정정). 지금은 보스 다섯 모두 null이다.
 */
export type PhaseEnterHook = BossPattern;

/** §10 보스 페이즈 하나 */
export type BossPhase = {
  /** 진입 HP 비율. 1.00이면 시작 페이즈다 */
  readonly hpThreshold: number;
  /**
   * §10.4 B3 전용. 파괴된 부위 수가 이 값에 닿아도 진입한다. hpThreshold와 OR이고
   * 먼저 만족한 쪽이 이긴다(스펙의 「선착」). 둘 다 만족해도 전환은 한 번만 일어난다.
   */
  readonly partsDestroyedThreshold?: number;
  readonly onEnter: PhaseEnterHook | null;
  readonly patterns: readonly BossPattern[];
  /**
   * §10.6 B5 페이즈 4만 갖는다 — 직전 패턴을 제외하고 무작위로 고른다.
   * 없으면 §10.1의 고정 순환이다.
   */
  readonly patternOrder?: 'randomNoRepeat';
  /** §10.6 B5 페이즈 4의 관통 대창. sim/lance.ts를 웨이브와 공유한다(12 §10 E-10) */
  readonly lance?: LanceDef;
  /**
   * §10.6 B5 페이즈 3. 이 페이즈 동안 본체 판정 도형이 선체가 아니라 갑판으로 나온 총대장이다.
   * 없으면 BossDef.hitBox를 그대로 쓴다.
   *
   * 부위(BossPartDef)로 만들 수 없다 — 별도 HP가 없고 파괴되지도 않으며, 선체를 대신하는 것이지
   * 선체에 얹히는 것이 아니다. 페이즈에 붙는 이유도 같다: 등판은 페이즈 3에서만 유효하다.
   */
  readonly bodyHitBox?: HitBox;
};

/**
 * §10.4 · §15.1 파괴 가능 부위
 *
 * 본체와 별도 HP를 갖고 별도 히트박스로 판정한다. 반사탄이 본체와 부위에 동시에 들어가면
 * 부위가 먼저 가져간다 — 그 순서가 없으면 선체가 포문 넷을 전부 가린다(05 §8.3).
 */
export type BossPartDef = {
  readonly id: string;
  readonly hp: number;
  /** 보스 중심 기준 오프셋 (u) */
  readonly offsetU: { readonly xU: number; readonly yU: number };
  readonly hitBox: HitBox;
  readonly bullet: BulletId;
};

/**
 * §10 보스 하나
 *
 * phaseTransitionSec · patternGapSec · deathSec은 여기 없다. 다섯 보스가 같은 값이라
 * BOSS_COMMON이 갖는다(12_통합_계약.md §10 E-12).
 *
 * B3의 hp는 §10.7 요약표의 3200이 아니라 본체 2000이다. 요약표 값은 본체 + 포문 4×300의
 * 합계이고, BossDef.hp가 단일 소스인 이상 그 필드에는 본체 HP만 들어간다(04 §8.1-B).
 */
export type BossDef = {
  readonly id: BossId;
  readonly name: string;
  readonly hp: number;
  readonly targetKillSec: number;
  readonly shape: BossSpriteId;
  /** 목업 실측값. 원이 아니라 사각형이라 core/sweep.ts의 선분–AABB가 판정한다 */
  readonly hitBox: HitBox;
  readonly phases: readonly BossPhase[];
  /** §10.4 B3만 갖는다. 나머지 넷은 이 필드가 없다 */
  readonly parts?: readonly BossPartDef[];
};

/**
 * §10.1 보스 다섯이 공유하는 규칙
 *
 * BossDef에 두면 리터럴이 15개가 되고 소유자가 두 병렬 작업으로 갈린다. 보스 하나만 다르게
 * 하고 싶어졌다면 그것은 이 표가 아니라 스펙 §10.1을 바꾸는 일이다(12_통합_계약.md §10 E-12).
 */
export type BossCommon = {
  /** 전환 연출. 보스 무적, 신규 발사 정지. 기존 탄환은 유지된다(HR-03) */
  readonly phaseTransitionSec: number;
  readonly patternGapSec: number;
  /** 격파 연출. 이 동안 모든 적 탄환 소멸, 플레이어 무적 */
  readonly deathSec: number;
};
