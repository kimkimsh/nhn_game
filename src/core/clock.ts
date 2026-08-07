/**
 * sim 시계 — 히트스톱은 프레임 건너뛰기가 아니라 시계 정지다
 * (02_아키텍처.md §3 · 12_통합_계약.md §10 E-02).
 *
 * advance()가 realDt에서 정지 잔여분만큼만 빼므로, 프레임 중간에 정지가 끝나면 그 프레임에
 * 남은 sim 시간이 살아남는다. `simDt = hitstopRemaining > 0 ? 0 : realDt`로 쓰면 60Hz에서
 * 가장 짧은 등급의 정지가 +67%로 늘어나고 설계된 등급별 체감 비율이 뭉개진다.
 *
 * **두 시계가 한 파일 안에 섞여 있고 그것이 이 파일의 유일한 함정이다.**
 *   - 정지 길이(`durationSec` · `hitstopRemainingSec`)는 **실시간 초**다. realDt에서 빼는 값이니까.
 *   - 누적 상한을 재는 창은 **sim 초**다. 실시간 창으로 밀면 한 주기가 쿨다운 + 정지 길이가 되어
 *     초당 패리 횟수가 낮게 잡히고, 그러면 상한이 사실상 걸리지 않는다 (02_아키텍처.md §3.1).
 *
 * 그래서 config/parry.ts가 적어 둔 sim 초당 최대 패리 횟수는 sim 시계 값이지 플레이어 체감값이
 * 아니다. 쿨다운을 더 줄이는 카드(R10·E07)를 든 빌드는 이 상한을 넘고, 그때 requestHitstop이
 * 초과분을 잘라 승인된 길이만 돌려준다 — 09_검증_전략.md §3.7이 보는 것이 그 절단이다.
 *
 * core/는 완전 독립이라 config/를 import할 수 없다 (03_파일_구조.md §5). 상한값을 생성 시
 * 주입받는 이유가 그것이고, 넘기는 쪽은 config/feel.ts의 HITSTOP_BUDGET_PER_SEC를 읽는다.
 */

/** 누적 상한을 재는 창의 길이. 주입받는 예산이 "1초당"이라 말하는 그 1초이고, sim 초다 */
const BUDGET_WINDOW_SIM_SEC = 1;

export interface Clock {
  /**
   * 실시간 경과를 sim 경과로 바꾼다. 정지 잔여분이 줄어드는 자리는 여기 하나뿐이다.
   * 프레임마다 정확히 한 번 부른다 — 두 번 부르면 그 프레임에서 정지가 두 배로 소모된다.
   */
  advance(realDtSec: number): number;

  /**
   * 정지를 요청하고 **실제로 승인된 길이**를 돌려준다. 남은 예산보다 길면 잘린 값이 나오고,
   * 예산이 없으면 0이다. 요청한 값을 그대로 쓰면 상한이 없는 것과 같아진다.
   *
   * atSimTimeSec는 누적 sim 시간이다. 실시간을 넣으면 창이 느슨해져 상한이 걸리지 않는다.
   * 호출 시각은 단조 증가해야 한다 — 창을 벗어난 기록은 지워지고 되돌아오지 않는다.
   */
  requestHitstop(durationSec: number, atSimTimeSec: number): number;

  /** atSimTimeSec 기준으로 창 안에 남아 있는, 승인된 정지의 합 */
  budgetUsedSec(atSimTimeSec: number): number;

  /** 아직 소비되지 않은 정지 길이 (실시간 초). 0보다 크면 sim이 멈춰 있다 */
  hitstopRemainingSec(): number;
}

/** 승인 기록 한 건. 시각은 sim 초, 길이는 실시간 초다 */
interface BudgetEntry {
  atSimTimeSec: number;
  grantedSec: number;
}

interface ClockState {
  hitstopRemainingSec: number;
  budgetWindow: BudgetEntry[];
}

/**
 * 창을 벗어난 기록을 앞에서 잘라내고 남은 것을 합한다.
 * 기록이 시각 오름차순으로만 들어온다는 전제에 기대므로, 첫 생존 기록에서 멈춰도 된다.
 */
function usedWithinWindow(budgetWindow: BudgetEntry[], atSimTimeSec: number): number {
  const cutoffSimSec = atSimTimeSec - BUDGET_WINDOW_SIM_SEC;
  let expired = 0;
  for (const entry of budgetWindow) {
    if (entry.atSimTimeSec > cutoffSimSec) {
      break;
    }
    expired += 1;
  }
  budgetWindow.splice(0, expired);

  let usedSec = 0;
  for (const entry of budgetWindow) {
    usedSec += entry.grantedSec;
  }
  return usedSec;
}

/**
 * hitstopBudgetPerSimSec — sim 1초당 승인할 수 있는 정지의 총합 (초).
 * config/feel.ts의 HITSTOP_BUDGET_PER_SEC를 넘긴다. 기본값을 두지 않는 것은 의도다 —
 * 기본값은 config/의 숫자를 core/에 한 벌 더 두는 것이고, 두 벌은 조용히 어긋난다.
 */
export function createClock(hitstopBudgetPerSimSec: number): Clock {
  const state: ClockState = { hitstopRemainingSec: 0, budgetWindow: [] };

  return {
    advance(realDtSec: number): number {
      const freezeSec = Math.min(realDtSec, state.hitstopRemainingSec);
      state.hitstopRemainingSec -= freezeSec;
      return realDtSec - freezeSec;
    },

    requestHitstop(durationSec: number, atSimTimeSec: number): number {
      const remainingBudgetSec =
        hitstopBudgetPerSimSec - usedWithinWindow(state.budgetWindow, atSimTimeSec);
      const grantedSec = Math.min(durationSec, remainingBudgetSec);
      if (grantedSec <= 0) {
        return 0;
      }
      state.budgetWindow.push({ atSimTimeSec, grantedSec });
      state.hitstopRemainingSec += grantedSec;
      return grantedSec;
    },

    budgetUsedSec(atSimTimeSec: number): number {
      return usedWithinWindow(state.budgetWindow, atSimTimeSec);
    },

    hitstopRemainingSec(): number {
      return state.hitstopRemainingSec;
    },
  };
}
