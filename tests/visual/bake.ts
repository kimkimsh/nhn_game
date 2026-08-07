/**
 * 06 §3.2 정적 배경 굽기 검증 — 브라우저 안에서 돈다.
 *
 * 굽기는 "정적 레이어를 한 번 그려 두고 프레임에서는 `drawImage` 1회로 끝낸다"는 최적화이므로,
 * 옳다면 매 프레임 직접 그린 것과 **같은 픽셀이어야 한다.** 한 픽셀이라도 다르면 그것은
 * 최적화가 아니라 다른 그림이고, 그 차이는 프레임 하나가 아니라 스테이지 전체에 상시로 깔린다.
 *
 * 굽기 결과가 틀렸을 때 고치는 것은 이 파일이 아니다 — 12 §2가 `render/backgrounds/*`를
 * P4-14에게 읽기 전용으로 두었으므로 여기가 하는 일은 발견해서 적는 것까지다.
 */

import { comparePixels, type CompareResult } from './compare';
import { resolveStageBackground } from './renderer-binding';
import { DIFF_CELL_U, PLAYFIELD_SIZE_U } from './targets';

export interface BakePayload {
  readonly stageKey: string;
  /**
   * 대조를 돌린 배율. 굽기는 논리 해상도(1080×1920u) 고정 래스터라
   * `backgrounds/index.ts:141`이 그 사실과 대가를 이미 적어 두었다 — 배율 1에서는 `drawImage`가
   * 1:1이므로 비트가 같아야 하고, 배율 2에서는 구운 한 장이 확대되므로 **다른 것이 정상**이다.
   * 두 배율을 다 재는 것은 프레임 대조(배율 2)의 차이 중 얼마가 그 확대 때문인지 알기 위해서다.
   */
  readonly scale: number;
  readonly status: 'verified' | 'not-implemented';
  readonly detail: string;
  readonly compare: CompareResult | null;
}

function newCanvas(widthPx: number, heightPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D 컨텍스트를 못 얻었다');
  }
  return ctx;
}

function readPixels(canvas: HTMLCanvasElement): ImageData {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export async function runBakeCheck(
  stageKey: string,
  timeSec: number,
  scale: number,
  renderSeed: number,
): Promise<BakePayload> {
  const binding = await resolveStageBackground(stageKey);
  if (binding.status === 'missing') {
    return {
      stageKey,
      scale,
      status: 'not-implemented',
      detail: `${binding.expected} — ${binding.detail}`,
      compare: null,
    };
  }
  const { backgroundId, layers, api } = binding.value;
  const widthPx = Math.round(PLAYFIELD_SIZE_U.widthU * scale);
  const heightPx = Math.round(PLAYFIELD_SIZE_U.heightU * scale);

  const withBake = newCanvas(widthPx, heightPx);
  const withBakeCtx = context2d(withBake);
  withBakeCtx.setTransform(scale, 0, 0, scale, 0, 0);
  api.bakeStageBackground(backgroundId, renderSeed);
  api.drawStageBackground(withBakeCtx, backgroundId, timeSec, renderSeed);

  // 굽기 없이 같은 순서로 직접 그린다. 겹 순서(정적₀ → 동적₀ → 정적₁ → 동적₁)는
  // BACKGROUNDS 표가 갖고 있고 여기서 다시 정하지 않는다
  const direct = newCanvas(widthPx, heightPx);
  const directCtx = context2d(direct);
  directCtx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const layer of layers) {
    layer.drawStatic(directCtx, renderSeed);
    layer.drawDynamic(directCtx, timeSec, renderSeed);
  }
  api.disposeStageBackground();

  const compare = comparePixels({
    expected: readPixels(direct).data,
    actual: readPixels(withBake).data,
    widthPx,
    heightPx,
    scale,
    masks: [],
    channelDelta: 0,
    cellU: DIFF_CELL_U,
  });
  return {
    stageKey,
    scale,
    status: 'verified',
    detail:
      compare.diffPixels === 0
        ? '구운 레이어와 매 프레임 그린 것이 비트 단위로 같다'
        : `다른 픽셀 ${compare.diffPixels} · 최대 채널차 ${compare.maxChannelDelta}`,
    compare,
  };
}
