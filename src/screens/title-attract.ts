/**
 * 타이틀 어트랙트 루프 — 08 §6.2 · §6.2.1 · 12 §1 C-03
 *
 * ── 자동 패리가 아니라 기록된 입력의 재생이다 ──────────────────────────────────
 *
 * 목업은 `HW.autoParry`(`00_title/scene.js:56`)로 패리를 성립시켰지만 **그 방법은 이식하지
 * 않았다.** 그 함수가 남으면 「자동 패리」라는 규칙 밖 경로가 코드에 상주하고, 타이틀에서 도는
 * 것이 진짜 플레이가 아니게 되며, §17이 요구한 신호들도 그만큼 가짜가 된다.
 *
 * 대신 **고정 시드 위에서 미리 녹화한 입력을 재생한다.** D-05의 결정론이 같은 시드 + 같은
 * 입력 → 같은 결과를 보장하므로 매번 같은 장면이 나온다. 재생 대상은 진짜 `core/input.ts`
 * 인스턴스이고 이 파일이 하는 일은 그 위에서 키를 눌렀다 떼는 것뿐이라, `sim/`이 받는 것은
 * 사람이 친 것과 **구별되지 않는다.** 병렬 입력 구현이 없으므로 어긋날 자리도 없다.
 *
 * 녹화는 이 파일에 **리터럴로 박는다.** 외부 파일을 읽으면 D-03의 단일 파일 빌드가 깨진다.
 *
 * ── 지금은 비어 있다 ───────────────────────────────────────────────────────────
 *
 * **녹화 자체는 P7에서 만든다** (08 §6.2.1 표 「녹화 시점」). 그전까지 `ATTRACT_RECORDING`이
 * 비어 있고 `createAttractLoop`는 null을 내며, 타이틀은 정적 화면으로 선다 — 어트랙트 루프가
 * 없는 것이 잘못된 어트랙트 루프보다 낫다. **같은 녹화가 제출 영상의 소스다.**
 *
 * ── 스텝 누산을 여기서 또 하는 이유 ────────────────────────────────────────────
 *
 * `core/loop.ts`가 고정 스텝 누산을 갖고 있지만 `screens/manager.ts`는 전투 화면일 때만 그
 * 스텝을 `play.ts`로 흘린다(`simRunning()`). 타이틀은 화면 계약상 `paint`와 `update`만 받으므로
 * 자기 몫의 누산을 자기가 든다. 정책은 loop.ts와 같다 — 프레임당 상한 `MAX_STEPS_PER_FRAME`,
 * 넘치면 따라잡기를 포기하고 잔여를 버린다.
 *
 * **재생 위치는 벽시계가 아니라 스텝 번호다.** 프레임 간격이 흔들려도 스텝 N이 받는 입력은
 * 언제나 같으므로, 60Hz에서 보든 144Hz에서 보든 같은 런이 나온다.
 */

import { PLAYFIELD } from '../config/playfield';
import { STAGES } from '../config/stages';
import type { StageId } from '../config/ids';
import { bus } from '../core/bus';
import { createInput, type Input } from '../core/input';
import { FIXED_DT_SEC, MAX_STEPS_PER_FRAME } from '../core/loop';
import { deriveStream } from '../core/rng';
import { prefersReducedMotion, watchReducedMotion } from '../boot/platform-guard';
import {
  bakeStageBackground, disposeStageBackground, isStageBackgroundBaked,
} from '../render/backgrounds/index';
import { createCamera, type Camera } from '../render/camera';
import { bakeEnemyBodies, discardEnemyBodyBakes } from '../render/enemy';
import { drawFrame, type FrameView } from '../render/frame';
import { createHudAnim, type HudAnim } from '../render/hud';
import { createImpactLayer, type ImpactLayer } from '../render/impact';
import { createParticleLayer, type ParticleLayer } from '../render/particles';
import { createPlayerFx, notifyPlayerFx, type PlayerFxState } from '../render/player';
import { createRun, disposeRun, stepRun, type Run } from '../sim/run';
import { buildFrameView, createBatch, stageBakeSpecs, type MutableBatch } from './play-view';

const MS_PER_SEC = 1000;
const FIXED_DT_MS = FIXED_DT_SEC * MS_PER_SEC;
const SEED_RANGE = 0x1_0000_0000;

/**
 * 어트랙트 고정 시드 (D-05). **값을 바꾸면 녹화된 입력이 다른 런 위에서 재생되어 장면이
 * 통째로 달라진다.** 녹화와 시드는 한 쌍이므로 둘 중 하나만 고치지 않는다.
 */
