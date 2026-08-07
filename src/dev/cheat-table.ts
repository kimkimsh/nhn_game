/**
 * 치트 메뉴 우열의 실효 수치 표 — 스펙 §18.4, 08_화면과_UI.md §8.4.
 *
 * §18.4가 "이 기능의 핵심"이라고 부른 것이 이 표다. §11.6의 보정 순서는 여러 단계이고
 * INV-1과 INV-2가 서로 다른 방향으로 값을 자르므로, 최종값만 띄우면 N04 3중첩이 쿨다운을
 * 0.197초로 내렸는데 INV-1이 0.230초로 되돌린 것을 실측 중에 원인으로 짚지 못한다.
 *
 * ── 「자른 규칙」 열을 UI가 역산하지 않는다 ─────────────────────────────────────
 *
 * 값은 전부 `EffectiveStats`에서 오고 규칙 이름은 `clamps`에서 그대로 옮긴다. "0.197이
 * 0.230이 됐으니 INV-1이겠거니" 하고 추측하면 두 상한이 같은 값을 만드는 경계에서 틀린
 * 이름을 말한다(08 §8.4). 그래서 이 파일에는 §11.6의 계산이 한 줄도 없다.
 *
 * ── 정적 스냅샷과 런타임 파생을 섞지 않는다 (12_통합_계약.md §10 E-05) ──────────
 *
 * 아래 넷은 카드 목록이 그대로여도 값이 바뀐다 — N13의 빈 패리 쿨다운, R05의 콤보 종속
 * 데미지 배수, R10의 최소 간격, 스테이지마다 차오르는 E03 보호막. 정적 행과 같은 표에
 * 두면 N13이나 R05를 든 빌드에서 패리가 한 번 성립하는 순간 표 전체가 틀린 값이 된다.
 * 그래서 구획을 나누고 그 넷에는 「기본값」 열을 채우지 않는다.
 *
 * 스냅샷 타입을 sim/world.ts에서 가져오는 것은 `world.stats`가 실제로 그 타입이기 때문이고,
 * 타입만 읽을 뿐 값을 만들거나 바꾸는 함수는 부르지 않는다 — 조작은 cheat-menu.ts가
 * sim/run.ts의 공개 함수로만 한다(03_파일_구조.md §2.4).
 */

import type { ParryGradeId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PARRY, PARRY_BANDS } from '../config/parry';
import { FONTS } from '../config/ui';
import type { EffectiveStats } from '../sim/world';

/** 카드 0장의 반사탄 데미지 배수. §11.6 2단계의 가산이 비면 곱이 1이다 */
const NO_CARD_DAMAGE_MUL = 1;

const SEC_DECIMALS = 3;
const DIST_DECIMALS = 0;
const MUL_DECIMALS = 2;
const RATE_DECIMALS = 2;
/** clamps의 after를 그대로 찍으면 부동소수 꼬리가 붙는다. 표시용으로만 자른다 */
const CLAMP_VALUE_DECIMALS = 4;

/** 값이 없는 칸. 런타임 파생 행의 「기본값」과 미보유 카드의 값이 이것이다 */
const EMPTY_CELL = '—';

const TABLE_X_U = 560;
const TABLE_RIGHT_U = 1000;
const BASE_RIGHT_U = 836;
const FINAL_RIGHT_U = 928;
const RULE_X_U = 938;
const HEAD_FIRST_YU = 152;
const ROW_FIRST_YU = 196;
const ROW_STEP_U = 40;
/** 구획 사이. 한 행보다 넓어야 정적 스냅샷과 런타임 파생이 다른 표로 읽힌다 */
const SECTION_GAP_U = 34;
const RULE_LINE_STEP_U = 32;
const HEAD_PX = 18;
const LABEL_PX = 20;
const VALUE_PX = 20;
const RULE_PX = 16;
const HEAD_WEIGHT = 500;
const LABEL_WEIGHT = 500;
const FINAL_WEIGHT = 600;
const DIVIDER_HEIGHT_U = 1;
const DIVIDER_ALPHA = 0.18;

/** StatClamp.rule 네 값의 표기. 계약은 sim/world.ts의 StatClamp이고 여기는 이름만 짧게 쓴다 */
const RULE_LABELS: Readonly<Record<EffectiveStats['clamps'][number]['rule'], string>> = {
  'INV-1': 'INV-1',
  'INV-2': 'INV-2',
  hardLimit: '상한',
  bandOrder: '밴드순',
};

/** 표 한 줄. base가 null이면 「기본값」이라는 것이 없는 런타임 파생 행이다 */
export interface CheatStatRow {
  readonly label: string;
  readonly base: string | null;
  readonly final: string;
  /** clamps에서 옮겨 온 것만 들어간다. 없으면 아무것도 자르지 않았다는 뜻이다 */
  readonly rule: string | null;
}

