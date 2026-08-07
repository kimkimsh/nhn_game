/**
 * 연출 강도 — 스펙 §3.2 · §4.3 · §17, 06_렌더링과_게임필.md §4
 *
 * 모든 피드백 사건을 정해진 강도에 배정한다. 사건마다 즉흥으로 숫자를 넣으면 화면 전체가
 * 균질하게 시끄러워지고, 가장 강한 효과가 의미를 잃는다.
 *
 * 등급별 히트스톱은 여기 없다. parry.ts의 PARRY_BANDS[].hitstopSec가 단일 소스이고, 같은
 * 세 숫자가 두 파일에 살면 밴드를 조정한 사람이 이쪽을 잊는다(12_통합_계약.md §5). 여기
 * 남는 히트스톱은 밴드 밖의 playerHit과 등급과 무관한 누적 상한 둘뿐이다.
 *
 * SHAKE와 TRAUMA_ON의 값은 출처가 스펙이 아니라 승인된 목업과 리서치라 절 번호가 붙은 적이
 * 없었다. §17이 이 값들이 지키는 요구이므로 §17을 단다(04_밸런스_데이터_설계.md §1.1).
 *
 * 색은 하나도 없다 — 임팩트 프레임의 채움색과 집중선 색은 palette.ts의 baek이고, 그 참조는
 * render/가 한다.
 */
import type {
  HitstopConfig,
  ImpactFrameConfig,
  KickTable,
  ParticleConfig,
  ShakeConfig,
  SpeedLinesConfig,
  TraumaTable,
  ZoneConfig,
} from './types';

/**
 * 등급 밴드 밖의 유일한 히트스톱.
 * player.ts도 §4.2 피격 처리를 담당하므로 같은 0.14가 그쪽에 있었다 — 지웠다(12 §10 E-13).
 */
export const HITSTOP_SEC = {
  playerHit: 0.14, // §4.2 5단계. 초 — 게임에서 가장 긴 정지다
} as const satisfies HitstopConfig;

/** §3.2 히트스톱 1초당 누적 상한. 초 단위이고 초과분은 잘라낸다 */
export const HITSTOP_BUDGET_PER_SEC = 0.32; // §3.2

/**
 * 화면 흔들림. trauma ∈ [0,1]을 쌓고 매 초 decayPerSec만큼 줄이며, 실제 진폭은
 * trauma^exponent × maxOffsetU다. 선형으로 올리면 약한 흔들림이 안 느껴지고 강한 흔들림이
 * 과해진다 — trauma 0.30 / 0.60 / 0.90이 제곱을 거치면 3% / 22% / 73%가 된다.
 *
 * 노이즈는 core/rng.ts의 시드로 만든 value noise를 x 이동 · y 이동 · 회전 3채널로 샘플한다.
 * Math.random()은 D-05의 결정론을 깨고, 부드러운 노이즈라야 히트스톱(=슬로모션) 중에도
 * 저절로 맞고 §7의 촬영본이 재현된다.
 *
 * 흔들림은 render 변위로만 적용한다 — 카메라 원점을 옮기면 판정이 따라 움직인다.
 * prefers-reduced-motion이 참이면 maxOffsetU와 maxRotationDeg를 0으로 읽는다.
 */
export const SHAKE = {
  decayPerSec: 0.5, // §17 trauma/초. 1.0이 2초에 0으로 내려간다
  exponent: 2.0, // §17 shake = trauma^2. 이 제곱이 흔들림의 이징을 대신한다
  noiseSpeed: 20.0, // §17 노이즈 샘플 속도. 꽤 빠른 흔들림에 해당한다
  maxOffsetU: 26, // §17 최대 이동 진폭 (u)
  maxRotationDeg: 0.4, // §17 최대 회전 진폭 (도, 0.007 rad). 순수 평행이동은 glitch로 읽힌다
} as const satisfies ShakeConfig;

