/**
 * HUD — 목업 engine.js drawHud 이식 + 누락분 (06_렌더링과_게임필.md §1.10 · 08_화면과_UI.md §2)
 *
 * draw* 다섯이 목업 drawHud(1669-1740)의 블록 하나씩에 대응하고 뒤의 둘은 신규다(06 §5.1 · §5.2).
 *
 * **HUD는 흔들리지 않는다** (06 §2 레이어 11). 목업 render()가 흔들림 translate를
 * restore(engine.js:1975)한 뒤 drawHud(:1978)를 부르는 것이 그 계약이고, 흔들리는 숫자는
 * §15.1이 요구한 "즉시 셀 수 있는 형태"가 아니다. 흔들림 안쪽에 붙는 부위 게이지(10 A22)는
 * render/enemy-parts.ts가, 재패리 라벨은 발사체 좌표라 render/bullet.ts가 갖는다(12 §2).
 *
 * **연출 상태는 HudAnim이 갖는다.** 렌더가 sim을 한 줄도 바꾸지 않으므로(HR-06) 감쇠·스쿼시·
 * 맥동의 진행값을 sim에 쓸 수 없다. HudAnim은 이 파일이 소유하고 realDt로 돈다.
 */

import type { StageId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { COMBO_WARN_SEC } from '../config/scoring';
import { FONTS, UI } from '../config/ui';
import { clamp01, damp, easeOutBack, lerp } from '../core/math';
import { glow, hatch, hexA, poly, type PolyPoint } from './primitives';

/** §15의 화면 표가 요소마다 정한 CSS font-weight. ui.ts는 크기만 갖고 굵기 칸이 없다 */
const WEIGHT = { value: 600, label: 500, combo: 700 };
/** 목업이 직접 적은 알파들 (engine.js:1677 · 1697 · 1704 · 1734 · 1680 · 1709) */
const LIFE_EMPTY_STROKE = hexA(PALETTE.baek, 0.4);
const PROGRESS_TRACK = hexA(PALETTE.baek, 0.14);
const BOSS_TRACK = hexA(PALETTE.baek, 0.12);
const COMBO_GAUGE_TRACK = hexA(PALETTE.baek, 0.14);
const LIFE_GLOW_ALPHA = 0.5;
const BOSS_GLOW_ALPHA = 0.6;
/** 06 §4.7 "HUD 점수 증가 — 지수 감쇠 decay = 12". 프레임률 독립이라 144Hz에서도 같은 곡선이다 */
const SCORE_DECAY_PER_SEC = 12;
/**
 * 06 §4.8 스쿼시 표. scaleX와 scaleY가 반드시 반대로 움직인다 — 단일 scale()은 무게가 아니라
 * 풍선이다. 페이즈 번호 갱신(06 §5.8)은 길이가 없어 콤보 숫자와 같은 0.10초를, 음소거 전환은
 * 06 §4.8의 등급 팝업 등장 값을 쓴다.
 */
const LIFE_SQUASH = { sec: 0.18, scaleX: 0.8, scaleY: 1.2 };
const COUNT_SQUASH = { sec: 0.1, scaleX: 1.1, scaleY: 0.92 };
const MUTE_POP = { sec: 0.15, scaleX: 1.12, scaleY: 0.9 };
/**
 * 06 §5.8 페이즈 전환 **예고**. 다음 임계값 + 3%에 닿는 순간부터 그 눈금이 1.6초 주기로 폭
 * 3u ↔ 9u로 맥동한다. 9u 대신 배율 3인 것은 notchStrokeU와 갈리지 않게 하려는 것이다.
 */
const PHASE_PULSE_PERIOD_SEC = 1.6;
const PHASE_PULSE_MARGIN = 0.03;
const NOTCH_PULSE_WIDTH_SCALE = 3;
/** 취소선 치수는 ui.ts에 칸이 없어 글자 크기에서 유도한다. 0.3은 모노 대문자의 중앙 높이 비율 */
const MUTE_STRIKE_CENTER_RATIO = 0.3;
const MUTE_STRIKE_WIDTH_RATIO = 0.09;
const CHEAT_MARK_TEXT = '치트 — 오염된 런'; // §18.5 — 08 §2.3 (b)가 글자까지 확정했다
const MUTE_TEXT_ON = '♪';   // §15.1 정상 — 흐리게
const MUTE_TEXT_OFF = 'MUTE'; // §15.1 음소거 — 진하게 + 취소선
/** 목업이 가운뎃점 좌우로 공백 두 칸을 준다 (engine.js:1717 · :1696) */
const BOSS_PHASE_JOIN = '  ·  ';
const STAGE_WAVE_JOIN = ' · ';

export interface HudBossView {
  readonly name: string; readonly phase: number;
  /** hpRatio는 0~1로 목업 h.boss.hp와 같고, §10.4 페이즈 임계값도 같은 축의 비율이다 */
  readonly hpRatio: number; readonly phaseThresholds: readonly number[];
}

/**
 * §12.2 콤보. 두 필드가 목업의 버그 둘을 각각 막는다.
 *
 * **multiplier는 이미 잘려서 들어온다** (10 A10). 목업(1729)은 `1 + floor(combo/10) × 0.1`을
 * 렌더에서 다시 계산해 상한이 없었고 콤보 210부터 화면만 ×3.1을 말했다. 계산은 sim/world.ts
 * comboMultiplier가, 상한 3.0은 config/scoring.ts가 갖는다. **holdSec은 상수가 아니다**
 * (10 A11): 목업(1733)의 `1 − ((t % 3) / 3)`은 마지막 패리 시각을 안 읽는 톱니파였고, 여기
 * 들어올 값은 카드 반영 후의 실효값이다 — N11이 4.5초까지 늘린다.
 */
export interface HudComboView {
  readonly count: number; readonly multiplier: number;
  readonly remainSec: number; readonly holdSec: number;
}

/**
 * HUD가 읽는 전부. sim 타입을 그대로 받지 않는 것은 소유자가 넷으로 흩어져 있어서다 — 라이프·
 * 콤보는 sim/world.ts, 실효 유지 시간은 sim/stats.ts, 진행도와 웨이브는 화면 계층, 음소거와
 * 오염 표시는 sim 밖이다. **maxLife는 상수가 아니다** (10 A19): `3 + R06 중첩 수`다 —
 * ui.ts의 maxSlots 5를 넣으면 카드를 안 든 런에도 빈 칸이 두 개 뜨고, 그 신호가 사라진다.
 */
export interface HudView {
  readonly life: number; readonly maxLife: number; readonly score: number;
  readonly stage: StageId; readonly progress: number;
  /** 'W4  0:51 / 1:00' 형태. 웨이브가 없으면 빈 문자열이다 (engine.js:1696) */
  readonly wave: string;
  readonly boss: HudBossView | null; readonly combo: HudComboView | null;
  readonly muted: boolean;
  /** §18.5 치트 메뉴를 연 순간부터 런 종료까지 true. 런 도중에는 해제되지 않는다 */
  readonly cheated: boolean;
}

/** 연출 진행값. 전부 realDt로 돌고 어느 것도 판정에 닿지 않는다 */
export interface HudAnim {
  elapsedSec: number;
  scoreShown: number;
  /** lifeSquashIndex는 방금 비워진 칸이다 — 감소 후의 life 값과 같다 */
  lifeSquashSec: number; lifeSquashIndex: number; prevLife: number;
  countSquashSec: number; prevCombo: number;
  phaseSquashSec: number; prevPhase: number;
  mutePopSec: number; prevMuted: boolean;
}

export function createHudAnim(): HudAnim {
  return {
    elapsedSec: 0, scoreShown: 0, lifeSquashSec: 0, lifeSquashIndex: -1, prevLife: 0,
    countSquashSec: 0, prevCombo: 0, phaseSquashSec: 0, prevPhase: 0, mutePopSec: 0, prevMuted: false,
  };
}

function setFont(ctx: CanvasRenderingContext2D, weight: number, sizePx: number): void {
  ctx.font = `${weight} ${sizePx}px ${FONTS.data}`;
}

type SquashKey = { readonly scaleX: number; readonly scaleY: number };
/** 스쿼시 원점을 옮겨 건다. 원점이 가운데면 착지가 아니라 심장박동으로 읽힌다 (06 §4.8) */
function squashAround(ctx: CanvasRenderingContext2D, xU: number, yU: number, key: SquashKey, progress: number): void {
  ctx.translate(xU, yU);
  ctx.scale(lerp(key.scaleX, 1, progress), lerp(key.scaleY, 1, progress));
  ctx.translate(-xU, -yU);
}

/** 남은 시간 → 0~1 진행도 */
function squashProgress(remainSec: number, totalSec: number): number {
  return remainSec <= 0 ? 1 : 1 - remainSec / totalSec;
}

/** 이식: engine.js drawHud (1686) — 천 단위 콤마 정규식 그대로 */
function withThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 변화 감지가 직전 프레임 값과의 비교인 것은, sim의 이벤트 큐를 소비하면 그 이벤트가 다른 소비자에게서 사라져서다 */
function advanceHudAnim(anim: HudAnim, view: HudView, realDtSec: number): void {
  anim.elapsedSec += realDtSec;
  anim.scoreShown = damp(anim.scoreShown, view.score, SCORE_DECAY_PER_SEC, realDtSec);
  if (view.life < anim.prevLife) {
    anim.lifeSquashSec = LIFE_SQUASH.sec;
    anim.lifeSquashIndex = view.life;
  }
  anim.prevLife = view.life;
  anim.lifeSquashSec = Math.max(0, anim.lifeSquashSec - realDtSec);
  const comboCount = view.combo === null ? 0 : view.combo.count;
  if (comboCount > anim.prevCombo) {
    anim.countSquashSec = COUNT_SQUASH.sec;
  }
  anim.prevCombo = comboCount;
  anim.countSquashSec = Math.max(0, anim.countSquashSec - realDtSec);
  // 보스가 없는 프레임의 페이즈는 0이다. 0 → 1은 전환이 아니라 등장이라 스쿼시하지 않는다
  const phase = view.boss === null ? 0 : view.boss.phase;
  if (phase > anim.prevPhase && anim.prevPhase > 0) {
    anim.phaseSquashSec = COUNT_SQUASH.sec;
  }
  anim.prevPhase = phase;
  anim.phaseSquashSec = Math.max(0, anim.phaseSquashSec - realDtSec);
  if (view.muted !== anim.prevMuted) {
    anim.mutePopSec = MUTE_POP.sec;
  }
  anim.prevMuted = view.muted;
  anim.mutePopSec = Math.max(0, anim.mutePopSec - realDtSec);
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawHud 라이프 pip (1673-1681) — 감소 스쿼시 추가
 *
 * **최대치 칸은 비어 있어도 항상 그린다** — 카드로 최대 라이프가 늘었다는 사실(R06)이 빈 칸
 * 하나로만 읽힌다(§15.1). 칸 수는 maxLife이고 maxSlots는 상한일 뿐이다(10 A19).
 */
export function drawLifePips(ctx: CanvasRenderingContext2D, view: HudView, anim: HudAnim): void {
  const life = UI.hud.life;
  const slots = Math.min(view.maxLife, life.maxSlots);
  for (let i = 0; i < slots; i += 1) {
    const xU = life.firstCenterXU + i * life.stepXU;
    const yU = life.centerYU;
    ctx.save();
    if (i === anim.lifeSquashIndex && anim.lifeSquashSec > 0) {
      squashAround(ctx, xU, yU, LIFE_SQUASH, squashProgress(anim.lifeSquashSec, LIFE_SQUASH.sec));
    }
    const d = life.halfDiagU;
    const diamond: PolyPoint[] = [[xU, yU - d], [xU + d, yU], [xU, yU + d], [xU - d, yU]];
    ctx.strokeStyle = LIFE_EMPTY_STROKE;
    ctx.lineWidth = life.emptyStrokeU;
    poly(ctx, diamond);
    ctx.stroke();
    if (i < view.life) {
      ctx.fillStyle = PALETTE.cheong;
      ctx.fill();
      glow(ctx, xU, yU, life.filledGlowRU, PALETTE.cheong, LIFE_GLOW_ALPHA);
    }
    ctx.restore();
  }
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawHud 점수 (1683-1690) — 증가 애니메이션 추가
 *
 * §15.1의 "획득 시 증가 애니메이션" 때문에 즉시 갱신을 지수 감쇠로 바꾼다. 표시값
 * anim.scoreShown과 실제 점수가 다른 것이 이 연출 자체다.
 */
export function drawScore(ctx: CanvasRenderingContext2D, anim: HudAnim): void {
  const score = UI.hud.score;
  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.baek;
  setFont(ctx, WEIGHT.value, score.valuePx);
  ctx.fillText(withThousands(Math.round(anim.scoreShown)), score.rightXU, score.valueBaselineYU);
  setFont(ctx, WEIGHT.label, score.labelPx);
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.fillText('SCORE', score.rightXU, score.labelBaselineYU);
}

/** 이식: docs/sample_image/_shared/engine.js drawHud 스테이지·진행도 (1692-1700) — 그대로 */
export function drawStageProgress(ctx: CanvasRenderingContext2D, view: HudView): void {
  const stage = UI.hud.stage;
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.baekMute;
  setFont(ctx, WEIGHT.label, stage.labelPx);
  const wave = view.wave === '' ? '' : STAGE_WAVE_JOIN + view.wave;
  ctx.fillText(`STAGE ${view.stage}${wave}`, stage.centerXU, stage.labelBaselineYU);
  ctx.fillStyle = PROGRESS_TRACK;
  ctx.fillRect(stage.barXU, stage.barYU, stage.barWidthU, stage.barHeightU);
  ctx.fillStyle = PALETTE.cheong;
  ctx.fillRect(stage.barXU, stage.barYU, stage.barWidthU * clamp01(view.progress), stage.barHeightU);
}

/** 다음에 닿을 임계값. hpRatio보다 작은 것 중 가장 큰 것이고, 마지막 페이즈면 null이다 */
function nextPhaseThreshold(boss: HudBossView): number | null {
  let next: number | null = null;
  for (const threshold of boss.phaseThresholds) {
    if (threshold < boss.hpRatio && (next === null || threshold > next)) {
      next = threshold;
    }
  }
  return next;
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawHud 보스 바 (1702-1718) — 전환 예고 맥동 추가
 *
 * 눈금이 배경색(ink900)인 것은 바를 깎아내는 방식이라 새 색이 필요 없어서다(§15.1). 06 §5.8이
 * 요구한 것은 **예고**이고 전환 뒤에 알리는 것은 요건 미달이라, 다음 임계값 + 3%에 닿는
 * 순간부터 그 눈금만 맥동한다. 짝이 되는 본체 외곽선 맥동은 render/boss.ts가 갖는다.
 */
export function drawBossBar(ctx: CanvasRenderingContext2D, boss: HudBossView, anim: HudAnim): void {
  const bar = UI.hud.boss;
  const filledU = bar.widthU * clamp01(boss.hpRatio);
  ctx.fillStyle = BOSS_TRACK;
  ctx.fillRect(bar.xU, bar.yU, bar.widthU, bar.heightU);
  ctx.fillStyle = PALETTE.jeok;
  ctx.fillRect(bar.xU, bar.yU, filledU, bar.heightU);
  glow(ctx, bar.xU + filledU, bar.yU + bar.heightU / 2, bar.endGlowRU, PALETTE.jeok, BOSS_GLOW_ALPHA);
  const nextThreshold = nextPhaseThreshold(boss);
  const warning = nextThreshold !== null && boss.hpRatio <= nextThreshold + PHASE_PULSE_MARGIN;
  const pulse = (1 - Math.cos((anim.elapsedSec / PHASE_PULSE_PERIOD_SEC) * Math.PI * 2)) / 2;
  ctx.strokeStyle = PALETTE.ink900;
  for (const threshold of boss.phaseThresholds) {
    ctx.lineWidth = warning && threshold === nextThreshold
      ? lerp(bar.notchStrokeU, bar.notchStrokeU * NOTCH_PULSE_WIDTH_SCALE, pulse)
      : bar.notchStrokeU;
    const notchXU = bar.xU + bar.widthU * threshold;
    ctx.beginPath();
    ctx.moveTo(notchXU, bar.yU - bar.notchOverhangU);
    ctx.lineTo(notchXU, bar.yU + bar.heightU + bar.notchOverhangU);
    ctx.stroke();
  }
  ctx.save();
  if (anim.phaseSquashSec > 0) {
    const progress = squashProgress(anim.phaseSquashSec, COUNT_SQUASH.sec);
    squashAround(ctx, bar.xU, bar.nameBaselineYU, COUNT_SQUASH, progress);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.baekMute;
  setFont(ctx, WEIGHT.label, bar.namePx);
  ctx.fillText(`${boss.name}${BOSS_PHASE_JOIN}PHASE ${boss.phase}`, bar.xU, bar.nameBaselineYU);
  ctx.restore();
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawHud 콤보 (1720-1738) — 수정 셋
 *
 * ①③ 잔여 시간과 배수 상한은 HudComboView 주석이 갖는다 (10 A11 · A10).
 * ② 배수 x가 고정 220u다. 목업(1729)은 measureText로 콤보 숫자 폭을 쟀는데 직전 줄에서 폰트가
 *    50px → 24px로 바뀌어 실제의 48%를 재고 있었다 — 4자리부터 겹친다(10 A21). 모노 서체라
 *    고정값이 자릿수와 무관하게 안정적이다.
 *
 * 콤보 0이면 이 블록이 통째로 사라진다. **상시 표시로 바꾸지 않는다** — 사라지는 것 자체가
 * "콤보가 스테이지를 넘지 않는다"(§12.2)를 알리는 유일한 신호다.
 */
export function drawCombo(ctx: CanvasRenderingContext2D, combo: HudComboView, anim: HudAnim): void {
  const ui = UI.hud.combo;
  ctx.textAlign = 'left';
  ctx.save();
  if (anim.countSquashSec > 0) {
    // 원점은 숫자 좌하단 — 왼쪽 정렬선과 베이스라인이 만나는 점이다 (06 §4.8)
    const progress = squashProgress(anim.countSquashSec, COUNT_SQUASH.sec);
    squashAround(ctx, ui.leftXU, ui.countBaselineYU, COUNT_SQUASH, progress);
  }
  ctx.fillStyle = PALETTE.hwang;
  setFont(ctx, WEIGHT.combo, ui.countPx);
  ctx.fillText(String(combo.count), ui.leftXU, ui.countBaselineYU);
  ctx.restore();
  setFont(ctx, WEIGHT.value, ui.multiplierPx);
  ctx.fillStyle = PALETTE.baek;
  ctx.fillText(`×${combo.multiplier.toFixed(1)}`, ui.multiplierXU, ui.multiplierBaselineYU);
  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, WEIGHT.label, ui.labelPx);
  ctx.fillText('COMBO', ui.leftXU, ui.labelBaselineYU);
  ctx.fillStyle = COMBO_GAUGE_TRACK;
  ctx.fillRect(ui.gaugeXU, ui.gaugeYU, ui.gaugeWidthU, ui.gaugeHeightU);
  // §17 "끊기기 직전임을 알린다". 비율이 아니라 남은 초로 판정해야 N11이 유지 시간을 늘려도
  // 게이지가 적색이 되는 순간과 오디오 경고 3핍이 같은 순간에 온다 (12 §8-5)
  ctx.fillStyle = combo.remainSec <= COMBO_WARN_SEC ? PALETTE.jeok : PALETTE.hwang;
  const gauge = clamp01(combo.remainSec / combo.holdSec);
  ctx.fillRect(ui.gaugeXU, ui.gaugeYU, ui.gaugeWidthU * gauge, ui.gaugeHeightU);
}

/**
 * 신규: 음소거 상태 상시 표시 — 스펙 §15.1 · 06 §5.1 · 08 §2.3 (a)
 *
 * **음소거일 때만 켜는 배지가 아니다.** §17이 요구한 것은 "지금 소리가 나고 있는가"를 화면만
 * 보고 아는 것이고, 쿨다운 종료음이 안 들리는 것이 음소거 때문인지 버그인지를 이것이 가른다.
 * 정상을 흐리게 음소거를 진하게 칠하는 것은 음소거가 잊어버렸을 때만 문제가 되기 때문이고
 * (08 §2.3 a), 기호가 글자로 바뀌고 취소선이 붙는 것이 색과 별개인 형태 축이다(§17).
 */
export function drawMuteState(ctx: CanvasRenderingContext2D, view: HudView, anim: HudAnim): void {
  const mute = UI.hud.mute;
  ctx.save();
  if (anim.mutePopSec > 0) {
    const progress = easeOutBack(squashProgress(anim.mutePopSec, MUTE_POP.sec));
    squashAround(ctx, mute.rightXU, mute.baselineYU, MUTE_POP, progress);
  }
  ctx.textAlign = 'right';
  setFont(ctx, WEIGHT.label, mute.px);
  ctx.fillStyle = view.muted ? PALETTE.baek : PALETTE.baekFaint;
  const text = view.muted ? MUTE_TEXT_OFF : MUTE_TEXT_ON;
  ctx.fillText(text, mute.rightXU, mute.baselineYU);
  if (view.muted) {
    // 방금 그린 크기 그대로 잰다. 목업 1729가 다른 크기로 재서 틀린 자리와 같은 함정이다
    const widthU = ctx.measureText(text).width;
    const strikeYU = mute.baselineYU - mute.px * MUTE_STRIKE_CENTER_RATIO;
    ctx.strokeStyle = PALETTE.baek;
    ctx.lineWidth = mute.px * MUTE_STRIKE_WIDTH_RATIO;
    ctx.beginPath();
    ctx.moveTo(mute.rightXU - widthU, strikeYU);
    ctx.lineTo(mute.rightXU, strikeYU);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 신규: 치트 오염 상시 표시 — 스펙 §18.5 · 06 §5.2 · 08 §2.3 (b)
 *
 * **모서리 배지가 아니라 하단 전폭 띠다.** §18.6이 "오염 표시가 HUD에 떠 있는 화면은 그대로
 * 실격 사유"라고 못 박았으므로 설계 목표가 어떤 크롭에서도 남는 것이고, 그래서 촬영본 확인용
 * 장치이기도 하다. **깜빡이지 않는다** — 경고가 아니라 정보라 §17의 "신호가 피로하지 않아야
 * 한다"에 걸린다. **색이 아니라 사선 해칭**인 것은 팔레트의 색에 전부 임자가 있어서다.
 */
export function drawCheatMark(ctx: CanvasRenderingContext2D): void {
  const mark = UI.hud.cheatMark;
  ctx.save();
  ctx.globalAlpha = mark.hatchAlpha;
  ctx.fillStyle = hatch();
  ctx.fillRect(mark.xU, mark.yU, mark.widthU, mark.heightU);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.baek;
  setFont(ctx, WEIGHT.value, mark.labelPx);
  ctx.fillText(CHEAT_MARK_TEXT, mark.labelCenterXU, mark.labelBaselineYU);
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawHud (1669-1740) — 블록 순서 그대로 + 신규 둘
 *
 * realDtSec는 연출 시간이다 — sim의 FIXED_DT가 아니고, 히트스톱으로 sim이 멈춘 프레임에도
 * 감쇠와 스쿼시는 돈다. **이 함수는 view를 읽기만 하고 anim만 쓴다** (HR-06). textBaseline
 * 한 줄은 목업에 없다: 기본값 alphabetic에 기대는데 ui.ts의 y가 전부 베이스라인 좌표라,
 * 앞 레이어가 baseline을 바꾸고 갔으면 HUD가 통째로 어긋난다.
 */
export function drawHud(ctx: CanvasRenderingContext2D, view: HudView, anim: HudAnim, realDtSec: number): void {
  advanceHudAnim(anim, view, realDtSec);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  drawLifePips(ctx, view, anim);
  drawScore(ctx, anim);
  drawStageProgress(ctx, view);
  if (view.boss !== null) {
    drawBossBar(ctx, view.boss, anim);
  }
  if (view.combo !== null && view.combo.count > 0) {
    drawCombo(ctx, view.combo, anim);
  }
  drawMuteState(ctx, view, anim);
  if (view.cheated) {
    drawCheatMark(ctx);
  }
  ctx.restore();
}
