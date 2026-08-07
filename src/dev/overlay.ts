/**
 * 개발 오버레이 — fps · 프레임 타임 p50/p95/p99 · 엔티티 수 · 드로우 콜 수 · 합성 모드 전환 수
 * — 11_구현_계획.md §3, 06_렌더링과_게임필.md §3.7.2
 *
 * **드로우 콜을 추정하지 않고 실제로 센다.** 06 §3.5의 예산 표(2,668)와 13의 실측 상한
 * (2,013, p95 기준)이 맞는지를 P1이 판정해야 하는데, 코드가 세어 준 숫자와 표의 숫자가
 * 다르면 그 차이 자체가 발견이다. 손으로 더한 값을 표시하면 그 발견이 영영 안 나온다.
 *
 * 세는 방법은 ctx의 메서드를 감싸는 것이다. 호출부가 오버레이를 몰라도 세어지고, 나중에
 * 붙는 render/ 코드가 계수를 빠뜨릴 방법이 없다.
 *
 * 세는 대상은 12 §10 E-15가 정한 넷 — drawImage · fill · stroke · fillText다.
 * **fillRect과 strokeRect도 각각 fill과 stroke로 센다** — 06 §3.5의 예산 표가 파티클 240과
 * 임팩트 프레임 1을 fillRect로 세어 두었으므로, 빼면 검증하려는 표와 단위가 달라진다.
 */

import { PALETTE } from '../config/palette';
import { FONTS } from '../config/ui';

/** 게이트 (06 §3.7.2). p99가 이 값을 넘으면 실패다 */
const FRAME_BUDGET_MS = 16.67;

/** 13 §3.2 실측 드로우 콜 상한 (p95 기준). 확정값이 아니라 안전한 하한이다 — 13 §1-B */
const DRAW_CALL_LIMIT = 2013;

/** 06 §3.7.2 — 측정 창은 600프레임이다 */
const SAMPLE_CAPACITY = 600;

/** 백분위를 매 프레임 다시 정렬하면 오버레이가 자기 측정을 오염시킨다 */
const RECOMPUTE_INTERVAL_FRAMES = 15;

/** rAF 간격이 이보다 크면 vsync를 놓친 프레임으로 센다 (ms). 16.67의 1.2배 */
const DROPPED_FRAME_MS = 20;

const PANEL_X_U = 24;
const PANEL_Y_U = 150;
const PANEL_WIDTH_U = 470;
const PANEL_PAD_U = 16;
const PANEL_LINE_STEP_U = 30;
const PANEL_FONT_PX = 22;
const PANEL_FONT_WEIGHT = 500;
const MS_DECIMALS = 2;

interface Counters {
  drawCalls: number;
  compositeSwitches: number;
}

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
}

const live: Counters = { drawCalls: 0, compositeSwitches: 0 };
const frozen: Counters = { drawCalls: 0, compositeSwitches: 0 };
let peakDrawCalls = 0;

const cpuSamplesMs = new Float64Array(SAMPLE_CAPACITY);
const frameSamplesMs = new Float64Array(SAMPLE_CAPACITY);
const scratch = new Float64Array(SAMPLE_CAPACITY);
let sampleCount = 0;
let sampleCursor = 0;
let droppedFrames = 0;

let frameStartMs = 0;
let previousFrameStartMs = Number.NaN;
let entityCount = 0;
let framesSinceRecompute = RECOMPUTE_INTERVAL_FRAMES;
let cpu: Percentiles = { p50: 0, p95: 0, p99: 0 };
let wall: Percentiles = { p50: 0, p95: 0, p99: 0 };
let fps = 0;
let instrumented = false;

type CanvasCtx = CanvasRenderingContext2D;
type DrawImageRaw = (
  this: CanvasCtx,
  image: CanvasImageSource,
  a: number, b: number, c?: number, d?: number,
  e?: number, f?: number, g?: number, h?: number,
) => void;
type FillRaw = (this: CanvasCtx, a?: unknown, b?: unknown) => void;
type StrokeRaw = (this: CanvasCtx, a?: unknown) => void;
type RectRaw = (this: CanvasCtx, x: number, y: number, w: number, h: number) => void;
type TextRaw = (this: CanvasCtx, text: string, x: number, y: number, maxWidth?: number) => void;

/**
 * ctx의 그리기 메서드를 계수 래퍼로 갈아 끼운다. 같은 ctx에 두 번 걸면 두 배로 세므로 한 번만 건다.
 *
 * 래퍼가 나머지 인자(rest)를 안 쓰는 것은 의도다 — 프레임당 2,600회면 인자 배열도 2,600개고,
 * 그 할당이 만든 GC가 재려는 p99에 그대로 섞인다.
 */
