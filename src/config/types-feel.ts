/**
 * 연출 강도 테이블의 타입 — 스펙 §3.2 · §4.3 · §5.3 · §17, 06_렌더링과_게임필.md §4
 *
 * 히트스톱·흔들림·파티클·임팩트 프레임·집중선·장판이 여기 있다. 06 §4가 이 값들의 정본이고
 * 근거가 목업 engine.js 또는 리서치라 스펙 절 번호가 없는 항목이 섞인다 — 그런 값에는 §17을
 * 단다(04_밸런스_데이터_설계.md §1.1).
 *
 * 배럴은 ./types이며 config/의 다른 파일은 이 파일을 직접 import하지 않는다.
 */

/**
 * §4.2 등급 밴드 밖의 유일한 히트스톱
 *
 * 등급별 히트스톱은 여기 없다. ParryBand.hitstopSec가 단일 소스이고, 같은 세 숫자가 두 파일에
 * 살면 밴드를 조정한 사람이 이쪽을 잊는다(12_통합_계약.md §5).
 */
export type HitstopConfig = {
  readonly playerHit: number;
};

/**
 * §17 화면 흔들림
 *
 * trauma ∈ [0,1]을 쌓고 매 초 decayPerSec만큼 줄이며 실제 진폭은 trauma^exponent다.
 * 선형으로 올리면 약한 흔들림이 안 느껴지고 강한 흔들림이 과해진다.
 * 흔들림은 render 변위로만 적용한다 — 카메라 원점을 옮기면 판정이 따라 움직인다.
 */
export type ShakeConfig = {
  readonly decayPerSec: number;
  readonly exponent: number;
  readonly noiseSpeed: number;
  readonly maxOffsetU: number;
  /** 순수 평행이동은 glitch로 읽힌다. 회전이 섞여야 힘으로 읽힌다 */
  readonly maxRotationDeg: number;
};

/**
 * §17 방향성 킥 하나. 무방향 노이즈 위에 더한다
 *
 * 방향은 사건이 정한다 — 피격은 맞힌 발사체의 진행 방향, 연쇄 시작은 첫 처치 위치,
 * 보스 돌진은 돌진 방향. 그래서 이 표는 크기와 감쇠만 갖는다.
 */
export type KickDef = {
  readonly magnitudeU: number;
  readonly decaySec: number;
};

/** §17 방향성 킥이 붙는 사건 셋 */
export type KickTable = {
  readonly playerHit: KickDef;
  readonly chainStart: KickDef;
  readonly bossChargeLand: KickDef;
};

/**
 * §17 사건별 trauma 가산량
 *
 * 전부 min(1, trauma + x)로 누적한다. 빈 패리와 쿨다운 종료가 0인 것이 값이 아니라 규칙이다 —
 * 빈 패리는 §5.4가 연출을 주지 않기로 한 것이고, 쿨다운 종료는 초당 4회 이상 반복돼서 흔들면
 * 피로가 된다.
 */
export type TraumaTable = {
  readonly parryNotBad: number;
  readonly parryGood: number;
  readonly parryGreat: number;
  readonly reflectHit: number;
  readonly enemyKilled: number;
  readonly chainLink2: number;
  readonly chainLink3Up: number;
  /** 연쇄 중 trauma 상한. 진폭이 0.8초 내내 9~26u에 머무는 것을 막는다(12_통합_계약.md §7.3) */
  readonly chainCap: number;
  readonly bossPartBreak: number;
  readonly bossPhase: number;
  readonly playerHit: number;
  readonly bossDeath: number;
  /** §7.3 방패병 정면 무효. 아무 일도 안 일어났다는 것이 정보다 */
  readonly shieldBlocked: number;
  readonly parryWhiff: number;
  readonly cooldownReady: number;
};

/** §17 강도 티어 한 단 */
export type ParticleTier = {
  readonly count: number;
  readonly spreadUPerSec: number;
};

/**
 * §17 파티클
 *
 * 각도는 균등 링 + 지터다. 순수 난수 각도는 뭉치고 빈틈을 남긴다.
 * 난수는 core/rng.ts를 쓴다 — Math.random()은 D-05의 결정론을 깬다.
 */
