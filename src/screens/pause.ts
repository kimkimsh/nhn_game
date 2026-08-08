/**
 * 일시정지 — 스펙 §13.4 · §16.3 · §18.2, 08 §4. 그림은 `14_pause/scene.js`.
 *
 * ── 이 파일은 아무것도 멈추지 않는다 ────────────────────────────────────────────
 *
 * §13.4의 「모든 타이머·탄환·쿨다운 정지」는 `manager.ts`가 이 화면인 동안 `play.step()`을
 * 부르지 않는 것으로 이미 성립한다(08 §4.1). 고정 스텝이 한 개도 소비되지 않으므로 탄환도
 * 쿨다운도 히트스톱 누적 창도 그 자리에 얼어붙는다. 여기서 무엇을 「정지시키는」 코드를
 * 쓰면 정지의 소유자가 둘이 되고, 둘 중 하나만 고치는 순간 일시정지가 이득이 된다.
 *
 * ── 배경은 전투 프레임이다 (12 §1 C-02) ─────────────────────────────────────────
 *
 * 딤 0.78은 카드 선택(0.86)·결과(0.9)보다 옅다. §13.4의 약속이 「멈췄다」이지 「다른 화면으로
 * 갔다」가 아니어서다(08 §4.2). HUD도 딤 아래에 그대로 남는다 — §18.5의 오염 표시가 **상시**
 * 여야 하므로 일시정지를 HUD의 예외로 만들지 않는다.
 *
 * ── 보유 카드가 이 화면의 실질이다 ─────────────────────────────────────────────
 *
 * 전투 중의 `Tab` 오버레이는 게임을 멈추지 않으므로(§16.1) 천천히 읽을 수 없다. 표시 줄 수의
 * 상한은 `현재 스테이지 번호 − 1`이다(10 A3) — S4 도중이면 클리어한 스테이지가 S1·S2·S3뿐이라
 * 카드도 최대 3장이고, 그 상한이 곧 S5의 4행이라는 레이아웃 상한과 만난다.
 */

