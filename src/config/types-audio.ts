/**
 * 신스 패치 테이블의 타입 — 스펙 §16 · §17, 07_오디오_설계.md §5
 *
 * 주파수는 전부 Hz, 시간은 전부 초다. 게인은 0~1 선형이고 sfxGain 버스를 거친 뒤의 값이다.
 * 이 표의 값을 바꾸면 소리만 바뀌고 게임 규칙은 하나도 안 바뀐다 — 예외는
 * cooldown.suppressAfterParrySec 하나인데 그것도 규칙이 아니라 피로도다.
 *
 * 배럴은 ./types이며 config/의 다른 파일은 이 파일을 직접 import하지 않는다.
 */
import type { ParryGradeId } from './ids';

/** OscillatorNode.type이 받는 값 중 이 게임이 쓰는 넷 */
export type OscWave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** 음정 하나. fromHz → toHz로 durSec 동안 미끄러진다 */
export type ToneDef = {
  readonly wave: OscWave;
  readonly fromHz: number;
  readonly toHz: number;
  readonly gain: number;
  readonly durSec: number;
  /** 패치 시작으로부터의 지연 (s) */
  readonly delaySec: number;
};

/**
 * §5.3 등급 하나의 패리 패치
 *
 * 세 등급의 tones 배열 모양이 서로 다른 것이 구분의 핵심이다 — NOT BAD는 빈 배열이고,
 * 음정이 없다는 사실 자체가 그 등급의 정체다(07 §3.1).
 */
export type ParryVoiceDef = {
  readonly bandHz: number;
  readonly bandQ: number;
  readonly gain: number;
  readonly tailSec: number;
  readonly tones: readonly ToneDef[];
};

/**
 * §4.2 피격 원인 하나
 *
 * 적 탄환과 반사탄이 갈리는 것이 §12.3의 "반사탄 자해로 잃은 라이프 수"와 §14.3 T-06의
 * 전제다. clangHeadHz가 0이 아닌 쪽이 반사탄 — 내 칼 소리가 앞에 붙는다(07 §3.7).
 */
export type HitVoiceDef = {
  readonly fromHz: number;
  readonly toHz: number;
  readonly sweepSec: number;
  readonly gain: number;
  readonly bodySec: number;
  readonly bodyHz: number;
  readonly bodyGain: number;
  readonly clangHeadHz: number;
  readonly clangHeadGain: number;
};

/**
 * §17 사건별 신스 패치 전체
 *
 * warn의 키가 ids.ts의 TelegraphId와 다른 표기인 것은 07 §5의 표기를 그대로 옮겼기 때문이다.
 * 두 곳이 같은 세 도형을 가리키므로 하나를 늘리면 다른 하나도 늘려야 한다.
 */
