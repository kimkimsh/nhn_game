/**
 * 수학 유틸 — clamp · lerp · 이징 · 프레임률 독립 지수 감쇠.
 *
 * 이식: docs/sample_image/_shared/engine.js clamp (76) · lerp (77) · easeOut (78)
 *
 * 목업에는 cubic ease-out 하나뿐이라, 06 §4.7이 요구한 나머지 세 곡선을 같은 파일에 둔다.
 *
 * 이징 네 개는 전부 정규화 구간 [0,1]에서 정의되고 입력 t를 안에서 클램프한다 — 수명을
 * 넘긴 프레임이 곡선 밖으로 나가지 않게 하려는 것이다. 출력은 클램프하지 않는다:
 * easeOutBack이 1을 넘겼다 되돌아오는 것은 그 곡선의 정의지 오차가 아니다.
 */

/** cubic 곡선 둘이 공유하는 지수 */
const CUBIC_EXPONENT = 3;

/**
 * ease-out-back의 표준 계수(easings.net의 c1·c3 그대로).
 * c1이 되돌아오는 양이고, c3은 3차 항에 붙는다.
 */
const EASE_BACK_C1 = 1.70158;
const EASE_BACK_C3 = EASE_BACK_C1 + 1;

/** 이식: engine.js clamp (76) */
export function clamp(value: number, minValue: number, maxValue: number): number {
  return value < minValue ? minValue : value > maxValue ? maxValue : value;
}

/** 진행도(경과 / 전체)를 이징에 넣기 전에 자르는 자리. 이징이 안에서도 이걸 부른다 */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * 이식: engine.js lerp (77)
 *
 * t를 클램프하지 않는다. 목업이 그렇고, 구간 밖 외삽을 쓰는 곳이 있다.
 * 진행도로 쓸 때는 부르는 쪽이 clamp01을 먼저 건다.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 이식: engine.js easeOut (78). 목업에서 `easeOut`이라 부르던 곡선이 이것이다 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), CUBIC_EXPONENT);
}

/** 06 §4.7 — 적 퇴장(F-1~F-6)의 출발 곡선 */
export function easeInCubic(t: number): number {
  return Math.pow(clamp01(t), CUBIC_EXPONENT);
}

/** 06 §4.7 — 보스 등장 카메라 팬 */
export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
}

/**
 * 06 §4.7 — 등급 팝업 등장.
 *
 * 반환값이 1을 넘는 구간이 있다. 이 곡선을 강체(환도·탄환·반사탄·보스 본체)에 걸면
 * 잘못된 재질이 전달되므로 UI에만 쓴다.
 */
export function easeOutBack(t: number): number {
  const x = clamp01(t) - 1;
  return 1 + EASE_BACK_C3 * Math.pow(x, CUBIC_EXPONENT) + EASE_BACK_C1 * x * x;
}

/**
 * 지수 감쇠의 보간 가중치 — `1 − exp(−decayPerSec · dtSec)`.
 *
 * 스칼라가 아닌 것(색·2D 벡터)을 따라가게 할 때 이 가중치를 직접 받아 쓴다.
 * 스칼라라면 damp가 이미 이 값을 쓴다.
 */
export function dampFactor(decayPerSec: number, dtSec: number): number {
  return 1 - Math.exp(-decayPerSec * dtSec);
}

/**
 * current가 target을 따라가게 한다. 06 §4.7이 지정한 프레임률 독립 형태다.
 *
 * `lerp(current, target, 0.1)`을 매 프레임 쓰면 60fps와 144fps에서 감속 곡선이 갈라진다.
 * HR-06이 프레임 수 기반 시간을 금지하고 D-04가 sim을 고정 스텝으로 못 박은 이유가
 * 프레임률을 판정에서 떼어 놓으려는 것인데, 렌더 쪽 따라가기가 프레임률에 묶이면
 * 같은 금이 반대편에서 다시 간다.
 */
export function damp(current: number, target: number, decayPerSec: number, dtSec: number): number {
  return current + (target - current) * dampFactor(decayPerSec, dtSec);
}
