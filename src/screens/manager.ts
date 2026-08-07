/**
 * 화면 전이 — 08 §1.4의 전이표 T-01 ~ T-19가 사는 유일한 자리.
 *
 * **전이 조건이 코드 한 곳에 모인다.** 다른 화면은 자기가 무엇을 원하는지만 `ScreenRequest`로
 * 말하고, 무엇이 초기화되고 무엇이 유지되는지는 전부 이 파일이 정한다.
 *
 * **상태는 화면 하나가 아니라 한 쌍이다.** 치트 메뉴만 화면이 아니라 오버레이다 —
 * §18.2가 "메뉴만 닫히며"라고 적었고, 그것은 닫으면 아래 화면으로 *돌아가는* 것이 아니라
 * 아래 화면이 계속 거기 있었다는 뜻이다. 그래서 상태가 `{ screen, cheatOpen }`이다.
 *
 * **배경은 언제나 전투 프레임이다** (12 §1 C-02). 카드 선택·일시정지·결과는 별개의 화면이지만
 * 배경은 `play.ts`가 그리는 전투 프레임이고 딤은 각 화면이 자기 그림 안에서 얹는다 — 런이
 * 이어지고 있다는 사실 자체가 그 화면의 정보다. 그래서 이 파일은 화면이 아니라
 * `play.render(ctx, dt, overlay)`의 overlay를 갈아 끼운다. `BG.void`는 이식하지 않았다.
 *
 * **탭 포커스를 잃으면 자동 일시정지한다** (12 §1 C-01). hidden이면 즉시 §13.4와 같은 정지,
 * 복귀하면 3 · 2 · 1 카운트다운 뒤 재개이고 그동안 어떤 입력도 받지 않는다. 탭 밖에서 흐른
 * 실시간은 sim에 닿지 않는다 — `loop.ts`의 realDt 상한 0.25초가 이미 막지만 일시정지가 그보다
 * 먼저 걸린다. 카운트다운이 끝나면 선입력 버퍼를 비운다(T-10).
 *
 * 화면이 이 파일에 꽂히는 계약(`Screen` · `ScreenHost` · `ScreenRequest`)과, 아직 없을 수도 있는
 * 이웃 화면을 늦게 잡는 일은 `screens/registry.ts`가 갖는다.
 */

import type { CanvasView } from '../boot/canvas';
import type { StageId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { PROGRESSION } from '../config/progression';
import { FONTS } from '../config/ui';
import { bus } from '../core/bus';
import { attachInput, createInput, type InputPress } from '../core/input';
import type { Clock } from '../core/clock';
import { createLoop } from '../core/loop';
import { deriveStream } from '../core/rng';
import type { ScenePaint } from '../render/frame';
import {
  createRun, disposeRun, jumpTo, markCheatOpened, markRerollUsed, pickCard, restartRun,
  type Run, type StageEntryPoint,
} from '../sim/run';
import {
  isSupportedPlatform, loadMuteSetter, loadScreenFactories, showUnsupportedNotice,
  type LateScreenKey, type Screen, type ScreenHost, type ScreenId, type ScreenRequest,
} from './registry';
import { createPlayScreen, type PlayScreen } from './play';

/** 3 · 2 · 1 (12 §1 C-01) */
const COUNTDOWN_STEPS = 3;
const COUNTDOWN_STEP_SEC = 1;
const COUNTDOWN_PX = 180;
const COUNTDOWN_CENTER_YU = PLAYFIELD.heightU * 0.5;
const SEED_RANGE = 0x1_0000_0000;

/** 카운트다운 숫자 한 장. HUD보다 위이고 흔들림 밖이다 */
function drawCountdown(ctx: CanvasRenderingContext2D, remainSec: number): void {
  const step = Math.ceil(remainSec / COUNTDOWN_STEP_SEC);
  const within = remainSec - (step - 1) * COUNTDOWN_STEP_SEC;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, within / COUNTDOWN_STEP_SEC));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.baek;
  ctx.font = `700 ${COUNTDOWN_PX}px ${FONTS.display}`;
  ctx.fillText(String(step), PLAYFIELD.widthU / 2, COUNTDOWN_CENTER_YU);
  ctx.restore();
}

