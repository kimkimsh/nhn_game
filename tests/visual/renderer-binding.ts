/**
 * 게임 렌더러와의 결합점 — 이 하네스가 게임 코드에 대해 **가정하는 전부**가 여기 있다.
 *
 * P4-14(이 하네스)는 `tests/visual/**`만 소유하고 `render/`는 읽기 전용이다(12 §2). 그래서
 * `render/frame.ts`의 시그니처를 이 하네스가 정할 수 없고, 반대로 그 파일이 아직 없어도
 * 하네스가 막히면 안 된다. 결합점을 이 한 파일에 모아 두는 이유가 그것이다 —
 * **P4-1이 정한 이름이 아래 표와 다르면 고칠 곳은 이 파일뿐이다.**
 *
 * 못 찾았을 때 던지지 않는 것도 의도다. 09 §5가 요구한 P4 게이트는 "하네스가 6장에 대해
 * 차이 리포트를 생성한다"이므로, 렌더러가 없으면 그 사실을 리포트의 한 칸으로 적고 나머지
 * 항목(목업 캡처 · 재현성 · 마스크 적용 범위)은 그대로 낸다.
 */

import type { BackgroundId } from '../../src/config/ids';
import type { FrameDeps, FrameView } from '../../src/render/frame';
import type { MockupFrame } from './adapt';
import { createFrameDeps, disposeFrameDeps, ensureBackgroundBaked, toFrameView } from './frame-adapter';

/** 하네스가 기대하는 모듈 경로와 export 이름. 바뀌면 여기만 고친다 */
export const EXPECTED_BINDINGS = {
  /** 06 §1.9 · 03 §2.3 — 레이어 순서를 가진 유일한 파일 */
  frameModule: '/src/render/frame.ts',
  frameExport: 'drawFrame',
  /** 06 §3.2 굽기 관리자. 배경 파일 5개가 아니라 이 한 파일이 굽기의 소유자다 */
  backgroundModule: '/src/render/backgrounds/index.ts',
  /**
   * 목업 `BG` 키 → `BackgroundId`(config/ids.ts:94-95).
   *
   * 하나만 다르다 — 목업은 S2를 `dongnae`로, 게임은 파일명과 맞춘 `dongnaeseong`으로 부른다.
   */
  backgroundIdFor: {
    busanjin: 'busanjin',
    dongnae: 'dongnaeseong',
    hansando: 'hansando',
    haengju: 'haengju',
    noryang: 'noryang',
  } as Record<string, string | undefined>,
} as const;

/**
 * 한 프레임을 그리는 함수. `render/frame.ts`가 내놓아야 할 형태다.
 *
 * `realDtSec`을 넘기는 것은 렌더가 `realDt`로 도는 연출 계층이기 때문이다(sim의 FIXED_DT가
 * 아니다). 정지 프레임 대조에서는 0을 넘긴다 — 시간이 흐르지 않은 한 장이므로 감쇠·보간이
 * 한 걸음도 진행하면 안 된다.
 */
export type DrawFrameFn = (
  ctx: CanvasRenderingContext2D,
  frame: MockupFrame,
  options: DrawFrameOptions,
) => void;

export interface DrawFrameOptions {
  /** 연출용 실시간 델타 (초). 정지 프레임에서는 0 */
  readonly realDtSec: number;
  /**
   * 12 §3 — `prefers-reduced-motion`은 런타임 플래그로 들어온다. 기본값은 "감소 요청 없음"이고
   * 대조에서는 항상 false다. true로 두면 셰이크와 임팩트 프레임이 꺼져 목업과 다른 그림이 된다
   */
  readonly reducedMotion: boolean;
  /** render 전용 시드 스트림 (D-05). 파티클 위상이 이 값에 걸린다 */
  readonly renderSeed: number;
}

/**
 * `render/backgrounds/index.ts`가 내놓는 굽기 API (06 §3.2).
 *
 * 배경 파일 다섯을 직접 부르지 않는다 — 한산도가 겹 두 개라 `정적₀ → 동적₀ → 정적₁ → 동적₁`
 * 순서를 갖는데, 그 순서를 아는 것은 그 파일이지 여기가 아니다.
 */
export interface BackgroundApi {
  /** `Record<BackgroundId, readonly { drawStatic, drawDynamic }[]>` */
  readonly BACKGROUNDS: Record<string, readonly BackgroundLayerLike[] | undefined>;
  readonly bakeStageBackground: (backgroundId: string, renderSeed: number) => void;
  readonly disposeStageBackground: () => void;
  readonly drawStageBackground: (
    ctx: CanvasRenderingContext2D,
    backgroundId: string,
    tSec: number,
    renderSeed: number,
  ) => void;
}

export interface BackgroundLayerLike {
  readonly drawStatic: (ctx: CanvasRenderingContext2D, renderSeed: number) => void;
  readonly drawDynamic: (ctx: CanvasRenderingContext2D, tSec: number, renderSeed: number) => void;
}

