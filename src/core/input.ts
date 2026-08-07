/**
 * 입력 — 키보드·마우스, press edge, 선입력 버퍼. 스펙 §16 · 08_화면과_UI.md §10.
 *
 * 두 층으로 나뉜다. createInput()이 만드는 상태 기계는 DOM을 모르고 주입된 사실(pressKey ·
 * releaseKey · movePointer · pressPointer)만 받는다. attachInput()이 그 위에 window·document
 * 리스너를 건다. 이 경계가 없으면 09_검증_전략.md §3.7의 tests/core.test.ts가 돌지 못한다 —
 * vitest는 node에서 돌고 이 저장소에 jsdom이 없다.
 *
 * 키 매핑 표가 config/가 아니라 여기 있는 이유는 core/가 아무것도 import하지 않기 때문이다
 * (03_파일_구조.md §5). 리매핑을 지원하지 않으므로(§16.5) 표가 상수인 것이 곧 계약이다.
 * 반대로 선입력 버퍼의 길이는 여기 없다 — 카드가 바꾸는 값이라 호출자가 인자로 넣는다.
 */

/**
 * 화면이 해석하는 단위. 한 물리 키가 여러 동작을 낼 수 있고(Space = 패리 + 확정),
 * 화면은 자기가 읽는 것만 골라 읽는다 — 전투는 parry를, 메뉴는 confirm을 본다.
 * 이렇게 두지 않으면 core/가 지금 어느 화면인지 알아야 한다.
 */
export type InputAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'parry'
  | 'confirm'
  | 'cards'
  | 'mute'
  | 'pause'
  | 'reroll'
  | 'cheat';

/** 논리 좌표 (u). §3.1의 좌표계이고 환산은 attachInput()이 한다 */
export interface PointerPositionU {
  readonly xU: number;
  readonly yU: number;
}

/**
 * 접수된 눌림 하나.
 *
 * atMs를 함께 들고 있는 것이 이 파일의 존재 이유다(12_통합_계약.md §10 E-01). beginFrame()이
 * rAF 프레임당 1회라서, 프레임 단위로 소비하면 등급을 고를 수 있는 해상도가 sim 스텝이 아니라
 * 프레임 간격이 되고 고정 스텝을 잘게 쪼갠 값이 전부 사라진다. KeyboardEvent.timeStamp와
 * PointerEvent.timeStamp는 performance.now()와 같은 타임베이스라 환산이 없다.
 */
export interface InputPress {
  readonly action: InputAction;
  readonly atMs: number;
  /** 포인터에서 온 눌림만 값을 갖는다. 키보드는 null */
  readonly pointerU: PointerPositionU | null;
}

/** 마지막으로 관측된 커서 자리. seen이 false면 xU·yU는 의미가 없다 — 키보드만 쓰면 끝까지 false다 */
export interface PointerState {
  xU: number;
  yU: number;
  seen: boolean;
}

/** attachInput()이 브라우저 이벤트에서 뽑아 넣는다. 테스트는 같은 자리에 직접 값을 넣는다 */
export interface KeyPress {
  code: string;
  atMs: number;
  shiftHeld: boolean;
  /** OS 자동 반복 여부. 참이면 눌림으로 세지 않는다 */
  repeat: boolean;
}

export interface PointerPress {
  atMs: number;
  xU: number;
  yU: number;
}

export interface Input {
  readonly pointer: PointerState;

  /**
   * rAF 프레임당 1회, 고정 스텝 while 루프 **밖**에서 부른다(02_아키텍처.md §1).
   * 이 프레임이 소비할 수 있는 시각의 상한을 정한다 — 프레임이 시작한 뒤에 찍힌 눌림은
   * 아직 시뮬레이션되지 않은 시간에 속하므로 다음 프레임 몫이다.
   * 히트스톱 중에도 이 호출은 계속 돈다. 정지 중에 누른 패리가 풀리는 순간 발동해야 한다.
   */
  beginFrame(frameNowMs: number): void;