import type { CardId, StageId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { STAGES } from '../config/stages';
import { FONTS, UI } from '../config/ui';
import type { InputPress } from '../core/input';
import { hexA } from '../render/primitives';
import { cardText } from '../sim/cards';
import type { Run } from '../sim/run';
import { wavePhase } from '../sim/waves';
import type { World } from '../sim/world';
import {
  applyMenuHover, applyMenuPress, cardNameWithStack, createMenuState, dimFrame, drawHintLine,
  drawMenu, formatCount, layoutMenu, rarityColorOf, resetMenuState, type MenuState,
} from './menu';
import type { Screen, ScreenHost } from './registry';

const PAUSE = UI.pause;

/** 목업 14_pause/scene.js:80·86 보유 목록의 좌우 여백 (u). UI.pause에 x 칸이 없다 */
const HELD_LEFT_XU = 120;
const HELD_RIGHT_XU = PLAYFIELD.widthU - HELD_LEFT_XU;

/** 목업 14_pause/scene.js:86-88 구분선 */
const RULE_WIDTH_U = 1.5;
const RULE_ALPHA = 0.14;

/** 목업 14_pause/scene.js:90-99 한 줄 안의 상대 좌표 (u)와 크기 (px) */
const ROW_SWATCH_OFFSET_YU = 6;
const ROW_TEXT_XU = HELD_LEFT_XU + 26;
const ROW_ID_OFFSET_YU = 28;
const ROW_NAME_OFFSET_YU = 62;
const ROW_EFFECT_OFFSET_YU = 56;
const ROW_ID_PX = 22;
const ROW_NAME_PX = 32;
const ROW_EFFECT_PX = 26;

/** 이름 열과 효과 열 사이에 반드시 남기는 빈 폭 (u) */
const COLUMN_GAP_U = 24;
/** 효과 열이 이보다 좁아지지는 않는다 (u). 이름이 아무리 길어도 문장이 한 점으로 눌리면 안 된다 */
const EFFECT_MIN_WIDTH_U = 360;

/** 목업 14_pause/scene.js:84 '보유 카드 n' (px). weight 500 / data */
const HEADER_PX = 24;
/** 목업 14_pause/scene.js:107-116 머리말 세 줄 (px) */
const CONTEXT_PX = 28;
const TITLE_PX = 96;
const SUBTITLE_PX = 26;

const TITLE_TEXT = '멈춤';
const SUBTITLE_TEXT = '모든 타이머 · 탄환 · 쿨다운이 정지했다';
const MENU_HINT = '↑ ↓  항목 이동      Enter  실행      Esc  즉시 계속';
const CONFIRM_HINT = '↑ ↓  항목 이동      Enter  실행';
const RESUME_LABEL = '계속하기';
const ABANDON_LABEL = '런 포기';
const CONFIRM_LABELS: readonly string[] = ['아니오', '예, 포기한다'];

/** 08 §4.3 확정 — `●` 음소거 켜짐 / `○` 꺼짐. 목업은 점만 그렸을 뿐 대응을 적지 않았다 */
const MUTE_ON_GLYPH = '●';
const MUTE_OFF_GLYPH = '○';

/** 메뉴 항목 순서. 되돌릴 수 없는 항목이 초기 커서에서 가장 멀다 (08 §4.3) */
const ITEM_RESUME = 0;
const ITEM_MUTE = 1;
const ITEM_ABANDON = 2;
const MENU_ITEM_COUNT = 3;

/**
 * 확정 패널의 「예」 자리 (08 §4.5). 0번은 「아니오」이고 커서는 거기서 열린다 —
 * 파괴적 항목을 기본값으로 두면 확정 단계가 `Enter` 두 번으로 축소돼 없는 것과 같아진다.
 */
const CONFIRM_YES = 1;

/**
 * 마지막 `update` 이후 이만큼 지났으면 화면이 닫혔다 다시 열린 것으로 본다 (ms).
 *
 * §4.3의 「커서는 항상 계속하기에 놓인 채 열린다」를 지키려면 진입 신호가 필요한데
 * `registry.ts`의 `Screen` 계약에 그런 칸이 없고, `manager.ts`가 화면 객체를 런이 바뀌어도
 * 계속 재사용한다. 프레임이 이어지고 있는지가 유일하게 남은 신호다. `loop.ts`의 realDt 상한
 * 0.25초보다 넉넉히 크게 잡아 한 프레임 지연을 재진입으로 오인하지 않게 한다.
 */
const REENTRY_GAP_MS = 400;

interface HeldRow {
  readonly id: CardId;
  readonly name: string;
  readonly effect: string;
  readonly color: string;
}

/** §15.1의 진행도와 같은 사실을 글자로. 웨이브 구간 밖에서는 소강·보스가 그 자리를 대신한다 */
function waveLabel(world: World): string {
  const phase = wavePhase(world);
  if (phase === 'boss') {
    return '보스';
  }
  if (phase === 'lull') {
    return '소강';
  }
  let index = 0;
  for (const wave of STAGES[world.stageId].waves) {
    index += 1;
    if (world.simTimeSec >= wave.startSec && world.simTimeSec < wave.endSec) {
      return `W${index}`;
    }
  }
  return '';
}

/**
 * 10 A3 — 줄 수의 상한은 `스테이지 번호 − 1`이다. 정상 플레이에서는 보유 카드 수가 이미 그
 * 값이라 아무것도 자르지 않고, 잘리는 것은 치트로 카드를 직접 지정한 런뿐이다. 그 런에서
 * 조용히 사라지지 않도록 잘린 수를 머리글에 함께 적는다.
 */
function heldRows(run: Run): { readonly rows: readonly HeldRow[]; readonly hidden: number } {
  const limit = Math.max(0, (run.stageId as number) - 1);
  const rows: HeldRow[] = [];
  for (const held of run.cards) {
    if (rows.length >= limit) {
      break;
    }
    rows.push({
      id: held.id,
      name: cardNameWithStack(held.id, held.stack),
      effect: cardText(held.id),
      color: rarityColorOf(held.id),
    });
  }
  return { rows, hidden: run.cards.length - rows.length };
}

function drawHeader(ctx: CanvasRenderingContext2D, run: Run, stageId: StageId): void {
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.cheong;
  ctx.font = `500 ${CONTEXT_PX}px ${FONTS.data}`;
  const wave = waveLabel(run.world);
  const stage = STAGES[stageId];
  ctx.fillText(
    `STAGE ${stageId} · ${stage.name}${wave === '' ? '' : ` · ${wave}`}`,
    PLAYFIELD.widthU / 2,
    PAUSE.contextBaselineYU,
  );
  ctx.fillStyle = PALETTE.baek;
  ctx.font = `700 ${TITLE_PX}px ${FONTS.display}`;
  ctx.fillText(TITLE_TEXT, PLAYFIELD.widthU / 2, PAUSE.titleBaselineYU);
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `400 ${SUBTITLE_PX}px ${FONTS.body}`;
  ctx.fillText(SUBTITLE_TEXT, PLAYFIELD.widthU / 2, PAUSE.subtitleBaselineYU);
}

function drawHeldList(
  ctx: CanvasRenderingContext2D,
  rows: readonly HeldRow[],
  hidden: number,
): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `500 ${HEADER_PX}px ${FONTS.data}`;
  const suffix = hidden > 0 ? `  (+${hidden} 숨김)` : '';
  ctx.fillText(`보유 카드  ${rows.length}${suffix}`, HELD_LEFT_XU, PAUSE.heldHeaderYU);

  ctx.strokeStyle = hexA(PALETTE.baek, RULE_ALPHA);
  ctx.lineWidth = RULE_WIDTH_U;
  ctx.beginPath();
  ctx.moveTo(HELD_LEFT_XU, PAUSE.heldRuleYU);
  ctx.lineTo(HELD_RIGHT_XU, PAUSE.heldRuleYU);
  ctx.stroke();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) {
      continue;
    }
    const yU = PAUSE.heldRowFirstYU + index * PAUSE.heldRowStepU;
    ctx.fillStyle = row.color;
    ctx.fillRect(HELD_LEFT_XU, yU + ROW_SWATCH_OFFSET_YU, PAUSE.heldSwatchWidthU, PAUSE.heldSwatchHeightU);
    ctx.fillStyle = PALETTE.baekFaint;
    ctx.font = `500 ${ROW_ID_PX}px ${FONTS.data}`;
    ctx.fillText(row.id, ROW_TEXT_XU, yU + ROW_ID_OFFSET_YU);
    ctx.fillStyle = PALETTE.baek;
    ctx.font = `600 ${ROW_NAME_PX}px ${FONTS.body}`;
    ctx.fillText(row.name, ROW_TEXT_XU, yU + ROW_NAME_OFFSET_YU);
    // 이름과 효과가 같은 줄의 양 끝이라 열 경계가 없으면 겹친다. 웹폰트 대체 상태의 E03
    // (「피격을 무효화하는 보호막 최대 3중 · 스테이지 시작 시 1중 충전」)이 실제로 이름을
    // 49u 파고든다 — 12 §3.1이 폰트 없이도 layout이 서야 한다고 못 박은 자리다
    const nameRightXU = ROW_TEXT_XU + ctx.measureText(row.name).width;
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.baekMute;
    ctx.font = `400 ${ROW_EFFECT_PX}px ${FONTS.body}`;
    const effectRoomU = Math.max(EFFECT_MIN_WIDTH_U, HELD_RIGHT_XU - nameRightXU - COLUMN_GAP_U);
    ctx.fillText(row.effect, HELD_RIGHT_XU, yU + ROW_EFFECT_OFFSET_YU, effectRoomU);
    ctx.textAlign = 'left';
  }
}