export type Resolution<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'missing'; readonly expected: string; readonly detail: string };

/**
 * 모듈을 동적으로 부른다.
 *
 * 지정자를 변수로 넘기는 것은 타입 체크를 피하려는 것이 아니라 **모듈이 없어도 이 파일이
 * 컴파일되어야** 하기 때문이다. 리터럴로 적으면 `render/frame.ts`가 생기기 전에는
 * `npm run typecheck`이 하네스에서 먼저 깨지고, 그러면 하네스를 잘라내는 것 말고 방법이 없다.
 */
async function importModule(specifier: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickFunction(
  module: Record<string, unknown> | null,
  specifier: string,
  exportName: string,
): Resolution<(...args: never[]) => void> {
  if (module === null) {
    return { status: 'missing', expected: specifier, detail: '모듈이 아직 없다' };
  }
  const candidate = module[exportName];
  if (typeof candidate !== 'function') {
    return {
      status: 'missing',
      expected: `${specifier} → export ${exportName}`,
      detail: `모듈은 있는데 ${exportName}이(가) 함수가 아니다`,
    };
  }
  return { status: 'ready', value: candidate as (...args: never[]) => void };
}

/** `render/frame.ts`의 실제 시그니처. 이 파일이 게임 쪽에 대해 갖는 두 번째 가정이다 */
type GameDrawFrame = (ctx: CanvasRenderingContext2D, view: FrameView, deps: FrameDeps) => void;

/**
 * 주입 payload를 게임 프레임 뷰로 옮겨 `drawFrame`을 부른다.
 *
 * 어댑터가 여기 있는 이유는 이 파일이 결합점이기 때문이다 — `in-page.ts`는 `MockupFrame`과
 * `DrawFrameOptions`만 알고, `render/frame.ts`가 실제로 무엇을 받는지 모른 채로 남아야 한다.
 *
 * **호출마다 새 deps를 만들고 버린다.** 정지 프레임 한 장이라 프레임을 넘겨 사는 상태가 없어야
 * 하고, 남겨 두면 같은 하네스 안에서 6장이 서로의 버스 구독을 물려받는다.
 */
function adaptFrameRenderer(drawFrame: GameDrawFrame, stageKey: string): DrawFrameFn {
  const backgroundId = EXPECTED_BINDINGS.backgroundIdFor[stageKey] as BackgroundId | undefined;
  return (ctx, frame, options) => {
    if (backgroundId === undefined) {
      throw new Error(`목업 BG 키에 대응하는 BackgroundId가 표에 없다: ${stageKey}`);
    }
    ensureBackgroundBaked(backgroundId, options.renderSeed);
    const deps = createFrameDeps(options.realDtSec, options.reducedMotion, options.renderSeed);
    try {
      drawFrame(ctx, toFrameView(frame, backgroundId, options.renderSeed), deps);
    } finally {
      disposeFrameDeps(deps);
    }
  };
}

export async function resolveFrameRenderer(stageKey: string): Promise<Resolution<DrawFrameFn>> {
  const module = await importModule(EXPECTED_BINDINGS.frameModule);
  const found = pickFunction(module, EXPECTED_BINDINGS.frameModule, EXPECTED_BINDINGS.frameExport);
  return found.status === 'ready'
    ? { status: 'ready', value: adaptFrameRenderer(found.value as unknown as GameDrawFrame, stageKey) }
    : found;
}

export interface StageBackgroundBinding {
  readonly backgroundId: string;
  readonly layers: readonly BackgroundLayerLike[];
  readonly api: BackgroundApi;
}

export async function resolveStageBackground(
  backgroundKey: string,
): Promise<Resolution<StageBackgroundBinding>> {
  const backgroundId = EXPECTED_BINDINGS.backgroundIdFor[backgroundKey];
  if (backgroundId === undefined) {
    return {
      status: 'missing',
      expected: `backgroundIdFor['${backgroundKey}']`,
      detail: '목업 BG 키에 대응하는 BackgroundId가 표에 없다',
    };
  }
  const specifier = EXPECTED_BINDINGS.backgroundModule;
  const module = await importModule(specifier);
  if (module === null) {
    return { status: 'missing', expected: specifier, detail: '모듈이 아직 없다' };
  }
  for (const name of ['bakeStageBackground', 'drawStageBackground', 'disposeStageBackground']) {
    const found = pickFunction(module, specifier, name);
    if (found.status === 'missing') {
      return found;
    }
  }
  const api = module as unknown as BackgroundApi;
  const layers = api.BACKGROUNDS[backgroundId];
  if (layers === undefined) {
    return {
      status: 'missing',
      expected: `${specifier} → BACKGROUNDS['${backgroundId}']`,
      detail: '배경 표에 그 키가 없다',
    };
  }
  return { status: 'ready', value: { backgroundId, layers, api } };
}
