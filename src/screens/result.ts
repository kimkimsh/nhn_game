/**
 * 결과 화면 — 스펙 §12.3(항목) · §15.3 · §16.3(입력) · §18.5, 08 §5. 그림은 `13_result/scene.js`.
 *
 * §15.3은 한 줄이다 — 「§12.3의 항목 전체를 표시한다.」 그러므로 이 화면의 완료 정의는 §12.3의
 * 아홉 항목이 전부 화면에 있는 것이다. 그중 여덟(총점 · 도달 스테이지 · 최대 콤보 · 등급별
 * 횟수 · 성공률 · 재패리 · 반사탄 자해 라이프 · 획득 카드 · 오염 여부)은 `result-view.ts`가
 * 그리고, 이 파일은 메뉴와 확정 단계와 입력을 갖는다 (한 파일 400줄 상한).
 *
 * ── 목업이 스펙과 어긋난 셋째 곳 (08 §5.5) ──────────────────────────────────────
 *
 * 목업은 `R  다시 한 판` · `ESC  타이틀로`를 **가로로** 놓았다. §16.2에서 `R`은 카드 선택
 * 화면의 리롤이고 §16.3에서 `Esc`는 일시정지의 「즉시 계속하기」에만 배정돼 있다. 그리고
 * 항목 이동이 ↑ ↓ · `W` · `S`이므로 항목은 세로로 쌓인다. 그래서 여기 두 항목은 세로이고,
 * 상자 규격은 일시정지 메뉴와 같은 것을 쓴다 — 두 화면이 같은 조작을 받으므로 같은 모양이다.
 *
 * ── 「다시 하기」에는 확정 단계가 붙는다 (§16.3) ────────────────────────────────
 *
 * 목업에는 없다. 규칙은 08 §4.5와 같다 — 메뉴를 확정 패널로 교체하고 기본 커서는 「아니오」다.
 * 다시 하기가 하는 일은 §13.3이며(스테이지 1부터, 카드 전부 소실, 라이프·점수·콤보·리롤
 * 사용 여부·오염 표시 초기화) 그 전부를 `manager.ts`의 T-15가 수행한다.
 */

import { UI } from '../config/ui';
import type { InputPress } from '../core/input';
import type { Run } from '../sim/run';
import {
  applyMenuHover, applyMenuPress, createMenuState, drawHintLine, drawMenu, formatCount,
  layoutMenu, resetMenuState, type MenuState,
} from './menu';
import type { Screen, ScreenHost } from './registry';
import { paintResultBody } from './result-view';

const RESULT = UI.result;

/**
 * 메뉴 마지막 상자 아래로 조작 안내까지 (u)와 그 아래 한 줄까지 (u).
 *
 * `UI.result.noteBaselineYU`(1740)는 목업이 상자 둘을 **가로로** 놓았을 때의 값이다. 08 §5.5가
 * 세로 배치로 판정했으므로 상자 둘은 `menuFirstYU`(1560)에서 1748까지 내려가 그 값과 겹친다.
 * 아래 두 줄은 마지막 상자에서 내려 잡되 config 값을 하한으로 쓴다 — `ui.ts`의 값이 다시
 * 커지면 그때부터 config가 그대로 이긴다. 간격 50u는 일시정지의 안내(1636) → 경고(1686)와 같다.
 */
const HINT_GAP_BELOW_MENU_U = 40;
const NOTE_GAP_BELOW_HINT_U = 50;

const MENU_HINT = '↑ ↓  항목 이동      Enter  실행';
const MENU_LABELS: readonly string[] = ['다시 하기', '타이틀로'];
/** §16.3이 결과 화면에 `Esc`를 배정하지 않았으므로(08 §5.5) 취소는 「아니오」 하나뿐이다 */
const CONFIRM_LABELS: readonly string[] = ['아니오', '예, 다시 한다'];
/** 08 §5.5 — 확정 패널이 뜨기 전에 결과를 미리 알려 주는 유일한 문장이다. 지우지 않는다 */
const NOTE_TEXT = '재시작하면 카드는 전부 사라지고 스테이지 1부터 시작한다.';

const ITEM_RESTART = 0;
const ITEM_TO_TITLE = 1;
/**
 * 확정 패널의 「예」 자리 (08 §4.5). 0번은 「아니오」이고 커서는 거기서 열린다 —
 * 파괴적 항목을 기본값으로 두면 확정 단계가 `Enter` 두 번으로 축소돼 없는 것과 같아진다.
 */
const CONFIRM_YES = 1;

