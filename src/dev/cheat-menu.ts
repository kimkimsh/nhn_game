/**
 * 치트 메뉴 — 스펙 §18 전체, 08_화면과_UI.md §8. 05_시스템_설계.md §14.
 *
 * **조작하는 것은 진행 상태뿐이다.** 어느 스테이지에 있는지, 어떤 카드를 들고 있는지, 라이프가
 * 몇인지를 정할 수 있을 뿐이고 전투 규칙은 하나도 바뀌지 않는다(§18.1). 그것을 검사가 아니라
 * 구조로 보장한다 — 이 파일이 sim에 쓰는 경로는 `setCards` · `setLives` 둘과, 화면 전환을
 * 동반하므로 매니저를 거치는 `jumpTo`(T-14) 하나뿐이다. 스테이지 파라미터를 넘길 통로 자체가
 * 없으므로 §14.1의 적 HP 배율·탄속 배율·예비동작 시간·동시 탄환 상한은 치트로 건너뛰어도
 * 정상값이다. 무적·원턴킬·탄환 소거·최대 중첩 초과는 부를 함수가 없어서 불가능하다(08 §8.5).
 *
 * ── 스테이지 진입만 Enter를 요구한다 (08 §8.2) ──────────────────────────────────
 *
 * 카드와 라이프는 변경 즉시 반영된다. 값을 하나 올리고 실효 수치 표가 어디서 잘리는지를
 * **입력과 같은 프레임에** 보는 것이 §18.4가 "이 기능의 핵심"이라고 부른 동작이고, 여기에
 * 확정 단계를 붙이면 그 루프가 두 배로 길어진다. 스테이지·진입 지점·보스 페이즈만 화면 전환을
 * 동반하므로 Enter로 적용한다. Enter는 커서가 어느 줄에 있든 같은 일을 한다 — §16.4가 준
 * 「적용」은 하나뿐이고, 줄마다 뜻이 달라지면 하단 안내 한 줄로 적을 수 없는 규칙이 된다.
 *
 * ── 카드는 자동 지급되지 않는다 (§18.3) ─────────────────────────────────────────
 *
 * S1에서 S5로 점프하면 정상 플레이라면 4장을 들고 있을 시점이지만 자동 추첨해 주지 않는다.
 * 무작위가 섞이면 같은 조건을 두 번 재현할 수 없고, 실측에 필요한 것은 "그럴듯한 빌드"가
 * 아니라 "지정한 빌드"다. 그래서 카드는 좌열의 31행에서 직접 쌓는다.
 *
 * ── 런이 없으면 카드와 라이프를 못 바꾼다 ───────────────────────────────────────
 *
 * 타이틀에서도 열 수 있는데(§18.2) 그때는 카드를 담을 런이 없다. 여기서 임시 목록을 들고
 * 있다가 나중에 밀어 넣으면 보유 카드의 소유자가 둘이 되고 §11.6이 언제 다시 도는지가
 * 흐려진다. 대신 Enter로 스테이지에 들어가면 매니저가 런을 세우고(T-14b) 메뉴는 열린 채로
 * 남으므로, 그 다음 프레임부터 좌열의 카드 행이 살아난다.
 *
 * 오염 표시(§18.5)를 세우는 것은 이 파일이 아니다. `screens/manager.ts`가 메뉴를 여는 순간
 * `markCheatOpened`를 부르고 `jumpTo` · `setCards` · `setLives`도 각자 다시 세운다. 아무것도
 * 바꾸지 않고 닫아도 남아야 하므로 표시의 근거는 "열렸다"이지 "바꿨다"가 아니다.
 */

import { CARDS } from '../config/cards';
import type { CardId, StageId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYER } from '../config/player';
import { PLAYFIELD } from '../config/playfield';
import { PROGRESSION } from '../config/progression';
import { FONTS } from '../config/ui';
import type { Input, InputPress } from '../core/input';
import { clamp } from '../core/math';
import type { CardStack } from '../sim/cards';
import { setCards, setLives, type Run, type StageEntryPoint } from '../sim/run';
import {
  drawMenuLines, entryOptionsFor, itemAtLine, ITEM_LINES, LEFT_X_U,
  type CheatView, type EntryOption, type MenuItem,
} from './cheat-items';
import { drawStatPanel } from './cheat-table';

/**
 * `screens/registry.ts`의 계약을 구조로만 다시 적는다. `dev/`는 `screens/`를 import할 수
 * 없고(03 §5, eslint가 막는다) TypeScript는 구조적이라 이 모양이면 그대로 꽂힌다.
 */