export function instrumentContext(ctx: CanvasCtx): void {
  if (instrumented) {
    return;
  }
  instrumented = true;

  const target = ctx as unknown as {
    drawImage: DrawImageRaw;
    fill: FillRaw;
    stroke: StrokeRaw;
    fillRect: RectRaw;
    strokeRect: RectRaw;
    fillText: TextRaw;
  };

  const rawDrawImage = target.drawImage;
  target.drawImage = function (image, a, b, c, d, e, f, g, h): void {
    live.drawCalls += 1;
    if (c === undefined) {
      rawDrawImage.call(this, image, a, b);
    } else if (e === undefined) {
      rawDrawImage.call(this, image, a, b, c, d);
    } else {
      rawDrawImage.call(this, image, a, b, c, d, e, f, g, h);
    }
  };

  const rawFill = target.fill;
  target.fill = function (a, b): void {
    live.drawCalls += 1;
    if (a === undefined) {
      rawFill.call(this);
    } else if (b === undefined) {
      rawFill.call(this, a);
    } else {
      rawFill.call(this, a, b);
    }
  };

  const rawStroke = target.stroke;
  target.stroke = function (a): void {
    live.drawCalls += 1;
    if (a === undefined) {
      rawStroke.call(this);
    } else {
      rawStroke.call(this, a);
    }
  };

  const rawFillRect = target.fillRect;
  target.fillRect = function (x, y, w, h): void {
    live.drawCalls += 1;
    rawFillRect.call(this, x, y, w, h);
  };

  const rawStrokeRect = target.strokeRect;
  target.strokeRect = function (x, y, w, h): void {
    live.drawCalls += 1;
    rawStrokeRect.call(this, x, y, w, h);
  };

  const rawFillText = target.fillText;
  target.fillText = function (text, x, y, maxWidth): void {
    live.drawCalls += 1;
    if (maxWidth === undefined) {
      rawFillText.call(this, text, x, y);
    } else {
      rawFillText.call(this, text, x, y, maxWidth);
    }
  };

  instrumentCompositeOperation(ctx);
}

/**
 * 합성 모드 전환은 값이 **실제로 바뀔 때만** 센다. 같은 값을 다시 대입하는 것은 래스터라이저의
 * 배치를 끊지 않으므로 전환이 아니고, 06 §3.5가 세는 1,040 대 2도 그 기준이다.
 */
function instrumentCompositeOperation(ctx: CanvasCtx): void {
  const proto: object = Object.getPrototypeOf(ctx) as object;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'globalCompositeOperation');
  const read = descriptor?.get;
  const write = descriptor?.set;
  if (read === undefined || write === undefined) {
    console.error('globalCompositeOperation 접근자를 못 찾았다 — 전환 수를 세지 않는다');
    return;
  }
  Object.defineProperty(ctx, 'globalCompositeOperation', {
    configurable: true,
    get(this: CanvasCtx): unknown {
      return read.call(this);
    },
    set(this: CanvasCtx, value: unknown): void {
      if (read.call(this) !== value) {
        live.compositeSwitches += 1;
      }
      write.call(this, value);
    },
  });
}

/** 프레임의 그리기 시작 직전에 부른다. nowMs는 rAF가 준 타임스탬프다 */
export function beginFrame(nowMs: number): void {
  live.drawCalls = 0;
  live.compositeSwitches = 0;
  frameStartMs = nowMs;
}

/**
 * 프레임의 그리기 직후, 오버레이를 그리기 **전에** 부른다.
 * 여기서 계수를 얼려 두므로 오버레이 자신의 fillText는 표시값에 안 들어간다.
 *
 * 두 시계를 따로 재는 이유 — cpu는 우리 코드가 쓴 시간이고 13의 「호출당 비용 × 호출 수」
 * 예측이 그것과 맞는지를 본다. wall은 rAF 간격이라 GPU가 못 따라오면 여기서만 드러난다.
 * 게이트의 "p99 ≤ 16.67ms"는 둘 다 만족해야 의미가 있다.
 */
export function endFrame(nowMs: number, entities: number): void {
  frozen.drawCalls = live.drawCalls;
  frozen.compositeSwitches = live.compositeSwitches;
  peakDrawCalls = Math.max(peakDrawCalls, live.drawCalls);
  entityCount = entities;

  const cpuMs = performance.now() - frameStartMs;
  const wallMs = Number.isNaN(previousFrameStartMs) ? FRAME_BUDGET_MS : nowMs - previousFrameStartMs;
  previousFrameStartMs = nowMs;
  if (wallMs > DROPPED_FRAME_MS) {
    droppedFrames += 1;
  }

  cpuSamplesMs[sampleCursor] = cpuMs;
  frameSamplesMs[sampleCursor] = wallMs;
  sampleCursor = (sampleCursor + 1) % SAMPLE_CAPACITY;
  sampleCount = Math.min(sampleCount + 1, SAMPLE_CAPACITY);

  framesSinceRecompute += 1;
  if (framesSinceRecompute >= RECOMPUTE_INTERVAL_FRAMES) {
    framesSinceRecompute = 0;
    cpu = percentilesOf(cpuSamplesMs);
    wall = percentilesOf(frameSamplesMs);
    fps = wall.p50 > 0 ? 1000 / wall.p50 : 0;
  }
}

