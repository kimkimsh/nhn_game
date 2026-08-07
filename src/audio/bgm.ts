/**
 * 절차적 BGM — 07 §4. 오디오 파일 0개, 라이브러리 0개(D-08). 이 파일과 `bgm-plan.ts`가 곧 악보다.
 *
 * **BGM은 스펙이 직접 요구한 적이 없는 유일한 오디오 항목이다.** 스펙이 요구한 것은 "사운드"이고
 * §17의 모든 항목은 음소거 상태에서도 시각만으로 구분 가능해야 하므로(07 §6.2), 배경음이 없어도
 * 스펙이 깨지는 자리가 없다. 그래서 **잘라내기 1순위이고**(11 §11 · 07 §7.1), 중단 규칙은 연구의
 * 것을 그대로 쓴다 — **SFX 6종이 안 끝나면 여기 착수하지 않는다.** 잘라도 잃는 것은 배경음뿐이고
 * SFX는 남으므로 §17은 그대로 만족된다.
 *
 * 자르는 법: 이 파일과 `bgm-plan.ts`, config/audio.ts의 BGM 상수, 그리고 createBgm을 부르는 자리를
 * 지운다. AUDIO 쪽과 값을 하나도 공유하지 않으므로 SFX에는 아무 영향이 없다.
 *
 * ── 발성이 voices.ts를 안 지나는 유일한 자리다 ────────────────────────────────
 *
 * 나머지 audio/는 전부 voices.ts를 지나 상한 24와 병합 창을 받는다. BGM만 자기 서브그래프에서
 * 직접 start()·stop() 하고, 이유는 셋이다.
 *
 *   ① look-ahead 스케줄러는 노트를 최대 0.1초 앞서 건다(§4.3). 그 노트들은 소리가 나기 전부터
 *      풀 자리를 물고 있고, 한 코드가 최대 15개(패드 3 + 서브 2 + 16분 8 + 드럼 2)라 24 중 절반을
 *      점거한다 — 상한이 지키려던 SFX가 먼저 잘린다. **SFX가 BGM보다 앞이다**(07 §7.1).
 *   ② voices.ts의 eviction은 즉시 `stop()`이다. 지속 중인 코드가 그 자리에서 잘리면 클릭이
 *      남고, 그건 소리가 하나 빠지는 SFX의 거절과 성질이 다르다.
 *   ③ 상한이 막으려던 클리핑은 여기서 이미 막힌다 — 규칙 3(게인 ÷ 코드 음 수), 자체 lowpass,
 *      musicGain 0.42, 그리고 master 뒤의 리미터다. 07 §2.6의 최악 프레임 계산이 BGM을 3으로
 *      잡은 것은 §4.3의 패드 전용 스케치 기준이고, 텍스처가 붙은 뒤로는 그 수가 아니다.
 *
 * 노이즈 버퍼만은 voices.ts의 캐시를 쓴다. 굽는 비용이 (길이, decay) 쌍마다 한 번뿐이어야 하고
 * (07 §2.7), 그 캐시가 쓰는 난수가 audio 전용 스트림이다 — sim 스트림을 쓰면 음소거 여부가
 * 난수 소비 횟수를 바꿔 같은 시드의 두 런이 갈라진다(07 §2.3 · D-05).
 *
 * ── 계층과 시동 ───────────────────────────────────────────────────────────────
 *
 * audio/는 config·core만 본다(03 §5) — 지금 어느 스테이지인지는 sim에 묻지 않고 인자로 받는다.
 * 첫 사용자 제스처 전에는 `musicBus()`가 null이고(07 §2.5 함정 6), 스케줄러는 null인 동안
 * 아무것도 걸지 않다가 버스가 생긴 첫 틱에서 곡을 시작한다 — 그 몇 초가 구조적 무음이다(§1.4).
 */

import { BGM } from '../config/audio';
import { audioCtx, musicBus } from './context';
import { noiseBufferFor } from './voices';
import {
  chordTones, midiToHz, planFor, SEMITONES_PER_OCTAVE,
  type BgmSection, type Plan,
} from './bgm-plan';

export type { BgmSection } from './bgm-plan';

const SEC_PER_MIN = 60;
const MS_PER_SEC = 1000;

