/**
 * 동시 발성 상한 · 병합 창 · 노이즈 버퍼 캐시 — 07 §2.6 · §2.7.
 *
 * 소스 노드를 실제로 `start()`·`stop()` 하는 유일한 파일이다. synth.ts는 노드를 만들기만
 * 하고, 여기를 거치지 않는 발성 경로가 없어야 아래 세 가지가 성립한다.
 *
 * ── 왜 상한이 필요한가 ────────────────────────────────────────────────────────
 *
 * 스펙 §3.2의 전역 상한이 적 탄환 280 · 반사탄 240 · 잡몹 20을 허용한다. 07 §2.6이 자기
 * 값으로 최악 프레임을 세어 약 40 보이스를 얻었다 — 연쇄 겹침 14, 확인 아르페지오 3,
 * 패리 GREAT 4, 반사 1, 콤보 1, 쿨다운 1, 예비동작 8, 예고 3, BGM 3. 그대로 두면 합이
 * full scale을 넘어 찢어지고, 40개가 각자 노드를 만들면 §2.5 함정 5가 실제 누수가 된다.
 *
 * ── 그런데 상한 24는 그대로 두면 지키려던 것을 먼저 자른다 ────────────────────
 *
 * "가장 오래된 것부터 stop()"이면 **연쇄의 앞쪽 링크가 먼저 죽는데, 그 상승 음정이 07 §3.6이
 * 「이 함수의 존재 이유」라고 적은 바로 그것이다.** 그래서 카테고리 예약을 둔다 — 연쇄는
 * eviction 대상에서 통째로 빠지고, 패리는 6까지 보장받고, 나머지는 잔여를 공유한다.
 * 예약은 "이만큼은 반드시 준다"이지 "이만큼만 준다"가 아니다. 자리가 남아 있으면 어느
 * 카테고리든 예약을 넘어 쓴다.
 *
 * ── 병합 창 ───────────────────────────────────────────────────────────────────
 *
 * 0.03초 안에 같은 이벤트가 N번 오면 소리는 1회만 내고 게인을 올린다. 연쇄 처치만 예외인데,
 * 연쇄는 **의도적으로 시간축에 늘어놓는 것**이라 병합하면 D-09가 통째로 무너진다.
 */

import { AUDIO } from '../config/audio';
import type { OscWave } from '../config/types';
import { audioCtx, audioRng } from './context';
import { envelope, glideOsc, noiseBuffer } from './synth';

/**
 * 07 §2.6의 카테고리 셋. config/audio.ts에 자리가 없어 예약 수가 여기 있다(그 파일 머리말 ③).
 *
 * 'chain'은 D-09의 연쇄 처치, 'parry'는 패리 성공 3등급, 'other'는 나머지 전부다.
 * 셋으로 나눈 축은 "잘리면 무엇이 사라지는가" 하나다.
 */
export type VoiceCategory = 'chain' | 'parry' | 'other';

const RESERVED_VOICES: Readonly<Record<VoiceCategory, number>> = {
  chain: 16,
  parry: 6,
  other: 0,
};

/** 병합으로 올릴 수 있는 게인의 상한 배수 (07 §2.6). 증분 자체는 AUDIO.mixer.mergeGainStep이다 */
const MERGE_GAIN_MAX_MUL = 1.6;

/** playTone의 어택 (s). 12ms보다 짧으면 오실레이터 시작에서 딱 소리가 난다 */
const TONE_ATTACK_SEC = 0.012;

/** 감쇠가 끝난 뒤 stop()까지의 여유 (s). 0이면 꼬리가 잘려 나가며 클릭이 남는다 */
const TONE_TAIL_SEC = 0.02;

interface Voice {
  readonly category: VoiceCategory;
  readonly source: AudioScheduledSourceNode;
  /** source와 버스 사이의 중간 노드 전부. 끝나면 여기까지 disconnect 한다 */
  readonly nodes: readonly AudioNode[];
  released: boolean;
}

/** 시작 순서로 쌓인다 — 앞이 가장 오래된 보이스다 */
const active: Voice[] = [];

function countByCategory(): Record<VoiceCategory, number> {
  const counts: Record<VoiceCategory, number> = { chain: 0, parry: 0, other: 0 };
  for (const voice of active) {
    counts[voice.category] += 1;
  }
  return counts;
}

/** 노드를 끊고 목록에서 뺀다. onended와 eviction 양쪽에서 오므로 두 번 불려도 안전해야 한다 */
function release(voice: Voice): void {
  if (voice.released) {
    return;
  }
  voice.released = true;
  const at = active.indexOf(voice);
  if (at >= 0) {
    active.splice(at, 1);
  }
  voice.source.disconnect();
  for (const node of voice.nodes) {
    node.disconnect();
  }
}

/**
 * 자리를 내줄 보이스를 고른다. 못 고르면 null이고, 그때 새 소리는 나지 않는다.
 *
 * 연쇄는 어떤 경우에도 후보가 아니다. 예약을 넘겨 쓰고 있는 카테고리를 먼저 자르고,
 * 그런 보이스가 없을 때만 예약 안쪽을 건드리는데 그것도 들어오는 쪽이 자기 예약을 아직
 * 다 못 쓴 경우로 한정한다 — 그래야 패리 6이 잔여 소리들에 잠식되지 않는다.
 */