  /** 누르고 있는 동안 참. 이동과 Tab 오버레이만 이걸 읽는다 — 나머지는 전부 눌림 단위다(§16.5) */
  isDown(action: InputAction): boolean;

  /**
   * untilMs까지의 눌림을 오래된 것부터 꺼내고 큐에서 지운다.
   * 상한은 beginFrame()이 받은 프레임 시각이다. 반드시 큐에서 지워야 한다 —
   * 60Hz 화면은 한 프레임에 sim 스텝이 두 번 돌므로, 남겨 두면 같은 눌림이 두 번 소비된다(08 §10.2).
   */
  takePressesUntil(untilMs: number): readonly InputPress[];

  /** sim 스텝이 없는 화면(타이틀·카드 선택·일시정지·결과)이 이 프레임 몫을 통째로 가져간다 */
  takePresses(): readonly InputPress[];

  /** 매핑된 키였으면 참. attachInput()이 이 값으로 preventDefault 여부를 정한다 */
  pressKey(key: KeyPress): boolean;
  releaseKey(code: string): void;
  movePointer(xU: number, yU: number): void;
  pressPointer(press: PointerPress): void;

  /** 눌림을 접수했으나 쿨다운이라 발동하지 못했을 때. 길이는 호출자가 config에서 넣는다 */
  armParryBuffer(bufferSec: number): void;

  /**
   * 스텝 순서 1번(타이머 감산)에서 simDt로만 깎는다(05_시스템_설계.md §1, 12 §10 E-03).
   * 실시간으로 깎으면 GREAT 히트스톱 동안 버퍼의 대부분이 정지 안에서 사라지는데 쿨다운은
   * 얼어 있어 끝나지 않고, 그 결과 GREAT 직후의 연속 패리가 구조적으로 불가능해진다.
   */
  decayParryBuffer(simDtSec: number): void;

  hasParryBuffer(): boolean;

  /** 발동시켰을 때, 그리고 일시정지 재개·복귀 카운트다운 종료 시(08 §10.3 T-10) */
  clearParryBuffer(): void;

  /**
   * 누른 키·대기 중인 눌림·버퍼를 전부 버린다. blur와 visibilitychange가 부른다 —
   * keyup을 못 받으면 키가 영원히 눌린 채로 남아 플레이어가 한 방향으로 흘러가고,
   * 큐에 남은 눌림은 탭에서 돌아온 첫 프레임에 저절로 발동한다(08 §10.3).
   */
  reset(): void;
}

/** 좌클릭과 Space가 같은 것을 뜻한다 — 전투에서는 패리, 그 밖의 화면에서는 확정(§16.1 · §16.3) */
const PARRY_AND_CONFIRM: readonly InputAction[] = ['parry', 'confirm'];
const CHEAT_ONLY: readonly InputAction[] = ['cheat'];
const NO_ACTIONS: readonly InputAction[] = [];

/** PointerEvent.button의 주 버튼 */
const PRIMARY_POINTER_BUTTON = 0;

/**
 * 08 §10.1의 통합표 그대로. 이 표에 없는 키는 어떤 화면에서도 아무 일도 하지 않는다.
 *
 * 키는 event.code(물리 위치)로 식별한다. event.key는 레이아웃과 Shift에 따라 값이 바뀌어
 * W와 w가 갈리고 비 QWERTY 배열에서 WASD가 어긋난다. 리매핑이 없으므로(§16.5)
 * 물리 위치가 유일하게 안정적인 기준이다.
 *
 * F5 · F11 · F12 · Ctrl+Shift+I · Ctrl+Shift+J · Ctrl+Shift+C 가 이 표에 하나도 없다는 것이
 * §16.5의 브라우저 예약키 규칙을 지켰다는 검사 방법이다.
 */
