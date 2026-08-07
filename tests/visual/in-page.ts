/**
 * 브라우저 안에서 도는 부분 — 09 §5.2의 1 · 2 · 4 · 5번.
 *
 * 왜 대조까지 페이지 안에서 하는가. 한 프레임의 RGBA가 2160×3840×4 = 33MB다. 목업과 게임 두
 * 장을 드라이버 밖으로 꺼내면 프레임당 66MB를 직렬화해야 하고, 꺼낸 뒤에도 node에는 PNG
 * 디코더가 없다(의존성 0개 규칙). 큰 버퍼를 페이지에 두고 **작은 수치와 그림 한 장만** 내보내는
 * 것이 유일하게 성립하는 형태다.
 *
 * 목업을 iframe으로 여는 이유는 09 §5.2가 요구한 두 가지를 한 realm에서 같이 해야 하기
 * 때문이다 — 목업의 `window.HWSTATE`를 읽는 것과, 같은 프레임을 두 번 띄워 재현성을 재는 것.
 */

import { adaptMockupState, reparryLabelAnchors, type HwState, type MockupFrame } from './adapt';
import {
  buildDiffImage,
  comparePixels,
  countDiffInRect,
  type CompareResult,
  type MaskKind,
  type MaskRect,
} from './compare';
import {
  context2d,
  fillImageData,
  loadMockup,
  newCanvas,
  readAtCompareScale,
  readPixels,
  toArtifactPng,
  COMPARE_SCALE,
  type MockupWindow,
} from './page-canvas';
import { resolveFrameRenderer } from './renderer-binding';
import {
  cheatMarkRegion,
  DIFF_CELL_U,
  dynamicMasks,
  particleMasks,
  PLAYFIELD_SIZE_U,
  staticMasks,
} from './targets';
import { REPEAT_TOLERANCE, TOLERANCE } from './tolerance';

export interface CaptureArgs {
  readonly targetId: string;
  readonly mockupUrl: string;
  readonly backgroundKey: string;
  /** D-05 — render 전용 시드. 목업 burst의 Math.random()이 그 위반이다 */
  readonly renderSeed: number;
}

export interface CaptureSummaryPayload {
  readonly bullets: number;
  readonly reflectBullets: number;
  readonly enemies: number;
  readonly zones: number;
  readonly telegraphs: number;
  readonly popups: number;
  readonly particles: number;
  readonly hudPresent: boolean;
  readonly maxLife: number;
  readonly traumaAtCapture: number;
  readonly hitstopRemainingSec: number;
}

export interface CapturePayload {
  readonly targetId: string;
  readonly status: 'compared' | 'renderer-missing' | 'capture-failed';
  readonly detail: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
  /** 목업 캔버스의 원래 가로 픽셀. 대조는 그 절반에서 돈다 (COMPARE_SCALE 주석) */
  readonly nativeWidthPx: number;
  readonly capture: CaptureSummaryPayload | null;
  readonly maskCountByKind: Record<MaskKind, number> | null;
  readonly maskCoverageRatio: number | null;
  readonly repeat: CompareResult | null;
  /** 처치 파편만 가리고 다시 잰 재현성. 파편이 없는 프레임에서는 `repeat`과 같은 값이다 */
  readonly repeatIgnoringParticles: CompareResult | null;
  readonly compare: CompareResult | null;
  readonly cheatMarkDiffPixels: number | null;
  /** 주입에 쓴 payload 그대로. 리포트 옆에 떨어져 사람이 상태를 눈으로 확인한다 */
  readonly frame: MockupFrame | null;
  /** 사람이 볼 그림. 데이터 URL이며 논리 해상도(1080×1920)로 줄여서 낸다 */
  readonly mockupPngDataUrl: string | null;
  readonly gamePngDataUrl: string | null;
  readonly diffPngDataUrl: string | null;
}

function summarize(frame: MockupFrame): CaptureSummaryPayload {
  return {
    bullets: frame.bullets.length,
    reflectBullets: frame.bullets.filter((b) => b.owner === 'reflect').length,
    enemies: frame.enemies.length,
    zones: frame.zones.length,
    telegraphs: frame.telegraphs.length,
    popups: frame.popups.length,
    particles: frame.particles.length,
    hudPresent: frame.hud.stage > 0,
    maxLife: frame.hud.maxLife,
    traumaAtCapture: frame.traumaAtCapture,
    hitstopRemainingSec: frame.hitstopRemainingSec,
  };
}

function countMasks(masks: readonly MaskRect[]): Record<MaskKind, number> {
  const counts: Record<MaskKind, number> = { text: 0, ruling: 0, 'new-element': 0 };
  for (const mask of masks) {
    counts[mask.kind] += 1;
  }
  return counts;
}

/**
 * 목업 탄환 반경 표(engine.js:39-52)를 목업 realm에서 읽는다.
 *
 * `config/bullets.ts`를 쓰지 않는 이유는 adapt.ts에 적었다 — 마스크가 덮어야 하는 것은 목업이
 * 그린 글자이지 게임이 그릴 글자가 아니다.
 */
function mockupBulletRadius(win: MockupWindow): (type: string) => number {
  const table = win.HW?.BULLETS ?? {};
  return (type: string) => table[type]?.r ?? 0;
}

