/**
 * 패치를 이루는 층 넷 — 노이즈 · 톤 · 아르페지오 · 폭발.
 *
 * 07 §3의 스무 개 남짓한 패치가 전부 이 넷의 조합이다. `patches-parry.ts`(§3.1~§3.7)와
 * `patches-world.ts`(§3.8~§3.15)가 여기를 공유한다 — 셋으로 나눈 것은 한 파일 400줄 상한
 * 때문이고, 나눈 자리는 "층을 만드는가 / 어느 사건에 무슨 층을 쌓는가"라는 실제 이음매다.
 *
 * **발성은 전부 voices.ts를 지난다.** 노드를 만들어 연결까지 하고 `playVoice`에 넘기면
 * 소유권이 그쪽으로 간다 — 상한 24에 걸려 거절되면 그쪽이 끊는다. 직접 `start()`를 부르면
 * 07 §2.6의 상한과 카테고리 예약이 우회되고, 그 표를 실제로 넘기는 사건이 연쇄 처치
 * 하나뿐이라 우회 경로는 언제나 최악 프레임에서만 드러난다.
 *
 * 숫자는 전부 `config/audio.ts`에서 온다. 여기 있는 상수는 config에 자리가 없는 엔벨로프
 * 성형값뿐이고, 값의 출처는 07 §3의 발췌 코드다.
 */

import type { OscWave } from '../config/types';
import type { Rng } from '../core/rng';
import { envelope, filterNode, noiseSource, sweepCutoff } from './synth';
import type { VoiceCategory } from './voices';
import { noiseBufferFor, playTone, playVoice } from './voices';

/** 클릭 계열의 어택 (s). 07 §3.1의 금속 코어와 §3.7의 금속 헤드가 쓴다 */
export const CLICK_ATTACK_SEC = 0.001;
/** 노이즈 몸통의 어택 (s). 07 §3.7 발췌 코드 */
export const BODY_ATTACK_SEC = 0.003;
/** 감쇠가 끝난 뒤 stop()까지의 여유 (s). 0이면 꼬리가 잘리며 클릭이 남는다 (07 §2.5 함정 5) */
export const NOISE_TAIL_SEC = 0.02;
/** Q를 config가 주지 않는 lowpass·highpass가 쓰는 값 (무단위). 공진 없이 통과대역만 자른다 */
export const FLAT_Q = 1;

/** 패치 하나가 필요로 하는 것 전부. 07 §3의 발췌 코드가 함수마다 다시 꺼내던 넷이다 */
export interface PatchSite {
  readonly ctx: AudioContext;
  /** 효과음 버스. 패치는 이 노드까지만 알고 그 위의 master·리미터는 모른다 */
  readonly dest: AudioNode;
  readonly rng: Rng;
  /** 이 패치가 시작하는 절대 시각 (s, `AudioContext` 시계) */
  readonly atSec: number;
  readonly category: VoiceCategory;
}

/**
 * 병합 창이 게인을 올릴 대표 층 (07 §2.6).
 *
 * 창 안에 같은 사건이 또 오면 `voices.ts`가 이 노드의 게인을 `1 + 0.12 × (N − 1)`배로 올린다.
 * 층이 여럿인 패치는 노이즈 층 하나만 넘긴다 — 전부 올리면 층 사이의 비율이 무너져 같은
 * 소리가 아니라 다른 소리가 커진 것처럼 들린다. 톤만으로 된 패치는 null을 내고, 그때는
 * 병합이 중복 제거만 하고 게인은 그대로다.
 */
export interface MergeAnchor {
  readonly gain: GainNode;
  readonly peak: number;
}

/**
 * 07 §2.7이 굽기로 한 여섯 쌍에 없는 노이즈의 감쇠 상수 (샘플).
 *
 * 버퍼가 자기 길이에 걸쳐 1/e로 떨어진다. 빈 패리의 바람, 장판의 불길, 페이즈 전환의 스웰이
 * 그 셋인데 전부 "훅 감싸는" 소리라, kill·hit의 감쇠 900(48kHz에서 19ms)을 쓰면 클릭이 된다.
 * config에 없는 감쇠를 새 리터럴로 적는 대신 길이에서 유도한다.
 */
export function selfDecayFor(ctx: AudioContext, durSec: number): number {
  return ctx.sampleRate * durSec;
}

