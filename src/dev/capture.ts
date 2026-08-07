/**
 * 캡처 도구 — 입력 기록/재생 · HUD 토글 · 씬 리셋 · 진입점 복원.
 * 06 §7(30초 영상) · 09 §4.2(기록 재생) · 12 §1 C-03(타이틀 어트랙트) · 12 §8-9.
 *
 * 하나의 녹화가 세 곳을 덮는다 — 제출 영상의 소스, 타이틀 어트랙트 루프, 버그 재현.
 * 셋 다 성립 조건은 D-05 하나다: 같은 시드 + 같은 입력 → 같은 결과.
 *
 * ── 프레임이 아니라 고정 스텝에 기록한다 ────────────────────────────────────────
 *
 * 벽시계 ms로 적어 두면 재생 기기의 rAF 간격이 다를 때 눌림이 다른 스텝에 소비되고, 등급이
 * 갈리는 순간 그 뒤 전부가 딴 판이 된다. 그래서 키 사건에 **고정 스텝 인덱스**를 붙여 적고
 * 재생은 스텝 경계에서만 먹인다. 두 기기의 프레임률이 달라도 같은 30초가 나온다.
 *
 * ── 키 코드를 그대로 적는다 ─────────────────────────────────────────────────────
 *
 * 동작(`InputAction`)이 아니라 `KeyboardEvent.code`를 적는다. 코드 → 동작 표는 core/input.ts가
 * 갖고 밖으로 내지 않으므로, 동작으로 적으면 그 표의 두 번째 사본이 여기 생긴다. 재생은 진짜
 * `createInput()`에 `pressKey`·`releaseKey`로 먹이므로 선입력 버퍼도 누름 유지도 실기와 같다.
 *
 * ── 이 파일을 부르는 자리 ───────────────────────────────────────────────────────
 *
 * `dev/`는 `screens/`를 import할 수 없다(03 §5). 그래서 이 파일은 스스로 설치된다 —
 * 브라우저에서 모듈이 적재되는 순간 `installCapture()`가 window 리스너와 `globalThis.hwando`를
 * 걸고, sim 시계를 붙이는 것(`attachSimClock`)만 선택이다. 시계가 없으면 스텝 인덱스를 벽시계로
 * 추정하는데 히트스톱만큼 어긋나므로, 촬영 테이크는 시계를 붙인 뒤에 딴다.
 *
 * 진입점 복원(12 §8-9)이 `sessionStorage`인 이유는 HMR이 이 프로젝트에서 안 되기 때문이다.
 * `config/`에 로직을 금지했으므로 어떤 모듈도 `import.meta.hot.accept` 경계를 선언할 수 없고,
 * 경계가 없으면 Vite는 편집마다 전체 새로고침을 보낸다 — 런이 타이틀로 초기화된다. 씬 리셋도
 * 같은 장치를 쓴다: 진입점을 적고 새로고침하는 것이 곧 리셋이다.
 */
import type { StageId } from '../config/ids';
import { createInput, type Input } from '../core/input';
import { FIXED_DT_SEC } from '../core/loop';
import type { CardInventory } from '../sim/cards';
import { jumpTo, setCards, type Run, type StageEntry } from '../sim/run';

export const TAPE_SCHEMA = 'hwando-input-tape/1';

const MS_PER_SEC = 1000;

/** 진입점이 새로고침을 건너뛰는 자리. 탭을 닫으면 함께 사라지는 것이 의도다 */
const ENTRY_STORAGE_KEY = 'hwando/dev/entry';

/**
 * 캡처 전용 단축키. §16.5가 브라우저에 넘긴 F5·F11·F12와 core/input.ts의 키 표를 둘 다 피한다.
 * F9는 Shift와 함께일 때 치트 진입이라 여기 없다(§18.2).
 */
const HOTKEY = { record: 'F2', hud: 'F4', mark: 'F7', reset: 'F8' } as const;

