/**
 * 카드 선택 화면 — 스펙 §11.1 · §15.2 · §16.2. 08_화면과_UI.md §3.
 *
 * 전이는 하지 않는다. 확정도 리롤도 `host.request()`로 요청만 하고, 무엇이 초기화되고 무엇이
 * 유지되는지는 `screens/manager.ts`가 정한다(08 §1.4 T-05 · T-17).
 *
 * ── 리롤은 3장 다시 뽑기가 아니다 ───────────────────────────────────────────────
 *
 * §11.1이 "제시된 3장을 버리고 §11.2의 추첨 절차를 **처음부터** 다시 실행한다. 등급도 다시
 * 뽑는다"이고, 그것은 `drawOffer`를 한 번 더 부르는 것과 정확히 같다 — 그 함수가 부를 때마다
 * 3장의 등급을 새로 뽑기 때문이다. 등급 추첨을 건너뛰고 풀에서만 다시 뽑는 경로는 여기 없다.
 *
 * 다시 뽑는 순간 **선택 인덱스를 지운다**(§3.6). 살려 두면 2번을 고른 채 리롤한 플레이어의
 * 다음 `Enter` 한 번이 한 번도 읽지 않은 카드를 확정한다 — §15.2가 확정 단계를 요구한 이유가
 * 정확히 그것이다.
 *
 * ── 추첨 난수는 sim 스트림이고 화면 상태에 종속되지 않는다 ──────────────────────
 *
 * 스트림 라벨이 `cards/screen/{회차}`와 `cards/screen/{회차}/reroll` 둘뿐이라, 같은 시드의 두
 * 런은 커서를 몇 번 움직였든 같은 3장을 본다(D-05). 리롤 여부만이 수열을 가른다.
 */

import { CARDS } from '../config/cards';
import { DRAW } from '../config/cards/draw-table';
import type { CardHideCondition, CardId } from '../config/ids';
import type { CardDef } from '../config/types';
import { UI } from '../config/ui';
import type { InputPress } from '../core/input';
import { deriveStream } from '../core/rng';
import { cardText, drawOffer, type CardRound } from '../sim/cards';
import type { Run } from '../sim/run';
import { cardDeltaOf } from './card-delta';
import {
  cardRectU,
  containsU,
  HELD_RECT,
  type CardSelectView,
  type HeldCardView,
  type OfferedCardView,
} from './card-select-parts';
import { paintCardSelect } from './card-select-view';
import type { Screen, ScreenHost } from './registry';

/** 진입 직후의 선택 없음 상태에서 좌우·확정이 처음 고르는 자리 (§3.5) */
const MIDDLE_INDEX = 1;
const FIRST_INDEX = 0;
const LAST_INDEX = DRAW.offerCount - 1;

/** §11.2 가중치 표가 가진 회차. 치트가 스테이지를 건너뛰어도 표 밖으로 나가지 않게 잘라 둔다 */
const FIRST_ROUND = 1;
const LAST_ROUND = DRAW.acquisitionCount;

function asRound(cardScreenNo: number): CardRound {
  return Math.min(Math.max(cardScreenNo, FIRST_ROUND), LAST_ROUND) as CardRound;
}

/** §11.2 "효과가 무의미한 경우". 지금 그 조건은 N14 하나이고 런 상태를 봐야 안다 */
function hideConditionsOf(run: Run): readonly CardHideCondition[] {
  return run.world.player.lives >= run.world.stats.maxLife ? ['lifeAtMax'] : [];
}

function offerFor(run: Run, rerolled: boolean): readonly CardId[] {
  const round = asRound(run.cardScreenNo);
  const label = rerolled ? `cards/screen/${round}/reroll` : `cards/screen/${round}`;
  return drawOffer(
    { round, held: run.cards, hideConditions: hideConditionsOf(run) },
    deriveStream(run.seed, label),
  );
}

function offeredCardView(id: CardId, run: Run): OfferedCardView {
  const def: CardDef = CARDS[id];
  const stack = run.cards.find((card) => card.id === id)?.stack ?? 0;
  return {
    id,
    name: def.name,
    rarity: def.rarity,
    text: cardText(id),
    stack,
    maxStack: def.maxStack,
    delta: cardDeltaOf(id, run.cards, run.world.player.lives),
  };
}

function heldViews(run: Run): readonly HeldCardView[] {
  return run.cards.map((card) => {
    const def: CardDef = CARDS[card.id];
    return { id: card.id, name: def.name, rarity: def.rarity, stack: card.stack, text: cardText(card.id) };
  });
}

/** 커서가 이 자리에 있을 때 고르게 되는 카드. 어느 카드 위도 아니면 null */
function cardIndexAt(xU: number, yU: number): number | null {
  for (let index = 0; index < DRAW.offerCount; index += 1) {
    if (containsU(cardRectU(index), xU, yU)) {
      return index;
    }
  }
  return null;
}