function pickVictim(incoming: VoiceCategory, counts: Record<VoiceCategory, number>): Voice | null {
  let overReserved: Voice | null = null;
  let oldest: Voice | null = null;
  for (const voice of active) {
    if (voice.category === 'chain') {
      continue;
    }
    if (overReserved === null && counts[voice.category] > RESERVED_VOICES[voice.category]) {
      overReserved = voice;
    }
    oldest ??= voice;
  }
  if (overReserved !== null) {
    return overReserved;
  }
  return counts[incoming] < RESERVED_VOICES[incoming] ? oldest : null;
}

function admit(category: VoiceCategory): boolean {
  if (active.length < AUDIO.mixer.maxVoices) {
    return true;
  }
  const victim = pickVictim(category, countByCategory());
  if (victim === null) {
    return false;
  }
  // stop()의 onended는 다음 틱에나 온다. 그때까지 자리가 안 비면 이 프레임의 다음 소리가
  // 같은 판정을 또 받게 되므로 여기서 동기적으로 뺀다
  victim.source.stop();
  release(victim);
  return true;
}

/**
 * 이미 만들어 연결까지 끝낸 노드 사슬을 실제로 재생한다.
 *
 * `nodes`는 source와 버스 사이의 중간 노드 전부다. 이 함수는 결과와 무관하게 그 노드들의
 * 소유권을 가져간다 — 상한에 걸려 거절되면 여기서 끊는다. 부르는 쪽이 실패 경로에서
 * disconnect를 따로 하면 이중 해제가 된다.
 *
 * 거절은 예외가 아니라 정상이다. §1.1대로 모든 사건이 시각 신호를 이미 갖고 있으므로,
 * 소리 하나가 빠져도 정보는 빠지지 않는다.
 */
export function playVoice(spec: {
  readonly category: VoiceCategory;
  readonly source: AudioScheduledSourceNode;
  readonly nodes: readonly AudioNode[];
  readonly atSec: number;
  readonly stopAtSec: number;
}): boolean {
  const voice: Voice = {
    category: spec.category,
    source: spec.source,
    nodes: spec.nodes,
    released: false,
  };
  if (audioCtx() === null || !admit(spec.category)) {
    release(voice);
    return false;
  }
  spec.source.onended = (): void => release(voice);
  spec.source.start(spec.atSec);
  spec.source.stop(Math.max(spec.stopAtSec, spec.atSec));
  // 목록에는 실제로 시작된 소스만 넣는다. 안 그러면 start()가 던진 보이스가 자리를 물고 남는다
  if (!voice.released) {
    active.push(voice);
  }
  return true;
}

/**
 * 음정 하나. 07 §3.1의 `playTone`이 이것이다.
 *
 * 글라이드 목표(`toHz`)가 선택이 아니라 필수 인자인 것은 이 게임에서 음정이 고정된 톤이
 * 쿨다운 틱 하나뿐이기 때문이다 — 기본값을 두면 그 하나 때문에 나머지 전부가 인자를 넘긴다.
 * 고정 음정은 fromHz와 toHz를 같게 준다.
 */
export function playTone(spec: {
  readonly category: VoiceCategory;
  readonly wave: OscWave;
  readonly fromHz: number;
  readonly toHz: number;
  readonly gain: number;
  readonly durSec: number;
  readonly atSec: number;
  readonly dest: AudioNode;
}): boolean {
  const ctx = audioCtx();
  if (ctx === null) {
    return false;
  }
  const osc = glideOsc(ctx, spec.wave, spec.fromHz, spec.toHz, spec.atSec, spec.durSec);
  const gain = envelope(ctx, spec.gain, TONE_ATTACK_SEC, spec.durSec, spec.atSec);
  osc.connect(gain).connect(spec.dest);
  return playVoice({
    category: spec.category,
    source: osc,
    nodes: [gain],
    atSec: spec.atSec,
    stopAtSec: spec.atSec + TONE_ATTACK_SEC + spec.durSec + TONE_TAIL_SEC,
  });
}

/** 지금 살아 있는 보이스 수. 상한이 실제로 걸리는지 보는 자리는 여기뿐이다 */
export function activeVoiceCount(): number {
  return active.length;
}

interface MergeSlot {
  openedAtSec: number;
  hits: number;
  gain: GainNode | null;
  peak: number;
}

const merges = new Map<string, MergeSlot>();

/**
 * 이번 트리거가 실제로 소리를 내야 하는가 (07 §2.6 병합 창 0.03초).
 *
 * false면 부르는 쪽은 노드를 하나도 만들지 않고 돌아선다. 대신 창을 연 소리의 게인이
 * `1 + mergeGainStep × (N − 1)`배로 오른다 — 다섯 기가 같은 프레임에 죽으면 같은 소리가
 * 다섯 번 나는 게 아니라 한 번 더 크게 난다.
 *
 * **연쇄 처치는 이것을 부르지 않는다.** 연쇄는 시간축 자체가 정보라 병합하면 D-09가 무너진다.
 */