/** 한 키가 눌리거나 떼어진 사건 하나 */
export interface TapeKeyEvent {
  /** 이 사건을 소비해야 하는 고정 스텝 인덱스 */
  readonly step: number;
  readonly code: string;
  readonly down: boolean;
  /** F9의 치트 판정이 이 값으로 갈린다. keyup에는 뜻이 없다 */
  readonly shiftHeld: boolean;
}

export interface InputTape {
  readonly schema: typeof TAPE_SCHEMA;
  readonly seed: number;
  readonly stageId: StageId;
  readonly entry: StageEntry;
  readonly fixedDtSec: number;
  readonly stepCount: number;
  readonly events: readonly TapeKeyEvent[];
  /**
   * 06 §7.2 — 컷을 자르는 시계는 실시간이고 웨이브 경과는 sim 시계다. 히트스톱이 둘을 벌리므로
   * (sim은 멈추고 실시간은 흐른다) 두 값을 같이 남긴다. 하나만 남기면 컷 경계가 밀린 이유가
   * 테이크 안에 안 남는다.
   */
  readonly realSec: number;
  readonly simSec: number;
}

export interface TapeRecordSpec {
  readonly seed: number;
  readonly stageId: StageId;
  readonly entry: StageEntry;
  /** 누적 sim 초. 없으면 벽시계로 추정하고 그만큼 히트스톱에서 어긋난다 */
  readonly simTimeSec?: () => number;
}

export interface TapeRecorder {
  readonly events: readonly TapeKeyEvent[];
  stop(): InputTape;
}

/** 재생기 하나. `beginStep`이 그 스텝의 키 사건을 먹이고 소비 상한을 돌려준다 */
export interface TapePlayer {
  readonly input: Input;
  readonly stepCount: number;
  beginStep(stepIndex: number): number;
}

/**
 * 치트로 만든 진입 지점 한 벌 — §18.3의 스테이지·웨이브·보스 페이즈·라이프와 §18.4의 카드.
 * `StageEntryPoint`와 달리 카드를 함께 들고 있다. 복원은 그 둘을 한 번에 세워야 하기 때문이다.
 */
export interface CapturedEntry {
  readonly stageId: StageId;
  readonly at: StageEntry;
  /** null이면 진입 시점의 라이프를 유지한다(§18.3) */
  readonly lives: number | null;
  readonly cards: CardInventory;
  readonly resetReroll: boolean;
}

let hudHidden = false;
let simClock: (() => number) | null = null;
let recorder: TapeRecorder | null = null;
let lastTape: InputTape | null = null;
let installed = false;

/** 화면이 HUD를 그릴지. 06 §7.3대로 영상에는 쓰지 않고 정지 스크린샷에만 쓴다 */
export function isHudHidden(): boolean {
  return hudHidden;
}

export function setHudHidden(hidden: boolean): void {
  hudHidden = hidden;
}

/**
 * 화면 계층이 자기 sim 시계를 여기 걸어 준다. 걸지 않아도 기록은 되지만 스텝 인덱스가
 * 벽시계 추정이 되어 히트스톱 누적만큼 밀린다.
 */
export function attachSimClock(simTimeSec: () => number): void {
  simClock = simTimeSec;
}

export function detachSimClock(): void {
  simClock = null;
}

function nowRealSec(): number {
  return performance.now() / MS_PER_SEC;
}

function stepIndexAt(simTimeSec: number): number {
  return Math.max(0, Math.floor(simTimeSec / FIXED_DT_SEC));
}

/**
 * 기록을 시작한다. 리스너를 keydown·keyup에 직접 건다 — `Input`을 감싸지 않는 것은 그 객체를
 * `screens/manager.ts`가 만들고 `dev/`가 거기 닿을 수 없기 때문이고, 어차피 같은 DOM 사건이다.
 */
