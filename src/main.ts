/**
 * 부팅 — 지원 판정 → 캔버스 → 스프라이트 굽기 → 소리 구독 → 화면 매니저.
 *
 * 이 파일이 갖는 것은 그 다섯 호출의 순서뿐이다. 전이도 상태도 없다.
 *
 * ── 지원 판정이 캔버스보다 먼저다 (§16.6) ──────────────────────────────────────
 *
 * §16.6은 미지원 기기에서 "게임을 시작하지 않고" 안내만 띄우라고 요구한다. 굽기는 8.3MB짜리
 * 오프스크린 캔버스를 세우므로(06 §3.3), 판정을 굽기 뒤로 미루면 폰에서 안내가 뜨기까지 몇 초
 * 동안 빈 화면이 남는다 — 그 몇 초가 미지원이 아니라 고장으로 읽힌다.
 *
 * `screens/manager.ts`도 첫 줄에서 같은 `isSupportedPlatform()`을 부른다. 두 곳이 같은 함수를
 * 부르므로 판정이 갈라지지 않고, 그쪽 갈래는 `startScreens`를 이 파일 밖에서 부르는 경우의
 * 방어로 남는다. T-18의 탈출구가 안내 화면에서 새로고침을 거는 것도 이 구조 그대로다 —
 * 판정이 뒤집힌 뒤 다시 여기부터 시작한다.
 *
 * ── 굽기는 캔버스 뒤, 화면 매니저 앞이다 ──────────────────────────────────────
 *
 * 굽기가 끝나기 전에 첫 프레임이 나가면 아끼려던 지연 생성이 그 프레임에 그대로 걸린다.
 * 캔버스 뒤인 것은 `handleViewChanged`가 등록되어 있어야 첫 리사이즈에서 해칭 패턴이
 * 무효화되기 때문이다.
 *
 * ── 소리 구독은 부팅에서 한 번 건다 ───────────────────────────────────────────
 *
 * `audio/sfx.ts`는 `core/bus.ts`의 전역 버스만 보고(07 §1.1) 아무에게도 불리지 않는다.
 * 그 구독을 거는 자리가 없으면 §17의 사건음이 하나도 안 난다. 버스는 게임 전체가 하나를 쓰고
 * `attachSfx`는 멱등하며 첫 제스처 전에 불러도 되므로(AudioContext가 없으면 각 진입점이
 * 첫 줄에서 반환한다, 07 §2.5 함정 6), 런이 생기기 전인 여기가 그 자리다.
 *
 * master/sfx/music 게인과 첫 제스처 resume은 `audio/mixer.ts`가 로드되는 것만으로 걸린다.
 * 그 로드는 `screens/registry.ts`의 `loadMuteSetter()`가 하므로 여기서 다시 잡지 않는다.
 */

import { attachSfx } from './audio/sfx';
import { bootCanvas } from './boot/canvas';
import { isSupportedPlatform } from './boot/platform-guard';
import { bakeSprites, handleViewChanged } from './boot/sprite-bake';
import { PLAYFIELD } from './config/playfield';
import { startScreens } from './screens/manager';
import { showUnsupported } from './screens/unsupported';

/** index.html의 canvas 요소 id. 그 파일과 이 파일이 공유하는 유일한 문자열이다 */
const CANVAS_ELEMENT_ID = 'stage';

async function boot(): Promise<void> {
  if (!isSupportedPlatform()) {
    showUnsupported();
    return;
  }

  const view = bootCanvas({
    canvasId: CANVAS_ELEMENT_ID,
    logicalWidthU: PLAYFIELD.widthU,
    logicalHeightU: PLAYFIELD.heightU,
    // backing store를 다시 만들면 ctx에 묶인 해칭 패턴의 축척이 무효가 된다 (02 §5.3).
    // 첫 계산에서는 불리지 않으므로 굽기보다 먼저 등록해도 굽기 결과를 지우지 않는다
    onViewChanged: handleViewChanged,
  });
  bakeSprites();
  attachSfx();
  await startScreens(view);
}

boot().catch((cause: unknown) => {
  // 부팅 실패는 화면에 검은 캔버스로만 나타난다. 원인을 콘솔에 남기지 않으면 증상만 남는다
  console.error('부팅 실패', cause);
});