/**
 * 방향성 킥. 무방향 노이즈 위에 더한다 — 흔들림 방향이 사건을 가리켜야 한다.
 *
 * 방향은 사건이 정하므로 이 표는 크기와 감쇠만 갖는다. 피격은 맞힌 발사체의 진행 방향,
 * 연쇄 시작은 패리 지점에서 첫 처치 위치로, 보스 돌진은 돌진 방향이다.
 * 감쇠는 전부 ease-out이다(§4.7 — linear는 쓰지 않는다).
 */
export const KICK = {
  playerHit: { magnitudeU: 12, decaySec: 0.12 }, // §17 12u · 0.12초
  chainStart: { magnitudeU: 14, decaySec: 0.2 }, // §17 14u · 0.20초. 머니샷 연쇄의 첫 처치
  bossChargeLand: { magnitudeU: 16, decaySec: 0.15 }, // §17 16u · 0.15초
} as const satisfies KickTable;

/**
 * 사건별 trauma 가산량. 전부 min(1, trauma + x)로 누적한다.
 *
 * 앞의 세 값은 목업이 `0.28 + 등급데미지배수 × 0.06`으로 계산하던 결과를 그대로 옮긴 것이고,
 * 등급이 올라갈수록 흔들림이 세지는 것이 그 식의 전부다.
 *
 * 0인 두 항목은 값이 아니라 규칙이다. 빈 패리는 §5.4가 연출을 주지 않기로 한 것이고, 쿨다운
 * 종료는 초당 4회 이상 반복돼서 흔들면 신호가 아니라 피로가 된다.
 */
export const TRAUMA_ON = {
  parryNotBad: 0.34, // §17 0.28 + 1.0 × 0.06
  parryGood: 0.4, // §17 0.28 + 2.0 × 0.06
  parryGreat: 0.49, // §17 0.28 + 3.5 × 0.06
  reflectHit: 0.2, // §17 반사탄이 잡몹에 적중
  enemyKilled: 0.3, // §17 잡몹 처치. medium 밴드 하단
  chainLink2: 0.12, // §17 다수 처치 링크 2. 20기 연쇄가 상한을 즉시 포화시키면 20번의 킬이 1번처럼 읽힌다
  chainLink3Up: 0.04, // §17 링크 3 이후 (12 §7.3)
  chainCap: 0.55, // §17 연쇄 중 상한 (12 §7.3). 진폭 0.55² × 26 = 7.9u
  bossPartBreak: 0.55, // §17 B3 포문 파괴. large 밴드 진입 직전
  bossPhase: 0.7, // §17 보스 페이즈 전환. large 하단
  playerHit: 0.85, // §17 히트스톱 0.14초와 짝을 이룬다
  bossDeath: 1.0, // §10.1 격파 연출
  shieldBlocked: 0.1, // §7.3 방패병 정면 무효. 아무 일도 안 일어났다는 것이 정보다
  parryWhiff: 0.0, // §5.4 빈 패리 — 점수도 히트스톱도 없다. 연출도 없는 것이 규칙이다
  cooldownReady: 0.0, // §17 초당 4회 이상 반복되므로 흔들면 피로가 된다
} as const satisfies TraumaTable;

/**
 * 파티클. 분포는 균등 링 + 지터다 — 순수 난수 각도는 뭉치고 빈틈을 남긴다.
 *
 *   angle = (2π × i) / count + rng() × angleJitterRad
 *   speed = spreadUPerSec × (distanceMinRatio + rng() × distanceRandRatio)
 *   vx    = cos(angle) × speed
 *   vy    = sin(angle) × speed + initialKickUPerSec
 *
 * 난수는 core/rng.ts를 쓴다. Math.random()은 D-05의 결정론을 깬다.
 *
 * 티어 배정은 §17 표 17행 전부에 걸린다 — NOT BAD 패리·반사탄 발생·자해 유예·빈 패리·쿨다운
 * 종료·무적 종료·예비동작·장판은 small, GOOD 패리·재패리·적 처치는 medium, GREAT 패리·피격·
 * 다수 동시 처치·보스 페이즈 전환은 large다.
 */
