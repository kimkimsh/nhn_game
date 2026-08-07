/**
 * 고정 스텝 누산기 — 02_아키텍처.md §1의 그림 그대로다.
 *
 *   realDt → clock.advance → beginFrame → 누산 → 고정 스텝 while → alpha → render
 *
 * 그림에서 값을 하는 것은 세 자리다.
 *
 * **beginFrame이 while 밖이다.** 히트스톱은 sim 시간을 멈추므로 정지 중에는 스텝이 한 번도
 * 돌지 않는다. 루프 안에 넣으면 정지 동안 입력을 아예 받지 못하고, 그러면 정지가 풀리는 순간
 * 발동해야 할 선입력이 사라져 높은 등급 직후의 연속 패리가 구조적으로 불가능해진다
 * (02 §1 · 12_통합_계약.md §10 E-03).
 *
 * **render는 realDt를, step은 FIXED_DT_SEC를 받는다.** 파티클 수명·팝업 상승·화면 흔들림
 * 감쇠는 연출이라 실시간이고, 탄환 위치·쿨다운·무적은 규칙이라 고정 스텝이다. 섞으면
 * 프레임률이 판정에 영향을 주고 그게 HR-06이 금지한 것이다.
 *
 * **스텝 상한에 걸리면 남은 누산분을 버린다.** 다음 프레임으로 넘기면 밀린 만큼을 따라잡느라
 * 다음 프레임이 더 밀리고, 그 반복이 게임을 멈춰 세운다. 버린 사실은 runFrame의 반환값
 * droppedSimSec으로 드러난다 — 이 경로는 밖에서 봐야 검증할 수 있다.
 *
 * core/는 완전 독립이라 config/를 import하지 않는다 (03_파일_구조.md §5). 아래 세 상수는
 * config/에 자리가 없고 이 파일이 단일 소스다.
 */
import type { Clock } from './clock';
import { clamp } from './math';

/**
 * 고정 스텝 (초). D-04 · 02 §2.1 — 가장 좁은 등급 밴드 안에 표본 두 개가 들어가는 첫 지점이다.
 * 스텝 수로 세는 타이머는 어디에도 두지 않는다. 이 값은 초 단위 감산에만 쓰인다 (HR-06).
 */
export const FIXED_DT_SEC = 1 / 120;

/** 한 프레임이 도는 최대 스텝 수. 02 §1 — 여기 걸리면 남은 sim 시간을 버린다 */
export const MAX_STEPS_PER_FRAME = 5;

/** realDt 상한 (초). 02 §1 — 탭에서 돌아왔을 때 몇 초가 한 프레임에 밀려드는 것을 막는다 */
export const MAX_REAL_DT_SEC = 0.25;

const MILLIS_PER_SEC = 1000;

export interface FrameHooks {
  /**
   * 키 상태 스냅샷과 press edge 확정. 히트스톱 중에도 매 프레임 불린다.
   * 눌린 사실만 여기서 받고, 그 뒤의 시간 셈은 전부 sim 시계로 한다 (12 §10 E-03).
   */
  beginFrame(): void;
  /** 게임 규칙 전부. 인자는 언제나 FIXED_DT_SEC다 */
  step(fixedDtSec: number): void;
  /** 픽셀 전부. alpha는 스텝 사이 보간 계수, realDtSec는 연출 타이머용 실시간이다 */
  render(alpha: number, realDtSec: number): void;
}

export interface FrameResult {
  /** 상한을 적용한 뒤의 실시간 경과 (초). render가 받은 값과 같다 */
  realDtSec: number;
  /** 히트스톱 잔여분을 뺀 sim 경과 (초) */
  simDtSec: number;
  /** 이 프레임이 실제로 돈 고정 스텝 수 */
  steps: number;
  /** 스텝 상한에 걸려 버린 sim 시간 (초). 0보다 크면 버리기 경로가 탔다는 뜻이다 */
  droppedSimSec: number;
  /** 누산 잔여분 ÷ FIXED_DT_SEC. 버린 프레임에서는 0이다 */
  alpha: number;
}

export interface LoopSpec {
  clock: Clock;
  hooks: FrameHooks;
}

export interface Loop {
  /** rAF 구동을 시작한다. 이미 돌고 있으면 아무 일도 하지 않는다 */
  start(): void;
  stop(): void;
  /**
   * 한 프레임분을 직접 돌린다. start()가 부르는 것도 이 함수이고,
   * rAF 없이 프레임을 먹일 수 있는 유일한 입구다.
   */
  runFrame(elapsedRealSec: number): FrameResult;
}

export function createLoop(spec: LoopSpec): Loop {
  const clock = spec.clock;
  const hooks = spec.hooks;

  let accumulatorSec = 0;
  let rafHandle: number | null = null;
  let lastFrameMs: number | null = null;

  function runFrame(elapsedRealSec: number): FrameResult {
    const realDtSec = clamp(elapsedRealSec, 0, MAX_REAL_DT_SEC);
    const simDtSec = clock.advance(realDtSec);

    hooks.beginFrame();

    accumulatorSec += simDtSec;
    let steps = 0;
    while (accumulatorSec >= FIXED_DT_SEC && steps < MAX_STEPS_PER_FRAME) {
      hooks.step(FIXED_DT_SEC);
      accumulatorSec -= FIXED_DT_SEC;
      steps += 1;
    }

    // 스텝 수가 아니라 잔여분으로 판정한다 — 딱 상한만큼 돌고 잔여분이 한 스텝에 못 미치는
    // 프레임은 밀린 것이 아니고, 그 잔여분은 alpha로 살려야 한다
    let droppedSimSec = 0;
    if (accumulatorSec >= FIXED_DT_SEC) {
      droppedSimSec = accumulatorSec;
      accumulatorSec = 0;
    }

    const alpha = accumulatorSec / FIXED_DT_SEC;
    hooks.render(alpha, realDtSec);

    return { realDtSec, simDtSec, steps, droppedSimSec, alpha };
  }

  function onAnimationFrame(nowMs: number): void {
    // 다음 프레임을 먼저 건다. 훅이 던져도 루프가 죽지 않고, 훅 안에서 부른 stop()은
    // 방금 건 handle을 취소하므로 멈춤도 정상으로 동작한다
    rafHandle = window.requestAnimationFrame(onAnimationFrame);
    const elapsedRealSec = lastFrameMs === null ? 0 : (nowMs - lastFrameMs) / MILLIS_PER_SEC;
    lastFrameMs = nowMs;
    runFrame(elapsedRealSec);
  }

  return {
    start(): void {
      if (rafHandle !== null) {
        return;
      }
      // 멈춰 있던 동안 흐른 실시간을 첫 프레임에 몰아 넣지 않는다
      lastFrameMs = null;
      rafHandle = window.requestAnimationFrame(onAnimationFrame);
    },

    stop(): void {
      if (rafHandle === null) {
        return;
      }
      window.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    },

    runFrame,
  };
}