const KEY_ACTIONS: Readonly<Record<string, readonly InputAction[]>> = {
  KeyW: ['moveUp'],
  ArrowUp: ['moveUp'],
  KeyS: ['moveDown'],
  ArrowDown: ['moveDown'],
  KeyA: ['moveLeft'],
  ArrowLeft: ['moveLeft'],
  KeyD: ['moveRight'],
  ArrowRight: ['moveRight'],
  Space: PARRY_AND_CONFIRM,
  KeyJ: ['parry'],
  Enter: ['confirm'],
  NumpadEnter: ['confirm'],
  Tab: ['cards'],
  KeyM: ['mute'],
  Escape: ['pause'],
  KeyR: ['reroll'],
};

/** F9만 표 밖이다 — Shift와 함께일 때만 치트이고, 맨 F9는 어떤 화면에서도 동작이 아니다(§18.2) */
function actionsFor(code: string, shiftHeld: boolean): readonly InputAction[] {
  if (code === 'F9') {
    return shiftHeld ? CHEAT_ONLY : NO_ACTIONS;
  }
  return KEY_ACTIONS[code] ?? NO_ACTIONS;
}

function createDownCounts(): Record<InputAction, number> {
  return {
    moveUp: 0,
    moveDown: 0,
    moveLeft: 0,
    moveRight: 0,
    parry: 0,
    confirm: 0,
    cards: 0,
    mute: 0,
    pause: 0,
    reroll: 0,
    cheat: 0,
  };
}

export function createInput(): Input {
  const presses: InputPress[] = [];
  /** 눌린 코드 → 눌린 시점에 부여된 동작들. Shift를 뗀 뒤 오는 F9 keyup도 이걸로 짝이 맞는다 */
  const heldActions = new Map<string, readonly InputAction[]>();
  const pointer: PointerState = { xU: 0, yU: 0, seen: false };
  let downCounts = createDownCounts();
  let horizonMs = 0;
  let parryBufferSec = 0;

  function enqueue(actions: readonly InputAction[], atMs: number, pointerU: PointerPositionU | null): void {
    for (const action of actions) {
      presses.push({ action, atMs, pointerU });
    }
  }

  function drain(untilMs: number): readonly InputPress[] {
    const taken: InputPress[] = [];
    const kept: InputPress[] = [];
    for (const press of presses) {
      if (press.atMs <= untilMs) {
        taken.push(press);
      } else {
        kept.push(press);
      }
    }
    presses.length = 0;
    presses.push(...kept);
    return taken;
  }

  return {
    pointer,

    beginFrame(frameNowMs: number): void {
      horizonMs = frameNowMs;
    },

    isDown(action: InputAction): boolean {
      return downCounts[action] > 0;
    },

    takePressesUntil(untilMs: number): readonly InputPress[] {
      return drain(Math.min(untilMs, horizonMs));
    },

    takePresses(): readonly InputPress[] {
      return drain(horizonMs);
    },

    pressKey(key: KeyPress): boolean {
      const actions = actionsFor(key.code, key.shiftHeld);
      if (actions.length === 0) {
        return false;
      }
      // 자동 반복과 이미 눌린 키는 눌림이 아니다. 이걸 세면 패리 버튼을 누르고만 있어도
      // 눌림이 계속 들어와 §5.1의 "누르고 있어도 활성이 연장되지 않는다"가 깨진다
      if (key.repeat || heldActions.has(key.code)) {
        return true;
      }
      heldActions.set(key.code, actions);
      for (const action of actions) {
        downCounts[action] += 1;
      }
      enqueue(actions, key.atMs, null);
      return true;
    },

    releaseKey(code: string): void {
      const actions = heldActions.get(code);
      if (actions === undefined) {
        return;
      }
      heldActions.delete(code);
      for (const action of actions) {
        downCounts[action] -= 1;
      }
    },

    movePointer(xU: number, yU: number): void {
      pointer.xU = xU;
      pointer.yU = yU;
      pointer.seen = true;
    },

    pressPointer(press: PointerPress): void {
      pointer.xU = press.xU;
      pointer.yU = press.yU;
      pointer.seen = true;
      // 누른 자리를 눌림에 함께 실어 보낸다. 커서는 그 사이에 움직이므로 화면이 나중에
      // pointer를 읽으면 클릭한 카드가 아니라 지금 커서 아래 카드를 고르게 된다
      enqueue(PARRY_AND_CONFIRM, press.atMs, { xU: press.xU, yU: press.yU });
    },

    armParryBuffer(bufferSec: number): void {
      parryBufferSec = bufferSec;
    },

    decayParryBuffer(simDtSec: number): void {
      parryBufferSec = Math.max(0, parryBufferSec - simDtSec);
    },

    hasParryBuffer(): boolean {
      return parryBufferSec > 0;
    },

    clearParryBuffer(): void {
      parryBufferSec = 0;
    },

    reset(): void {
      presses.length = 0;
      heldActions.clear();
      downCounts = createDownCounts();
      parryBufferSec = 0;
    },
  };
}