export const PARTICLES = {
  small: { count: 8, spreadUPerSec: 160 }, // §17 8개 · 160 u/s
  medium: { count: 18, spreadUPerSec: 260 }, // §17 18개 · 260 u/s
  large: { count: 28, spreadUPerSec: 380 }, // §17 28개 · 380 u/s
  angleJitterRad: 0.6, // §17 균등 링에 더하는 각도 지터 (rad)
  distanceMinRatio: 0.45, // §17 초기 속도의 하한 비율
  distanceRandRatio: 0.55, // §17 초기 속도에 더하는 난수 폭 비율
  initialKickUPerSec: -30, // §17 초기 dy에 더하는 킥 (u/s). 음수라 위로 튄다 — 궤적의 시작 모양을 만든다
  gravityUPerSec2: 260, // §17 지속 중력 (u/s²). 낙하를 만든다 — 초기 킥과 다른 일을 한다
  lifetimeBaseSec: 0.5, // §17 수명의 고정분 (초)
  lifetimeRandSec: 0.4, // §17 수명에 더하는 난수 폭 (초)
  maxAlive: 240, // §17 동시 생존 상한. 넘으면 가장 오래된 것부터 회수한다 (12 §7.4)
  chainLinkCount: 28, // §17 연쇄 링크 하나당 파티클 수
  chainLinkCountAfter4: 12, // §17 링크 4 이상은 이 수로 감쇠한다 (12 §7.4). 28 × 20링크는 화면이 먼저 무너진다
  targetFlashSec: 0.22, // §17 medium 이상에서 대상이 밝아지는 시간 (초)
} as const satisfies ParticleConfig;

/**
 * 임팩트 프레임 — GREAT 패리에서만. 화면 전체를 palette.ts의 baek 단색으로 채운다.
 *
 * 반전 합성(globalCompositeOperation='difference')은 쓰지 않는다 — 합성 모드가 브라우저마다
 * 다르게 그려진다. 잔상 기제는 고대비 전면 전환이 만드는 것이라 단색 채움으로도 그대로 얻는다.
 *
 * 레이어는 탄환층과 플레이어층 사이다(12 §7.1). 최상단에 두면 §15.1이 상시 표시로 못 박은
 * 코어가 durationSec 동안 사라지고, 그 사이 S5 조총탄은 34u를 가서 GREAT 밴드 전체보다 멀리
 * 간다. reduced-motion에서는 끈다.
 */
export const IMPACT_FRAME = {
  durationSec: 0.033, // §17 60fps에서 2프레임 (초). 뒤에 alphaLow 1프레임이 더 붙고 소멸한다
  alphaHigh: 0.88, // §17 앞 2프레임의 알파
  alphaLow: 0.3, // §17 마지막 1프레임의 알파. 진폭이 시작에서 크고 작아지는 규칙과 같은 형태다
  minGapSec: 0.35, // §17 광과민성 방어선 (초). GREAT는 초당 4.16회까지 가능하므로 초당 2.9회 미만으로 제한한다
  delayAfterParrySec: 0.15, // §17 패리 시작 후 이만큼 뒤, 히트스톱 종료 직후에 띄운다 (초)
} as const satisfies ImpactFrameConfig;

/**
 * 집중선 — 한 점으로 수렴하는 선분들. 심사자가 평생 본 문법이고, 자막이 아니라 게임 내
 * 렌더링이라 §7의 자막 트릭 금지에 걸리지 않는다.
 *
 * GOOD·NOT BAD에는 붙이지 않는다. 희소성이 이 신호의 전부다.
 * 각도는 파티클과 같은 균등 링 + 지터이고, 색은 palette.ts의 baek에 lighter 합성이다.
 * 화면이 움직이지 않으므로 reduced-motion에서도 유지한다.
 */
export const SPEED_LINES = {
  parryGreat: { count: 40, durationSec: 0.15 }, // §17 40개 · 0.15초. 수렴점은 패리 성립 위치다
  chainStart: { count: 60, durationSec: 0.15 }, // §17 60개 · 0.15초. 수렴점은 첫 처치 위치다
  bossPhase: { count: 30, durationSec: 0.4 }, // §17 30개 · 0.40초. 수렴점은 보스 중심이다
  startRadiusU: 240, // §17 수렴점에서 이만큼 떨어진 곳부터 그린다 (u). 안쪽이 비어야 시선이 그리로 간다
  endRadiusU: 1400, // §17 화면 밖까지 (u)
  widthBaseU: 3, // §17 선폭의 고정분 (u)
  widthRandU: 11, // §17 선폭에 더하는 난수 폭 (u). 굵기 편차가 밀집 포화선의 성격을 만든다
  angleJitterRad: 0.5, // §17 균등 링에 더하는 각도 지터 (rad)
  alpha: 0.1, // §17 시작 알파. 수명 동안 0으로 ease-out
} as const satisfies SpeedLinesConfig;

