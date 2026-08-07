/**
 * 치트 메뉴 좌열의 항목 목록과 그림 — 08_화면과_UI.md §8.3 · §8.7, 스펙 §18.3 · §18.4.
 *
 * 여기 있는 것은 "무엇을 고를 수 있는가"와 "그것을 어떻게 그리는가"뿐이고, 고른 값을 sim에
 * 밀어 넣는 일은 `cheat-menu.ts`가 한다. 한 파일 400줄 상한 때문에 나눴지만 나눈 자리가
 * 이음매이기도 하다 — 이 파일은 상태를 하나도 갖지 않고 `CheatView`를 받아 읽기만 한다.
 *
 * 커서가 머리글을 건너뛰는 일도 이동 코드가 아니라 `ITEM_LINES` 표가 한다. 이동 쪽에서
 * "머리글이면 한 칸 더" 식으로 처리하면 목록 끝에서 감싸는 경우가 따로 생기고, 그 갈래는
 * 등급 머리글을 하나 더 넣는 순간 조용히 어긋난다.
 */

import { BOSSES } from '../config/bosses';
import { CARDS, CARD_POOLS } from '../config/cards';
import type { CardId, StageId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { STAGES } from '../config/stages';
import type { BossDef } from '../config/types';
import { FONTS } from '../config/ui';
import type { StageEntry } from '../sim/run';

export const LEFT_X_U = 80;
export const LEFT_RIGHT_U = 520;
const CARD_NAME_DX_U = 66;
export const LINE_FIRST_YU = 150;
export const LINE_STEP_U = 40;
const CURSOR_PAD_U = 12;
const CURSOR_RISE_U = 27;
const CURSOR_HEIGHT_U = 36;
const CURSOR_ALPHA = 0.08;
const LINE_PX = 20;
const HEADING_PX = 18;
const TEXT_WEIGHT = 500;

const SECONDS_PER_MINUTE = 60;
const SECOND_DIGITS = 2;
const HP_DECIMALS = 1;
const EMPTY_CELL = '—';

/** 08 §8.3 목록은 31종을 등급별로 묶는다. 순서는 config의 선언 순서 그대로다 */
const RARITY_GROUPS = [
  { heading: `노말 ${CARD_POOLS.NORMAL.length}종 (§11.3)`, ids: CARD_POOLS.NORMAL },
  { heading: `레어 ${CARD_POOLS.RARE.length}종 (§11.4)`, ids: CARD_POOLS.RARE },
  { heading: `에픽 ${CARD_POOLS.EPIC.length}종 (§11.5)`, ids: CARD_POOLS.EPIC },
] as const satisfies readonly { heading: string; ids: readonly CardId[] }[];

export type MenuItem =
  | { readonly kind: 'stage' }
  | { readonly kind: 'entry' }
  | { readonly kind: 'life' }
  | { readonly kind: 'reroll' }
  | { readonly kind: 'apply' }
  | { readonly kind: 'clearCards' }
  | { readonly kind: 'card'; readonly id: CardId };

/** 한 줄은 머리글이거나 항목이다. 머리글에는 커서가 서지 않는다 */
interface MenuLine {
  readonly heading: string | null;
  readonly item: MenuItem | null;
}

/** 좌열이 그리는 값 전부. 상태는 cheat-menu.ts가 갖고 여기는 읽기만 한다 */
export interface CheatView {
  readonly stageId: StageId;
  readonly entryLabel: string;
  /** 런이 없으면 null — 라이프를 담을 자리가 없다는 사실이 그대로 보여야 한다 */
  readonly lives: number | null;
  readonly maxLife: number;
  readonly resetReroll: boolean;
  stackOf(id: CardId): number;
}

function buildLines(): readonly MenuLine[] {
  const lines: MenuLine[] = [
    { heading: '스테이지 자유 입장 (§18.3)', item: null },
    { heading: null, item: { kind: 'stage' } },
    { heading: null, item: { kind: 'entry' } },
    { heading: null, item: { kind: 'life' } },
    { heading: null, item: { kind: 'reroll' } },
    { heading: null, item: { kind: 'apply' } },
    { heading: null, item: { kind: 'clearCards' } },
  ];
  for (const group of RARITY_GROUPS) {
    lines.push({ heading: group.heading, item: null });
    for (const id of group.ids) {
      lines.push({ heading: null, item: { kind: 'card', id } });
    }
  }
  return lines;
}

const LINES = buildLines();

/** 커서가 셀 수 있는 줄의 인덱스. 머리글은 여기 없다 */
export const ITEM_LINES: readonly number[] = LINES.reduce<number[]>((acc, line, index) => {
  if (line.item !== null) {
    acc.push(index);
  }
  return acc;
}, []);

export function itemAtLine(lineIndex: number | undefined): MenuItem | null {
  return lineIndex === undefined ? null : (LINES[lineIndex]?.item ?? null);
}

/** §18.3 진입 지점 하나 */
export interface EntryOption {
  readonly label: string;
  readonly at: StageEntry;
}

function clockText(totalSec: number): string {
  const minutes = Math.floor(totalSec / SECONDS_PER_MINUTE);
  const seconds = Math.floor(totalSec % SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds).padStart(SECOND_DIGITS, '0')}`;
}

/**
 * 스테이지 시작 · 웨이브 · 소강 · 보스 페이즈. 보스 HP는 08 §8.3이 요구한 대로 계산 결과를
 * 라벨에 함께 띄운다 — B5 페이즈 3이면 5100의 50%인 2550이다.
 *
 * B3만 페이즈 조건이 HP 하나가 아니다. §10.4의 P2 진입이 "포문 2개 파괴 **또는** 본체 60%
 * 이하(선착)"이라 HP만 맞추면 정상 플레이에서 도달할 수 없는 조합(포문 4기 생존 + P2)이
 * 생기므로, 함께 맞춰야 하는 포문 수를 라벨에 적어 둔다.
 */
export function entryOptionsFor(stageId: StageId): readonly EntryOption[] {
  const stage = STAGES[stageId];
  const boss: BossDef = BOSSES[stage.bossId];
  const options: EntryOption[] = [{ label: 'W1 0:00 스테이지 시작', at: { kind: 'stageStart' } }];
  stage.waves.forEach((wave, index) => {
    if (index > 0) {
      options.push({
        label: `W${index + 1} ${clockText(wave.startSec)} 웨이브`,
        at: { kind: 'wave', waveIndex: index },
      });
    }
  });
  options.push({ label: `소강 ${stage.lullSec}초 · 보스 직전`, at: { kind: 'lull' } });
  boss.phases.forEach((phase, index) => {
    const parts = phase.partsDestroyedThreshold;
    const partsText = parts === undefined ? '' : ` 포문 ${parts}기`;
    const hpText = (boss.hp * phase.hpThreshold).toFixed(HP_DECIMALS);
    options.push({
      label: `${boss.id} P${index + 1} HP ${hpText}${partsText}`,
      at: { kind: 'bossPhase', phaseIndex: index },
    });
  });
  return options;
}

function labelOf(item: MenuItem): string {
  switch (item.kind) {
    case 'stage': return '스테이지';
    case 'entry': return '진입 지점';
    case 'life': return '라이프';
    case 'reroll': return '리롤 사용 여부';
    case 'apply': return '적용 — 진입';
    case 'clearCards': return '카드 전체 초기화';
    case 'card': return CARDS[item.id].name;
  }
}

function valueOf(item: MenuItem, view: CheatView): string {
  switch (item.kind) {
    case 'stage': return `${view.stageId} ${STAGES[view.stageId].name}`;
    case 'entry': return view.entryLabel;
    case 'life': return view.lives === null ? EMPTY_CELL : `${view.lives} / ${view.maxLife}`;
    case 'reroll': return view.resetReroll ? '초기화' : '유지';
    case 'apply': return 'Enter';
    case 'clearCards': return '실행';
    case 'card': return `${view.stackOf(item.id)} / ${CARDS[item.id].maxStack}`;
  }
}

function drawCursor(ctx: CanvasRenderingContext2D, yU: number): void {
  ctx.save();
  ctx.globalAlpha = CURSOR_ALPHA;
  ctx.fillStyle = PALETTE.baek;
  ctx.fillRect(
    LEFT_X_U - CURSOR_PAD_U,
    yU - CURSOR_RISE_U,
    LEFT_RIGHT_U - LEFT_X_U + CURSOR_PAD_U * 2,
    CURSOR_HEIGHT_U,
  );
  ctx.restore();
}

/** 08 §8.7 최대 중첩에 닿은 카드는 한 단 내린다 — 더 못 올린다는 사실이 보여야 한다 */
function nameColor(item: MenuItem, view: CheatView): string {
  if (item.kind !== 'card') {
    return PALETTE.baekMute;
  }
  return view.stackOf(item.id) >= CARDS[item.id].maxStack ? PALETTE.baekFaint : PALETTE.baekMute;
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  item: MenuItem,
  yU: number,
  focused: boolean,
  view: CheatView,
): void {
  if (focused) {
    drawCursor(ctx, yU);
  }
  ctx.font = `${TEXT_WEIGHT} ${LINE_PX}px ${FONTS.data}`;
  ctx.textAlign = 'left';
  if (item.kind === 'card') {
    ctx.fillStyle = PALETTE.baekFaint;
    ctx.fillText(item.id, LEFT_X_U, yU);
    ctx.fillStyle = nameColor(item, view);
    ctx.fillText(labelOf(item), LEFT_X_U + CARD_NAME_DX_U, yU);
  } else {
    ctx.fillStyle = PALETTE.baekMute;
    ctx.fillText(labelOf(item), LEFT_X_U, yU);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = focused ? PALETTE.hwang : PALETTE.baek;
  // ‹ › 는 ← → 로 바뀌는 항목임을 알리는 표시다 (08 §8.7)
  ctx.fillText(`‹ ${valueOf(item, view)} ›`, LEFT_RIGHT_U, yU);
}

/** 좌열 한 벌. focusedLine은 LINES의 인덱스이지 항목 번호가 아니다 */
export function drawMenuLines(
  ctx: CanvasRenderingContext2D,
  focusedLine: number | undefined,
  view: CheatView,
): void {
  LINES.forEach((line, index) => {
    const yU = LINE_FIRST_YU + index * LINE_STEP_U;
    if (line.item === null) {
      ctx.textAlign = 'left';
      ctx.font = `${TEXT_WEIGHT} ${HEADING_PX}px ${FONTS.data}`;
      ctx.fillStyle = PALETTE.baekFaint;
      ctx.fillText(line.heading ?? '', LEFT_X_U, yU);
      return;
    }
    drawItem(ctx, line.item, yU, index === focusedLine, view);
  });
}