export function startTapeRecording(spec: TapeRecordSpec): TapeRecorder {
  const events: TapeKeyEvent[] = [];
  const startedRealSec = nowRealSec();
  const clock = spec.simTimeSec ?? simClock;
  const startedSimSec = clock === null || clock === undefined ? 0 : clock();

  function simSec(): number {
    if (clock === null || clock === undefined) {
      return nowRealSec() - startedRealSec;
    }
    return clock() - startedSimSec;
  }

  function record(event: KeyboardEvent, down: boolean): void {
    if (down && event.repeat) {
      return;
    }
    events.push({
      step: stepIndexAt(simSec()),
      code: event.code,
      down,
      shiftHeld: event.shiftKey,
    });
  }

  const onDown = (event: KeyboardEvent): void => record(event, true);
  const onUp = (event: KeyboardEvent): void => record(event, false);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  return {
    events,
    stop(): InputTape {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      const simEndSec = simSec();
      return {
        schema: TAPE_SCHEMA,
        seed: spec.seed,
        stageId: spec.stageId,
        entry: spec.entry,
        fixedDtSec: FIXED_DT_SEC,
        stepCount: stepIndexAt(simEndSec) + 1,
        events,
        realSec: nowRealSec() - startedRealSec,
        simSec: simEndSec,
      };
    },
  };
}

/**
 * 테이프 하나를 진짜 `Input`으로 되돌린다. 스텝마다 `beginStep`을 부르고 그 반환값을
 * `stepRun`의 `untilMs`로 넘기면 눌림이 기록된 그 스텝에서 소비된다.
 */
export function createTapePlayer(tape: InputTape): TapePlayer {
  const input = createInput();
  const byStep = new Map<number, TapeKeyEvent[]>();
  for (const event of tape.events) {
    const bucket = byStep.get(event.step);
    if (bucket === undefined) {
      byStep.set(event.step, [event]);
    } else {
      bucket.push(event);
    }
  }

  return {
    input,
    stepCount: tape.stepCount,
    beginStep(stepIndex: number): number {
      const atMs = stepIndex * tape.fixedDtSec * MS_PER_SEC;
      for (const event of byStep.get(stepIndex) ?? []) {
        if (event.down) {
          input.pressKey({ code: event.code, atMs, shiftHeld: event.shiftHeld, repeat: false });
        } else {
          input.releaseKey(event.code);
        }
      }
      // 눌림의 atMs와 상한이 같아야 그 스텝에서 소비된다. 상한을 앞당기면 한 스텝씩 밀린다
      input.beginFrame(atMs);
      return atMs;
    },
  };
}