export type AudioConfig = {
  readonly mixer: {
    /** 음소거는 이 버스를 0으로 만든다(§16.1 M) */
    readonly masterGain: number;
    readonly sfxGain: number;
    /** 효과음보다 확실히 아래에 둔다 — §17은 SFX만 필수다 */
    readonly musicGain: number;
    /** 트리거마다 곱하는 피치 랜덤 폭 */
    readonly pitchJitter: number;
    /** 동시 활성 보이스 상한. 초과 시 가장 오래된 것을 stop() */
    readonly maxVoices: number;
    /** 같은 이벤트 병합 창 (s). 연쇄 처치는 예외다(07 §3.6) */
    readonly mergeWindowSec: number;
    readonly mergeGainStep: number;
  };
  /** §5.3 등급 밴드와 1:1 대응 */
  readonly parry: {
    /** 금속 코어 노이즈 버퍼 길이 (s) */
    readonly clangSec: number;
    readonly clangDecay: number;
  } & { readonly [K in ParryGradeId]: ParryVoiceDef };
  /**
   * §5.4 빈 패리. bandHz가 없고 lowpass만 있는 것이 요점이다 —
   * 금속 대역의 부재 = 접촉 없음 = 무적 없음
   */
  readonly whiff: {
    readonly noiseSec: number;
    readonly lowpassHz: number;
    readonly lowpassQ: number;
    readonly gain: number;
    readonly toneFromHz: number;
    readonly toneToHz: number;
    readonly toneSec: number;
    readonly toneGain: number;
  };
  /** §7.4 재패리. 등급 패치를 그대로 쓰고 앞뒤에만 덧붙인다 */
  readonly reparry: {
    readonly preClickHz: number;
    readonly preClickQ: number;
    readonly preClickGain: number;
    readonly preClickLeadSec: number;
    /** 등급이 오른 경우에만 울린다(07 §3.3) */
    readonly upgradeArpHz: readonly number[];
    readonly upgradeNoteSec: number;
    readonly upgradeGain: number;
  };
  /** §7.1 반사탄 발생. 독립 소리가 아니라 패리 패치에 얹는 레이어다 */
  readonly reflectLaunch: {
    readonly fromHz: number;
    readonly toHz: number;
    readonly durSec: number;
    /** 금속 코어 몸통 대역을 비켜 간다 */
    readonly highpassHz: number;
    /** 실제 게인 = 이 값 × (등급 반사 속도 배수 / NOT BAD 배수) */
    readonly gainAtNotBad: number;
  };
  /** §8 잡몹 처치 */
  readonly kill: {
    readonly noiseSec: number;
    readonly noiseDecay: number;
    /** 이 값 하나가 처치음의 성격을 정한다. 작은 변화가 성격을 통째로 바꾼다 */
    readonly cutoffFromHz: number;
    readonly cutoffToHz: number;
    readonly cutoffSweepSec: number;
    /** 패리 GREAT보다 낮다. 처치는 결과이고 패리가 원인이다 */
    readonly gain: number;
    readonly subFromHz: number;
    readonly subToHz: number;
    readonly subSec: number;
    readonly subGain: number;
  };
  /** D-09 머니샷. 링크 간격은 여기 없다 — render가 정하고 오디오는 이벤트마다 울린다(07 §3.6) */
  readonly chain: {
    readonly confirmDelaySec: number;
    /** 링크 n의 음정 = baseHz × stepRatio^n */
    readonly baseHz: number;
    readonly stepRatio: number;
    /** n이 이보다 크면 음정을 고정한다 */
    readonly pitchCapIndex: number;
    readonly gain: number;
    readonly gainFalloff: number;
    readonly gainFloor: number;
    readonly confirmMinLinks: number;
    readonly confirmArpHz: readonly number[];
    readonly confirmNoteSec: number;
    readonly confirmGain: number;
  };
  /** §4.2 피격 */
  readonly hit: {
    readonly bodyDecay: number;
    readonly ENEMY: HitVoiceDef;
    readonly REFLECT: HitVoiceDef;
  };
  /** §5.1 쿨다운 종료. sim 초당 최대 4.16회 나므로 이 표의 모든 값이 피로도 대책이다 */
  readonly cooldown: {
    readonly toneHz: number;
    readonly durSec: number;
    readonly attackSec: number;
    readonly gain: number;
    readonly highpassHz: number;
    /** 유일하게 랜덤을 끈다. 이 소리는 메트로놈이어야 배경으로 내려간다(07 §3.8) */
    readonly pitchJitter: number;
    /** 직전 이 시간 안에 패리 성공음이 났으면 내지 않는다 */
    readonly suppressAfterParrySec: number;
  };
  /** §6.2 발사 예비동작. 길이는 고정이 아니라 스테이지·공격별 예비동작 시간을 그대로 받는다 */
  readonly windup: {
    readonly fromHz: number;
    readonly toHz: number;
    readonly gain: number;
    readonly lowpassHz: number;
    /** 마지막 구간의 블립. 발사 시점을 예측 가능하게 만든다 */
    readonly blipHz: number;
    readonly blipSec: number;
    readonly blipGain: number;
    /** 잡몹 20기가 동시에 예비동작에 들어갈 수 있다(§3.2). 이 수를 넘으면 무음 */
    readonly maxConcurrent: number;
  };
  /** §6.2 예고 표시 3종. 전부 sawtooth 전용이고 엔벨로프로만 구분한다(07 §3.10) */
  readonly warn: {
    readonly IMPACT_CIRCLE: {
      readonly hz: number;
      readonly pulseSec: number;
      readonly pulseGapSec: number;
      readonly pulses: number;
      readonly gain: number;
      readonly lowpassHz: number;
    };
    readonly PIERCE_LINE: {
      readonly fromHz: number;
      readonly toHz: number;
      readonly durSec: number;
      readonly gain: number;
      readonly bandHz: number;
      readonly bandQ: number;
    };
    readonly CHARGE_LINE: {
      readonly fromHz: number;
      readonly toHz: number;
      readonly durSec: number;
      readonly gainFrom: number;
      readonly gainTo: number;
      readonly lowpassHz: number;
    };
  };
  /** §4.3 장판. 진입 순간 1회만. 안에 있는 동안의 지속음은 없다(07 §3.11) */
  readonly zoneEnter: {
    readonly noiseSec: number;
    readonly bandHz: number;
    readonly bandQ: number;
    readonly gain: number;
    readonly subHz: number;
    readonly subSec: number;
    readonly subGain: number;
  };
  /** §10.1 보스. 연출 길이 1.2초 / 2.0초가 소리 길이의 상한이다 */
  readonly boss: {
    readonly phase: {
      /** 하강 아르페지오. "패턴이 바뀐다"는 경고다 */
      readonly arpHz: readonly number[];
      readonly noteSec: number;
      readonly gain: number;
      readonly swellFromHz: number;
      readonly swellToHz: number;
      readonly swellSec: number;
      readonly swellGain: number;
    };
    readonly defeat: {
      readonly noiseSec: number;
      readonly cutoffFromHz: number;
      readonly cutoffToHz: number;
      readonly cutoffSweepSec: number;
      readonly gain: number;
      readonly subFromHz: number;
      readonly subToHz: number;
      readonly subSec: number;
      readonly subGain: number;
      readonly fanfareDelaySec: number;
      readonly fanfareHz: readonly number[];
      /** 짧으면 획득음으로 들린다. 격파는 획득이 아니다 */
      readonly fanfareNoteSec: number;
      readonly fanfareGain: number;
    };
  };
  /** §16.2 카드 선택 화면. 전투가 멈춘 화면이라 서로만 안 헷갈리면 된다 */
  readonly ui: {
    readonly move: {
      readonly noiseSec: number;
      readonly bandBaseHz: number;
      readonly bandSpreadHz: number;
      readonly bandQ: number;
      readonly gain: number;
    };
    readonly reroll: {
      readonly fromHz: number;
      readonly toHz: number;
      readonly durSec: number;
      readonly gain: number;
    };
    readonly confirm: {
      readonly arpHz: readonly number[];
      readonly noteSec: number;
      readonly gain: number;
    };
  };
  /**
   * §12.2 콤보
   *
   * warnLeadSec은 여기 없다. scoring.ts의 COMBO_WARN_SEC이 단일 소스이고(12 §8-5),
   * config/ 계층은 서로를 import할 수 없으므로 여기 적으면 리터럴 중복이 된다.
   * audio/sfx.ts가 config/scoring.ts에서 직접 읽는다.
   */
  readonly combo: {
    /** 실제 음정 = baseHz + combo × perComboHz */
    readonly baseHz: number;
    readonly perComboHz: number;
    /** 이 위로는 음정을 고정하고 완전 5도 위 오실레이터로 두께만 더한다 */
    readonly capCombo: number;
    readonly stepSec: number;
    readonly stepGain: number;
    readonly warnHz: number;
    readonly warnNoteSec: number;
    readonly warnGapSec: number;
    /** 커지는 반복은 게임 전체에서 이것 하나뿐이다 */
    readonly warnGains: readonly number[];
  };
  /** §4.2 피격 무적 종료. 패리 무적에는 소리를 붙이지 않는다(07 §3.15) */
  readonly invulnEnd: {
    readonly hz: number;
    readonly durSec: number;
    readonly gain: number;
  };
};