export type ParticleConfig = {
  readonly small: ParticleTier;
  readonly medium: ParticleTier;
  readonly large: ParticleTier;
  /** 균등 링에 더하는 각도 지터 (rad) */
  readonly angleJitterRad: number;
  /** 초기 속도 = spreadUPerSec × (distanceMinRatio + rng × distanceRandRatio) */
  readonly distanceMinRatio: number;
  readonly distanceRandRatio: number;
  /** 초기 dy에 더하는 중력 킥 (u/s). 궤적의 시작 모양을 만든다 */
  readonly initialKickUPerSec: number;
  /** 지속 중력 (u/s²). 낙하를 만든다 — 초기 킥과 다른 일을 한다 */
  readonly gravityUPerSec2: number;
  readonly lifetimeBaseSec: number;
  readonly lifetimeRandSec: number;
  /** 동시 생존 상한. 연쇄 20링크가 전부 살아 있으면 이 값에서 잘린다(12_통합_계약.md §7.4) */
  readonly maxAlive: number;
  /** 연쇄 링크 하나당 파티클 수 */
  readonly chainLinkCount: number;
  /** 링크 4 이상은 이 수로 감쇠한다 */
  readonly chainLinkCountAfter4: number;
  /** medium 이상에서 대상이 밝아지는 시간 (s) */
  readonly targetFlashSec: number;
};

/**
 * §17 임팩트 프레임 — GREAT 패리에서만
 *
 * 레이어는 탄환층과 플레이어층 사이다. 최상단에 두면 §15.1이 상시 표시로 못 박은 10u 코어가
 * 0.033초 사라지고, 그 사이 S5 조총탄이 GREAT 밴드 전체보다 멀리 간다(12_통합_계약.md §7.1).
 * minGapSec는 광과민성 방어선이다 — GREAT는 초당 4회 이상 가능하다.
 */
export type ImpactFrameConfig = {
  readonly durationSec: number;
  readonly alphaHigh: number;
  readonly alphaLow: number;
  readonly minGapSec: number;
  /** 패리 시작 후 이만큼 뒤, 히트스톱 종료 직후에 띄운다 */
  readonly delayAfterParrySec: number;
};

/** §17 집중선이 붙는 사건 하나 */
export type SpeedLineEventDef = {
  readonly count: number;
  readonly durationSec: number;
};

/**
 * §17 집중선
 *
 * GOOD·NOT BAD에는 붙이지 않는다. 희소성이 이 신호의 전부다.
 * 시작 반경 안쪽이 비어야 시선이 수렴점으로 간다.
 */
export type SpeedLinesConfig = {
  readonly parryGreat: SpeedLineEventDef;
  readonly chainStart: SpeedLineEventDef;
  readonly bossPhase: SpeedLineEventDef;
  readonly startRadiusU: number;
  readonly endRadiusU: number;
  readonly widthBaseU: number;
  readonly widthRandU: number;
  readonly angleJitterRad: number;
  readonly alpha: number;
};

/**
 * §4.3 장판 · §9.6 동시 존재 상한
 *
 * 다각형 계수가 여기 있는 이유는 판정과 그림이 같은 도형이어야 하기 때문이다. 피해 판정을
 * 그려진 다각형 외곽선 자체로 잡기로 했으므로(12_통합_계약.md §8-6), sim/zones.ts와
 * render/zone.ts가 같은 꼭짓점을 만들어야 하고 그 유일한 소스가 이 표다.
 *
 * 꼭짓점 i의 반경 = radiusU × (polyBaseRatio + ((i × polyStrideIndex) % polyModulus) × polyStepRatio)
 * 각도 = (i / polyVertices) × 2π + polyStartAngleRad
 */
export type ZoneConfig = {
  /** P9와 E06 화공 장판이 이 상한을 공유한다. 초과 시 가장 오래된 것부터 제거한다(§11.5) */
  readonly maxConcurrent: number;
  /** 진입 즉시 1회, 이후 이 간격으로 반복 판정 */
  readonly damageIntervalSec: number;
  /** §6.1 화염 장판 P9의 지속 시간. E06 장판은 CardEffect가 자기 값을 갖는다 */
  readonly p9DurationSec: number;
  readonly polyVertices: number;
  readonly polyBaseRatio: number;
  readonly polyStepRatio: number;
  readonly polyStrideIndex: number;
  readonly polyModulus: number;
  readonly polyStartAngleRad: number;
};
