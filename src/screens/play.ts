/**
 * 전투 화면 — 08 §1.1.1 · 12 §3.3. sim 한 스텝과 render 한 프레임을 잇는다.
 *
 * ── 화면을 늘리지 않는다 ────────────────────────────────────────────────────────
 *
 * 스테이지 진입 연출은 여덟 번째 화면이 아니라 이 파일의 `entering` 상태다. 그 1.2초 동안
 * sim이 서고 배경 정적 레이어와 잡몹 실루엣을 굽는다 — 8.3MB 굽기가 전투 첫 프레임이 되면
 * 안 된다(06 §3.3). 굽기가 1.2초보다 오래 걸리면 굽기가 끝날 때까지 연장한다.
 * `lull`·`boss`는 sim의 웨이브 구간을 읽어 파생되므로 여기서 따로 세지 않는다.
 *
 * ── 눌림은 프레임이 아니라 스텝 단위로 소비한다 (12 §10 E-01) ───────────────────
 *
 * core/input.ts가 눌림에 이벤트 시각을 실어 두므로, 이 파일은 **그 시각이 속한 sim 스텝**에서
 * 소비한다. 프레임 단위로 비우면 등급을 고를 수 있는 해상도가 고정 스텝(8.48u)이 아니라
 * 프레임 간격(60Hz에서 16.97u)이 되고, 그러면 1/120은 프레임당 sim 비용만 두 배로 만든다.
 *
 * ── 눌림을 sim과 화면이 나눠 갖는다 ─────────────────────────────────────────────
 *
 * `Input.takePressesUntil`은 큐를 비우고 sim은 그중 `parry`만 본다. 원본을 그대로 넘기면 같은
 * 스텝에 들어온 Esc·M·Shift+F9가 sim 안에서 사라지므로, 아래 `simInput`이 그 자리에서 갈라
 * 화면 몫을 매니저로 넘긴다.
 *
 * ── 다른 화면의 배경이 된다 (12 §1 C-02) ────────────────────────────────────────
 *
 * 카드 선택·일시정지·결과는 별개의 화면이지만 배경은 전투 프레임이다. 그래서 그 셋은 자기
 * 그림을 `render(ctx, realDtSec, overlay)`의 overlay로 넘기고 딤도 그 안에서 얹는다 —
 * 층 12는 HUD보다 위여서 §18.5의 오염 표시가 그 아래에 상시로 남는다.
 *
 * World → FrameView 값 옮기기는 `screens/play-view.ts`가 갖는다 (한 파일 400줄 상한).
 */

import { BOSS_COMMON } from '../config/bosses';
import type { StageDef } from '../config/types';
import type { ParryGradeId } from '../config/ids';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { STAGES } from '../config/stages';
import { FONTS } from '../config/ui';
import type { FeedbackBus, Unsubscribe } from '../core/bus';
import type { Input, InputPress } from '../core/input';
import { FIXED_DT_SEC, MAX_STEPS_PER_FRAME } from '../core/loop';
import { deriveStream, type Rng } from '../core/rng';
import { bakeStageBackground } from '../render/backgrounds/index';
import { prefersReducedMotion, watchReducedMotion } from '../boot/platform-guard';
import { createCamera, type Camera } from '../render/camera';
import { bakeEnemyBodies, discardEnemyBodyBakes, type HitstopShake } from '../render/enemy';
import { drawFrame } from '../render/frame';
import type { FrameDeps, ScenePaint } from '../render/frame';
import { createHudAnim, type HudAnim } from '../render/hud';
import { createImpactLayer, type ImpactLayer } from '../render/impact';
import { createParticleLayer, type ParticleLayer } from '../render/particles';
import { createPlayerFx, notifyPlayerFx, type PlayerFxState } from '../render/player';
import { bossPhaseWarning } from '../sim/boss';
import { stepRun, type Run } from '../sim/run';
import { wavePhase } from '../sim/waves';
import { buildFrameView, createBatch, stageBakeSpecs, type MutableBatch } from './play-view';

const MS_PER_SEC = 1000;