/** 첫 코드를 currentTime에 정확히 걸면 이미 지난 시각이 되어 앞머리가 잘린다 */
const START_LEAD_SEC = 0.05;
/** 구간 전환·정지 페이드 (s). §6.1의 음소거 램프와 같은 20ms다 — 즉시 끊으면 파형이 잘려 딱 소리가 난다 */
const FADE_SEC = 0.02;
/** stop()을 엔벨로프 끝보다 이만큼 뒤에 건다 (s). 07 §2.5 함정 5 */
const STOP_PAD_SEC = 0.02;

/**
 * 층 사이의 상대 비율. BgmConfig에 자리가 없는 값들이고, 전체 음량은 BGM.chordGain 하나가
 * 지배하므로 여기 있는 것은 그 안에서의 배분뿐이다.
 */
const ARP_GAIN_RATIO = 0.55;
/** 아르페지오가 훑는 폭 (옥타브). 한 옥타브면 16분에서 같은 세 음이 계속 돈다 */
const ARP_SPAN_OCTAVES = 2;
/** 아르페지오 음 길이 = 음 간격 × 이 값. 1이면 다음 음과 붙어 아르페지오가 아니라 지속음이 된다 */
const ARP_NOTE_HOLD = 0.9;
const SUB_GAIN_RATIO = 0.7;
/** §4.4 S3 "느린 스웰". 코드 길이에 대한 비율이라 BPM이 바뀌어도 성격이 유지된다 */
const SWELL_ATTACK_RATIO = 0.45;
const SWELL_RELEASE_RATIO = 0.5;

/** 노이즈 드럼 버퍼의 (길이, decay) 쌍. 07 §2.7의 캐시 키가 이 둘이다 */
const DRUM_NOISE_SEC = 0.25;
const DRUM_NOISE_DECAY = 1200;
/** 정박 강세. 코드가 바뀌는 자리를 짚는다 */
const DRUM_DOWNBEAT = { lowpassHz: 220, gain: 0.5, holdSec: 0.16 };
const DRUM_OFFBEAT = { lowpassHz: 900, gain: 0.22, holdSec: 0.08 };

export interface Bgm {
  /** 같은 구간을 다시 넘기면 아무 일도 하지 않는다 — 매 프레임 불러도 곡이 처음부터 다시 시작하지 않는다 */
  play(section: BgmSection): void;
  stop(): void;
  dispose(): void;
}

/** 음 하나. 코드·아르페지오·서브가 전부 이 모양으로 스케줄된다 */
type ToneSpec = {
  readonly midi: number;
  readonly atSec: number;
  readonly durSec: number;
  readonly peak: number;
  readonly attackSec: number;
  readonly releaseSec: number;
};

type ArpSpec = {
  readonly atSec: number;
  readonly noteSec: number;
  readonly count: number;
  readonly peak: number;
};

