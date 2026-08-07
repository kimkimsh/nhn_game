/**
 * 하네스 페이지의 모듈 진입점 — 렌더러를 부팅하고 브라우저 쪽 API를 창에 올려 둔다.
 *
 * 드라이버가 `page.evaluate` 안에서 `import()`로 부르지 않는 이유는 하나다. vitest가 드라이버
 * 파일을 SSR 변환하면서 콜백 안의 `import()`를 `__vite_ssr_dynamic_import__`로 바꾸는데, 그
 * 이름은 node 쪽 헬퍼라 브라우저 realm에 없다. 정적 import는 이 파일이 하고, 드라이버의
 * 콜백은 창에 올라온 것을 읽기만 한다 — 콜백에 import 구문이 하나도 없으면 변환될 것도 없다.
 *
 * 스프라이트 굽기를 여기서 하는 것은 `render/primitives.ts`의 `getGlowSprite`가 지연 생성을
 * 금지했기 때문이다(06 §3.1). 굽기 없이 배경을 그리면 목록 밖 색 요청으로 dev 오류가 난다.
 * 하네스 페이지는 게임의 부팅 사슬을 안 타므로 그 한 걸음을 여기서 대신한다.
 */

import { PLAYFIELD } from '../../src/config/playfield';
import type { CanvasView } from '../../src/boot/canvas';
import { bakeSprites } from '../../src/boot/sprite-bake';
import { runBakeCheck } from './bake';
import { captureTarget } from './in-page';

declare global {
  interface Window {
    /** 드라이버가 읽는 유일한 접합면. 이 값이 생긴 뒤부터 캡처를 걸 수 있다 */
    __HW_VISUAL__?: {
      captureTarget: typeof captureTarget;
      runBakeCheck: typeof runBakeCheck;
    };
  }
}

/**
 * 굽기에만 쓰이는 최소 view. `bootCanvas`를 부르지 않는 것은 그것이 창 크기와 DPR에 맞춰
 * 화면 캔버스를 잡기 때문이다 — 대조는 오프스크린에서만 그리고, 화면 크기가 결과에 섞이면
 * 실행 환경마다 다른 픽셀이 나온다.
 */
function offscreenView(): CanvasView {
  const canvas = document.createElement('canvas');
  canvas.width = PLAYFIELD.widthU;
  canvas.height = PLAYFIELD.heightU;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('굽기용 2d 컨텍스트를 못 얻었다');
  }
  return {
    canvas,
    ctx,
    logicalWidthU: PLAYFIELD.widthU,
    logicalHeightU: PLAYFIELD.heightU,
    pixelsPerUnit: 1,
  };
}

await bakeSprites(offscreenView());

window.__HW_VISUAL__ = { captureTarget, runBakeCheck };