export interface NoiseLayer {
  readonly durSec: number;
  readonly decay: number;
  /** null이면 필터 없이 엔벨로프로 바로 간다 */
  readonly filter: BiquadFilterNode | null;
  readonly peak: number;
  readonly attackSec: number;
  readonly tailSec: number;
  readonly atSec: number;
}

/** 버퍼는 재사용하고 소스 노드는 재생마다 새로 만든다 (07 §2.5 함정 7) */
export function noiseLayer(site: PatchSite, layer: NoiseLayer): MergeAnchor | null {
  const buffer = noiseBufferFor(site.ctx, layer.durSec, layer.decay);
  const source = noiseSource(site.ctx, buffer, site.rng);
  const gain = envelope(site.ctx, layer.peak, layer.attackSec, layer.tailSec, layer.atSec);
  const nodes: AudioNode[] = [gain];
  if (layer.filter === null) {
    source.connect(gain);
  } else {
    source.connect(layer.filter).connect(gain);
    nodes.push(layer.filter);
  }
  gain.connect(site.dest);
  const started = playVoice({
    category: site.category,
    source,
    nodes,
    atSec: layer.atSec,
    stopAtSec: layer.atSec + layer.attackSec + layer.tailSec + NOISE_TAIL_SEC,
  });
  return started ? { gain, peak: layer.peak } : null;
}

export interface ToneLayer {
  readonly wave: OscWave;
  readonly fromHz: number;
  readonly toHz: number;
  readonly gain: number;
  readonly durSec: number;
  readonly atSec: number;
  readonly filter: BiquadFilterNode | null;
}

export function toneLayer(site: PatchSite, layer: ToneLayer): void {
  const spec = {
    category: site.category,
    wave: layer.wave,
    fromHz: layer.fromHz,
    toHz: layer.toHz,
    gain: layer.gain,
    durSec: layer.durSec,
    atSec: layer.atSec,
  };
  if (layer.filter === null) {
    playTone({ ...spec, dest: site.dest });
    return;
  }
  layer.filter.connect(site.dest);
  if (!playTone({ ...spec, dest: layer.filter })) {
    // 거절된 보이스의 중간 노드는 voices.ts가 끊는다. 이 필터는 그 목록 밖이라 여기서 끊는다
    layer.filter.disconnect();
  }
}

/** 07 §3.3·§3.6·§3.12·§3.13이 공유하는 아르페지오. 음마다 하나씩 시간축에 늘어놓는다 */
export function arpeggio(
  site: PatchSite,
  notes: readonly number[],
  wave: OscWave,
  noteSec: number,
  gain: number,
  atSec: number,
): void {
  for (let index = 0; index < notes.length; index += 1) {
    const hz = notes[index];
    if (hz === undefined) {
      continue;
    }
    toneLayer(site, {
      wave,
      fromHz: hz,
      toHz: hz,
      gain,
      durSec: noteSec,
      atSec: atSec + noteSec * index,
      filter: null,
    });
  }
}

export interface BlastLayer {
  readonly noiseSec: number;
  readonly decay: number;
  readonly cutoffFromHz: number;
  readonly cutoffToHz: number;
  readonly cutoffSweepSec: number;
  readonly gain: number;
  readonly subFromHz: number;
  readonly subToHz: number;
  readonly subSec: number;
  readonly subGain: number;
}

/**
 * 07 §3.5의 폭발. 노이즈만으로는 충격이 안 실려 저역 톤을 겹친다.
 * 보스 격파(§3.12)가 같은 모양을 3배 길이로 쓰고, 연쇄 링크(§3.6)는 저역 톤의 음정만 바꾼다.
 */
export function blast(site: PatchSite, layer: BlastLayer): MergeAnchor | null {
  const lowpass = filterNode(site.ctx, 'lowpass', layer.cutoffFromHz, FLAT_Q);
  sweepCutoff(lowpass, layer.cutoffFromHz, layer.cutoffToHz, site.atSec, layer.cutoffSweepSec);
  const anchor = noiseLayer(site, {
    durSec: layer.noiseSec,
    decay: layer.decay,
    filter: lowpass,
    peak: layer.gain,
    attackSec: BODY_ATTACK_SEC,
    tailSec: layer.noiseSec,
    atSec: site.atSec,
  });
  toneLayer(site, {
    wave: 'triangle',
    fromHz: layer.subFromHz,
    toHz: layer.subToHz,
    gain: layer.subGain,
    durSec: layer.subSec,
    atSec: site.atSec,
    filter: null,
  });
  return anchor;
}