/**
 * 장판. 다각형 계수가 여기 있는 이유는 판정과 그림이 같은 도형이어야 하기 때문이다.
 *
 * 목업의 7각형은 반경이 −14% ~ +8.5% 흔들리는데 피해 판정 반경은 하나였다. §17이 "피해 판정
 * 범위와 표시 범위가 일치해야 한다"고 못 박았으므로 그림이 아니라 판정을 고쳤다 — 승인된
 * 목업을 한 픽셀도 안 바꾸고 sim/zones.ts가 이 계수로 만든 외곽선 자체를 판정으로 쓴다
 * (12_통합_계약.md §8-6). render/zone.ts와 sim/zones.ts가 같은 꼭짓점을 만들어야 하고 그
 * 유일한 소스가 이 표다.
 *
 *   꼭짓점 i의 반경 = radiusU × (polyBaseRatio + ((i × polyStrideIndex) % polyModulus) × polyStepRatio)
 *   꼭짓점 i의 각도 = (i / polyVertices) × 2π + polyStartAngleRad
 */
export const ZONE = {
  maxConcurrent: 6, // §9.6 동시 존재 상한. P9와 E06 화공 장판이 공유하고, 초과 시 가장 오래된 것부터 제거한다
  damageIntervalSec: 0.5, // §4.3 진입 즉시 1회, 이후 이 간격으로 반복 판정 (초)
  p9DurationSec: 4.0, // §6.1 화염 장판 P9의 지속 시간 (초). E06 장판은 CardEffect가 자기 값을 갖는다
  polyVertices: 7, // §17 꼭짓점 수
  polyBaseRatio: 0.86, // §17 반경 비율의 하한
  polyStepRatio: 0.025, // §17 계단 한 칸이 더하는 반경 비율
  polyStrideIndex: 37, // §17 꼭짓점 인덱스에 곱하는 보폭
  polyModulus: 11, // §17 계단 수. 보폭 37과 맞물려 꼭짓점 7개가 서로 다른 계단에 놓인다
  polyStartAngleRad: -1.2, // §17 첫 꼭짓점의 각도 (rad)
} as const satisfies ZoneConfig;

/**
 * 머니샷 연쇄의 링크 간 최소 간격 — D-09.
 *
 * 고정 간격이 아니라 최소 간격이다. 반사탄들이 물리적으로 이미 이보다 벌어져 명중하면 지연을
 * 더하지 않는다. 늦추기만 하고 앞당기지는 않는다 — 앞당기면 아직 안 죽은 적이 죽은 것처럼
 * 보인다. 동시에 사라지면 그냥 삭제이고, 순차적이어야 연쇄로 읽힌다.
 *
 * sim은 명중 즉시 처치를 확정하고 render/particles.ts만 어긋나게 재생한다. 최대 연쇄 길이는
 * 저장하지 않는다 — 잡몹 상한 20기에서 (20 − 1) × 이 값으로 유도된다.
 */
export const CHAIN_STAGGER_SEC = 0.04; // §17 초

/**
 * R08 파편이 낸 처치의 파티클 수 — 06_렌더링과_게임필.md §6.3.
 *
 * 파편 처치는 원 처치의 링크 번호를 물려받되 depth +1로 같은 큐에 얹히므로 PARTICLES의
 * 링크 기준 감쇠에 걸리지 않는다. 낮추지 않으면 파편 다중 처치가 화면을 백색으로 채워
 * §2 레이어 계약이 지키려던 코어 판독이 무너진다.
 */
export const PARTICLE_COUNT_SHARD_DEPTH2 = 18; // §17 개