/**
 * 마지막 `update` 이후 이만큼 지났으면 화면이 닫혔다 다시 열린 것으로 본다 (ms).
 *
 * 커서를 「다시 하기」로, 확정 패널을 닫힌 채로 되돌리려면 진입 신호가 필요한데
 * `registry.ts`의 `Screen` 계약에 그런 칸이 없고 `manager.ts`가 화면 객체를 런이 바뀌어도
 * 계속 재사용한다. 프레임이 이어지고 있는지가 유일하게 남은 신호다. `loop.ts`의 realDt 상한
 * 0.25초보다 넉넉히 크게 잡아 한 프레임 지연을 재진입으로 오인하지 않게 한다.
 */
const REENTRY_GAP_MS = 400;

/** §13.3 다시 하기가 버리는 것을 숫자로. 08 §4.5의 확정 단계 규칙이 여기에도 그대로 걸린다 */
function confirmNoteText(run: Run): string {
  let stacks = 0;
  for (const held of run.cards) {
    stacks += held.stack;
  }
  const score = formatCount(run.world.run.score);
  return `카드 ${stacks}장 · 점수 ${score} · 도달 스테이지 ${run.stageId} — 전부 초기화된다. 되돌릴 수 없다.`;
}

export function createResultScreen(host: ScreenHost): Screen {
  const state: MenuState = createMenuState();
  let confirming = false;
  let lastUpdateMs = Number.NEGATIVE_INFINITY;

  function labels(): readonly string[] {
    return confirming ? CONFIRM_LABELS : MENU_LABELS;
  }

  /** 확정 패널을 열고 닫을 때마다 커서를 되돌린다. 08 §4.5의 「기본 커서는 아니오」가 그것이다 */
  function setConfirming(next: boolean): void {
    confirming = next;
    resetMenuState(state);
  }

  function execute(index: number): void {
    if (confirming) {
      if (index === CONFIRM_YES) {
        host.request({ kind: 'restart' });
      }
      // 「예」 뒤에도 패널을 닫는다. 전이는 매니저가 이 프레임 끝에 하지만, 그 전이가 어떤
      // 이유로든 안 일어났을 때 화면이 스스로 못 빠져나오는 상태에 남으면 안 된다
      setConfirming(false);
      return;
    }
    if (index === ITEM_RESTART) {
      setConfirming(true);
      return;
    }
    if (index === ITEM_TO_TITLE) {
      // §16.3이 확정 단계를 요구한 것은 「런 포기」와 「다시 하기」 둘뿐이다. 런은 이미 끝났고
      // 타이틀로 가는 것이 버리는 것은 지금 보고 있는 이 화면뿐이다
      host.request({ kind: 'toTitle' });
    }
  }

  return {
    paint(ctx: CanvasRenderingContext2D): void {
      const run = host.run();
      if (run === null) {
        return;
      }
      ctx.save();
      ctx.textBaseline = 'alphabetic';
      paintResultBody(ctx, run);
      const layout = layoutMenu(RESULT.menuFirstYU, labels().length);
      drawMenu(ctx, layout, labels(), state.cursor);
      const hintYU = layout.bottomYU + HINT_GAP_BELOW_MENU_U;
      drawHintLine(ctx, hintYU, MENU_HINT);
      drawHintLine(
        ctx,
        Math.max(RESULT.noteBaselineYU, hintYU + NOTE_GAP_BELOW_HINT_U),
        confirming ? confirmNoteText(run) : NOTE_TEXT,
      );
      ctx.restore();
    },

    update(presses: readonly InputPress[]): void {
      const nowMs = performance.now();
      if (nowMs - lastUpdateMs > REENTRY_GAP_MS) {
        setConfirming(false);
      }
      lastUpdateMs = nowMs;
      if (host.run() === null) {
        return;
      }
      const layout = layoutMenu(RESULT.menuFirstYU, labels().length);
      applyMenuHover(state, layout, host.input.pointer);
      for (const press of presses) {
        // §16.2의 `R`(리롤)과 §16.3의 `Esc`는 이 화면에 배정되지 않았다 (08 §5.5). 그 눌림이
        // 여기까지 오더라도 applyMenuPress가 이동·실행 어느 쪽으로도 해석하지 않는다
        const chosen = applyMenuPress(state, layout, press);
        if (chosen !== null) {
          execute(chosen);
          // 확정 패널이 열리거나 닫히면 항목 수가 바뀐다. 같은 프레임의 다음 눌림을 옛 배치로
          // 해석하면 「예」 자리에 있던 좌표가 다른 항목을 실행한다
          return;
        }
      }
    },
  };
}