export async function captureTarget(args: CaptureArgs): Promise<CapturePayload> {
  let first: { win: MockupWindow; canvas: HTMLCanvasElement };
  let second: { win: MockupWindow; canvas: HTMLCanvasElement };
  try {
    first = await loadMockup(args.mockupUrl);
    second = await loadMockup(args.mockupUrl);
  } catch (error) {
    return {
      targetId: args.targetId,
      status: 'capture-failed',
      detail: String(error),
      widthPx: 0,
      heightPx: 0,
      scale: 0,
      nativeWidthPx: 0,
      capture: null,
      maskCountByKind: null,
      maskCoverageRatio: null,
      repeat: null,
      repeatIgnoringParticles: null,
      compare: null,
      cheatMarkDiffPixels: null,
      frame: null,
      mockupPngDataUrl: null,
      gamePngDataUrl: null,
      diffPngDataUrl: null,
    };
  }

  const nativeWidthPx = first.canvas.width;
  const widthPx = Math.round(PLAYFIELD_SIZE_U.widthU * COMPARE_SCALE);
  const heightPx = Math.round(PLAYFIELD_SIZE_U.heightU * COMPARE_SCALE);
  const scale = COMPARE_SCALE;
  const mockupPixels = readAtCompareScale(first.canvas);
  const repeatPixels = readAtCompareScale(second.canvas);

  const hwState = first.win.HWSTATE as HwState;
  const secondState = second.win.HWSTATE as HwState;
  const frame = adaptMockupState(hwState);

  // 재현성은 마스크 없이 잰다. 폰트 대체까지 포함해 두 번이 같아야 결정론이다
  const repeat = comparePixels({
    expected: mockupPixels.data,
    actual: repeatPixels.data,
    widthPx,
    heightPx,
    scale,
    masks: [],
    channelDelta: REPEAT_TOLERANCE.channelDelta,
    cellU: DIFF_CELL_U,
  });

  // 파편만 빼고 다시 잰다. 두 수가 갈리면 결정론이 깨진 층이 파편 하나라는 뜻이고,
  // 그 원인은 이미 이름이 있다 — 목업 burst의 Math.random()(engine.js:1927-1928)
  const particleOnlyMasks = [
    ...particleMasks(hwState.parts.map((p) => ({ xU: p.x, yU: p.y }))),
    ...particleMasks(secondState.parts.map((p) => ({ xU: p.x, yU: p.y }))),
  ];
  const repeatIgnoringParticles =
    particleOnlyMasks.length === 0
      ? repeat
      : comparePixels({
          expected: mockupPixels.data,
          actual: repeatPixels.data,
          widthPx,
          heightPx,
          scale,
          masks: particleOnlyMasks,
          channelDelta: REPEAT_TOLERANCE.channelDelta,
          cellU: DIFF_CELL_U,
        });

  const masks: MaskRect[] = [
    ...staticMasks(),
    ...dynamicMasks({
      popups: frame.popups.map((p) => ({ xU: p.xU, yU: p.yU })),
      reparryLabels: reparryLabelAnchors(hwState, mockupBulletRadius(first.win)),
      particles: frame.particles.map((p) => ({ xU: p.xU, yU: p.yU })),
    }),
  ];
  const maskCountByKind = countMasks(masks);
  const mockupPng = toArtifactPng(mockupPixels);

  const renderer = await resolveFrameRenderer(frame.stageKey);
  if (renderer.status === 'missing') {
    const probe = comparePixels({
      expected: mockupPixels.data,
      actual: mockupPixels.data,
      widthPx,
      heightPx,
      scale,
      masks,
      channelDelta: TOLERANCE.channelDelta,
      cellU: DIFF_CELL_U,
    });
    return {
      targetId: args.targetId,
      status: 'renderer-missing',
      detail: `${renderer.expected} — ${renderer.detail}`,
      widthPx,
      heightPx,
      scale,
      nativeWidthPx,
      capture: summarize(frame),
      maskCountByKind,
      maskCoverageRatio: probe.maskedPixels / (widthPx * heightPx),
      repeat,
      repeatIgnoringParticles,
      compare: null,
      cheatMarkDiffPixels: null,
      frame,
      mockupPngDataUrl: mockupPng,
      gamePngDataUrl: null,
      diffPngDataUrl: null,
    };
  }

  const gameCanvas = newCanvas(widthPx, heightPx);
  const gameCtx = context2d(gameCanvas);
  gameCtx.setTransform(scale, 0, 0, scale, 0, 0);
  // 09 §5.2 — 정지 프레임이므로 realDt는 0이다. 화면 흔들림은 payload에 없으므로 구조상 0이다
  renderer.value(gameCtx, frame, {
    realDtSec: 0,
    reducedMotion: false,
    renderSeed: args.renderSeed,
  });
  const gamePixels = readPixels(gameCanvas);

  const compare = comparePixels({
    expected: mockupPixels.data,
    actual: gamePixels.data,
    widthPx,
    heightPx,
    scale,
    masks,
    channelDelta: TOLERANCE.channelDelta,
    cellU: DIFF_CELL_U,
  });
  const cheatMarkDiffPixels = countDiffInRect(
    mockupPixels.data,
    gamePixels.data,
    widthPx,
    heightPx,
    scale,
    cheatMarkRegion(),
    TOLERANCE.channelDelta,
  );
  const diffImage = buildDiffImage({
    expected: mockupPixels.data,
    actual: gamePixels.data,
    widthPx,
    heightPx,
    scale,
    masks,
    channelDelta: TOLERANCE.channelDelta,
    cellU: DIFF_CELL_U,
  });

  return {
    targetId: args.targetId,
    status: 'compared',
    detail: '목업과 게임을 같은 상태로 그려서 대조했다',
    widthPx,
    heightPx,
    scale,
    nativeWidthPx,
    capture: summarize(frame),
    maskCountByKind,
    maskCoverageRatio: compare.maskedPixels / (widthPx * heightPx),
    repeat,
    repeatIgnoringParticles,
    compare,
    cheatMarkDiffPixels,
    frame,
    mockupPngDataUrl: mockupPng,
    gamePngDataUrl: toArtifactPng(gamePixels),
    diffPngDataUrl: toArtifactPng(fillImageData(widthPx, heightPx, diffImage)),
  };
}