export function createBgm(): Bgm {
  /** 지금 울려야 하는 구간. null이면 정지 상태이고 타이머도 돌지 않는다 */
  let wanted: BgmSection | null = null;
  let plan: Plan | null = null;
  /**
   * 이 구간의 보이스가 모이는 곳. 구간마다 새로 만들고 통째로 페이드아웃한다 —
   * 개별 노트를 세어 끄면 전환 순간에 걸쳐 있던 코드의 꼬리가 그대로 남는다.
   */
  let voiceBus: GainNode | null = null;
  const live = new Set<AudioScheduledSourceNode>();
  let nextChordAtSec = 0;
  let step = 0;
  let timerId = 0;

  function track(source: AudioScheduledSourceNode, gain: GainNode): void {
    live.add(source);
    source.onended = (): void => {
      live.delete(source);
      source.disconnect();
      gain.disconnect();
    };
  }

  /**
   * 07 §4.2 규칙 1(triangle)과 규칙 2(짧은 어택 + **linear** 릴리스)가 사는 자리.
   *
   * 릴리스가 linear인 것이 SFX와 갈리는 지점이다 — 지수 램프는 0에 도달할 수 없어서(함정 1)
   * 음이 끝내 안 꺼지고, 코드가 겹쳐 쌓인다.
   */
  function tone(ctx: AudioContext, out: GainNode, spec: ToneSpec): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(spec.midi);

    const attackSec = Math.min(spec.attackSec, spec.durSec / 2);
    const holdAtSec = Math.max(spec.atSec + attackSec, spec.atSec + spec.durSec - spec.releaseSec);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, spec.atSec);
    gain.gain.linearRampToValueAtTime(spec.peak, spec.atSec + attackSec);
    gain.gain.setValueAtTime(spec.peak, holdAtSec);
    gain.gain.linearRampToValueAtTime(0, spec.atSec + spec.durSec);

    osc.connect(gain).connect(out);
    osc.start(spec.atSec);
    osc.stop(spec.atSec + spec.durSec + STOP_PAD_SEC);
    track(osc, gain);
  }

  function drumHit(ctx: AudioContext, out: GainNode, atSec: number, accent: boolean): void {
    const shape = accent ? DRUM_DOWNBEAT : DRUM_OFFBEAT;
    const source = ctx.createBufferSource();
    source.buffer = noiseBufferFor(ctx, DRUM_NOISE_SEC, DRUM_NOISE_DECAY);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = shape.lowpassHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(BGM.chordGain * shape.gain, atSec);
    gain.gain.linearRampToValueAtTime(0, atSec + shape.holdSec);

    source.connect(lowpass).connect(gain).connect(out);
    source.start(atSec);
    source.stop(atSec + shape.holdSec + STOP_PAD_SEC);
    track(source, gain);
  }

  /** 코드 음을 두 옥타브에 걸쳐 아래에서 위로 훑는다 */
  function scheduleArp(ctx: AudioContext, out: GainNode, tones: readonly number[], spec: ArpSpec): void {
    const rungs = tones.length * ARP_SPAN_OCTAVES;
    for (let i = 0; i < spec.count; i++) {
      const rung = i % rungs;
      const octave = Math.floor(rung / tones.length);
      tone(ctx, out, {
        midi: (tones[rung % tones.length] ?? 0) + octave * SEMITONES_PER_OCTAVE,
        atSec: spec.atSec + spec.noteSec * i,
        durSec: spec.noteSec * ARP_NOTE_HOLD,
        peak: spec.peak * ARP_GAIN_RATIO,
        attackSec: BGM.attackSec,
        releaseSec: BGM.releaseSec,
      });
    }
  }

  function scheduleChord(ctx: AudioContext, out: GainNode, current: Plan, atSec: number, index: number): void {
    const voicing = current.voicing;
    const degree = current.progression[index % current.progression.length] ?? 0;
    const tones = chordTones(current.tonicMidi, current.scale, degree);
    const beatSec = SEC_PER_MIN / current.bpm;
    const chordSec = beatSec * BGM.beatsPerChord;
    // 07 §4.2 규칙 3. 나누지 않으면 3~4개가 합산되어 그대로 클리핑된다
    const perVoice = BGM.chordGain / tones.length;
    const swell = voicing.pad === 'SWELL';

    if (voicing.pad !== 'NONE') {
      for (const midi of tones) {
        tone(ctx, out, {
          midi,
          atSec,
          durSec: chordSec,
          peak: perVoice,
          attackSec: swell ? chordSec * SWELL_ATTACK_RATIO : BGM.attackSec,
          releaseSec: swell ? chordSec * SWELL_RELEASE_RATIO : BGM.releaseSec,
        });
      }
    }
    const root = tones[0] ?? current.tonicMidi;
    for (let octave = 1; octave <= voicing.subOctaves; octave++) {
      tone(ctx, out, {
        midi: root - octave * SEMITONES_PER_OCTAVE,
        atSec,
        durSec: chordSec,
        peak: perVoice * SUB_GAIN_RATIO,
        attackSec: BGM.attackSec,
        releaseSec: BGM.releaseSec,
      });
    }
    if (voicing.arpPerBeat > 0) {
      scheduleArp(ctx, out, tones, {
        atSec,
        noteSec: beatSec / voicing.arpPerBeat,
        count: voicing.arpPerBeat * BGM.beatsPerChord,
        peak: perVoice,
      });
    }
    if (voicing.drum) {
      for (let beat = 0; beat < BGM.beatsPerChord; beat++) {
        drumHit(ctx, out, atSec + beatSec * beat, beat === 0);
      }
    }
  }

  /** 07 §4.2 규칙 4. 마스터 lowpass 하나가 보스 구간에서만 2400 → 3200Hz로 열린다 */
  function openVoiceBus(ctx: AudioContext, bus: AudioNode, lowpassHz: number): GainNode {
    const gain = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = lowpassHz;
    gain.connect(lowpass).connect(bus);
    return gain;
  }

  function closeVoiceBus(): void {
    const gain = voiceBus;
    const ctx = audioCtx();
    voiceBus = null;
    if (gain === null || ctx === null) {
      return;
    }
    const atSec = ctx.currentTime;
    const endSec = atSec + FADE_SEC;
    gain.gain.cancelScheduledValues(atSec);
    gain.gain.setValueAtTime(gain.gain.value, atSec);
    gain.gain.linearRampToValueAtTime(0, endSec);
    for (const source of live) {
      source.stop(endSec);
    }
    live.clear();
    // 페이드가 끝나기 전에 끊으면 그 순간의 파형이 잘려 딱 소리가 난다
    window.setTimeout(() => gain.disconnect(), (FADE_SEC + STOP_PAD_SEC) * MS_PER_SEC);
  }

  /**
   * MDN look-ahead 패턴 (07 §4.3 · 연구 09:854). setTimeout은 "언제 다시 볼지"만 정하고,
   * 노트 시각은 전부 ctx.currentTime 기준의 절대 타임스탬프다 — 타이머가 노트를 직접 재생하면
   * 타이머 지터가 그대로 리듬이 되고, 프레임률이 흔들릴 때마다 박이 밀린다.
   */
  function pump(): void {
    const ctx = audioCtx();
    const bus = musicBus();
    const current = plan;
    if (ctx === null || bus === null || current === null) {
      return; // 첫 제스처 전에는 컨텍스트도 버스도 없다 (07 §2.5 함정 6)
    }
    if (voiceBus === null) {
      voiceBus = openVoiceBus(ctx, bus, current.lowpassHz);
      step = 0;
      nextChordAtSec = ctx.currentTime + START_LEAD_SEC;
    }
    const chordSec = (SEC_PER_MIN / current.bpm) * BGM.beatsPerChord;
    while (nextChordAtSec < ctx.currentTime + BGM.scheduleAheadSec) {
      scheduleChord(ctx, voiceBus, current, nextChordAtSec, step);
      step += 1;
      nextChordAtSec += chordSec;
    }
  }

  function tick(): void {
    timerId = 0;
    pump();
    if (plan !== null) {
      timerId = window.setTimeout(tick, BGM.lookaheadMs);
    }
  }

  function play(section: BgmSection): void {
    if (wanted !== null && wanted.kind === section.kind && wanted.stageId === section.stageId) {
      return;
    }
    wanted = section;
    plan = planFor(section);
    // 20ms 페이드로 나가는 동안 새 구간이 START_LEAD_SEC 뒤에 들어온다. 겹치는 구간이 곧 크로스페이드다
    closeVoiceBus();
    pump();
    if (timerId === 0) {
      timerId = window.setTimeout(tick, BGM.lookaheadMs);
    }
  }

  function stop(): void {
    wanted = null;
    plan = null;
    if (timerId !== 0) {
      window.clearTimeout(timerId);
      timerId = 0;
    }
    closeVoiceBus();
  }

  /**
   * 탭이 백그라운드로 가면 setTimeout이 1초로 조여져 look-ahead 창(0.1초)이 매번 이미 지난
   * 시각이 된다. 그대로 두면 복귀 순간 밀린 코드가 한꺼번에 쏟아지므로, 07 §4.3대로 음소거와
   * 같은 경로로 세운다. 복귀하면 다음 틱이 새 서브그래프를 열어 진행 첫 코드부터 다시 시작한다.
   */
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      if (timerId !== 0) {
        window.clearTimeout(timerId);
        timerId = 0;
      }
      closeVoiceBus();
      return;
    }
    if (plan !== null && timerId === 0) {
      timerId = window.setTimeout(tick, BGM.lookaheadMs);
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    play,
    stop,
    dispose(): void {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    },
  };
}