interface CheatHost {
  readonly input: Input;
  run(): Run | null;
  request(request: { readonly kind: 'jump'; readonly target: StageEntryPoint }): void;
}

interface CheatScreen {
  paint(ctx: CanvasRenderingContext2D, realDtSec: number): void;
  update(presses: readonly InputPress[], realDtSec: number): void;
}

/** 08 §8.7 딤. 표를 읽는 화면이라 아래 전장이 방해가 된다 — 다른 화면보다 진하다 */
const DIM_ALPHA = 0.92;
const BANNER_BASELINE_YU = 62;
const SUMMARY_BASELINE_YU = 100;
const HINT_BASELINE_YU = 1868;
const NO_RUN_X_U = 560;
const NO_RUN_BASELINE_YU = 200;
const BANNER_PX = 26;
const SUMMARY_PX = 20;
const NOTICE_PX = 20;
const HINT_PX = 20;
const TEXT_WEIGHT = 500;
const BANNER_WEIGHT = 600;

const BANNER_TEXT = '치트 모드 — 이 런은 오염된 것으로 기록된다';
const HINT_TEXT = '↑ ↓ 항목    ← → 값    Enter 적용    Esc 닫기    Shift+F9 열고 닫기';
const NO_RUN_TEXT = '런이 없다 — Enter로 스테이지에 들어가면 카드와 라이프가 살아난다';
const EMPTY_LABEL = '—';

function stackOf(run: Run | null, id: CardId): number {
  return run?.cards.find((card) => card.id === id)?.stack ?? 0;
}

/**
 * 중첩 하나를 갈아 끼운다. 획득 순서를 지키려고 자리를 옮기지 않는다 — 결과·일시정지 화면이
 * 그 순서로 칩을 늘어놓으므로 값을 고칠 때마다 카드가 목록 끝으로 튀면 안 된다.
 * 최대 중첩과 즉발 효과(N14 · R06)의 처리는 `setCards` 안에 있고 여기서 흉내 내지 않는다.
 */
function writeStack(run: Run, id: CardId, stack: number): void {
  const held = run.cards.some((card) => card.id === id);
  const next: CardStack[] = held
    ? run.cards.map((card) => (card.id === id ? { id, stack } : card))
    : [...run.cards, { id, stack }];
  setCards(run, next);
}

function totalStacks(run: Run): number {
  return run.cards.reduce((sum, card) => sum + card.stack, 0);
}

function summaryText(run: Run | null): string {
  if (run === null) {
    return '현재 런 없음';
  }
  return `현재  S${run.stageId} · 라이프 ${run.world.player.lives}/${run.world.stats.maxLife}`
    + ` · 콤보 ${run.world.run.combo} · 카드 ${totalStacks(run)}장`
    + ` · 리롤 ${run.rerollUsed ? '사용함' : '미사용'}`;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  xU: number,
  yU: number,
  px: number,
  weight: number,
  color: string,
): void {
  ctx.textAlign = 'left';
  ctx.font = `${weight} ${px}px ${FONTS.data}`;
  ctx.fillStyle = color;
  ctx.fillText(text, xU, yU);
}