/**
 * 화면 밖에서 게이트를 판정하는 쪽이 읽는 것. 오버레이는 사람이 눈으로 보는 표시라
 * 15프레임마다만 다시 계산하는데(RECOMPUTE_INTERVAL_FRAMES), 판정은 마지막 표본까지
 * 들어간 값이어야 하므로 여기서 한 번 더 계산한다.
 */
export interface MetricsSnapshot {
  readonly sampleCount: number;
  readonly cpuMs: Percentiles;
  readonly frameMs: Percentiles;
  readonly fps: number;
  readonly droppedFrames: number;
  readonly drawCalls: number;
  readonly peakDrawCalls: number;
  readonly compositeSwitches: number;
  readonly drawCallLimit: number;
  readonly budgetMs: number;
}

export function snapshot(): MetricsSnapshot {
  const cpuNow = percentilesOf(cpuSamplesMs);
  const wallNow = percentilesOf(frameSamplesMs);
  return {
    sampleCount,
    cpuMs: cpuNow,
    frameMs: wallNow,
    fps: wallNow.p50 > 0 ? 1000 / wallNow.p50 : 0,
    droppedFrames,
    drawCalls: frozen.drawCalls,
    peakDrawCalls,
    compositeSwitches: frozen.compositeSwitches,
    drawCallLimit: DRAW_CALL_LIMIT,
    budgetMs: FRAME_BUDGET_MS,
  };
}

/** 측정 창을 비운다. A/B 손잡이를 바꾼 직후에 부르지 않으면 이전 설정의 표본이 섞인다 */
export function resetSamples(): void {
  sampleCount = 0;
  sampleCursor = 0;
  droppedFrames = 0;
  peakDrawCalls = 0;
  previousFrameStartMs = Number.NaN;
  framesSinceRecompute = RECOMPUTE_INTERVAL_FRAMES;
}

function percentilesOf(samples: Float64Array): Percentiles {
  if (sampleCount === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }
  scratch.set(samples.subarray(0, sampleCount));
  const window = scratch.subarray(0, sampleCount);
  window.sort();
  return { p50: pick(window, 0.5), p95: pick(window, 0.95), p99: pick(window, 0.99) };
}

function pick(sorted: Float64Array, ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function ms(value: number): string {
  return value.toFixed(MS_DECIMALS);
}

/**
 * 오버레이를 그린다. 기준 변환이 걸린 상태에서, endFrame 뒤에 부른다.
 * extraLines에는 씬이 자기 손잡이 상태를 넣는다 — 어느 A/B에서 잰 숫자인지가 화면에 없으면
 * 나중에 그 숫자가 무엇의 값이었는지 알 수 없다.
 */
export function drawOverlay(ctx: CanvasCtx, extraLines: readonly string[]): void {
  const lines: string[] = [
    `표본 ${sampleCount}/${SAMPLE_CAPACITY}   fps ${fps.toFixed(1)}   드롭 ${droppedFrames}`,
    `cpu   p50 ${ms(cpu.p50)}  p95 ${ms(cpu.p95)}  p99 ${ms(cpu.p99)} ms`,
    `frame p50 ${ms(wall.p50)}  p95 ${ms(wall.p95)}  p99 ${ms(wall.p99)} ms`,
    `엔티티 ${entityCount}`,
    `드로우 콜 ${frozen.drawCalls}  (최대 ${peakDrawCalls} / 상한 ${DRAW_CALL_LIMIT})`,
    `합성 모드 전환 ${frozen.compositeSwitches}`,
    ...extraLines,
  ];

  const height = PANEL_PAD_U * 2 + PANEL_LINE_STEP_U * lines.length;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.ink900;
  ctx.fillRect(PANEL_X_U, PANEL_Y_U, PANEL_WIDTH_U, height);
  ctx.font = `${PANEL_FONT_WEIGHT} ${PANEL_FONT_PX}px ${FONTS.data}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let y = PANEL_Y_U + PANEL_PAD_U + PANEL_LINE_STEP_U / 2;
  for (const line of lines) {
    ctx.fillStyle = failsGate(line) ? PALETTE.jeok : PALETTE.baek;
    ctx.fillText(line, PANEL_X_U + PANEL_PAD_U, y);
    y += PANEL_LINE_STEP_U;
  }
  ctx.restore();
}

/** 게이트를 넘긴 줄만 적색으로 칠한다. 판정은 사람이 하지만 눈에 띄어야 볼 수 있다 */
function failsGate(line: string): boolean {
  if (line.startsWith('cpu')) {
    return cpu.p99 > FRAME_BUDGET_MS;
  }
  if (line.startsWith('frame')) {
    return wall.p99 > FRAME_BUDGET_MS;
  }
  if (line.startsWith('드로우 콜')) {
    return peakDrawCalls > DRAW_CALL_LIMIT;
  }
  return false;
}