export const ATTRACT_SEED = 0x48_57_41_4e;

/**
 * 목업이 `stage: 'busanjin'`으로 못 박았다(`00_title/scene.js:31`). S1에는 패리 불가 요소가
 * 없어서(§14.1) 첫 화면에서 규칙이 하나로 읽힌다. 녹화가 없는 동안 `title.ts`가 그리는
 * 정적 배경도 이 스테이지의 것이어야 하므로 export한다 — 둘이 갈리면 녹화가 들어오는 순간
 * 하늘이 바뀐다.
 */
export const ATTRACT_STAGE_ID: StageId = 1;

/** 08 §6.2.1 재생 길이. 끝에 닿으면 같은 시드로 처음부터 다시 돈다 */
export const ATTRACT_LENGTH_SEC = 30;
const ATTRACT_LENGTH_STEPS = Math.round(ATTRACT_LENGTH_SEC / FIXED_DT_SEC);

/**
 * 녹화 한 점 — **누른 키의 집합이 바뀌는 순간만** 적는다.
 *
 * 눌림(press)이 아니라 눌린 상태(held)를 적는 이유는 §16.5다. 이동은 누르고 있는 동안 반복
 * 발동하고 패리는 눌림 순간에만 접수되는데, held 집합의 변화만 있으면 양쪽을 다 복원할 수
 * 있다 — 새로 들어온 코드가 곧 눌림이고, 남아 있는 코드가 곧 isDown이다. 반대로 눌림만
 * 적으면 이동 키를 언제 뗐는지가 사라진다.
 *
 * `code`는 `KeyboardEvent.code`(물리 위치)다. `core/input.ts`의 표가 그것으로 매핑한다.
 */
export interface AttractKeyframe {
  /** 이 상태가 적용되는 첫 스텝 번호. 0부터이고 오름차순이어야 한다 */
  readonly step: number;
  /** 이 시점에 눌려 있는 키 전부. 빈 배열은 아무것도 안 누른 상태다 */
  readonly codes: readonly string[];
}

/**
 * **P7이 채운다.** 지금은 비어 있고, 비어 있는 동안 타이틀은 정적 화면이다(08 §6.2.1).
 *
 * 채울 때의 계약은 위 `AttractKeyframe` 주석 그대로다. 마지막 키프레임 뒤로도 재생은
 * `ATTRACT_LENGTH_SEC`까지 이어지므로, 끝에서 손을 떼려면 `codes: []` 프레임을 하나 넣는다.
 */
export const ATTRACT_RECORDING: readonly AttractKeyframe[] = [];

/** 정적 화면 갈래와 어트랙트 갈래를 가르는 유일한 조건 */
export function hasAttractRecording(): boolean {
  return ATTRACT_RECORDING.length > 0;
}

/**
 * §3.1 클램프를 **우회하는 그리기 좌표** — 08 §6.5 · 10 A12 · 12 §8-7
 *
 * 목업은 플레이어를 `y = 545 ± 55`에 놓았고(`00_title/scene.js:31`·`:47-48`) 그 궤적은 전
 * 구간이 §3.1의 이동 가능 영역 `y ∈ [620, 1830]` **밖**이다. 이유는 명확하다 — 타이틀 스크림이
 * `y ≈ 749`에서 이미 불투명도 0.88에 도달하므로, 정상 위치에 있는 플레이어는 로고 판 뒤에
 * 통째로 묻힌다.
 *
 * 판정은 승인된 목업 구도를 그대로 세우는 쪽이다. 그래서 **이 화면에서만** 그리는 y를
 * 위로 민다. 아래 둘을 혼동하지 말 것:
 *
 *   · sim은 정상이다. `sim/player.ts`가 §3.1대로 클램프하고 패리 판정도 그 좌표에서 난다.
 *   · 예외는 **그리는 위치 하나**다. 게임 플레이의 플레이어 위치는 언제나 sim이 정하며 이
 *     우회는 타이틀 한 곳에서 끝난다.
 *
 * 「플레이어가 왜 여기 있지」를 조사하러 온 사람이 클램프 버그를 찾아 헤매지 않도록 적는다.
 * 이동 영역 상단(620u)을 목업의 중심(545u)에 맞추는 평행이동이라 상수 하나로 끝난다.
 */
const TITLE_PLAYER_DRAW_YU = 545;
const PLAYER_DRAW_OFFSET_YU = TITLE_PLAYER_DRAW_YU - PLAYFIELD.playerBounds.minYU;