/** 런이 없는 프레임의 바탕. 전투 프레임이 없으면 이것이 유일한 배경이다 */
function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = PALETTE.ink900;
  ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
}

/** 벽시계에서 한 번만 뽑는다. 그 뒤로는 D-05대로 시드가 모든 것을 정한다 */
const newSeed = (): number => Math.floor(Date.now() % SEED_RANGE);

/**
 * `main.ts`가 부르는 하나뿐인 입구. 캔버스와 스프라이트 굽기가 끝난 뒤에 온다.
 *
 * 미지원 판정이 먼저다(T-01) — §16.6이 "게임을 시작하지 않고" 안내만 띄우라고 요구하므로
 * 여기서 루프도 오디오도 만들지 않고 끝낸다. 안내 화면은 캔버스를 쓰지 않는다(§7.3).
 */
export async function startScreens(view: CanvasView): Promise<void> {
  if (!(await isSupportedPlatform())) {
    await showUnsupportedNotice();
    return;
  }

  const input = createInput();
  attachInput(input, {
    target: view.canvas,
    logicalWidthU: view.logicalWidthU,
    logicalHeightU: view.logicalHeightU,
  });

  const setMixerMuted = await loadMuteSetter();
  const factories = await loadScreenFactories();

  let screen: ScreenId = 'title';
  let cheatOpen = false;
  let run: Run | null = null;
  let play: PlayScreen | null = null;
  let muted = false;
  let countdownSec = 0;
  /** 탭을 벗어나 걸린 정지인가. 손으로 건 일시정지는 복귀해도 저절로 안 풀린다 */
  let autoPaused = false;
  let pending: ScreenRequest | null = null;
  /** sim이 안 가져간 눌림. 전투 중에는 play가 스텝마다 갈라 여기에 모아 준다 */
  const screenPresses: InputPress[] = [];

  const host: ScreenHost = {
    input,
    run: () => run,
    muted: () => muted,
    setMuted(next: boolean): void {
      muted = next;
      setMixerMuted?.(next);
    },
    request(request: ScreenRequest): void {
      pending = request;
    },
  };

  const made: Partial<Record<LateScreenKey, Screen>> = {};
  function screenOf(key: LateScreenKey): Screen | null {
    const factory = factories[key];
    if (factory === undefined) {
      return null;
    }
    made[key] ??= factory(host);
    return made[key] ?? null;
  }

  function startPlay(next: Run): void {
    play?.dispose();
    run = next;
    play = createPlayScreen({
      run: next,
      input,
      renderSeed: deriveStream(next.seed, 'render').int(0, SEED_RANGE),
      screenPresses: (press) => void screenPresses.push(press),
      isMuted: () => muted,
    });
    screen = 'play';
    play.enterStage();
  }

  /** T-03 · T-14b · T-15. 런 상태 전부를 새로 만든다 */
  function freshRun(entry: StageEntryPoint | null): void {
    if (run !== null) {
      disposeRun(run);
    }
    const created = createRun({ seed: newSeed(), stageId: PROGRESSION.restartStageId as StageId });
    startPlay(created);
    if (entry !== null) {
      jumpTo(created, entry);
      play?.enterStage();
    }
  }

  /** T-11 · T-16. 런을 버리는 것이지 상태 전이가 아니다 */
  function toTitle(): void {
    play?.dispose();
    play = null;
    if (run !== null) {
      disposeRun(run);
      run = null;
    }
    screen = 'title';
    cheatOpen = false;
    // 타이틀 화면이 아직 없으면 검은 화면만 남는다. 그 자리에서 새 런을 세워 P6-1 게이트를 살린다
    if (factories.title === undefined) {
      freshRun(null);
    }
  }

  function applyRequest(request: ScreenRequest): void {
    const active = run;
    switch (request.kind) {
      case 'startRun':
        freshRun(null);
        return;
      case 'pickCard':
        // T-05. 콤보 0과 월드 교체는 pickCard가 다음 스테이지를 세우는 것이 곧 그것이다
        if (active !== null) {
          pickCard(active, request.cardId);
          screen = 'play';
          play?.enterStage();
        }
        return;
      case 'reroll':
        // T-17. 다시 뽑는 일 자체는 카드 화면이 sim/cards.ts로 한다
        if (active !== null) {
          markRerollUsed(active);
        }
        return;
      case 'resume':
        // T-10. 정지 직전에 눌린 패리가 재개 순간 저절로 발동하는 것을 막는다 (§4.4)
        input.clearParryBuffer();
        autoPaused = false;
        screen = 'play';
        return;
      case 'abandon':
      case 'toTitle':
        toTitle();
        return;
      case 'restart':
        // T-15. 카드·라이프·점수·리롤 사용 여부·오염 표시가 전부 초기값이다
        if (active === null) {
          freshRun(null);
        } else {
          startPlay(restartRun(active, newSeed()));
        }
        return;
      case 'jump':
        // T-14. 런이 없으면 T-03과 똑같이 새로 만든 뒤 진입 지점을 적용한다 (T-14b)
        if (active === null) {
          freshRun(request.target);
        } else {
          jumpTo(active, request.target);
          screen = 'play';
          play?.enterStage();
        }
        return;
    }
  }

  /** T-09 · T-12. 전투 중이면 일시정지를 거쳐 연다 — 한 번 누른 키가 일을 절반만 하지 않는다 */
  function openCheat(): void {
    // §18.2의 진입 가능 시점은 타이틀·일시정지·카드 선택 셋뿐이다. 결과 화면에는 열지 않는다
    if (screen === 'result' || screen === 'unsupported' || factories.cheat === undefined) {
      return;
    }
    if (screen === 'play') {
      screen = 'pause';
      autoPaused = false;
    }
    cheatOpen = true;
    if (run !== null) {
      markCheatOpened(run); // §18.5 연 순간부터 런 종료까지 남는다
    }
  }

  /** T-08 · T-10. Esc는 언제나 가장 위 층부터 닫는다 (§4.4) */
  function togglePause(): void {
    if (cheatOpen) {
      cheatOpen = false;
      return;
    }
    if (screen === 'play') {
      screen = 'pause';
      autoPaused = false;
      return;
    }
    applyRequest({ kind: 'resume' });
  }

  /** 08 §10.1의 표에서 화면과 무관하게 같은 뜻인 것 셋 */
  function applyGlobalPress(press: InputPress): boolean {
    if (press.action === 'mute') {
      host.setMuted(!muted);
      return true;
    }
    if (press.action === 'cheat') {
      openCheat();
      return true;
    }
    if (press.action === 'pause' && (screen === 'play' || screen === 'pause')) {
      togglePause();
      return true;
    }
    return false;
  }

  /** T-19. sim이 서는 것은 여기서 스텝을 안 부르는 것이고, 그것이 §13.4와 같은 정지다 */
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      if (screen === 'play') {
        screen = 'pause';
        autoPaused = true;
        countdownSec = 0;
      }
      return;
    }
    if (autoPaused) {
      autoPaused = false;
      screen = 'play';
      countdownSec = COUNTDOWN_STEPS * COUNTDOWN_STEP_SEC;
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  /** 카드 선택과 결과는 화면이 아니라 런의 국면이다 — sim/run.ts가 정한 것을 화면으로 옮긴다 */
  function syncFromRun(): void {
    if (run === null || screen === 'pause' || screen === 'title') {
      return;
    }
    screen = run.phase === 'cardSelect' ? 'cardSelect' : run.phase === 'result' ? 'result' : 'play';
  }

  /** 전투 중에만 sim이 돈다. 그 밖의 화면은 전이표대로 「멈춘다」 열이다 */
  function simRunning(): boolean {
    return screen === 'play' && !cheatOpen && countdownSec <= 0;
  }

  /** 지금 층 12에 얹히는 것. 치트 메뉴는 아래 화면을 그대로 두고 겹친다 */
  function currentOverlay(): Screen | null {
    if (cheatOpen) {
      return screenOf('cheat');
    }
    return screen === 'play' || screen === 'unsupported' ? null : screenOf(screen);
  }

  function overlayPaint(overlay: Screen | null): ScenePaint | null {
    return overlay === null && countdownSec <= 0 ? null : (ctx, realDtSec) => {
      overlay?.paint(ctx, realDtSec);
      if (countdownSec > 0) {
        drawCountdown(ctx, countdownSec);
      }
    };
  }

  function routePresses(realDtSec: number): void {
    // 전투 중이면 play가 스텝마다 갈라 넘긴 것이 screenPresses에 이미 쌓여 있다
    const presses = [...screenPresses, ...(simRunning() ? [] : input.takePresses())];
    screenPresses.length = 0;
    const rest: InputPress[] = [];
    for (const press of presses) {
      if (!applyGlobalPress(press)) {
        rest.push(press);
      }
    }
    currentOverlay()?.update(rest, realDtSec);
    if (pending !== null) {
      const request = pending;
      pending = null;
      applyRequest(request);
    }
  }

  function drawFrameNow(realDtSec: number): void {
    // 카운트다운 중에는 어떤 입력도 받지 않는다. 큐를 비우기만 하고 아무에게도 넘기지 않는다
    if (countdownSec > 0) {
      countdownSec -= realDtSec;
      input.takePresses();
      screenPresses.length = 0;
      if (countdownSec <= 0) {
        input.clearParryBuffer(); // T-10과 같은 처리
      }
    } else {
      routePresses(realDtSec);
    }
    syncFromRun();

    const ctx = view.ctx;
    const paint = overlayPaint(currentOverlay());
    ctx.setTransform(view.pixelsPerUnit, 0, 0, view.pixelsPerUnit, 0, 0);
    if (play === null) {
      clearCanvas(ctx);
      paint?.(ctx, realDtSec);
    } else {
      play.setReading(!simRunning());
      play.render(ctx, realDtSec, paint);
    }
    // sim 밖에서 난 §16.2의 조작음도 같은 큐를 지난다. 스텝이 없는 프레임에서는 여기가 그 배출구다
    bus.flush();
  }

  /** 런이 없는 프레임에도 루프는 돈다 — 타이틀도 그려야 한다. 시계는 런과 함께 갈린다 */
  const clock: Clock = {
    advance: (realDtSec) => run?.clock.advance(realDtSec) ?? realDtSec,
    requestHitstop: (durationSec, atSec) => run?.clock.requestHitstop(durationSec, atSec) ?? 0,
    budgetUsedSec: (atSec) => run?.clock.budgetUsedSec(atSec) ?? 0,
    hitstopRemainingSec: () => run?.clock.hitstopRemainingSec() ?? 0,
  };

  createLoop({
    clock,
    hooks: {
      beginFrame(): void {
        const frameNowMs = performance.now();
        input.beginFrame(frameNowMs);
        play?.beginFrame(frameNowMs);
      },
      step(fixedDtSec: number): void {
        if (simRunning()) {
          play?.step(fixedDtSec);
        }
      },
      render(_alpha: number, realDtSec: number): void {
        drawFrameNow(realDtSec);
      },
    },
  }).start();

  // 타이틀이 아직 없으면 T-03을 바로 태운다. 검은 화면은 원인이 안 보이는 실패다
  if (factories.title === undefined) {
    freshRun(null);
  }
}