/**
 * 08 §4.5 — 잃는 것을 숫자로 적는다. 확정 단계에서는 §16.3이 요구한 세 가지(카드·점수·도달
 * 스테이지)를 전부 세고, 메뉴 상태에서는 목업이 쓴 문장을 실제 보유 수로 채워 그대로 쓴다.
 */
function warnText(run: Run, rowCount: number, confirming: boolean): string {
  if (!confirming) {
    return `포기하면 카드 ${rowCount}장이 전부 사라진다. 중간 저장은 없다.`;
  }
  const score = formatCount(run.world.run.score);
  return `카드 ${rowCount}장 · 점수 ${score} · 도달 스테이지 ${run.stageId} — 전부 사라진다. 되돌릴 수 없다.`;
}

export function createPauseScreen(host: ScreenHost): Screen {
  const state: MenuState = createMenuState();
  let confirming = false;
  let lastUpdateMs = Number.NEGATIVE_INFINITY;

  function itemCount(): number {
    return confirming ? CONFIRM_LABELS.length : MENU_ITEM_COUNT;
  }

  function labels(): readonly string[] {
    if (confirming) {
      return CONFIRM_LABELS;
    }
    const glyph = host.muted() ? MUTE_ON_GLYPH : MUTE_OFF_GLYPH;
    return [RESUME_LABEL, `음소거   M   ${glyph}`, ABANDON_LABEL];
  }

  /** 확정 패널을 열고 닫을 때마다 커서를 되돌린다. 08 §4.5의 「기본 커서는 아니오」가 그것이다 */
  function setConfirming(next: boolean): void {
    confirming = next;
    resetMenuState(state, host.input.pointer);
  }

  function execute(index: number): void {
    if (confirming) {
      if (index === CONFIRM_YES) {
        host.request({ kind: 'abandon' });
      }
      // 「예」 뒤에도 패널을 닫는다. 전이는 매니저가 이 프레임 끝에 하지만, 그 전이가 어떤
      // 이유로든 안 일어났을 때 화면이 스스로 못 빠져나오는 상태에 남으면 안 된다
      setConfirming(false);
      return;
    }
    if (index === ITEM_RESUME) {
      host.request({ kind: 'resume' });
      return;
    }
    if (index === ITEM_MUTE) {
      // 커서는 음소거 항목에 남는다. 실행한 자리에서 결과(`●`/`○`)가 바로 보여야 한다
      host.setMuted(!host.muted());
      return;
    }
    if (index === ITEM_ABANDON) {
      setConfirming(true);
    }
  }

  return {
    paint(ctx: CanvasRenderingContext2D): void {
      const run = host.run();
      if (run === null) {
        return;
      }
      const held = heldRows(run);
      ctx.save();
      ctx.textBaseline = 'alphabetic';
      dimFrame(ctx, PAUSE.dimAlpha, PLAYFIELD.widthU, PLAYFIELD.heightU);
      drawHeader(ctx, run, run.stageId);
      drawHeldList(ctx, held.rows, held.hidden);
      drawMenu(ctx, layoutMenu(PAUSE.menuFirstYU, itemCount()), labels(), state.cursor);
      drawHintLine(ctx, PAUSE.hintBaselineYU, confirming ? CONFIRM_HINT : MENU_HINT);
      drawHintLine(ctx, PAUSE.warnBaselineYU, warnText(run, held.rows.length, confirming));
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
      const layout = layoutMenu(PAUSE.menuFirstYU, itemCount());
      applyMenuHover(state, layout, host.input.pointer);
      for (const press of presses) {
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
