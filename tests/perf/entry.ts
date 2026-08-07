/**
 * P1 게이트 하네스의 페이지 진입점 — 캔버스를 세우고 창에 조작 API를 올린다.
 *
 * 드라이버가 `page.evaluate` 안에서 `import()`를 부르지 않는 이유는 `tests/visual/entry.ts`와
 * 같다. 정적 import는 이 파일이 하고, 콜백은 창에 올라온 것을 읽기만 한다.
 *
 * 캔버스 배율은 **1u = 1px 고정**이다. `boot/canvas.ts`는 창에 맞춰 DPR까지 곱하는데, 그러면
 * 재는 픽셀 수가 창 크기에 따라 달라져 실행마다 다른 물건을 잰 것이 된다. 06 §3.5·§3.6의 예산이
 * 전부 1080×1920 한 장 기준이므로 그 기준으로 고정한다.
 */

import { bakeSprites } from '../../src/boot/sprite-bake';
import { PLAYFIELD } from '../../src/config/playfield';
import { beginFrame, drawOverlay, endFrame, instrumentContext, resetSamples, snapshot, type MetricsSnapshot } from '../../src/dev/overlay';
import { createStressScene, type StressCounts, type StressOptions, type StressScene } from './scene';

/** 게이트의 측정 창 (06 §3.7.2) */
const SAMPLE_FRAMES = 600;
/** 굽기·JIT·첫 텍스처 업로드를 측정에서 뺀다. 이 구간의 프레임은 표본에 안 들어간다 */
const WARMUP_FRAMES = 120;
/** rAF 간격이 튀는 프레임에서 씬이 순간이동하지 않게 자른다 (s) */
const MAX_STEP_SEC = 0.05;

export interface StressRunResult {
  readonly frames: number;
  readonly warmupFrames: number;
  readonly counts: StressCounts;
  readonly peakEntities: number;
  readonly peakTotal: number;
  readonly metrics: MetricsSnapshot;
  readonly userAgent: string;
  readonly canvas: { readonly widthPx: number; readonly heightPx: number };
}

declare global {
  interface Window {
    __HW_P1__?: {
      run(options: { frames?: number; overlay?: boolean; scene?: StressOptions }): Promise<StressRunResult>;
    };
  }
}

function makeCanvas(): CanvasRenderingContext2D {
  const element = document.getElementById('stage');
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error('canvas #stage가 없다');
  }
  element.width = PLAYFIELD.widthU;
  element.height = PLAYFIELD.heightU;
  element.style.width = `${PLAYFIELD.widthU / 3}px`;
  element.style.height = `${PLAYFIELD.heightU / 3}px`;
  // alpha: false — boot/canvas.ts와 같은 조건이다. 알파가 있으면 페이지 합성 비용이 더 붙는다
  const ctx = element.getContext('2d', { alpha: false });
  if (ctx === null) {
    throw new Error('2d 컨텍스트를 못 얻었다');
  }
  return ctx;
}

let scene: StressScene | null = null;

async function run(options: { frames?: number; overlay?: boolean; scene?: StressOptions }): Promise<StressRunResult> {
  const frames = options.frames ?? SAMPLE_FRAMES;
  const ctx = makeCanvas();
  instrumentContext(ctx);
  scene?.dispose();
  scene = createStressScene(options.scene ?? {});
  const active = scene;

  let peakEntities = 0;
  let peakTotal = 0;
  let counts = active.counts();

  return new Promise<StressRunResult>((resolve) => {
    let index = 0;
    let previousNowMs = Number.NaN;

    const step = (nowMs: number): void => {
      const dtSec = Number.isNaN(previousNowMs) ? 1 / 60 : Math.min((nowMs - previousNowMs) / 1000, MAX_STEP_SEC);
      previousNowMs = nowMs;

      // 워밍업이 끝나는 프레임에서 창을 비운다. 안 비우면 굽기 직후의 느린 프레임이 p99에 남는다
      if (index === WARMUP_FRAMES) {
        resetSamples();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      beginFrame(nowMs);
      active.frame(ctx, dtSec);
      counts = active.counts();
      endFrame(nowMs, counts.entities);
      if (options.overlay === true) {
        drawOverlay(ctx, [`연쇄 링크 ${active.chainLink() + 1}/20`, `동시 ${counts.total}`]);
      }
      if (index >= WARMUP_FRAMES) {
        peakEntities = Math.max(peakEntities, counts.entities);
        peakTotal = Math.max(peakTotal, counts.total);
      }

      index += 1;
      if (index >= WARMUP_FRAMES + frames) {
        resolve({
          frames,
          warmupFrames: WARMUP_FRAMES,
          counts,
          peakEntities,
          peakTotal,
          metrics: snapshot(),
          userAgent: navigator.userAgent,
          canvas: { widthPx: ctx.canvas.width, heightPx: ctx.canvas.height },
        });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// 06 §3.1 — `getGlowSprite`가 지연 생성을 금지하므로 첫 프레임 전에 30장 + 13색을 구워 둔다
bakeSprites();

window.__HW_P1__ = { run };
