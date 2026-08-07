/**
 * oscillator · noise buffer · envelope · filter — 07 §2가 정한 기본기 네 가지가 전부다.
 *
 * 오디오 파일 0개, 라이브러리 0개다(D-08). 외부 음원과 라이브러리는 라이선스 고지 의무를
 * 만들고, 그 순간 "단일 HTML 한 장" 산출 조건도 같이 흔들린다.
 *
 * ── 이 파일은 노드를 만들기만 한다 ────────────────────────────────────────────
 *
 * `start()` · `stop()` · `disconnect()`는 한 줄도 없다. 전부 voices.ts가 한다 — 그래야
 * §2.6의 동시 발성 상한 24를 우회하는 경로가 구조적으로 안 생기고, §2.5 함정 5(stop을 안
 * 걸어 노드가 새는 것)를 한 곳에서만 지키면 된다.
 *
 * 모듈 상태도 없다. AudioContext와 Rng를 전부 인자로 받는다.
 *
 * ── 파형 배정 (07 §2.1) ───────────────────────────────────────────────────────
 *
 * sine은 콤보 끊김 경고와 무적 종료뿐이고, sawtooth는 예고 표시 3종 전용이다. 후자가 이
 * 표에서 가장 중요한 배정이다 — 버즈 음색이 들리면 패리로 지울 수 없는 공격이라는 규칙을
 * 소리 쪽에도 인코딩한 것이라, 다른 사건에 sawtooth를 쓰면 그 학습이 무너진다.
 */

import type { OscWave } from '../config/types';
import { AUDIO } from '../config/audio';
import type { Rng } from '../core/rng';

/**
 * exponentialRampToValueAtTime은 0을 지날 수 없다 (07 §2.5 함정 1).
 * 시작값도 0이면 안 되므로 0.0001에서 출발해 0.001로 떨어뜨린다.
 */
const MIN_RAMP_GAIN = 0.0001;
const MIN_END_GAIN = 0.001;

/** 지수 램프의 하한 (Hz). 컷오프도 음정도 0을 지나면 램프 자체가 성립하지 않는다 */
const MIN_RAMP_HZ = 20;

/**
 * 지수 감쇠 엔벨로프. atSec에 0.0001에서 출발해 peak를 찍고 0.001까지 떨어진다.
 *
 * peak에 하한이 있는 것은 감쇠 도착값(0.001)보다 낮은 peak를 넘기면 "감쇠"가 상승이 되기
 * 때문이다. 이 게임에서 가장 작은 게인이 쿨다운 틱의 0.055라 실제로 걸리지는 않지만,
 * 병합 게인이나 등급 배수를 곱한 값이 들어올 자리라 하한을 남긴다.
 */
export function envelope(
  ctx: AudioContext,
  peak: number,
  attackSec: number,
  decaySec: number,
  atSec: number,
): GainNode {
  const node = ctx.createGain();
  const top = Math.max(peak, MIN_END_GAIN * 2);
  const peakAtSec = atSec + attackSec;
  node.gain.setValueAtTime(MIN_RAMP_GAIN, atSec);
  node.gain.exponentialRampToValueAtTime(top, peakAtSec);
  node.gain.exponentialRampToValueAtTime(MIN_END_GAIN, peakAtSec + decaySec);
  return node;
}

/**
 * 지수 감쇠가 미리 곱해진 화이트 노이즈 버퍼.
 *
 * decay가 작을수록 앞머리만 남는다 — 8ms 버퍼에 decay 50이면 금속 클릭, 0.28초 버퍼에
 * decay 900이면 폭발 몸통이다. 두 사건이 같은 코드에서 나온다는 것이 이 함수의 요점이다.
 *
 * **직접 부르지 말고 voices.ts의 `noiseBufferFor()`를 거친다** — 굽는 비용이 샘플 수에
 * 비례해서 연쇄 처치 한 번에 26만 회 루프가 되고, 그 프레임이 밀리면 패리가 하나 실패한다
 * (07 §2.7). 여기 남겨 둔 것은 캐시가 미스일 때 실제로 굽는 자리이기 때문이다.
 */
export function noiseBuffer(ctx: AudioContext, durSec: number, decay: number, rng: Rng): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (rng.float() * 2 - 1) * Math.exp(-i / decay);
  }
  return buffer;
}

/**
 * 구운 버퍼를 재생할 소스 노드.
 *
 * 재생마다 새로 만든다. `stop()` 뒤에 다시 `start()`를 부르면 InvalidStateError다
 * (07 §2.5 함정 7) — 재사용하는 것은 AudioBuffer이지 AudioBufferSourceNode가 아니다.
 * 같은 버퍼가 매번 같게 들리지 않는 것은 여기의 playbackRate ±3%가 맡는다(함정 4).
 */
export function noiseSource(ctx: AudioContext, buffer: AudioBuffer, rng: Rng): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = jitter(1, rng);
  return source;
}

/** 음정이 fromHz에서 toHz로 durSec 동안 미끄러지는 오실레이터. 고정 음정은 두 값을 같게 준다 */
export function glideOsc(
  ctx: AudioContext,
  wave: OscWave,
  fromHz: number,
  toHz: number,
  atSec: number,
  durSec: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(fromHz, MIN_RAMP_HZ), atSec);
  osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, MIN_RAMP_HZ), atSec + durSec);
  return osc;
}

export function filterNode(
  ctx: AudioContext,
  type: BiquadFilterType,
  hz: number,
  q: number,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  return filter;
}

/**
 * 컷오프를 시간에 걸쳐 쓸어내린다. 폭발·처치·보스 격파가 전부 이 하나에 의존한다.
 *
 * 컷오프의 작은 변화가 소리의 성격을 통째로 바꾸는 자리라(07 §2.4) 값은 전부
 * config/audio.ts에 있다 — 이 게임에서 가장 자주 만지게 될 숫자가 그것이다.
 */
export function sweepCutoff(
  filter: BiquadFilterNode,
  fromHz: number,
  toHz: number,
  atSec: number,
  durSec: number,
): void {
  filter.frequency.setValueAtTime(Math.max(fromHz, MIN_RAMP_HZ), atSec);
  filter.frequency.exponentialRampToValueAtTime(Math.max(toHz, MIN_RAMP_HZ), atSec + durSec);
}

/**
 * 트리거마다 피치를 ±3% 흔든다 (07 §2.5 함정 4).
 *
 * 초당 4회 이상 반복되는 소리가 실제로 있어서(§5.1 쿨다운 0.24초) 이것이 없으면 기계로
 * 들린다. 그 쿨다운 틱 하나만 예외라 `jitterBy(hz, rng, AUDIO.cooldown.pitchJitter)`를 쓴다 —
 * 흔들리는 틱은 오류음으로 들리고, 일정한 틱은 메트로놈이 되어 의식에서 배경으로 내려간다.
 */
export function jitter(hz: number, rng: Rng): number {
  return jitterBy(hz, rng, AUDIO.mixer.pitchJitter);
}

/** 흔드는 폭을 부르는 쪽이 정하는 판. spread가 0이면 hz를 그대로 낸다 */
export function jitterBy(hz: number, rng: Rng, spread: number): number {
  return hz * (1 + (rng.float() * 2 - 1) * spread);
}
