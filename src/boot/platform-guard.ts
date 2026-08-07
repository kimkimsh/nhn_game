/**
 * 플랫폼 판정과 OS 접근성 플래그 — 스펙 §16.6 · 08 §7.2 · 12 §3
 *
 * 두 가지를 판정한다. 이 기기에서 게임을 시작해도 되는가(`isSupportedPlatform`), 그리고 OS가
 * 움직임 축소를 요구하는가(`prefersReducedMotion`). 둘 다 `window.matchMedia` 하나로 끝나므로
 * 한 파일에 있고, 둘 다 `sim/`이 읽을 수 없는 값이라 여기가 그 값들이 게임에 들어오는 입구다.
 *
 * ── 왜 `any-pointer`인가 ────────────────────────────────────────────────────────
 *
 * `pointer: fine`은 **주** 포인터만 본다. 터치스크린 노트북은 주 포인터가 `coarse`로 보고되면서
 * 마우스도 달려 있는데, `pointer`로 판정하면 그 기기가 미지원으로 튕긴다. `any-pointer`는
 * "정밀 포인터가 하나라도 있는가"를 묻는다.
 *
 * userAgent 문자열은 쓰지 않는다. 기기 목록은 반드시 낡고 하이브리드 기기를 못 가른다 —
 * §16.6이 요구하는 것은 기기 종류가 아니라 **입력 능력**이다. 게임패드도 보지 않는다.
 * §16.6이 미지원으로 명시했으므로 있어도 없는 것과 같다.
 *
 * ── 판정이 틀렸을 때의 탈출구 (T-18) ───────────────────────────────────────────
 *
 * §16.1의 이동에는 마우스 배정이 없다 — 실제로는 키보드가 필수이고 §16.6의 "키보드 또는
 * 마우스"는 느슨하게 적힌 것이다. 그런데 키보드의 존재는 feature detection으로 알 수 없다.
 * 그래서 판정은 포인터로 하되, 안내 화면에서 물리 keydown이 한 번이라도 오면 그 판정을
 * 뒤집는다. 뒤집힌 사실은 `sessionStorage`에 남는다 — 안내를 띄우는 경로가
 * `screens/manager.ts`의 첫 줄이라, 그 뒤에 판정을 바꾸려면 부팅을 다시 태우는 수밖에 없다.
 * 진입점 복원(12 §8-9)이 이미 같은 저장소를 같은 이유로 쓴다.
 *
 * ── prefers-reduced-motion의 소비자 ────────────────────────────────────────────
 *
 * `render/camera.ts`의 `setReducedMotion`(셰이크)과 `render/impact.ts`의 같은 이름
 * (임팩트 프레임) 둘이다. 이 파일은 값을 읽어 주기만 하고 누구에게 꽂을지는 그 둘을 만드는
 * 쪽이 정한다 — 여기서 인스턴스를 알면 boot/이 render/의 수명을 갖게 된다.
 */

/** §16.6 지원 판정. `pointer`가 아니라 `any-pointer`인 이유는 파일 머리 주석 참조 */
const FINE_POINTER_QUERY = '(any-pointer: fine)';

/** 12 §3 OS 접근성 설정 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** T-18로 뒤집힌 판정이 남는 자리. 탭을 닫으면 사라지는 것이 맞다 — 다른 기기에서 열면 다시 판정한다 */
const KEYBOARD_OVERRIDE_KEY = 'hwando.platform.keyboardSeen';
const KEYBOARD_OVERRIDE_VALUE = '1';

/**
 * `matchMedia` 자체가 없으면 null이다. **null을 거짓으로 뭉개지 않는다** — 지원 판정에서
 * null은 "지원"이고 움직임 축소 판정에서 null은 "축소 안 함"이라, 두 자리의 안전한 기본값이
 * 서로 반대쪽이다.
 */
function queryMatches(query: string): boolean | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(query).matches;
}

/** sessionStorage는 사파리 비공개 모드에서 접근만 해도 던진다. 저장소가 없다고 사람을 막지 않는다 */
function readKeyboardOverride(): boolean {
  try {
    return window.sessionStorage.getItem(KEYBOARD_OVERRIDE_KEY) === KEYBOARD_OVERRIDE_VALUE;
  } catch {
    return false;
  }
}

/**
 * §16.6 이 기기에서 게임을 시작해도 되는가. `screens/registry.ts`가 이 이름으로 잡는다.
 *
 * 판정할 수단이 없으면(`matchMedia` 부재) 지원으로 본다. 검사기가 없다는 것이 사람을 막는
 * 근거가 될 수는 없고, 잘못 막는 비용이 잘못 통과시키는 비용보다 크다.
 */
export function isSupportedPlatform(): boolean {
  if (readKeyboardOverride()) {
    return true;
  }
  return queryMatches(FINE_POINTER_QUERY) ?? true;
}

/**
 * T-18. `screens/unsupported.ts`가 물리 keydown 하나를 받으면 부른다.
 * 이 함수는 저장만 한다 — 다시 부팅시키는 것은 부른 쪽의 일이다.
 */
export function grantKeyboardOverride(): void {
  try {
    window.sessionStorage.setItem(KEYBOARD_OVERRIDE_KEY, KEYBOARD_OVERRIDE_VALUE);
  } catch {
    // 저장하지 못하면 새로고침 뒤 다시 안내가 뜬다. 막을 방법이 없고, 막을 값도 아니다
  }
}

/** 12 §3 셰이크와 임팩트 프레임을 끌지 여부. 소비자는 render/camera.ts와 render/impact.ts다 */
export function prefersReducedMotion(): boolean {
  return queryMatches(REDUCED_MOTION_QUERY) ?? false;
}

/**
 * 설정은 런 도중에도 바뀐다. 부팅 때 한 번만 읽으면 그 이후의 변경이 새로고침 전까지 안 먹는다.
 * 구독할 수단이 없으면 아무 일도 안 하는 해제 함수를 낸다 — 호출부에 갈래가 생기지 않게.
 */
export function watchReducedMotion(listener: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return (): void => undefined;
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const handle = (event: MediaQueryListEvent): void => listener(event.matches);
  query.addEventListener('change', handle);
  return (): void => query.removeEventListener('change', handle);
}
