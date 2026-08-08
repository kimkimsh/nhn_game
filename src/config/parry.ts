/**
 * 패리 파라미터 — 스펙 §5.1 · §5.3 · §11.6
 *
 * 이 파일이 게임의 손맛을 통째로 정한다. 쿨다운을 내리면 난사 감각이 되고, 등급 밴드를 넓히면
 * GREAT가 흔해진다. 다만 INV_1_MARGIN_SEC와 INV_2_RATIO는 수치가 아니라 제약이므로 바꾸지 않는다 —
 * 이 둘이 깨지면 sim/guards.ts가 개발 빌드에서 오류를 낸다.
 *
 * 등급별 히트스톱도 여기 있다. PARRY_BANDS[].hitstopSec가 단일 소스이고 feel.ts는 그 셋을 갖지
 * 않는다(12_통합_계약.md §5). feel.ts에 남는 것은 피격 히트스톱과 누적 상한뿐이다.
 */
import { REFLECT } from './reflect';
import type { ParryConfig, ParryBand, HardLimits } from './types';

export const PARRY = {
  radiusU:      120,    // §5.1 패리 원 반경 (u), 플레이어 중심 기준
  activeSec:    0.15,  // §5.1 활성 시간 (s). 누르고 있어도 연장되지 않는다
  cooldownSec:  0.24,  // §5.1 쿨다운 (s), 활성 시작 시점 기준 → sim 초당 최대 4.16회.
                       //      4.16회는 sim 시계 값이고 플레이어 체감값이 아니다 — 히트스톱이 멈춰
                       //      세운 시간까지 세는 실시간에서는 3.175회/초다 (02_아키텍처.md §3.1)
  bufferSec:    0.12,  // §5.1 선입력 버퍼 (s). 쿨다운 종료 이만큼 전부터 입력을 받아 둔다
  invulnSec:    0.14,  // §5.1 무적 (s) — 패리가 성립했을 때만. 빈 패리는 무적이 없다(§5.4)
} as const satisfies ParryConfig;

/**
 * §5.1 재입력 불가 (s) = cooldownSec − activeSec.
 *
 * 리터럴로 저장하지 않는다 — 둘 중 하나만 고치고 이 값을 잊으면 두 숫자가 조용히 어긋나고,
 * 그 어긋남은 타입이 못 잡는다(12_통합_계약.md §5). 뺄셈 한 줄이 그 실수를 구조적으로 없앤다.
 */
export const PARRY_LOCKOUT_SEC = PARRY.cooldownSec - PARRY.activeSec;

/**
 * §5.3 등급 밴드. 반드시 좁은 것부터 나열한다 —
 * 판정이 "거리 d를 덮는 첫 밴드"를 고르므로 배열 순서가 곧 판정 우선순위다.
 *
 * 마지막 밴드의 maxDistU는 null이고 "패리 반경까지"를 뜻한다. sim/stats.ts가 스냅샷을 만들 때
 * 실효 parryRadiusU로 채운다. 숫자를 적어 두면 반경을 키우는 카드에서 등급 없는 고리가 생긴다 —
 * N03 3중첩(+18u)과 R09(+18u)로 반경이 156u가 되면 적어 둔 값과 156 사이가 C1은 통과하는데 어느
 * 밴드에도 안 걸리고, 등급이 없으면 데미지 배수·히트스톱·점수·무적이 전부 미정의다
 * (12_통합_계약.md §10 E-06).
 */
export const PARRY_BANDS = [
  { id: 'GREAT',   maxDistU: 28,   damageMul: 3.5, speedMul: 2.6, hitstopSec: 0.02, shakeAmplitudeU: 4, score: 400 },
  { id: 'GOOD',    maxDistU: 48,   damageMul: 2.0, speedMul: 1.8, hitstopSec: 0.02,  shakeAmplitudeU: 4, score: 150 },
  { id: 'NOT_BAD', maxDistU: null, damageMul: 1.0, speedMul: 1.3, hitstopSec: 0.02,  shakeAmplitudeU: 2, score: 50  },
] as const satisfies readonly ParryBand[];

/**
 * §5.1 불변 조건. 카드 효과를 전부 합산한 뒤 검사하며(§11.6 7·8단계), 위반 시 각각 쿨다운을
 * 늘리고 무적을 자른다.
 *
 * INV-1  쿨다운 ≥ 활성 + 0.05초
 *        활성 구간이 빈틈없이 이어지면 버튼을 계속 누르고 있는 것과 같아져 입력이 무의미해진다.
 * INV-2  패리 무적 ≤ 쿨다운 × 0.75
 *        탄이 계속 공급되는 구간에서 무적이 100% 이어지는 것을 막는다.
 *        무적만 잘리고 패리 판정 창 자체는 활성 시간 전체에서 정상 동작한다.
 */
export const INV_1_MARGIN_SEC = 0.05;      // §5.1 INV-1 최소 간극 (s)
export const INV_2_RATIO      = 0.75;      // §5.1 INV-2 무적 점유 상한 (쿨다운 대비 비율)
export const INV_1_MARGIN_E07_SEC = 0.04;  // §11.5 E07만 이 값을 쓴다. INV-1을 건너뛰는 유일한 예외

/**
 * §11.6 5단계의 개별 상한. 어떤 카드 조합으로도 넘을 수 없다.
 *
 * reflectSpeedMaxUPerSec는 숫자가 아니라 reflect.ts를 가리키는 식이다. 스펙이 이 상한을 §7.1
 * 반사탄 항목에서 정했고 §11.6은 카드가 그 상한을 넘지 못한다고만 말한다 — 소유자가 §7.1인
 * 이상 여기는 그것을 다시 적을 자리가 아니다.
 */
export const HARD_LIMITS = {
  cooldownMinSec:         0.15,  // §11.6 쿨다운 하한 (s). 다만 실효 하한은 대개 INV-1이 먼저 정한다
  // 카드 최대치 156(기본 120 + N03 3중첩 18 + R09 18) 위에 24u를 남긴 값이다. 반경 카드가
  // 하나 더 붙거나 N03의 maxStack이 오르면 여기를 다시 세운다
  parryRadiusMaxU:        180,   // §11.6 패리 반경 상한 (u)
  moveSpeedMaxUPerSec:    900,   // §11.6 이동 속도 상한 (u/s)
  // §7.1 반사탄 속도 상한 (u/s)
  reflectSpeedMaxUPerSec: REFLECT.speedMaxUPerSec,
} as const satisfies HardLimits;