export interface CheatStatParams {
  readonly stats: EffectiveStats;
  /** R05가 콤보 종속이라 현재 콤보가 표의 입력이다 */
  readonly combo: number;
  /** E03. 능력치는 스냅샷에, 현재 충전 수는 RunState에 있다 */
  readonly shieldCharges: number;
}

function secText(value: number): string {
  return `${value.toFixed(SEC_DECIMALS)}초`;
}

function distText(value: number): string {
  return `${value.toFixed(DIST_DECIMALS)}u`;
}

function mulText(value: number): string {
  return `×${value.toFixed(MUL_DECIMALS)}`;
}

function rateText(value: number): string {
  return `${value.toFixed(RATE_DECIMALS)}회/초`;
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(CLAMP_VALUE_DECIMALS)));
}

/**
 * 같은 필드를 두 단계가 자를 수 있다(5단계 하한 뒤에 7단계 INV-1). 최종값을 정한 것은
 * 마지막 것이므로 열에는 그것을 쓰고, 지나간 단계는 표 아래 「잘린 자리」가 전부 적는다.
 */
function ruleTagFor(stats: EffectiveStats, field: string): string | null {
  let tag: string | null = null;
  for (const clamp of stats.clamps) {
    if (clamp.field === field) {
      tag = `${clamp.step} ${RULE_LABELS[clamp.rule]}`;
    }
  }
  return tag;
}

function bandMaxDistU(stats: EffectiveStats, id: ParryGradeId): number {
  return stats.bands.find((band) => band.id === id)?.maxDistU ?? stats.parryRadiusU;
}

/** 마지막 밴드의 config 값은 null("패리 반경까지")이라 기본 반경으로 채운다 (12 §10 E-06) */
function baseBandMaxDistU(id: ParryGradeId): number {
  return PARRY_BANDS.find((band) => band.id === id)?.maxDistU ?? PARRY.radiusU;
}

function bandRow(stats: EffectiveStats, id: ParryGradeId): CheatStatRow {
  return {
    label: `${id} 밴드 상한`,
    base: distText(baseBandMaxDistU(id)),
    final: distText(bandMaxDistU(stats, id)),
    rule: ruleTagFor(stats, `bands.${id}.maxDistU`),
  };
}

/** §18.4가 이름을 댄 여섯 항목 + 08 §8.4의 파생 한 줄 */
export function buildSnapshotRows(stats: EffectiveStats): readonly CheatStatRow[] {
  const cooldownSec = stats.cooldownSecFor('hit');
  return [
    {
      label: '활성 시간',
      base: secText(PARRY.activeSec),
      final: secText(stats.parryActiveSec),
      rule: ruleTagFor(stats, 'parryActiveSec'),
    },
    {
      label: '쿨다운',
      base: secText(PARRY.cooldownSec),
      final: secText(cooldownSec),
      rule: ruleTagFor(stats, 'parryCooldownSec'),
    },
    {
      label: '패리 무적',
      base: secText(PARRY.invulnSec),
      final: secText(stats.parryInvulnSec),
      rule: ruleTagFor(stats, 'parryInvulnSec'),
    },
    {
      label: '패리 반경',
      base: distText(PARRY.radiusU),
      final: distText(stats.parryRadiusU),
      rule: ruleTagFor(stats, 'parryRadiusU'),
    },
    bandRow(stats, 'GREAT'),
    bandRow(stats, 'GOOD'),
    {
      label: '반사탄 데미지 배수',
      base: mulText(NO_CARD_DAMAGE_MUL),
      final: mulText(stats.reflectDamageMulFor(0)),
      rule: null,
    },
    {
      label: '(파생) 초당 최대 패리',
      base: rateText(1 / PARRY.cooldownSec),
      final: rateText(1 / cooldownSec),
      rule: null,
    },
  ];
}

/** 12 §10 E-05의 넷. R05는 현재 콤보와 콤보 0을 나란히 둔다 — 차이가 곧 그 카드의 실효다 */
export function buildRuntimeRows(params: CheatStatParams): readonly CheatStatRow[] {
  const stats = params.stats;
  const minGapSec = stats.r10ActiveMinGapSec;
  return [
    {
      label: '쿨다운 (빈 패리)',
      base: null,
      final: secText(stats.cooldownSecFor('empty')),
      rule: ruleTagFor(stats, 'whiffCooldownSec'),
    },
    {
      label: `반사탄 데미지 (콤보 ${params.combo})`,
      base: null,
      final: mulText(stats.reflectDamageMulFor(params.combo)),
      rule: null,
    },
    {
      label: '반사탄 데미지 (콤보 0)',
      base: null,
      final: mulText(stats.reflectDamageMulFor(0)),
      rule: null,
    },
    {
      label: 'R10 최소 간격',
      base: null,
      final: minGapSec === null ? EMPTY_CELL : secText(minGapSec),
      rule: null,
    },
    {
      label: 'E03 보호막 중첩',
      base: null,
      final: `${params.shieldCharges} / ${stats.shieldMaxCharges}`,
      rule: null,
    },
  ];
}

