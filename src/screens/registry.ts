/**
 * 화면이 `screens/manager.ts`에 꽂히는 계약과, 아직 없을 수도 있는 이웃 모듈을 늦게 잡는 법.
 *
 * 계약이 매니저가 아니라 여기 있는 이유는 순환 import 때문이다 — 매니저가 늦게 잡기를 부르고
 * 늦게 잡기는 팩토리 타입을 알아야 하므로, 둘 다 이 파일을 보게 두면 고리가 생기지 않는다.
 *
 * 늦게 잡는 이유는 P6의 아홉 작업이 병렬이기 때문이다.
 *
 * 타이틀(P6-2) · 카드 선택(P6-3) · 일시정지와 결과(P6-4) · 치트 메뉴(P6-8) · 플랫폼 가드(P6-2) ·
 * 믹서(P6-5)는 `screens/manager.ts`와 같은 단계에서 따로 만들어진다. 정적 import로 적으면 그중
 * 하나만 없어도 `npm run build`가 통째로 실패하므로, `main.ts`가 `manager.ts`를 잡는 방식과 같은
 * `import.meta.glob`으로 잡는다 — 일치하는 파일이 없으면 빈 객체이고, 파일이 생기면 이 표를
 * 고치지 않아도 그것을 쓴다.
 *
 * **아래 표가 계약이다.** 왼쪽이 파일, `name`이 그 파일이 export해야 하는 이름이다.
 */

import type { Input, InputPress } from '../core/input';
import type { Run, StageEntryPoint } from '../sim/run';
import type { CardId } from '../config/ids';

/** 08 §1.1의 화면 일곱 중 여섯. 치트 메뉴만 화면이 아니라 오버레이라 여기 없다 */
export type ScreenId = 'title' | 'play' | 'cardSelect' | 'pause' | 'result' | 'unsupported';

/** 화면이 낼 수 있는 요청 전부. 오른쪽 주석이 08 §1.4의 전이 번호다 */
export type ScreenRequest =
  | { readonly kind: 'startRun' }                                 // T-03
  | { readonly kind: 'pickCard'; readonly cardId: CardId }         // T-05
  | { readonly kind: 'reroll' }                                    // T-17
  | { readonly kind: 'resume' }                                    // T-10
  | { readonly kind: 'abandon' }                                   // T-11
  | { readonly kind: 'restart' }                                   // T-15
  | { readonly kind: 'toTitle' }                                   // T-16
  | { readonly kind: 'jump'; readonly target: StageEntryPoint };    // T-14

/** 화면 하나가 이 파일에 주는 것. 그림 한 장과 눌림 소비뿐이고 전이는 하지 않는다 */
export interface Screen {
  /** 층 12 오버레이 한 장. 딤도 여기서 얹는다 (C-02) */
  paint(ctx: CanvasRenderingContext2D, realDtSec: number): void;
  /** 이 프레임 몫의 눌림. 전이가 필요하면 `host.request()`로 요청한다 */
  update(presses: readonly InputPress[], realDtSec: number): void;
  dispose?(): void;
}

/** 화면이 이 파일에서 읽는 것 전부 */
export interface ScreenHost {
  readonly input: Input;
  /** 지금 살아 있는 런. 타이틀과 미지원 안내에서는 null이다 */
  run(): Run | null;
  muted(): boolean;
  setMuted(muted: boolean): void;
  request(request: ScreenRequest): void;
}

export type CreateScreen = (host: ScreenHost) => Screen;

type LateModules = Record<string, () => Promise<unknown>>;

/** 늦게 잡는 화면 다섯. `import.meta.glob`의 인자는 리터럴이어야 해서 한 줄씩 적는다 */
export type LateScreenKey = 'title' | 'cardSelect' | 'pause' | 'result' | 'cheat';

const LATE_SCREENS: Readonly<Record<LateScreenKey, { modules: LateModules; name: string }>> = {
  title: { modules: import.meta.glob('./title.ts'), name: 'createTitleScreen' },
  cardSelect: { modules: import.meta.glob('./card-select.ts'), name: 'createCardSelectScreen' },
  pause: { modules: import.meta.glob('./pause.ts'), name: 'createPauseScreen' },
  result: { modules: import.meta.glob('./result.ts'), name: 'createResultScreen' },
  cheat: { modules: import.meta.glob('../dev/cheat-menu.ts'), name: 'createCheatMenu' },
};
const UNSUPPORTED_SOURCE: LateModules = import.meta.glob('./unsupported.ts');
const PLATFORM_GUARD_SOURCE: LateModules = import.meta.glob('../boot/platform-guard.ts');
const MIXER_SOURCE: LateModules = import.meta.glob('../audio/mixer.ts');

/**
 * 모듈이 아직 없으면 null을 낸다. 있는데 약속한 이름이 없으면 던진다 — 둘을 같이 삼키면
 * 이름을 틀린 화면이 조용히 안 열리고 원인이 화면에 안 남는다(`main.ts`와 같은 규칙이다).
 */
async function loadExport<T>(modules: LateModules, exportName: string): Promise<T | null> {
  const load = Object.values(modules)[0];
  if (load === undefined) {
    return null;
  }
  const value = ((await load()) as Record<string, unknown>)[exportName];
  if (typeof value !== 'function') {
    throw new Error(`모듈이 ${exportName}을 export하지 않는다`);
  }
  return value as T;
}

/** §16.6 지원 판정. 가드가 아직 없으면 지원으로 본다 — 없는 파일이 사람을 막으면 안 된다 */
export async function isSupportedPlatform(): Promise<boolean> {
  const guard = await loadExport<() => boolean>(PLATFORM_GUARD_SOURCE, 'isSupportedPlatform');
  return guard === null ? true : guard();
}

/** §7.3 미지원 안내. 이 화면만 캔버스가 아니라 DOM으로 그린다 */
export async function showUnsupportedNotice(): Promise<void> {
  const show = await loadExport<() => void>(UNSUPPORTED_SOURCE, 'showUnsupported');
  show?.();
}

/** §17 음소거. 상태의 소유자는 audio/mixer.ts이고 매니저는 그것을 부르기만 한다 */
export async function loadMuteSetter(): Promise<((muted: boolean) => void) | null> {
  return loadExport<(muted: boolean) => void>(MIXER_SOURCE, 'setMuted');
}

export async function loadScreenFactories(): Promise<Partial<Record<LateScreenKey, CreateScreen>>> {
  const factories: Partial<Record<LateScreenKey, CreateScreen>> = {};
  for (const key of Object.keys(LATE_SCREENS) as LateScreenKey[]) {
    const source = LATE_SCREENS[key];
    const factory = await loadExport<CreateScreen>(source.modules, source.name);
    if (factory !== null) {
      factories[key] = factory;
    }
  }
  return factories;
}