/** §9.2 스테이지별 음악 성격 한 줄 */
export type BgmStageDef = {
  readonly id: string;
  readonly tonicMidi: number;
  readonly scale: 'MINOR' | 'MAJOR';
  readonly bpm: number;
  /** 스케일 도수 인덱스의 순환 */
  readonly progression: readonly number[];
  readonly texture: 'PAD' | 'ARP8_DRUM' | 'SWELL' | 'ARP16_DRUM' | 'ARP16_DRUM_SUB';
};

/**
 * 절차적 BGM — 07_오디오_설계.md §4
 *
 * 스코프 최하위다. 이 타입이 덮는 표를 통째로 지워도 AudioConfig 쪽은 그대로 돈다(07 §7).
 * lookaheadMs가 이 프로젝트에서 밀리초를 쓰는 유일한 값인데, 게임 시간 파라미터가 아니라
 * setTimeout에 넘기는 "언제 다시 볼지"라서 HR-06의 대상이 아니다(07 §4.3).
 */
export type BgmConfig = {
  readonly scheduleAheadSec: number;
  readonly lookaheadMs: number;
  readonly attackSec: number;
  /** 짧은 linear 릴리스. 지수 램프를 쓰면 음이 안 꺼진다(07 §4.2) */
  readonly releaseSec: number;
  /** 실제 보이스 게인 = chordGain / tones.length */
  readonly chordGain: number;
  readonly masterLowpassHz: number;
  readonly beatsPerChord: number;
  readonly stages: readonly BgmStageDef[];
  /** 스테이지 BPM에 더한다. 키는 유지 — 같은 전장의 절정이라는 뜻이다 */
  readonly bossBpmDelta: number;
  readonly bossProgression: readonly number[];
  readonly bossLowpassHz: number;
  /** 나란한 장조. 전투가 멈춘 유일한 화면이라 장조를 쓴다 */
  readonly cardTonicOffset: number;
  readonly cardBpm: number;
  readonly cardProgression: readonly number[];
};
