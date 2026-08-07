/**
 * BGM의 악보 쪽 — 07 §4.1의 음악 이론과 §4.4의 구간별 성격. Web Audio를 한 줄도 안 만진다.
 *
 * `bgm.ts`에서 떼어 낸 이유는 한 파일 400줄 상한이고, 자른 자리는 실제 이음매다 —
 * 여기는 "무엇을 울릴까"(키·BPM·진행·층)이고 저기는 "어떻게 울릴까"(노드·엔벨로프·스케줄러)다.
 * 컨텍스트가 없어도 도는 순수 함수만 있어서 헤드리스에서도 그대로 읽을 수 있다.
 *
 * 이 파일도 `bgm.ts`와 함께 통째로 잘려 나간다 — BGM은 스펙이 직접 요구한 적 없는 유일한
 * 오디오 항목이고 잘라내기 1순위다(11 §11 · 07 §7.1).
 */

import { BGM } from '../config/audio';
import type { StageId } from '../config/ids';
import type { BgmStageDef } from '../config/types';

/** 07 §4.1 반음 간격 배열. 이것이 스케일의 전부다 */
const SCALES = {
  MAJOR: [0, 2, 4, 5, 7, 9, 11],
  MINOR: [0, 2, 3, 5, 7, 8, 10],
} as const satisfies Record<BgmStageDef['scale'], readonly number[]>;

const DEGREES_PER_OCTAVE = 7;
export const SEMITONES_PER_OCTAVE = 12;
/** 코드 = 스케일에서 1·3·5도를 쌓은 것. 도수는 0부터 센다 */
const CHORD_STEPS = [0, 2, 4] as const;
const A4_MIDI = 69;
const A4_HZ = 440;

export function chordTones(tonicMidi: number, scale: readonly number[], degree: number): number[] {
  return CHORD_STEPS.map((stepUp) => {
    const index = degree + stepUp;
    const semitone = scale[index % DEGREES_PER_OCTAVE] ?? 0;
    const octave = Math.floor(index / DEGREES_PER_OCTAVE);
    return tonicMidi + octave * SEMITONES_PER_OCTAVE + semitone;
  });
}

export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
}

export type PadMode = 'NONE' | 'SUSTAIN' | 'SWELL';

/** 한 구간이 동시에 내는 층. 07 §4.4 표의 「텍스처」 열을 코드가 읽을 수 있게 편 것이다 */
export type Voicing = {
  readonly pad: PadMode;
  /** 한 박에 들어가는 아르페지오 음 수. 0이면 아르페지오가 없다 */
  readonly arpPerBeat: number;
  readonly drum: boolean;
  /** 근음을 몇 옥타브 아래까지 겹치는가 */
  readonly subOctaves: number;
};

const VOICINGS = {
  // §4.4 S1 부산진. 비어 있는 텍스처가 조총이라는 미지의 무기다
  PAD: { pad: 'SUSTAIN', arpPerBeat: 0, drum: false, subOctaves: 0 },
  // §4.4 S2 동래성. 정박 드럼이 공성의 규칙성이다
  ARP8_DRUM: { pad: 'SUSTAIN', arpPerBeat: 2, drum: true, subOctaves: 0 },
  // §4.4 S3 한산도. 긴 음이 저속 대형 함포탄과 대응한다
  SWELL: { pad: 'SWELL', arpPerBeat: 0, drum: false, subOctaves: 0 },
  // §4.4 S4 행주산성. 빠른 아르페지오가 공간 관리의 압박이다
  ARP16_DRUM: { pad: 'SUSTAIN', arpPerBeat: 4, drum: true, subOctaves: 0 },
  // §4.4 S5 노량. "저음 2옥타브 겹침" — 근음을 −12와 −24에 함께 둔다
  ARP16_DRUM_SUB: { pad: 'SUSTAIN', arpPerBeat: 4, drum: true, subOctaves: 2 },
} as const satisfies Record<BgmStageDef['texture'], Voicing>;

/** §4.4 카드 선택은 아르페지오만이다 — 전투가 멈춘 화면이라 패드도 드럼도 두지 않는다 */
const CARD_VOICING: Voicing = { pad: 'NONE', arpPerBeat: 2, drum: false, subOctaves: 0 };

/**
 * 울릴 구간. 스테이지 번호를 인자로 받는 것이 audio/가 sim을 안 보는 방법이다(03 §5).
 *
 * cardSelect의 stageId는 **방금 클리어한** 스테이지다 — 그 키의 나란한 장조로 올라간다(§4.4).
 */
export type BgmSection =
  | { readonly kind: 'stage'; readonly stageId: StageId }
  | { readonly kind: 'boss'; readonly stageId: StageId }
  | { readonly kind: 'cardSelect'; readonly stageId: StageId };

/** 구간 하나가 정하는 것 전부. BGM.stages 한 줄과 §4.4의 보스·카드 변주가 여기서 합쳐진다 */
export type Plan = {
  readonly tonicMidi: number;
  readonly scale: readonly number[];
  readonly bpm: number;
  readonly progression: readonly number[];
  readonly voicing: Voicing;
  readonly lowpassHz: number;
};

/** 표에 없는 스테이지가 오면 첫 줄로 떨어진다. 음악이 게임을 멈추게 하지 않는다 */
function stageDef(stageId: StageId): BgmStageDef {
  const wanted = `S${stageId}`;
  return BGM.stages.find((stage) => stage.id === wanted) ?? BGM.stages[0];
}

/**
 * 키를 스테이지 → 보스 → 카드 선택으로 이어 가는 것이 §4.4의 핵심이다. 매번 키가 바뀌면
 * 무관한 루프 다섯 개로 들리고, 이어지면 한 곡의 악장으로 들린다.
 */
export function planFor(section: BgmSection): Plan {
  const stage = stageDef(section.stageId);
  if (section.kind === 'cardSelect') {
    return {
      tonicMidi: stage.tonicMidi + BGM.cardTonicOffset,
      scale: SCALES.MAJOR,
      bpm: BGM.cardBpm,
      progression: BGM.cardProgression,
      voicing: CARD_VOICING,
      lowpassHz: BGM.masterLowpassHz,
    };
  }
  const boss = section.kind === 'boss';
  return {
    // 보스도 키를 유지한다. 그것이 "같은 전장의 절정"이다
    tonicMidi: stage.tonicMidi,
    scale: SCALES[stage.scale],
    bpm: stage.bpm + (boss ? BGM.bossBpmDelta : 0),
    progression: boss ? BGM.bossProgression : stage.progression,
    voicing: VOICINGS[stage.texture],
    lowpassHz: boss ? BGM.bossLowpassHz : BGM.masterLowpassHz,
  };
}