/**
 * 표의 네 열이 담지 못하는 것 전부. 같은 필드를 두 번 자른 경우의 앞 단계와, 표에 행이 없는
 * 필드(이동 속도·최대 라이프)가 여기 남는다 — 잘린 자리가 화면에서 사라지면 안 된다.
 */
export function buildClampLines(stats: EffectiveStats): readonly string[] {
  return stats.clamps.map(
    (clamp) => `${clamp.step}단계 ${RULE_LABELS[clamp.rule]} · ${clamp.field} → ${trimmed(clamp.after)}`,
  );
}

function drawDivider(ctx: CanvasRenderingContext2D, yU: number): void {
  ctx.save();
  ctx.globalAlpha = DIVIDER_ALPHA;
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.fillRect(TABLE_X_U, yU, TABLE_RIGHT_U - TABLE_X_U, DIVIDER_HEIGHT_U);
  ctx.restore();
}

function drawHead(ctx: CanvasRenderingContext2D, text: string, yU: number): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `${HEAD_WEIGHT} ${HEAD_PX}px ${FONTS.data}`;
  ctx.fillText(text, TABLE_X_U, yU);
}

function drawRow(ctx: CanvasRenderingContext2D, row: CheatStatRow, yU: number): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekMute;
  ctx.font = `${LABEL_WEIGHT} ${LABEL_PX}px ${FONTS.data}`;
  ctx.fillText(row.label, TABLE_X_U, yU);

  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.fillText(row.base ?? EMPTY_CELL, BASE_RIGHT_U, yU);

  ctx.fillStyle = PALETTE.baek;
  ctx.font = `${FINAL_WEIGHT} ${VALUE_PX}px ${FONTS.data}`;
  ctx.fillText(row.final, FINAL_RIGHT_U, yU);

  ctx.textAlign = 'left';
  ctx.font = `${LABEL_WEIGHT} ${RULE_PX}px ${FONTS.data}`;
  ctx.fillStyle = row.rule === null ? PALETTE.baekFaint : PALETTE.hwang;
  ctx.fillText(row.rule ?? EMPTY_CELL, RULE_X_U, yU);
}

function drawRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly CheatStatRow[],
  firstYU: number,
): number {
  rows.forEach((row, index) => {
    drawRow(ctx, row, firstYU + index * ROW_STEP_U);
  });
  return firstYU + rows.length * ROW_STEP_U;
}

/** 08 §8.7의 우열 하나. 좌열의 커서와 무관하게 언제나 현재 빌드의 계산 결과를 보인다 */
export function drawStatPanel(ctx: CanvasRenderingContext2D, params: CheatStatParams): void {
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  drawHead(ctx, '항목                 기본값      최종   자른 규칙', HEAD_FIRST_YU);
  let nextYU = drawRows(ctx, buildSnapshotRows(params.stats), ROW_FIRST_YU);

  drawDivider(ctx, nextYU);
  nextYU += SECTION_GAP_U;
  drawHead(ctx, '런타임 파생 — 카드 목록이 그대로여도 바뀐다 (E-05)', nextYU);
  nextYU = drawRows(ctx, buildRuntimeRows(params), nextYU + ROW_STEP_U);

  drawDivider(ctx, nextYU);
  nextYU += SECTION_GAP_U;
  drawHead(ctx, '잘린 자리 — §11.6의 어느 단계가 값을 되돌렸나', nextYU);
  nextYU += ROW_STEP_U;

  const lines = buildClampLines(params.stats);
  ctx.textAlign = 'left';
  ctx.font = `${LABEL_WEIGHT} ${RULE_PX}px ${FONTS.data}`;
  if (lines.length === 0) {
    ctx.fillStyle = PALETTE.baekFaint;
    ctx.fillText('없음 — 어떤 상한도 이 빌드를 자르지 않았다', TABLE_X_U, nextYU);
  } else {
    ctx.fillStyle = PALETTE.hwang;
    lines.forEach((line, index) => {
      ctx.fillText(line, TABLE_X_U, nextYU + index * RULE_LINE_STEP_U);
    });
  }
  ctx.restore();
}
