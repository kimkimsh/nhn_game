/**
 * 부팅 — 캔버스 → 스프라이트 굽기 → 화면 매니저. 이 파일이 갖는 것은 그 세 호출의 순서뿐이다.
 *
 * 뒤의 두 모듈은 아직 없다. P1이 boot/sprite-bake.ts를, P6-1이 screens/manager.ts를 만든다.
 * 그래서 정적 import 대신 import.meta.glob으로 부른다 — 일치하는 파일이 없으면 빈 객체를 내므로
 * 빌드가 깨지지 않고, 파일이 생기는 순간 아래 두 줄은 고치지 않아도 그것을 부른다.
 * 정적 import로 적으면 파일이 생기기 전까지 `npm run build`가 통째로 실패한다.
 */

import { bootCanvas, type CanvasView } from './boot/canvas';

/** index.html의 canvas 요소 id. 그 파일과 이 파일이 공유하는 유일한 문자열이다 */
const CANVAS_ELEMENT_ID = 'stage';

/** §3.1 논리 해상도 (u). P2-1의 config/playfield.ts가 생기면 그쪽이 단일 소스가 되고 이 두 줄은 사라진다 */
const LOGICAL_WIDTH_U = 1080;
const LOGICAL_HEIGHT_U = 1920;

type BootModules = Record<string, () => Promise<unknown>>;
type BootStep = (view: CanvasView) => void | Promise<void>;

const SPRITE_BAKE_MODULE: BootModules = import.meta.glob('./boot/sprite-bake.ts');
const SCREEN_MANAGER_MODULE: BootModules = import.meta.glob('./screens/manager.ts');

/**
 * 모듈이 아직 없으면 조용히 건너뛰고, 있는데 약속한 함수가 없으면 던진다.
 * 둘을 같이 삼키면 P1·P6-1이 export 이름을 틀렸을 때 검은 화면만 남는다.
 */
async function runBootStep(modules: BootModules, exportName: string, view: CanvasView): Promise<void> {
  const load = Object.values(modules)[0];
  if (load === undefined) {
    return;
  }
  const loaded = await load();
  const step: unknown = (loaded as Record<string, unknown>)[exportName];
  if (typeof step !== 'function') {
    throw new Error(`부팅 모듈이 ${exportName}을 export하지 않는다`);
  }
  await (step as BootStep)(view);
}

async function boot(): Promise<void> {
  // onViewChanged는 아직 비어 있다. 정적 레이어 캐시를 갖는 쪽(P1 스프라이트, P4 배경·비네트)이
  // 붙을 때 그 무효화 함수를 여기서 넘긴다 — 02 §5.3
  const view = bootCanvas({
    canvasId: CANVAS_ELEMENT_ID,
    logicalWidthU: LOGICAL_WIDTH_U,
    logicalHeightU: LOGICAL_HEIGHT_U,
  });
  await runBootStep(SPRITE_BAKE_MODULE, 'bakeSprites', view);
  await runBootStep(SCREEN_MANAGER_MODULE, 'startScreens', view);
}

boot().catch((cause: unknown) => {
  // 부팅 실패는 화면에 검은 캔버스로만 나타난다. 원인을 콘솔에 남기지 않으면 증상만 남는다
  console.error('부팅 실패', cause);
});