export interface AttractLoop {
  /** 프레임당 1회. 고정 스텝을 여기서 돌린다 — 그리기와 갈라야 정지 프레임에서도 그림이 나온다 */
  advance(realDtSec: number): void;
  /** 층 1~11. 스크림과 로고타입은 `screens/title.ts`가 이 위에 얹는다 */
  draw(ctx: CanvasRenderingContext2D, realDtSec: number): void;
  dispose(): void;
}

/** 녹화가 없으면 null이다. 호출부의 갈래가 「루프가 있나」 하나로 끝나게 한다 */
export function createAttractLoop(): AttractLoop | null {
  return hasAttractRecording() ? startAttract() : null;
}

function startAttract(): AttractLoop {
  const stage = STAGES[ATTRACT_STAGE_ID];
  const renderSeed = deriveStream(ATTRACT_SEED, 'render').int(0, SEED_RANGE);
  const input: Input = createInput();

  // 전역 버스를 쓴다 — core/bus.ts가 팩토리를 export하지 않아 사설 버스를 만들 수 없다.
  // 08 §6.2가 타이틀에서 도는 것을 「진짜 플레이」로 정의했으므로 방향은 맞지만, 어트랙트의
  // 전투음이 타이틀에서 그대로 난다는 뜻이기도 하다 — 녹화가 오는 P7에서 믹서와 함께 정한다
  const camera: Camera = createCamera({ bus, rng: deriveStream(renderSeed, 'render/camera') });
  const particles: ParticleLayer = createParticleLayer({ bus, rng: deriveStream(renderSeed, 'render/particles') });
  const impact: ImpactLayer = createImpactLayer({ bus, rng: deriveStream(renderSeed, 'render/impact') });
  const playerFx: PlayerFxState = createPlayerFx();
  const hudAnim: HudAnim = createHudAnim();

  function applyReducedMotion(reduced: boolean): void {
    camera.setReducedMotion(reduced);
    impact.setReducedMotion(reduced);
  }
  applyReducedMotion(prefersReducedMotion());
  const stopWatchingMotion = watchReducedMotion(applyReducedMotion);

  let run: Run = createRun({ seed: ATTRACT_SEED, stageId: ATTRACT_STAGE_ID });
  let batch: MutableBatch = createBatch(run.world.enemyBullets.capacity + run.world.reflectBullets.capacity);
  let offs = subscribePlayerFx(run, playerFx);
  let held = new Set<string>();
  let keyframeIndex = 0;
  let stepIndex = 0;
  let accumulatorSec = 0;
  let backgroundTimeSec = 0;

  function bake(): void {
    bakeStageBackground(stage.background, renderSeed);
    discardEnemyBodyBakes();
    bakeEnemyBodies(stageBakeSpecs(stage));
  }

  /** 재생이 끝났거나, 런이 끝났거나, 다른 화면이 굽기 슬롯을 가져갔을 때 처음부터 다시 */
  function restart(): void {
    for (const off of offs) {
      off();
    }
    disposeRun(run);
    input.reset();
    held = new Set<string>();
    keyframeIndex = 0;
    stepIndex = 0;
    accumulatorSec = 0;
    backgroundTimeSec = 0;
    run = createRun({ seed: ATTRACT_SEED, stageId: ATTRACT_STAGE_ID });
    offs = subscribePlayerFx(run, playerFx);
    batch = createBatch(run.world.enemyBullets.capacity + run.world.reflectBullets.capacity);
    camera.reset();
    bake();
  }

  /**
   * 녹화된 held 집합을 진짜 `Input` 위에 재현한다. 집합에서 빠진 코드는 떼고 새로 들어온 코드는
   * 누르며, 그 「새로 들어옴」이 곧 §16.5의 눌림이다. `atMs`는 스텝의 시작 시각이라 그 스텝의
   * `takePressesUntil` 상한 안에 반드시 들어온다.
   */
  function applyKeyframe(codes: readonly string[], atMs: number): void {
    for (const code of held) {
      if (!codes.includes(code)) {
        input.releaseKey(code);
        held.delete(code);
      }
    }
    for (const code of codes) {
      if (!held.has(code)) {
        input.pressKey({ code, atMs, shiftHeld: false, repeat: false });
        held.add(code);
      }
    }
  }

  function stepOnce(): void {
    const startMs = stepIndex * FIXED_DT_MS;
    const untilMs = startMs + FIXED_DT_MS;
    while (keyframeIndex < ATTRACT_RECORDING.length) {
      const keyframe = ATTRACT_RECORDING[keyframeIndex];
      if (keyframe === undefined || keyframe.step > stepIndex) {
        break;
      }
      applyKeyframe(keyframe.codes, startMs);
      keyframeIndex += 1;
    }
    input.beginFrame(untilMs);
    stepRun(run, FIXED_DT_SEC, { input, untilMs });
    stepIndex += 1;
  }

  bake();

  return {
    advance(realDtSec: number): void {
      // 다른 화면이 자기 스테이지를 구우면 슬롯이 갈린다. 그대로 그리면 DEV에서 던진다
      if (!isStageBackgroundBaked(stage.background, renderSeed)) {
        restart();
      }
      backgroundTimeSec += realDtSec;
      accumulatorSec += realDtSec;
      let steps = 0;
      while (accumulatorSec >= FIXED_DT_SEC && steps < MAX_STEPS_PER_FRAME) {
        stepOnce();
        accumulatorSec -= FIXED_DT_SEC;
        steps += 1;
      }
      if (accumulatorSec >= FIXED_DT_SEC) {
        // loop.ts와 같은 정책 — 못 따라간 시간은 버린다. 어트랙트가 빚을 갚느라 빨리 감기면 안 된다
        accumulatorSec = 0;
      }
      if (stepIndex >= ATTRACT_LENGTH_STEPS || run.phase !== 'combat') {
        restart();
      }
    },

    /**
     * **HUD가 함께 그려진다 — 목업과 어긋나는 자리이고 여기서 못 고친다.**
     *
     * 목업 타이틀은 HUD를 그리지 않는다. `00_title/scene.js`에 `hud` 칸이 없고 목업 엔진의
     * `drawHud`가 `if (!h) return`(`_shared/engine.js:1670`)으로 통째로 빠지기 때문이다.
     * 08 §6.1의 요소 표 13줄에도 HUD가 없다. 그런데 이식된 `render/frame.ts`는 층 11에서
     * `drawHud`를 조건 없이 부르고 `FrameView.hud`가 nullable이 아니라, 이 파일에서 끌 수단이
     * 없다 — 층 순서의 소유자는 `render/frame.ts` 하나이므로 여기서 층을 다시 부르는 것도
     * 답이 아니다. 원인은 이식 과정에서 `if (!h) return` 한 줄이 빠진 것이고, 옳은 고침은
     * `FrameView.hud`를 `HudView | null`로 만들어 그 한 줄을 되살리는 것이다(P4 소유).
     * 지금은 `ATTRACT_RECORDING`이 비어 있어 이 함수가 아예 불리지 않으므로 화면에 나타나지
     * 않는다. 녹화가 들어오는 P7 전에 그 한 줄이 먼저 들어와야 한다.
     */
    draw(ctx: CanvasRenderingContext2D, realDtSec: number): void {
      const view = buildFrameView({
        run,
        renderSeed,
        backgroundTimeSec,
        // 타이틀에는 HUD 음소거 표시가 없다. 상태는 `audio/mixer.ts`가 갖고 여기서는 안 읽는다
        muted: false,
        batch,
        shake: null,
        phaseTelegraphElapsedSec: 0,
        overlay: null,
      });
      drawFrame(ctx, shiftPlayer(view), { camera, particles, impact, playerFx, hudAnim, realDtSec });
    },

    dispose(): void {
      stopWatchingMotion();
      for (const off of offs) {
        off();
      }
      disposeRun(run);
      camera.dispose();
      particles.dispose();
      impact.dispose();
      discardEnemyBodyBakes();
      disposeStageBackground();
    },
  };
}

/** 위 `PLAYER_DRAW_OFFSET_YU` 주석이 이 함수의 계약 전부다. sim 좌표는 한 줄도 안 바뀐다 */
function shiftPlayer(view: FrameView): FrameView {
  return { ...view, player: { ...view.player, yU: view.player.yU + PLAYER_DRAW_OFFSET_YU } };
}

/**
 * `render/player.ts`는 버스를 직접 구독하지 않는다 — 화면마다 수명이 다른 상태라 소유자가
 * 넘긴다(`screens/play.ts`와 같은 규칙). 런이 갈리면 구독도 함께 갈아야 이전 런의 사건이
 * 새 런의 연출로 새지 않는다.
 */
function subscribePlayerFx(run: Run, playerFx: PlayerFxState): (() => void)[] {
  return (['parry', 'parryWhiff', 'cooldownReady', 'playerHit'] as const).map((kind) =>
    run.bus.on(kind, (event) => notifyPlayerFx(playerFx, event)),
  );
}