export function beginMerged(key: string, atSec: number): boolean {
  const slot = merges.get(key);
  if (slot !== undefined && atSec - slot.openedAtSec < AUDIO.mixer.mergeWindowSec) {
    slot.hits += 1;
    if (slot.gain !== null) {
      const mul = Math.min(1 + AUDIO.mixer.mergeGainStep * (slot.hits - 1), MERGE_GAIN_MAX_MUL);
      // 진행 중인 감쇠 램프의 출발값이 이 값으로 바뀐다. 꼬리는 그대로 살아 있다
      slot.gain.gain.setValueAtTime(slot.peak * mul, atSec);
    }
    return false;
  }
  merges.set(key, { openedAtSec: atSec, hits: 1, gain: null, peak: 0 });
  return true;
}

/**
 * `beginMerged`가 true를 낸 뒤, 그 소리의 게인 노드를 창에 등록한다.
 *
 * 창 안의 다음 트리거가 이 노드를 올린다. 등록하지 않아도 소리는 정상이고 병합분만 사라지므로,
 * 게인이 여러 층인 패치는 대표 한 층만 넘기면 된다.
 */
export function registerMerged(key: string, gain: GainNode, peak: number): void {
  const slot = merges.get(key);
  if (slot !== undefined) {
    slot.gain = gain;
    slot.peak = peak;
  }
}

/** key마다 살아 있는 사건의 종료 시각 (s) */
const holds = new Map<string, number[]>();

/**
 * 같은 종류의 사건이 동시에 몇 개까지 소리를 낼지 세는 판 (07 §3.9).
 *
 * 잡몹 20기가 동시에 예비동작에 들어갈 수 있는데 20개의 상승음은 소리가 아니라 소음이다.
 * 한도를 넘으면 false를 내고, 부르는 쪽은 그 사건의 소리를 통째로 건너뛴다 — 예비동작의
 * 시각 표시가 §15.1의 요구를 이미 혼자 만족하므로 정보가 빠지지는 않는다.
 */
export function tryHold(key: string, limit: number, atSec: number, holdSec: number): boolean {
  const live = (holds.get(key) ?? []).filter((endSec) => endSec > atSec);
  if (live.length >= limit) {
    holds.set(key, live);
    return false;
  }
  live.push(atSec + holdSec);
  holds.set(key, live);
  return true;
}

const noiseCache = new Map<string, AudioBuffer>();
let cacheCtx: AudioContext | null = null;

/**
 * `(길이, decay)` 쌍마다 버퍼를 한 번만 굽는다 (07 §2.7).
 *
 * 캐시가 없으면 `kill.noiseSec 0.28`이 48kHz에서 13,440 샘플이고 연쇄가 20링크면 한 사건에
 * 268,800회 루프다. 메인 스레드에서 3~10ms이고, **그 프레임이 밀리면 패리 하나가 실패한다**
 * (D-04 · D-07). 트리거마다 달라야 한다는 요구는 버퍼가 아니라 재생 쪽 playbackRate ±3%와
 * 필터 컷오프 랜덤이 맡는다 — 그쪽은 공짜다.
 *
 * sampleRate가 컨텍스트에 묶여 있으므로 컨텍스트가 바뀌면 통째로 버린다.
 */
export function noiseBufferFor(ctx: AudioContext, durSec: number, decay: number): AudioBuffer {
  if (cacheCtx !== ctx) {
    noiseCache.clear();
    cacheCtx = ctx;
  }
  const key = `${durSec}|${decay}`;
  const cached = noiseCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const baked = noiseBuffer(ctx, durSec, decay, audioRng());
  noiseCache.set(key, baked);
  return baked;
}

/**
 * 컨텍스트가 깨어난 직후 한 번 부른다. 부르는 자리는 audio/mixer.ts의 첫 제스처 콜백이다.
 *
 * config/audio.ts가 decay를 명시한 쌍만 여기서 굽는다. zoneEnter · boss.defeat · whiff ·
 * ui.move는 decay 필드가 없어 값을 고르는 것이 sfx.ts의 몫이고, 그 넷은 첫 발화 때
 * `noiseBufferFor()`가 캐시에 넣는다 — 한 번뿐인 비용이라 그 자리에서 감당한다.
 */
export function warmNoiseCache(): void {
  const ctx = audioCtx();
  if (ctx === null) {
    return;
  }
  noiseBufferFor(ctx, AUDIO.parry.clangSec, AUDIO.parry.clangDecay);
  noiseBufferFor(ctx, AUDIO.kill.noiseSec, AUDIO.kill.noiseDecay);
  noiseBufferFor(ctx, AUDIO.hit.ENEMY.bodySec, AUDIO.hit.bodyDecay);
  noiseBufferFor(ctx, AUDIO.hit.REFLECT.bodySec, AUDIO.hit.bodyDecay);
}