export function createCheatMenu(host: CheatHost): CheatScreen {
  let cursor = 0;
  let stageId: StageId = PROGRESSION.restartStageId;
  let entryOptions: readonly EntryOption[] = entryOptionsFor(stageId);
  let entryIndex = 0;
  /** §18.3 "기본은 진입 시점의 값을 유지". 건드리기 전까지 런의 값을 그대로 비춘다 */
  let livesTouched = false;
  let lives: number = PLAYER.startLife;
  let resetReroll = false;

  function maxLifeOf(run: Run | null): number {
    return run?.world.stats.maxLife ?? PLAYER.startLife;
  }

  function shownLives(run: Run | null): number {
    return livesTouched ? lives : (run?.world.player.lives ?? PLAYER.startLife);
  }

  function moveCursor(delta: number): void {
    cursor = (cursor + delta + ITEM_LINES.length) % ITEM_LINES.length;
  }

  function changeStage(delta: number): void {
    stageId = clamp(stageId + delta, 1, PROGRESSION.stageCount) as StageId;
    entryOptions = entryOptionsFor(stageId);
    entryIndex = 0;
  }

  function changeLives(run: Run | null, delta: number): void {
    lives = clamp(shownLives(run) + delta, 1, maxLifeOf(run));
    livesTouched = true;
    if (run !== null) {
      setLives(run, lives);
      lives = run.world.player.lives;
    }
  }

  function changeCard(run: Run | null, id: CardId, delta: number): void {
    if (run === null) {
      return;
    }
    const current = stackOf(run, id);
    const wanted = clamp(current + delta, 0, CARDS[id].maxStack);
    if (wanted !== current) {
      writeStack(run, id, wanted);
    }
  }

  function changeValue(delta: number): void {
    const run = host.run();
    const item: MenuItem | null = itemAtLine(ITEM_LINES[cursor]);
    switch (item?.kind) {
      case 'stage': changeStage(delta); return;
      case 'entry': entryIndex = clamp(entryIndex + delta, 0, entryOptions.length - 1); return;
      case 'life': changeLives(run, delta); return;
      case 'reroll': resetReroll = delta > 0; return;
      // §18.4의 「전체 초기화」. 방향이 없는 동작이라 ← → 어느 쪽이든 같은 일을 한다 —
      // Enter는 이미 스테이지 진입이 가져갔고 §16.4에 셋째 키가 없다
      case 'clearCards': if (run !== null) { setCards(run, []); } return;
      case 'card': changeCard(run, item.id, delta); return;
      default: return;
    }
  }

  /**
   * T-14. `jumpTo`를 직접 부르지 않고 매니저에 요청하는 것은 적용이 화면 전환을 동반하기
   * 때문이다(08 §8.2) — 스테이지가 바뀌면 배경과 잡몹 실루엣을 다시 구워야 하고 그 일의
   * 소유자는 `screens/play.ts`다. 세워지는 상태는 같다: 매니저가 같은 `jumpTo`를 부른다.
   */
  function applyJump(): void {
    const at = entryOptions[entryIndex]?.at;
    if (at === undefined) {
      return;
    }
    const target: StageEntryPoint = {
      stageId,
      at,
      ...(livesTouched ? { lives } : {}),
      resetReroll,
    };
    host.request({ kind: 'jump', target });
    // 진입 뒤의 라이프는 sim이 정한다. 표시를 다시 런에 맡기지 않으면 잘린 값이 안 보인다
    livesTouched = false;
  }

  function viewOf(run: Run | null): CheatView {
    return {
      stageId,
      entryLabel: entryOptions[entryIndex]?.label ?? EMPTY_LABEL,
      lives: run === null ? null : shownLives(run),
      maxLife: maxLifeOf(run),
      resetReroll,
      stackOf: (id: CardId) => stackOf(run, id),
    };
  }

  return {
    paint(ctx: CanvasRenderingContext2D): void {
      const run = host.run();
      ctx.save();
      ctx.textBaseline = 'alphabetic';
      // 08 §8.7의 rgba(5,6,10,0.92). 캔버스 바탕색을 그대로 깔아 색 리터럴을 늘리지 않는다
      ctx.globalAlpha = DIM_ALPHA;
      ctx.fillStyle = PALETTE.ink900;
      ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
      ctx.globalAlpha = 1;

      drawText(ctx, BANNER_TEXT, LEFT_X_U, BANNER_BASELINE_YU, BANNER_PX, BANNER_WEIGHT, PALETTE.hwang);
      drawText(ctx, summaryText(run), LEFT_X_U, SUMMARY_BASELINE_YU, SUMMARY_PX, TEXT_WEIGHT, PALETTE.baekFaint);
      drawMenuLines(ctx, ITEM_LINES[cursor], viewOf(run));

      if (run === null) {
        drawText(ctx, NO_RUN_TEXT, NO_RUN_X_U, NO_RUN_BASELINE_YU, NOTICE_PX, TEXT_WEIGHT, PALETTE.baekMute);
      } else {
        drawStatPanel(ctx, {
          stats: run.world.stats,
          combo: run.world.run.combo,
          shieldCharges: run.world.run.shieldCharges,
        });
      }

      drawText(ctx, HINT_TEXT, LEFT_X_U, HINT_BASELINE_YU, HINT_PX, TEXT_WEIGHT, PALETTE.baekFaint);
      ctx.restore();
    },

    update(presses: readonly InputPress[]): void {
      for (const press of presses) {
        switch (press.action) {
          case 'moveUp': moveCursor(-1); break;
          case 'moveDown': moveCursor(1); break;
          case 'moveLeft': changeValue(-1); break;
          case 'moveRight': changeValue(1); break;
          case 'confirm': applyJump(); break;
          default: break;
        }
      }
    },
  };
}
