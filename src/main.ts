/**
 * 부팅 — 캔버스 → 스프라이트 굽기 → 화면 매니저. 이 파일이 갖는 것은 그 세 호출의 순서뿐이다.
 *
 * 굽기는 캔버스가 생긴 뒤여야 하고 화면 매니저보다 앞이어야 한다. bakeSprites가 view를 받고,
 * 굽기가 끝나기 전에 첫 프레임이 나가면 아끼려던 지연 생성이 그 프레임에 그대로 걸린다.
 *
 * screens/manager.ts는 아직 없다 (P6-1). 그 한 줄만 정적 import 대신 import.meta.glob으로 부른다
 * — 일치하는 파일이 없으면 빈 객체를 내므로 빌드가 깨지지 않고, 파일이 생기는 순간 고치지 않아도
 * 그것을 부른다. 정적 import로 적으면 파일이 생기기 전까지 `npm run build`가 통째로 실패한다.
 */

import { bootCanvas, type CanvasView } from './boot/canvas';
import { bakeSprites, handleViewChanged } from './boot/sprite-bake';
import { PLAYFIELD } from './config/playfield';

/** index.html의 canvas 요소 id. 그 파일과 이 파일이 공유하는 유일한 문자열이다 */
const CANVAS_ELEMENT_ID = 'stage';

type BootModules = Record<string, () => Promise<unknown>>;
type BootStep = (view: CanvasView) => void | Promise<void>;

const SCREEN_MANAGER_MODULE: BootModules = import.meta.glob('./screens/manager.ts');

/**
 * 모듈이 아직 없으면 조용히 건너뛰고 거짓을 낸다. 있는데 약속한 함수가 없으면 던진다 —
 * 둘을 같이 삼키면 P6-1이 export 이름을 틀렸을 때 검은 화면만 남는다.
 */
async function runBootStep(modules: BootModules, exportName: string, view: CanvasView): Promise<boolean> {
  const load = Object.values(modules)[0];
  if (load === undefined) {
    return false;
  }
  const loaded = await load();
  const step: unknown = (loaded as Record<string, unknown>)[exportName];
  if (typeof step !== 'function') {
    throw new Error(`부팅 모듈이 ${exportName}을 export하지 않는다`);
  }
  await (step as BootStep)(view);
  return true;
}

async function boot(): Promise<void> {
  const view = bootCanvas({
    canvasId: CANVAS_ELEMENT_ID,
    logicalWidthU: PLAYFIELD.widthU,
    logicalHeightU: PLAYFIELD.heightU,
    // backing store를 다시 만들면 ctx에 묶인 해칭 패턴의 축척이 무효가 된다 (02 §5.3).
    // 첫 계산에서는 불리지 않으므로 굽기보다 먼저 등록해도 굽기 결과를 지우지 않는다
    onViewChanged: handleViewChanged,
  });
  await bakeSprites(view);
  if (await runBootStep(SCREEN_MANAGER_MODULE, 'startScreens', view)) {
    return;
  }
  // P6-1이 오기 전까지의 대역. 이것이 없으면 index.html은 검은 캔버스만 내보내고, 검은 화면은
  // 원인이 안 보이는 실패라 부팅이 성공한 것으로 오해된다. manager.ts가 생기는 순간 이 갈래는
  // 위 return에 막혀 죽고, boot/p3-entry.ts와 dev/p3-harness.ts를 함께 지우면 된다
  const p3 = await import('./boot/p3-entry');
  await p3.startP3Entry(view);
}

boot().catch((cause: unknown) => {
  // 부팅 실패는 화면에 검은 캔버스로만 나타난다. 원인을 콘솔에 남기지 않으면 증상만 남는다
  console.error('부팅 실패', cause);
});