function storage(): Storage | null {
  // 헤드리스는 node에서 돌고 거기에는 sessionStorage가 없다
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

function parseEntry(text: string): CapturedEntry | null {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Partial<CapturedEntry>;
  const at = value.at;
  if (typeof value.stageId !== 'number' || typeof at !== 'object' || at === null) {
    return null;
  }
  return {
    stageId: value.stageId,
    at,
    lives: typeof value.lives === 'number' ? value.lives : null,
    cards: Array.isArray(value.cards) ? value.cards : [],
    resetReroll: value.resetReroll === true,
  };
}

/** 12 §8-9. 치트가 진입 지점을 정한 순간 부른다 — 새로고침이 그 자리를 잃지 않게 한다 */
export function rememberEntryPoint(entry: CapturedEntry): void {
  storage()?.setItem(ENTRY_STORAGE_KEY, JSON.stringify(entry));
}

export function peekEntryPoint(): CapturedEntry | null {
  const text = storage()?.getItem(ENTRY_STORAGE_KEY) ?? null;
  if (text === null) {
    return null;
  }
  try {
    return parseEntry(text);
  } catch {
    // 손으로 고친 값이 남아 있어도 부팅은 막지 않는다. 복원을 포기하는 것이 안전한 쪽이다
    return null;
  }
}

export function clearEntryPoint(): void {
  storage()?.removeItem(ENTRY_STORAGE_KEY);
}

/**
 * 12 §8-9의 진입점 복원. 부팅해서 런이 세워진 직후에 한 번 부른다.
 *
 * 카드를 먼저 세우는 순서가 계약이다 — `jumpTo`가 스테이지를 다시 세우면서 보유 카드로
 * 스냅샷을 다시 계산하므로, 뒤집으면 R06이 올린 최대 라이프 위가 아니라 옛 최대치에서
 * 라이프가 잘린다(§11.4 · run.ts의 applyInventory 주석과 같은 이유다).
 */
export function restoreEntryPoint(run: Run): CapturedEntry | null {
  const entry = peekEntryPoint();
  if (entry === null) {
    return null;
  }
  if (entry.cards.length > 0) {
    setCards(run, entry.cards);
  }
  jumpTo(run, {
    stageId: entry.stageId,
    at: entry.at,
    ...(entry.lives === null ? {} : { lives: entry.lives }),
    resetReroll: entry.resetReroll,
  });
  return entry;
}

/**
 * 씬 리셋. 진입점을 적고 새로고침한다 — HMR 경계가 없어 어차피 전체 새로고침이 오는 이상,
 * 리셋과 편집 후 복귀가 같은 장치를 쓰는 편이 왕복 시간을 한 번만 지불하게 한다.
 */
export function resetScene(entry: CapturedEntry | null): void {
  if (entry === null) {
    clearEntryPoint();
  } else {
    rememberEntryPoint(entry);
  }
  location.reload();
}

/** 06 §7.2가 요구한 두 시계. 컷 경계를 실측 실시간으로 잘라야 하므로 둘을 같이 낸다 */
export function captureTiming(): { readonly realSec: number; readonly simSec: number } {
  return { realSec: nowRealSec(), simSec: simClock === null ? Number.NaN : simClock() };
}

/** 콘솔에서 부르는 손잡이. `hwando.record(spec)`으로 시작하고 `hwando.stop()`이 테이프를 낸다 */
export interface CaptureHandle {
  record(spec: TapeRecordSpec): void;
  stop(): InputTape | null;
  /** 마지막 테이프. 콘솔에서 JSON으로 떠 저장소에 커밋하는 것이 보관 경로다 */
  tape(): InputTape | null;
  hud(): boolean;
  mark(): void;
  reset(): void;
}

/** 콘솔이 잡는 전역 이름. `globalThis`를 넓히지 않는 것은 그 선언이 src 전체에 새기 때문이다 */
const CAPTURE_GLOBAL = 'hwando';

/** 단축키가 쓰는 기본값. 시드와 스테이지를 아는 것은 화면 계층뿐이라 손잡이 쪽이 정확하다 */
const DEFAULT_RECORD_SPEC: TapeRecordSpec = { seed: 0, stageId: 1, entry: { kind: 'stageStart' } };

const handle: CaptureHandle = {
  record(spec: TapeRecordSpec): void {
    recorder ??= startTapeRecording(spec);
  },
  stop(): InputTape | null {
    if (recorder !== null) {
      lastTape = recorder.stop();
      recorder = null;
    }
    return lastTape;
  },
  tape: (): InputTape | null => lastTape,
  hud(): boolean {
    hudHidden = !hudHidden;
    return hudHidden;
  },
  mark(): void {
    const timing = captureTiming();
    console.info(`[capture] real=${timing.realSec.toFixed(3)}s sim=${timing.simSec.toFixed(3)}s`);
  },
  reset(): void {
    resetScene(peekEntryPoint());
  },
};

const HOTKEY_ACTIONS: Readonly<Record<string, () => void>> = {
  [HOTKEY.record]: () => void (recorder === null ? handle.record(DEFAULT_RECORD_SPEC) : handle.stop()),
  [HOTKEY.hud]: () => void handle.hud(),
  [HOTKEY.mark]: () => handle.mark(),
  [HOTKEY.reset]: () => handle.reset(),
};

function onHotkey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return;
  }
  const action = HOTKEY_ACTIONS[event.code];
  if (action === undefined) {
    return;
  }
  action();
  event.preventDefault();
}

/**
 * 브라우저에서만 설치한다. 두 번 불러도 리스너가 겹치지 않는다 —
 * 헤드리스는 같은 모듈에서 테이프 재생과 진입점 형식만 가져가고 DOM에는 닿지 않는다.
 */
export function installCapture(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;
  (globalThis as unknown as Record<string, unknown>)[CAPTURE_GLOBAL] = handle;
  window.addEventListener('keydown', onHotkey);
}

installCapture();