export interface InputAttachSpec {
  /** 포인터 이벤트를 받을 요소. 캔버스 밖 레터박스에서 누른 것은 입력이 아니다 */
  target: HTMLElement;
  /** §3.1 논리 해상도 (u). 커서를 이 좌표계로 환산한다 */
  logicalWidthU: number;
  logicalHeightU: number;
}

/**
 * CSS 픽셀 → 논리 u. 레터박스는 캔버스 밖이라(boot/canvas.ts) 요소 안쪽이 곧 플레이필드다.
 * 레이아웃 전에는 크기가 0이고 그때는 환산할 좌표계가 없다.
 */
function toLogicalU(event: PointerEvent, spec: InputAttachSpec): PointerPositionU | null {
  const widthPx = spec.target.clientWidth;
  const heightPx = spec.target.clientHeight;
  if (widthPx <= 0 || heightPx <= 0) {
    return null;
  }
  return {
    xU: (event.offsetX / widthPx) * spec.logicalWidthU,
    yU: (event.offsetY / heightPx) * spec.logicalHeightU,
  };
}

/** 리스너를 걸고 해제 함수를 돌려준다. 키는 window에서 받는다 — 캔버스는 포커스를 갖지 않는다 */
export function attachInput(input: Input, spec: InputAttachSpec): () => void {
  function handleKeyDown(event: KeyboardEvent): void {
    // Ctrl·Meta·Alt 조합은 통째로 무시한다. Ctrl+R과 Cmd+R이 KEY_ACTIONS의 KeyR과 겹치는데,
    // 여기서 걸러야 아래 preventDefault가 새로고침을 먹지 않는다(§16.5)
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    // 자동 반복까지 막아야 한다. Tab을 누르고 있으면 반복 keydown이 계속 오고,
    // 그중 하나라도 통과하면 포커스가 캔버스를 떠나 이후 키가 전부 사라진다(08 §10.2)
    const mapped = input.pressKey({
      code: event.code, atMs: event.timeStamp, shiftHeld: event.shiftKey, repeat: event.repeat,
    });
    if (mapped) {
      event.preventDefault();
    }
  }

  function handleKeyUp(event: KeyboardEvent): void {
    // keydown과 달리 수식 키를 보지 않는다. 누른 뒤에 Ctrl을 잡고 떼면 조합이 달라지는데,
    // 그때 떼기를 버리면 그 키가 영원히 눌린 상태로 남는다
    input.releaseKey(event.code);
  }

  function handlePointerMove(event: PointerEvent): void {
    const point = toLogicalU(event, spec);
    if (point !== null) {
      input.movePointer(point.xU, point.yU);
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== PRIMARY_POINTER_BUTTON) {
      return;
    }
    const point = toLogicalU(event, spec);
    if (point === null) {
      return;
    }
    input.pressPointer({ atMs: event.timeStamp, xU: point.xU, yU: point.yU });
  }

  function handleBlur(): void {
    input.reset();
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      input.reset();
    }
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  spec.target.addEventListener('pointermove', handlePointerMove);
  spec.target.addEventListener('pointerdown', handlePointerDown);

  function detach(): void {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    spec.target.removeEventListener('pointermove', handlePointerMove);
    spec.target.removeEventListener('pointerdown', handlePointerDown);
  }
  return detach;
}