/**
 * 눌림 소비 상한이 프레임 시각에서 이만큼 이상 뒤처지지 않게 한다 (ms).
 * 한 프레임이 소비할 수 있는 sim 시간의 최댓값이라, 이보다 더 벌어지면 상한은 영영 못 따라잡는다.
 */
const MAX_PRESS_LAG_MS = MAX_STEPS_PER_FRAME * FIXED_DT_SEC * MS_PER_SEC;

/** §10.1 페이즈 전환 연출과 **같은 길이**다 — 이 게임이 "장면이 바뀐다"고 말하는 시간은 하나다 */
const STAGE_ENTER_SEC = BOSS_COMMON.phaseTransitionSec;

const ENTER_TITLE_PX = 88;
const ENTER_LABEL_PX = 28;
const ENTER_TITLE_YU = PLAYFIELD.heightU * 0.46;
const ENTER_LABEL_YU = ENTER_TITLE_YU - 84;
/** 진입 연출의 끝에서만 글자가 빠진다. 전체를 흐리면 "다음"이 아니라 "고장"으로 읽힌다 */
const ENTER_FADE_SEC = 0.35;

/** 08 §1.1.1의 다섯. `lull`·`boss`는 sim의 웨이브 구간이 정하고 나머지 셋은 이 파일이 정한다 */
export type PlayPhase = 'entering' | 'combat' | 'lull' | 'boss' | 'clear';

/** sim이 소비하지 않은 눌림. 매니저가 화면 전이·음소거·치트로 해석한다 */
export type ScreenPressSink = (press: InputPress) => void;

export interface PlayScreen {
  readonly run: Run;
  readonly phase: PlayPhase;
  /** rAF 프레임당 1회, 고정 스텝 루프 **밖**이다 (02 §1) */
  beginFrame(frameNowMs: number): void;
  /** 고정 스텝 하나. `entering` 중에는 sim을 돌리지 않고 눌림만 화면으로 흘린다 */
  step(fixedDtSec: number): void;
  /** 층 12에 얹을 것. 카드·일시정지·결과·치트 메뉴가 자기 그림을 여기로 넘긴다 */
  render(ctx: CanvasRenderingContext2D, realDtSec: number, overlay: ScenePaint | null): void;
  /**
   * sim이 멈춘 프레임인가. 참이면 카메라를 세운다 — 카드·결과·일시정지·치트는 글을 읽는
   * 화면이고, 그 아래에서 배경이 계속 흔들리면 읽을 수가 없다.
   */
  setReading(value: boolean): void;
  /** 스테이지가 바뀐 뒤에 부른다 — 다시 굽고 `entering`으로 되돌린다 */
  enterStage(): void;
  dispose(): void;
}

export interface PlaySpec {
  readonly run: Run;
  readonly input: Input;
  /** 렌더 전용 시드 (D-05). sim 스트림과 갈라야 연출이 판정을 흔들지 않는다 */
  readonly renderSeed: number;
  readonly screenPresses: ScreenPressSink;
  /** HUD의 음소거 표시. 상태 자체는 audio/가 갖는다 */
  readonly isMuted: () => boolean;
}