export function createCardSelectScreen(host: ScreenHost): Screen {
  /** 지금 그리고 있는 런과 회차. 둘 중 하나라도 달라지면 3장을 새로 뽑는다 */
  let shownRun: Run | null = null;
  let shownRound = 0;
  let rerolledHere = false;
  let offer: readonly CardId[] = [];
  let cards: readonly OfferedCardView[] = [];
  let held: readonly HeldCardView[] = [];
  let pickedIndex: number | null = null;
  /** 마우스로 연 보유 상세. `Tab`은 홀드라 이 값과 별개로 매 프레임 읽는다 (§3.4) */
  let detailOpen = false;
  /**
   * 마지막으로 반영한 커서 자리. 커서가 실제로 움직였을 때만 선택을 옮긴다 — 매 프레임
   * 읽으면 커서가 얹혀 있는 동안 방향키가 아무 일도 못 한다.
   */
  let hoverXU = 0;
  let hoverYU = 0;

  function rebuild(run: Run, rerolled: boolean): void {
    offer = offerFor(run, rerolled);
    cards = offer.map((id) => offeredCardView(id, run));
    held = heldViews(run);
    pickedIndex = null;
  }

  /** 화면에 처음 들어왔거나 회차가 넘어갔으면 3장을 뽑는다. 그 밖에는 아무것도 하지 않는다 */
  function sync(): Run | null {
    const run = host.run();
    if (run === null) {
      return null;
    }
    if (run !== shownRun || run.cardScreenNo !== shownRound) {
      shownRun = run;
      shownRound = run.cardScreenNo;
      rerolledHere = false;
      detailOpen = false;
      // 커서가 이미 카드 위에 놓여 있어도 진입 직후에는 아무 카드도 선택되지 않아야 한다 (§3.5)
      hoverXU = host.input.pointer.xU;
      hoverYU = host.input.pointer.yU;
      rebuild(run, false);
    }
    return run;
  }

  function movePick(delta: number): void {
    pickedIndex =
      pickedIndex === null
        ? MIDDLE_INDEX
        : Math.min(Math.max(pickedIndex + delta, FIRST_INDEX), LAST_INDEX);
  }

  /**
   * 확정은 두 번째 입력이다. 첫 입력이 여기 오면 가운데 카드를 고르기만 한다 (§16.2).
   * 매니저에 요청을 냈으면 참을 낸다 — 아래 update가 그 프레임을 거기서 끝낸다.
   */
  function confirm(): boolean {
    if (pickedIndex === null) {
      pickedIndex = MIDDLE_INDEX;
      return false;
    }
    const id = offer[pickedIndex];
    if (id === undefined) {
      return false;
    }
    host.request({ kind: 'pickCard', cardId: id });
    return true;
  }

  /** §16.2 남은 횟수가 0이면 입력이 무시된다. 버튼은 그대로 남는다 (§3.3) */
  function reroll(run: Run): boolean {
    if (run.rerollUsed || rerolledHere) {
      return false;
    }
    rerolledHere = true;
    host.request({ kind: 'reroll' });
    rebuild(run, true);
    return true;
  }

  function onPointerConfirm(run: Run, xU: number, yU: number): boolean {
    if (containsU(UI.cardSelect.rerollBox, xU, yU)) {
      return reroll(run);
    }
    // 선택이 없는 확정 버튼은 비활성이다. 여기서 confirm()을 부르면 클릭 한 번이 가운데 카드를
    // 고르게 되어 버튼이 자기 라벨과 다른 일을 한다
    if (containsU(UI.cardSelect.confirmBox, xU, yU)) {
      return pickedIndex !== null && confirm();
    }
    // §16.2의 「보유 카드 확인 · 클릭」. Tab은 홀드라 마우스에 같은 방식이 없어 토글로 둔다
    if (containsU(HELD_RECT, xU, yU)) {
      detailOpen = !detailOpen;
      return false;
    }
    const index = cardIndexAt(xU, yU);
    if (index === null) {
      return false;
    }
    // 선택되지 않은 카드를 클릭하면 선택만 된다. 커서가 빠르게 들어오면서 같은 프레임에 눌리면
    // hover와 click이 한 사건이 되어 확정 단계가 사라지는데, 이 한 줄이 그 경로를 막는다 (§3.5)
    if (index !== pickedIndex) {
      pickedIndex = index;
      return false;
    }
    return confirm();
  }

  /** 이 눌림이 매니저에 요청을 냈는가 */
  function handlePress(run: Run, press: InputPress): boolean {
    if (press.action === 'moveLeft') {
      movePick(-1);
    } else if (press.action === 'moveRight') {
      movePick(1);
    } else if (press.action === 'reroll') {
      return reroll(run);
    } else if (press.action === 'confirm') {
      return press.pointerU === null
        ? confirm()
        : onPointerConfirm(run, press.pointerU.xU, press.pointerU.yU);
    }
    return false;
  }

  /** §16.2 커서 올리기 = 카드 이동 */
  function applyHover(): void {
    const pointer = host.input.pointer;
    if (!pointer.seen || (pointer.xU === hoverXU && pointer.yU === hoverYU)) {
      return;
    }
    hoverXU = pointer.xU;
    hoverYU = pointer.yU;
    const index = cardIndexAt(pointer.xU, pointer.yU);
    if (index !== null) {
      pickedIndex = index;
    }
  }

  function currentView(): CardSelectView | null {
    if (shownRun === null) {
      return null;
    }
    return {
      round: asRound(shownRound),
      cards,
      held,
      pickedIndex,
      rerollLeft: shownRun.rerollUsed || rerolledHere ? 0 : DRAW.rerollsPerRun,
      detailOpen: detailOpen || host.input.isDown('cards'),
    };
  }

  return {
    update(presses: readonly InputPress[]): void {
      const run = sync();
      if (run === null) {
        return;
      }
      applyHover();
      for (const press of presses) {
        // 한 프레임에 요청은 하나다. 매니저의 pending은 한 칸이라 뒤엣것이 앞엣것을 덮는데,
        // 덮이는 것이 리롤이면 markRerollUsed가 돌지 않아 §11.1의 런당 1회가 두 번이 된다
        if (handlePress(run, press)) {
          return;
        }
      }
    },

    paint(ctx: CanvasRenderingContext2D): void {
      // 카운트다운 중에는 update가 돌지 않으므로(manager) 그림 쪽에서도 한 번 맞춘다
      sync();
      const view = currentView();
      if (view !== null) {
        paintCardSelect(ctx, view);
      }
    },
  };
}
