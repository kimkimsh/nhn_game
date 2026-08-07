/**
 * AudioContext 하나와 그 아래 게인 버스 셋 — audio/의 모든 노드가 여기 매달린다 (07 §2.5 함정 2·3).
 *
 * ── 첫 제스처 전에는 컨텍스트가 없다 ──────────────────────────────────────────
 *
 * 브라우저는 사용자 제스처 전에 AudioContext를 suspended로 둔다. 그래서 **심사자가 페이지를
 * 열고 처음 보는 몇 초는 구조적으로 무음이고, 개발자는 그 상태를 한 번도 보지 않는다**(07 §1.4) —
 * 개발자는 이미 어딘가를 클릭한 뒤에 테스트하기 때문이다.
 *
 * 그 몇 초를 무음으로 만드는 방법은 두 가지인데 하나만 맞다. suspended 컨텍스트를 미리 만들어
 * 두면 그동안 예약된 노트가 resume 순간에 한꺼번에 쏟아진다. 그래서 여기서는 **컨텍스트 자체를
 * 안 만든다** — `audioCtx()`가 null을 내고, 소리를 내는 쪽은 전부 첫 줄에서 그 null을 보고
 * 돌아선다(07 §2.5 함정 6). 게임 진행은 그 창에서도 정상이다.
 *
 * `installFirstGestureResume()`이 그 창을 닫는다. M(§16.1)만 기다리지 않는 이유는 M을 누르지
 * 않는 플레이어에게 게임 전체가 무음으로 끝나기 때문이다 — 아무 키·포인터 입력이든 먼저 온
 * 것이 컨텍스트를 깨운다. M은 그중 하나일 뿐이다(07 §1.3).
 *
 * ── 그래프 모양 ───────────────────────────────────────────────────────────────
 *
 *   sfx ─┐
 *        ├─→ master ─→ limiter ─→ destination
 *   music┘
 *
 * 버스를 나누지 않으면 음소거도 믹싱도 성립하지 않는다(07 §2.5 함정 3). 리미터가 master와
 * destination 사이에 있는 것은 다수 동시 처치 때문이다 — 24 보이스가 겹치면 합이 full scale을
 * 넘고, 그 프레임만 찢어진 소리가 난다. 파라미터가 config/audio.ts가 아니라 여기 있는 것은
 * AudioConfig에 자리가 없어서다(config/audio.ts 머리말 ③).
 */

import { AUDIO } from '../config/audio';
import { createRng, type Rng } from '../core/rng';

/** 07 §2.5의 리미터 설정. threshold는 dBFS, ratio는 무단위, attack·release는 초다 */
const LIMITER_THRESHOLD_DB = -10;
const LIMITER_KNEE_DB = 6;
const LIMITER_RATIO = 12;
const LIMITER_ATTACK_SEC = 0.003;
const LIMITER_RELEASE_SEC = 0.12;

/** audio 전용 난수의 시드 범위 (2^32). 세션마다 달라도 되는 유일한 난수다 */
const AUDIO_SEED_RANGE = 0x100000000;

interface AudioGraph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly music: GainNode;
  readonly limiter: DynamicsCompressorNode;
}

let graph: AudioGraph | null = null;
let rng: Rng | null = null;
let gestureArmed = false;

/**
 * 컨텍스트와 버스를 만든다. 두 번째 호출부터는 이미 있는 것을 낸다.
 *
 * 부르는 자리는 첫 제스처 하나뿐이다. 그보다 먼저 부르면 07 §1.4가 말한 "구조적 무음"이
 * "예약만 쌓이는 suspended 구간"으로 바뀐다.
 *
 * AudioContext가 없는 환경(테스트 러너 등)에서는 null을 낸다 — 소리가 없다고 게임이
 * 멈추면 안 된다.
 */
export function initAudio(): AudioContext | null {
  if (graph !== null) {
    return graph.ctx;
  }
  if (typeof AudioContext === 'undefined') {
    return null;
  }

  const ctx = new AudioContext();
  const master = ctx.createGain();
  const sfx = ctx.createGain();
  const music = ctx.createGain();
  master.gain.value = AUDIO.mixer.masterGain;
  sfx.gain.value = AUDIO.mixer.sfxGain;
  music.gain.value = AUDIO.mixer.musicGain;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.knee.value = LIMITER_KNEE_DB;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = LIMITER_ATTACK_SEC;
  limiter.release.value = LIMITER_RELEASE_SEC;

  sfx.connect(master);
  music.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  graph = { ctx, master, sfx, music, limiter };
  return ctx;
}

/**
 * 지금 살아 있는 컨텍스트. **만들지 않는다** — 첫 제스처 전에는 null이다.
 *
 * 소리를 내는 모든 함수의 첫 줄이 `const ctx = audioCtx(); if (ctx === null) { return; }`이다
 * (07 §2.5 함정 6). 타이틀 어트랙트가 실제 sim을 돌리므로(12 §1 C-03) 그 창에서도 패리가
 * 성립하고 발화 함수가 실제로 불린다 — 가드가 없으면 그 자리가 그대로 TypeError 구간이 된다.
 */
export function audioCtx(): AudioContext | null {
  return graph === null ? null : graph.ctx;
}

/** 효과음 버스. 음소거는 이 위의 master만 내리므로 여기는 상시 열려 있다 */
export function sfxBus(): GainNode | null {
  return graph === null ? null : graph.sfx;
}

/** BGM 버스. 잘라내기 1순위인 bgm.ts가 이것만 본다 */
export function musicBus(): GainNode | null {
  return graph === null ? null : graph.music;
}

/** 음소거가 만지는 유일한 노드. 소유자는 audio/mixer.ts다 */
export function masterBus(): GainNode | null {
  return graph === null ? null : graph.master;
}

/**
 * audio 전용 난수 스트림.
 *
 * sim 스트림에서 뽑는 것은 금지다 — 음소거 여부가 난수 소비 횟수를 바꾸면 같은 시드의 두 런이
 * 갈라진다(core/rng.ts 머리말). 소리는 픽셀에도 판정에도 남지 않아 재현 대상이 아니므로
 * 시드는 세션마다 달라도 된다.
 */
export function audioRng(): Rng {
  rng ??= createRng(Math.floor(Math.random() * AUDIO_SEED_RANGE));
  return rng;
}

/**
 * 첫 사용자 제스처에서 컨텍스트를 깨우고 `onStarted`를 한 번 부른다. 두 번째 호출부터는 무시한다.
 *
 * keydown·pointerdown 둘 다 거는 이유는 §16.1의 M이 키이고 §16.2의 카드 선택이 포인터도
 * 받기 때문이다. core/input.ts는 preventDefault만 하고 전파를 막지 않으므로 document까지
 * 올라온다. document가 없는 환경에서는 아무것도 걸지 않는다.
 */
export function installFirstGestureResume(onStarted: () => void): void {
  if (gestureArmed || typeof document === 'undefined') {
    return;
  }
  gestureArmed = true;

  const kick = (): void => {
    document.removeEventListener('keydown', kick);
    document.removeEventListener('pointerdown', kick);
    const ctx = initAudio();
    if (ctx === null) {
      return;
    }
    void ctx.resume();
    onStarted();
  };

  document.addEventListener('keydown', kick);
  document.addEventListener('pointerdown', kick);
}