export function createPlayScreen(spec: PlaySpec): PlayScreen {
  const run = spec.run;
  const input = spec.input;
  const bus: FeedbackBus = run.bus;
  const shakeRng: Rng = deriveStream(spec.renderSeed, 'render/hitstop');

  const camera: Camera = createCamera({ bus, rng: deriveStream(spec.renderSeed, 'render/camera') });
  const particles: ParticleLayer = createParticleLayer({ bus, rng: deriveStream(spec.renderSeed, 'render/particles') });
  const impact: ImpactLayer = createImpactLayer({ bus, rng: deriveStream(spec.renderSeed, 'render/impact') });
  const playerFx: PlayerFxState = createPlayerFx();
  const hudAnim: HudAnim = createHudAnim();

  /**
   * §16 접근성. 타이틀 데모만 조용하고 본편이 26u로 흔들리면 설정이 있으나 마나다 —
   * 광과민성 문제이기도 하다. 런 도중에 설정이 바뀌는 경우까지 받는다.
   */
  function applyReducedMotion(reduced: boolean): void {
    camera.setReducedMotion(reduced);
    impact.setReducedMotion(reduced);
  }
  applyReducedMotion(prefersReducedMotion());
  const stopWatchingMotion = watchReducedMotion(applyReducedMotion);

  /** 글을 읽는 화면(카드 선택·결과·일시정지·치트)에서 참. 그 동안 카메라는 서 있는다 */
  let reading = false;

  // player.ts는 버스를 직접 구독하지 않는다 — 화면마다 수명이 다른 상태라 소유자가 넘긴다
  const offs: Unsubscribe[] = (['parry', 'parryWhiff', 'cooldownReady', 'playerHit'] as const).map((kind) =>
    bus.on(kind, (event) => notifyPlayerFx(playerFx, event)),
  );
  // 히트스톱 진동은 등급별로 진폭이 갈리는데 clock은 등급을 모른다. 마지막 패리 등급을 여기서 붙든다
  let lastGrade: ParryGradeId = 'NOT_BAD';
  offs.push(bus.on('parry', (event) => void (lastGrade = event.grade)));

  let phase: PlayPhase = 'entering';
  let enterRemainSec = 0;
  let backgroundTimeSec = 0;
  let pressHorizonMs = 0;
  let batch: MutableBatch = createBatch(run.world.enemyBullets.capacity + run.world.reflectBullets.capacity);
  let phaseWarnElapsedSec = 0;
  let shakeTotalSec = 0;
  let shakeAngleRad = 0;

  /**
   * sim에 넘기는 입력 뷰. `takePressesUntil`이 큐를 통째로 비우고 sim은 `parry`만 보므로,
   * 여기서 갈라 두지 않으면 같은 스텝에 들어온 Esc·M·Shift+F9가 sim 안에서 사라진다.
   */
  const simInput: Input = {
    ...input,
    pointer: input.pointer,
    takePressesUntil(untilMs: number): readonly InputPress[] {
      const taken = input.takePressesUntil(untilMs);
      for (const press of taken) {
        if (press.action !== 'parry') {
          spec.screenPresses(press);
        }
      }
      return taken;
    },
  };

  function enterStage(): void {
    const stage: StageDef = STAGES[run.stageId];
    const startedMs = performance.now();
    discardEnemyBodyBakes();
    bakeStageBackground(stage.background, spec.renderSeed);
    bakeEnemyBodies(stageBakeSpecs(stage));
    // 굽기가 1.2초보다 오래 걸리면 그만큼 진입 연출이 밀린다 — 남는 시간만 표시로 쓴다
    const bakeSec = (performance.now() - startedMs) / MS_PER_SEC;
    enterRemainSec = Math.max(0, STAGE_ENTER_SEC - bakeSec);
    phase = 'entering';
    backgroundTimeSec = 0;
    batch = createBatch(run.world.enemyBullets.capacity + run.world.reflectBullets.capacity);
    camera.reset();
  }

  /** sim이 정한 구간을 그대로 읽는다. 여기서 따로 세면 소강 3초의 소유자가 둘이 된다 */
  function syncPhase(): void {
    if (phase === 'entering') {
      return;
    }
    if (run.world.boss?.mode === 'defeated') {
      phase = 'clear';
      return;
    }
    const wave = wavePhase(run.world);
    phase = wave === 'lull' ? 'lull' : wave === 'boss' ? 'boss' : 'combat';
  }

  function hitstopShake(): HitstopShake | null {
    const remainSec = run.clock.hitstopRemainingSec();
    if (remainSec <= 0) {
      shakeTotalSec = 0;
      return null;
    }
    if (shakeTotalSec <= 0) {
      shakeTotalSec = remainSec;
      shakeAngleRad = shakeRng.range(0, Math.PI * 2);
    }
    return { gradeId: lastGrade, progress01: 1 - remainSec / shakeTotalSec, angleRad: shakeAngleRad };
  }

  /** 진입 연출은 층 12에 얹는다 — HUD 위여야 스테이지명이 라이프 pip과 겹치지 않는다 */
  function composeOverlay(outer: ScenePaint | null): ScenePaint | null {
    if (phase !== 'entering' && outer === null) {
      return null;
    }
    return (ctx, realDtSec) => {
      if (phase === 'entering') {
        drawStageTitle(ctx, STAGES[run.stageId], enterRemainSec);
      }
      outer?.(ctx, realDtSec);
    };
  }

  const deps: Omit<FrameDeps, 'realDtSec'> = { camera, particles, impact, playerFx, hudAnim };

  return {
    run,
    get phase(): PlayPhase {
      return phase;
    },

    beginFrame(frameNowMs: number): void {
      input.beginFrame(frameNowMs);
      pressHorizonMs = Math.max(pressHorizonMs, frameNowMs - MAX_PRESS_LAG_MS);
    },

    step(fixedDtSec: number): void {
      pressHorizonMs += fixedDtSec * MS_PER_SEC;
      if (phase === 'entering') {
        // sim이 서 있는 동안 눌림이 큐에 쌓이면 전투 첫 스텝에 한꺼번에 발동한다
        for (const press of input.takePressesUntil(pressHorizonMs)) {
          spec.screenPresses(press);
        }
        return;
      }
      stepRun(run, fixedDtSec, { input: simInput, untilMs: pressHorizonMs });
      syncPhase();
    },

    setReading(value: boolean): void {
      reading = value;
    },

    render(ctx: CanvasRenderingContext2D, realDtSec: number, overlay: ScenePaint | null): void {
      if (reading) {
        // camera.reset()이 문서로 지목한 자리가 여기다. trauma를 0으로 내리고 킥을 버린다
        camera.reset();
      } else {
        // 읽는 화면 뒤에서는 배경도 선다. §13.4의 약속이 「모든 타이머 정지」이고 일시정지
        // 부제가 그 문장을 그대로 적는데(pause.ts), 시차 배경만 계속 흐르면 그 줄이 거짓말이 된다
        backgroundTimeSec += realDtSec;
      }
      if (phase === 'entering') {
        enterRemainSec -= realDtSec;
        if (enterRemainSec <= 0) {
          // syncPhase는 entering을 건드리지 않는다 — 연출을 끝내는 자리가 여기 하나여야 한다
          phase = 'combat';
          syncPhase();
        }
      }
      const boss = run.world.boss;
      phaseWarnElapsedSec = boss !== null && bossPhaseWarning(boss) ? phaseWarnElapsedSec + realDtSec : 0;
      const view = buildFrameView({
        run,
        renderSeed: spec.renderSeed,
        backgroundTimeSec,
        muted: spec.isMuted(),
        batch,
        shake: hitstopShake(),
        phaseTelegraphElapsedSec: phaseWarnElapsedSec,
        overlay: composeOverlay(overlay),
      });
      drawFrame(ctx, view, { ...deps, realDtSec });
    },

    enterStage,

    dispose(): void {
      stopWatchingMotion();
      for (const off of offs) {
        off();
      }
      camera.dispose();
      particles.dispose();
      impact.dispose();
      discardEnemyBodyBakes();
    },
  };
}

/** 스테이지명 한 장. 08 §1.1.1의 1.2초 표시이고 마지막 0.35초에만 빠진다 */
function drawStageTitle(ctx: CanvasRenderingContext2D, stage: StageDef, remainSec: number): void {
  const alpha = remainSec >= ENTER_FADE_SEC ? 1 : Math.max(0, remainSec / ENTER_FADE_SEC);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETTE.baekFaint;
  ctx.font = `500 ${ENTER_LABEL_PX}px ${FONTS.data}`;
  ctx.fillText(`STAGE ${stage.id}`, PLAYFIELD.widthU / 2, ENTER_LABEL_YU);
  ctx.fillStyle = PALETTE.baek;
  ctx.font = `700 ${ENTER_TITLE_PX}px ${FONTS.display}`;
  ctx.fillText(stage.name, PLAYFIELD.widthU / 2, ENTER_TITLE_YU);
  ctx.restore();
}
