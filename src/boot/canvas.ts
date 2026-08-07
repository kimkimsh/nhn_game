/**
 * 캔버스 부팅 — 논리 좌표계를 화면 크기와 DPR에 맞춘다.
 *
 * 레터박스 여백은 캔버스 밖이다. 캔버스 자체를 9:16으로 맞춘 크기로만 만들고
 * index.html의 셸 CSS가 가운데 정렬하므로, 남는 띠는 body 배경이지 그려지는 픽셀이 아니다.
 * 06 §3.5의 fill-rate 예산이 화면 한 장(1080×1920 = 2.07M px) 기준이라 띠를 칠하면 그만큼 깎인다.
 *
 * 논리 크기는 이 파일이 갖지 않고 인자로 받는다. §3.1의 단일 소스는 config/playfield.ts이고
 * 여기는 그 숫자를 화면 픽셀로 바꾸는 기계일 뿐이다.
 */

/** backing store를 다시 만든 직후 불린다. 정적 레이어 캐시를 여기서 버린다 */
export type ViewChangedListener = (view: CanvasView) => void;

export interface CanvasBootSpec {
  /** index.html의 canvas 요소 id */
  canvasId: string;
  /** §3.1 논리 해상도 (u) */
  logicalWidthU: number;
  logicalHeightU: number;
  /**
   * 창 크기나 DPR이 바뀌어 backing store를 새로 만들었을 때 부른다.
   * canvas.width 대입은 ctx 상태(transform·fillStyle·imageSmoothing)를 초기화하고
   * 구운 배경·비네트·hatch 패턴의 축척을 무효로 만든다 (02 §5.3 · 06 §3.2).
   */
  onViewChanged?: ViewChangedListener;
}

export interface CanvasView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly logicalWidthU: number;
  readonly logicalHeightU: number;
  /** 논리 1u당 물리 픽셀. 창 크기와 DPR을 곱한 값이고 리사이즈마다 갱신된다 */
  pixelsPerUnit: number;
}

function currentDevicePixelRatio(): number {
  const ratio = window.devicePixelRatio;
  return ratio > 0 ? ratio : 1;
}

/**
 * 창에 맞춰 backing store와 CSS 크기를 다시 잡는다.
 * backing store 크기가 실제로 바뀌었을 때만 true를 낸다 — 그 경우에만 캐시가 무효가 된다.
 */
function applyViewport(view: CanvasView): boolean {
  const dpr = currentDevicePixelRatio();
  const fitScale = Math.min(
    window.innerWidth / view.logicalWidthU,
    window.innerHeight / view.logicalHeightU,
  );
  // 가로 픽셀을 먼저 정수로 확정하고 나머지를 거기서 유도한다. 축척을 먼저 정하면
  // 반올림 뒤의 가로와 세로가 서로 다른 축척이 되어 원이 타원으로 그려진다
  const widthPx = Math.max(1, Math.floor(view.logicalWidthU * fitScale * dpr));
  const pixelsPerUnit = widthPx / view.logicalWidthU;
  const heightPx = Math.max(1, Math.round(view.logicalHeightU * pixelsPerUnit));

  view.canvas.style.width = `${widthPx / dpr}px`;
  view.canvas.style.height = `${heightPx / dpr}px`;

  if (view.canvas.width === widthPx && view.canvas.height === heightPx) {
    return false;
  }
  view.canvas.width = widthPx;
  view.canvas.height = heightPx;
  view.pixelsPerUnit = pixelsPerUnit;
  return true;
}

/**
 * DPR 변경은 resize 이벤트를 내지 않는다 — 창을 다른 배율의 모니터로 옮기면 CSS 크기가 그대로다.
 * 현재 배율에 맞춘 media query가 깨지는 것으로 감지하고, 감지할 때마다 새 배율로 다시 건다.
 */
function watchPixelRatio(onChange: ViewChangedListener, view: CanvasView): void {
  const query = window.matchMedia(`(resolution: ${currentDevicePixelRatio()}dppx)`);
  query.addEventListener(
    'change',
    () => {
      onChange(view);
      watchPixelRatio(onChange, view);
    },
    { once: true },
  );
}

export function bootCanvas(spec: CanvasBootSpec): CanvasView {
  const element = document.getElementById(spec.canvasId);
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`canvas #${spec.canvasId}가 index.html에 없다`);
  }
  // alpha: false — 13 §1의 프로브가 잰 조건과 같다. 알파 채널이 있으면 페이지와의 합성 비용이
  // 붙어서 실제 프레임이 06 §3.5의 예산 계산과 다른 물건이 된다
  const ctx = element.getContext('2d', { alpha: false });
  if (ctx === null) {
    throw new Error('CanvasRenderingContext2D를 얻지 못했다');
  }

  const view: CanvasView = {
    canvas: element,
    ctx,
    logicalWidthU: spec.logicalWidthU,
    logicalHeightU: spec.logicalHeightU,
    pixelsPerUnit: 1,
  };
  // 첫 계산에서는 onViewChanged를 부르지 않는다. 무효화할 캐시가 아직 없고,
  // 굽기는 이 함수가 돌려준 view를 받은 뒤에 시작한다
  applyViewport(view);

  const listener = spec.onViewChanged;
  window.addEventListener('resize', () => {
    if (applyViewport(view) && listener !== undefined) {
      listener(view);
    }
  });
  if (listener !== undefined) {
    watchPixelRatio(listener, view);
  }
  return view;
}

/**
 * 논리 좌표 → 물리 픽셀.
 * 스프라이트를 발마다 setTransform으로 놓는 경로(06 §3.1)는 기준 변환을 쓸 수 없으므로
 * 축척을 직접 인자에 넣어야 한다. 그때 쓰는 것이 이 함수다.
 */
export function toPixels(view: CanvasView, u: number): number {
  return u * view.pixelsPerUnit;
}

/**
 * 논리 좌표로 그리는 경로(배경 path 작도, HUD)가 프레임 시작에 한 번 부른다.
 * ctx 상태는 backing store를 다시 만들 때 초기화되므로 프레임마다 다시 건다.
 */
export function applyBaseTransform(view: CanvasView): void {
  view.ctx.setTransform(view.pixelsPerUnit, 0, 0, view.pixelsPerUnit, 0, 0);
}
