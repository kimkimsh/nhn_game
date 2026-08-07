/**
 * 하네스 페이지의 캔버스 조작 — 목업 적재와 픽셀 읽기.
 *
 * `in-page.ts`에서 갈라져 나온 것은 400줄 상한 때문이지만, 갈린 선은 임의가 아니다. 이 파일은
 * **캔버스와 iframe만** 알고 마스크도 대조도 리포트도 모른다.
 */

import type { HwState } from './adapt';
import { PLAYFIELD_SIZE_U } from './targets';

/**
 * 목업 페이지가 창에 올려 두는 것 (engine.js:2035).
 *
 * `typeof globalThis`를 섞는 것은 iframe realm의 생성자를 그 realm에서 꺼내 쓰기 위해서다.
 * 부모 realm의 `HTMLCanvasElement`로 `instanceof`를 하면 같은 캔버스인데도 거짓이 된다.
 */
export type MockupWindow = Window &
  typeof globalThis & {
    HWSTATE?: HwState;
    HW?: { BULLETS?: Record<string, { r?: number } | undefined> };
  };

/** 목업 페이지가 뜨기를 기다리는 상한 (ms). 넘으면 캡처 실패로 적는다 */
const MOCKUP_LOAD_TIMEOUT_MS = 20_000;

/** 산출 그림의 논리 해상도 배율. 사람이 눈으로 보는 용도라 원본 배율을 유지할 이유가 없다 */
const ARTIFACT_SCALE = 1;

/**
 * 대조를 도는 배율 — 09 §5.2의 4번이 적은 "오프스크린 캔버스 1080×1920" 그대로다.
 *
 * 목업 캔버스는 q = 2(engine.js:2000-2002)라 2160×3840이므로 여기서 절반으로 줄인다. 목업 배율을
 * 그대로 쓰는 쪽이 재표본화 한 겹을 아끼지만, 그렇게 하면 **배경 전체가 차이로 들어온다** —
 * 게임의 배경 굽기는 논리 해상도(1080×1920u) 고정 래스터를 `drawImage`로 얹는 구조이고
 * (`render/backgrounds/index.ts:141`), 2×에서는 그 한 장이 확대된다. 실측으로 831만 픽셀 중
 * 320만~510만이 달라졌다. 그 상태의 대조는 어느 규칙도 못 잠근다.
 */
export const COMPARE_SCALE = 1;

export function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = (): void => {
      left -= 1;
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 목업 한 장을 iframe에 띄우고 그 캔버스를 돌려준다.
 *
 * `document.fonts.ready` 이후 한 프레임을 더 기다리는 것은 `still()`이 폰트 도착 뒤에 다시
 * 그리기 때문이다(engine.js:2032-2033). 그 재도색 전에 읽으면 폰트 대체본과 실제본이 섞인다.
 */
export async function loadMockup(url: string): Promise<{ win: MockupWindow; canvas: HTMLCanvasElement }> {
  const frame = document.createElement('iframe');
  frame.width = String(PLAYFIELD_SIZE_U.widthU);
  frame.height = String(PLAYFIELD_SIZE_U.heightU);
  frame.style.position = 'absolute';
  frame.style.left = '-10000px';
  frame.src = url;
  document.body.appendChild(frame);

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`목업 페이지가 ${MOCKUP_LOAD_TIMEOUT_MS}ms 안에 뜨지 않았다: ${url}`));
    }, MOCKUP_LOAD_TIMEOUT_MS);
    frame.addEventListener('load', () => {
      window.clearTimeout(timer);
      resolve();
    });
    frame.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new Error(`목업 페이지 로드 실패: ${url}`));
    });
  });

  const win = frame.contentWindow as MockupWindow | null;
  const doc = frame.contentDocument;
  if (win === null || doc === null) {
    throw new Error(`iframe realm에 접근할 수 없다: ${url}`);
  }
  await doc.fonts.ready;
  await waitFrames(2);

  const element = doc.querySelector('canvas.screen');
  if (element === null || !(element instanceof win.HTMLCanvasElement)) {
    throw new Error(`목업 캔버스(canvas.screen)를 못 찾았다: ${url}`);
  }
  const canvas: HTMLCanvasElement = element;
  if (win.HWSTATE === undefined) {
    throw new Error(`window.HWSTATE가 없다 — still()이 안 돌았다: ${url}`);
  }
  return { win, canvas };
}

/**
 * 캔버스를 읽는다. `willReadFrequently`를 **켜지 않는다.**
 *
 * 그 플래그는 캔버스를 소프트웨어 래스터라이저로 내려보내는데, 목업 캔버스는 그 플래그 없이
 * 만들어졌다. 한쪽만 켜면 곡선의 안티에일리어싱이 래스터라이저 차이로 갈리고, 그 차이가
 * 09 §5.4-2가 말한 오탐 그 자체가 된다.
 */
export function readPixels(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D 컨텍스트를 못 얻었다');
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function newCanvas(widthPx: number, heightPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D 컨텍스트를 못 얻었다');
  }
  return ctx;
}

/**
 * RGBA 바이트를 ImageData로 담는다.
 *
 * `new ImageData(buffer, w, h)`를 안 쓰는 이유는 그 생성자가 `ArrayBuffer` 뒷단만 받는데
 * 대조기가 돌려주는 배열의 뒷단 타입이 `ArrayBufferLike`이기 때문이다. 복사 한 번이 든다.
 */
export function fillImageData(widthPx: number, heightPx: number, rgba: Uint8ClampedArray): ImageData {
  const image = new ImageData(widthPx, heightPx);
  image.data.set(rgba);
  return image;
}

/** 논리 해상도로 줄인 PNG 데이터 URL. 33MB 버퍼가 아니라 이것만 드라이버로 나간다 */
export function toArtifactPng(source: ImageData): string {
  const full = newCanvas(source.width, source.height);
  context2d(full).putImageData(source, 0, 0);
  const shrunk = newCanvas(
    PLAYFIELD_SIZE_U.widthU * ARTIFACT_SCALE,
    PLAYFIELD_SIZE_U.heightU * ARTIFACT_SCALE,
  );
  const ctx = context2d(shrunk);
  ctx.drawImage(full, 0, 0, shrunk.width, shrunk.height);
  return shrunk.toDataURL('image/png');
}

/**
 * 목업 캔버스를 대조 배율로 줄여 읽는다. 두 캡처에 같은 변환을 걸므로 재현성 측정의 뜻은
 * 그대로다 — 줄이기가 만드는 오차는 양쪽에 똑같이 들어간다.
 */
export function readAtCompareScale(canvas: HTMLCanvasElement): ImageData {
  const target = newCanvas(
    Math.round(PLAYFIELD_SIZE_U.widthU * COMPARE_SCALE),
    Math.round(PLAYFIELD_SIZE_U.heightU * COMPARE_SCALE),
  );
  const ctx = context2d(target);
  ctx.drawImage(canvas, 0, 0, target.width, target.height);
  return ctx.getImageData(0, 0, target.width, target.height);
}
