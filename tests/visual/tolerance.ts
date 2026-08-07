/**
 * 하네스의 손잡이 둘 — 09 §5.4-2.
 *
 * **이 값들은 스펙 값이 아니다.** 09 §5.4가 그렇게 못 박았다 — "채널당 허용 오차와 허용 픽셀
 * 비율은 하네스의 조절 손잡이이지 스펙 값이 아니며, 첫 초록불에서 실측해 고정한다."
 *
 * 그래서 아래 값은 아직 **잠정**이다. 실측이 성립하려면 게임 렌더러가 6장을 실제로 그려야 하고,
 * 그 전에는 비교 대상이 없다. `measuredAt`이 null인 동안 하네스는 판정을 내리지 않고 수치만
 * 리포트에 싣는다 — 그것이 09 §5.4의 "하네스의 역할은 어디가 달라졌는지 좁혀 주는 것"이다.
 *
 * 잠정값을 0이 아닌 수로 둔 이유: 캔버스 2D의 곡선 래스터화가 브라우저와 GPU에 따라 1~2 단계
 * 다르다(§5.4-2). 0으로 두면 첫 실행이 전부 빨강으로 나와 실측 자체를 못 한다.
 */

export interface ToleranceKnobs {
  /** 손잡이 ① 채널당 허용 오차 (0~255). 이 값 이하의 차는 같은 픽셀로 센다 */
  readonly channelDelta: number;
  /** 손잡이 ② 허용 픽셀 비율 (0~1). 마스크를 뺀 픽셀 중 이 비율까지는 사람이 볼 것도 없다 */
  readonly maxDiffRatio: number;
  /**
   * 실측한 날. **null이면 잠정값이다.**
   *
   * 09 §5.4의 절차는 이렇다 — 게임 렌더러가 6장을 그리고, 사람이 그 결과를 눈으로 통과시키고,
   * 그때 관측된 `maxChannelDelta`와 `diffRatio`를 여기에 옮겨 적는다. 사람의 통과가 먼저다.
   * 숫자를 먼저 넣고 초록불을 만드는 것은 §5.4가 금지한 순서다.
   */
  readonly measuredAt: string | null;
}

export const TOLERANCE: ToleranceKnobs = {
  channelDelta: 2,
  maxDiffRatio: 0.002,
  measuredAt: null,
};

/**
 * 재현성 측정용 손잡이. 같은 목업 프레임을 두 번 띄워 대조할 때 쓴다.
 *
 * 여기는 0이다 — 같은 브라우저·같은 GPU에서 같은 결정론적 프레임을 두 번 그리면 비트가
 * 같아야 한다. 0이 아닌 값이 나오면 그것은 허용 오차를 늘릴 근거가 아니라 **목업이나 브라우저가
 * 결정론적이지 않다는 발견**이고, 그 상태에서 잡은 기준선은 아무것도 잠그지 못한다.
 */
export const REPEAT_TOLERANCE: ToleranceKnobs = {
  channelDelta: 0,
  maxDiffRatio: 0,
  measuredAt: null,
};
