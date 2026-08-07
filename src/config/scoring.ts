/**
 * 점수·콤보 파라미터 — 스펙 §12.1 · §12.2
 *
 * 등급별 패리 점수는 여기 없다 — parry.ts의 PARRY_BANDS[].score가 단일 소스이고, 잡몹 처치
 * 점수는 enemies.ts의 ENEMIES[].score가 갖는다. 재패리 점수 25 / 75 / 200도 적지 않는다.
 * 등급 점수 × reparryRatio로 유도되는 값이라, 밴드 점수를 고치면 여기 적힌 셋만 옛 숫자로 남는다.
 *
 * COMBO_WARN_SEC이 이 파일에 있는 이유는 소비자가 둘이라서다. 콤보 게이지가 적색으로 바뀌는
 * 시각(render)과 경고 3핍이 울리는 시각(audio)이 같은 순간이어야 하는데, 06과 07이 각각
 * 0.6초와 0.8초로 갈렸던 자리다. 화면과 소리가 다른 순간에 경고하면 둘 다 신호가 아니라
 * 잡음이 된다(12_통합_계약.md §8-5).
 *
 * 경고 구간의 비율은 저장하지 않는다. COMBO_WARN_SEC / 실효 comboHoldSec으로 유도해야 N11이
 * 유지 시간을 늘렸을 때 게이지와 경고음이 함께 따라온다 — 비율을 상수로 박으면 4.5초짜리
 * 빌드에서 게이지가 1.5초 일찍 적색이 된다(08_화면과_UI.md §2.5 B).
 */
import type { ComboConfig, ScoringConfig } from './types';

export const SCORING = {
  reparryRatio:      0.5,     // §12.1 등급 점수에 곱하는 비율. NOT BAD 25 / GOOD 75 / GREAT 200이 여기서 나온다
  bossPhaseChange:   2_000,   // §12.1 점. 페이즈 전환 1회당
  bossKill:          10_000,  // §12.1 점. 보스 격파
  stageClearPerLife: 2_000,   // §12.1 점. 클리어 보너스 = 남은 라이프 × 이 값. S5 클리어에도 걸린다
} as const satisfies ScoringConfig;

export const COMBO = {
  holdSec:     3.0,   // §12.2 초. 마지막 패리 성공 후 유지 시간. N11이 늘리므로 HUD의 분모는 실효값이다
  multStep:    10,    // §12.2 콤보가 이 수만큼 오를 때마다 배수가 한 칸 오른다
  multPerStep: 0.1,   // §12.2 배수 = 1.0 + floor(콤보 / multStep) × 이 값
  multMax:     3.0,   // §12.2 배수 상한. 콤보 200에서 닿는다
} as const satisfies ComboConfig;

/**
 * §12.2 콤보 유지 시간이 이만큼 남으면 경고 상태
 *
 * COMBO 표 안이 아니라 밖에 있는 것은 ComboConfig에 이 칸이 없어서이고, 칸이 없는 것은
 * 이 값이 콤보 규칙이 아니라 §17의 피드백 요구사항이기 때문이다. render와 audio가 이 하나를
 * 같이 읽는다(12_통합_계약.md §8-5).
 */
export const COMBO_WARN_SEC = 0.8;   // §12.2 초
