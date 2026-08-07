/**
 * 07 §3.8~§3.15 — 칼 밖에서 일어난 사건의 소리.
 *
 * 쿨다운 종료 · 발사 예비동작 · 예고 3종 · 장판 진입 · 보스 전환과 격파 · 카드 화면 3종 ·
 * 콤보 · 무적 종료. 07 §7.2의 티어 C와 D이고, 자를 때는 이 파일이 먼저다.
 *
 * 층은 `patch-kit.ts`가 만들고, 어느 사건에 어느 패치를 붙일지는 `sfx.ts`가 정한다.
 */

import { AUDIO } from '../config/audio';
import { COMBO_WARN_SEC } from '../config/scoring';
import type { OscWave } from '../config/types';
import { filterNode, glideOsc, jitter, jitterBy, sweepCutoff } from './synth';
import type { MergeAnchor, PatchSite } from './patch-kit';
import {
  BODY_ATTACK_SEC,
  CLICK_ATTACK_SEC,
  FLAT_Q,
  NOISE_TAIL_SEC,
  arpeggio,
  blast,
  noiseLayer,
  selfDecayFor,
  toneLayer,
} from './patch-kit';
import { playVoice } from './voices';

/** 완전 5도 (배). 07 §3.14가 콤보 상한 위의 두께를 이 음정으로 정의한다 */
const PERFECT_FIFTH_RATIO = 1.5;
/** 07 §3.12 페이즈 전환의 "triangle+square 3음". 음 게인을 이 수로 나눠 합이 config 값이 된다 */
const PHASE_WAVES: readonly OscWave[] = ['triangle', 'square'];

/**
 * 쿨다운 종료 틱 (§5.1 · §17).
 *
 * 이 소리만 피치 랜덤을 끈다. 흔들리는 틱은 오류음으로 들리고, 일정한 틱은 메트로놈으로
 * 들려서 의식에서 배경으로 내려간다 — 배경으로 내려가는 것이 이 소리의 목표다.
 * `jitterBy`에 자기 폭을 넘기는 것은 그 예외가 `cooldown.pitchJitter: 0`이라는 값으로 남아
 * 있게 하기 위해서다. `jitter`를 부르면 mixer의 ±3%가 붙어 예외가 조용히 사라진다.
 */
export function cooldownTick(site: PatchSite): MergeAnchor | null {
  const cooldown = AUDIO.cooldown;
  const hz = jitterBy(cooldown.toneHz, site.rng, cooldown.pitchJitter);
  toneLayer(site, {
    wave: 'triangle',
    fromHz: hz,
    toHz: hz,
    gain: cooldown.gain,
    durSec: cooldown.durSec,
    atSec: site.atSec,
    filter: filterNode(site.ctx, 'highpass', cooldown.highpassHz, FLAT_Q),
  });
  return null;
}

/**
 * 적 발사 예비동작 (§6.2 · §17).
 *
 * 상승 자체가 신호다. 길이는 고정이 아니라 그 공격의 예비동작 시간을 그대로 받는다 —
 * 소리가 예비동작보다 짧으면 "곧"이 "언젠가"가 된다. 마지막 `blipSec`의 블립이 발사 시점을
 * 예측 가능하게 만든다.
 */
export function windupPatch(site: PatchSite, durationSec: number): MergeAnchor | null {
  const windup = AUDIO.windup;
  toneLayer(site, {
    wave: 'triangle',
    fromHz: jitter(windup.fromHz, site.rng),
    toHz: jitter(windup.toHz, site.rng),
    gain: windup.gain,
    durSec: durationSec,
    atSec: site.atSec,
    filter: filterNode(site.ctx, 'lowpass', windup.lowpassHz, FLAT_Q),
  });
  const blipHz = jitter(windup.blipHz, site.rng);
  toneLayer(site, {
    wave: 'square',
    fromHz: blipHz,
    toHz: blipHz,
    gain: windup.blipGain,
    durSec: windup.blipSec,
    atSec: site.atSec + Math.max(0, durationSec - windup.blipSec),
    filter: null,
  });
  return null;
}

/**
 * 착탄 예고 원 (§6.2). 펄스 셋이 원의 수축 리듬과 맞고, 마지막 펄스 뒤 `pulseGapSec`이 착탄이다.
 * `pulseGapSec`은 펄스 사이의 침묵이라 보폭은 `pulseSec + pulseGapSec`이고, 그래야 셋을 합한
 * 길이가 예고 1.2초와 맞는다.
 */
export function impactCirclePatch(site: PatchSite): MergeAnchor | null {
  const warn = AUDIO.warn.IMPACT_CIRCLE;
  const strideSec = warn.pulseSec + warn.pulseGapSec;
  for (let index = 0; index < warn.pulses; index += 1) {
    toneLayer(site, {
      wave: 'sawtooth',
      fromHz: warn.hz,
      toHz: warn.hz,
      gain: warn.gain,
      durSec: warn.pulseSec,
      atSec: site.atSec + strideSec * index,
      filter: filterNode(site.ctx, 'lowpass', warn.lowpassHz, FLAT_Q),
    });
  }
  return null;
}

/** 관통 예고선 (§6.2). 끊김 없는 위잉 소리가 "선이 계속 거기 있다"와 대응한다 */
export function pierceLinePatch(site: PatchSite): MergeAnchor | null {
  const warn = AUDIO.warn.PIERCE_LINE;
  toneLayer(site, {
    wave: 'sawtooth',
    fromHz: warn.fromHz,
    toHz: warn.toHz,
    gain: warn.gain,
    durSec: warn.durSec,
    atSec: site.atSec,
    filter: filterNode(site.ctx, 'bandpass', warn.bandHz, warn.bandQ),
  });
  return null;
}

/**
 * 돌진 방향선 (§6.2). 커지면서 낮아지는 것이 "다가온다"다.
 *
 * 게인이 올라가야 해서 `envelope`을 못 쓴다 — 그쪽은 peak를 찍고 떨어지는 모양뿐이라
 * 여기 쓰면 방향이 반대가 된다.
 */
export function chargeLinePatch(site: PatchSite): MergeAnchor | null {
  const warn = AUDIO.warn.CHARGE_LINE;
  const endAtSec = site.atSec + warn.durSec;
  const source = glideOsc(site.ctx, 'sawtooth', warn.fromHz, warn.toHz, site.atSec, warn.durSec);
  const gain = site.ctx.createGain();
  gain.gain.setValueAtTime(warn.gainFrom, site.atSec);
  gain.gain.exponentialRampToValueAtTime(warn.gainTo, endAtSec);
  gain.gain.exponentialRampToValueAtTime(warn.gainFrom, endAtSec + NOISE_TAIL_SEC);
  const lowpass = filterNode(site.ctx, 'lowpass', warn.lowpassHz, FLAT_Q);
  source.connect(lowpass).connect(gain).connect(site.dest);
  playVoice({
    category: site.category,
    source,
    nodes: [lowpass, gain],
    atSec: site.atSec,
    stopAtSec: endAtSec + NOISE_TAIL_SEC,
  });
  return null;
}

/**
 * 장판 진입 (§4.3). 진입 순간 1회뿐이다.
 *
 * 안에 있는 동안의 지속음은 없다 — 0.5초마다 오는 피해가 §4.2와 동일하게 처리되어 피격음이
 * 그대로 나고, 지속음을 더하면 P9 지속 4초 내내 다른 모든 소리를 덮는다 (07 §3.11).
 */
export function zoneEnterPatch(site: PatchSite): MergeAnchor | null {
  const zone = AUDIO.zoneEnter;
  const anchor = noiseLayer(site, {
    durSec: zone.noiseSec,
    decay: selfDecayFor(site.ctx, zone.noiseSec),
    filter: filterNode(site.ctx, 'bandpass', zone.bandHz, zone.bandQ),
    peak: zone.gain,
    attackSec: BODY_ATTACK_SEC,
    tailSec: zone.noiseSec,
    atSec: site.atSec,
  });
  toneLayer(site, {
    wave: 'triangle',
    fromHz: zone.subHz,
    toHz: zone.subHz,
    gain: zone.subGain,
    durSec: zone.subSec,
    atSec: site.atSec,
    filter: null,
  });
  return anchor;
}

/**
 * 보스 페이즈 전환 (§10.1 · §17). 하강 3음이 먼저 나고 스웰이 그 위로 차오른다.
 *
 * 전환은 하강, 격파는 상승이다 — 사전 경고와 결말이 방향으로 갈린다.
 * 스웰의 어택이 곧 스웰이다. 새 페이즈 시작 시점에 정점을 찍고 그 자리에서 끝난다.
 */
export function bossPhasePatch(site: PatchSite): MergeAnchor | null {
  const phase = AUDIO.boss.phase;
  for (const wave of PHASE_WAVES) {
    arpeggio(site, phase.arpHz, wave, phase.noteSec, phase.gain / PHASE_WAVES.length, site.atSec);
  }
  const lowpass = filterNode(site.ctx, 'lowpass', phase.swellFromHz, FLAT_Q);
  sweepCutoff(lowpass, phase.swellFromHz, phase.swellToHz, site.atSec, phase.swellSec);
  return noiseLayer(site, {
    durSec: phase.swellSec,
    decay: selfDecayFor(site.ctx, phase.swellSec),
    filter: lowpass,
    peak: phase.swellGain,
    attackSec: phase.swellSec,
    tailSec: NOISE_TAIL_SEC,
    atSec: site.atSec,
  });
}

/** 보스 격파 (§10.1). 처치 패치를 3배로 키운 폭발 뒤에 팡파르가 온다 */
export function bossDefeatPatch(site: PatchSite): MergeAnchor | null {
  const defeat = AUDIO.boss.defeat;
  const anchor = blast(site, {
    noiseSec: defeat.noiseSec,
    // §3.12가 이 폭발을 "처치 패치를 3배로 키운 것"으로 정의했으므로 감쇠도 그쪽 것을 쓴다
    decay: AUDIO.kill.noiseDecay,
    cutoffFromHz: defeat.cutoffFromHz,
    cutoffToHz: defeat.cutoffToHz,
    cutoffSweepSec: defeat.cutoffSweepSec,
    gain: defeat.gain,
    subFromHz: defeat.subFromHz,
    subToHz: defeat.subToHz,
    subSec: defeat.subSec,
    subGain: defeat.subGain,
  });
  arpeggio(
    site,
    defeat.fanfareHz,
    'triangle',
    defeat.fanfareNoteSec,
    defeat.fanfareGain,
    site.atSec + defeat.fanfareDelaySec,
  );
  return anchor;
}

/** 카드 커서 이동 (§16.2). 대역 중심의 랜덤이 연타해도 같은 소리가 안 나게 한다 */
export function uiMovePatch(site: PatchSite): MergeAnchor | null {
  const move = AUDIO.ui.move;
  const bandHz = move.bandBaseHz + site.rng.float() * move.bandSpreadHz;
  return noiseLayer(site, {
    durSec: move.noiseSec,
    // 8ms 클릭은 07 §3.1의 금속 코어와 같은 레시피라 감쇠도 같은 쌍을 쓴다 (07 §2.7의 캐시 적중)
    decay: AUDIO.parry.clangDecay,
    filter: filterNode(site.ctx, 'bandpass', bandHz, move.bandQ),
    peak: move.gain,
    attackSec: CLICK_ATTACK_SEC,
    tailSec: move.noiseSec,
    atSec: site.atSec,
  });
}

/** 리롤 (§16.2). 하나의 연속 글라이드 — "버리고 다시 뽑는다"는 상승이다 */
export function uiRerollPatch(site: PatchSite): MergeAnchor | null {
  const reroll = AUDIO.ui.reroll;
  toneLayer(site, {
    wave: 'sine',
    fromHz: reroll.fromHz,
    toHz: reroll.toHz,
    gain: reroll.gain,
    durSec: reroll.durSec,
    atSec: site.atSec,
    filter: null,
  });
  return null;
}

/** 선택 확정 (§16.2). 분리된 두 음이라 리롤의 글라이드와 방향이 같아도 안 섞인다 */
export function uiConfirmPatch(site: PatchSite): MergeAnchor | null {
  const confirm = AUDIO.ui.confirm;
  arpeggio(site, confirm.arpHz, 'triangle', confirm.noteSec, confirm.gain, site.atSec);
  return null;
}

/**
 * 콤보 상승 (§12.2). 패리 등급 패치 **아래에** 깔린다 — 등급이 사건이고 콤보는 카운터다.
 * 상한 위로는 음정을 고정하고 완전 5도 위 오실레이터로 두께만 더한다.
 */
export function comboStepPatch(site: PatchSite, combo: number): void {
  const layer = AUDIO.combo;
  const capped = Math.min(combo, layer.capCombo);
  const hz = layer.baseHz + capped * layer.perComboHz;
  toneLayer(site, {
    wave: 'triangle',
    fromHz: hz,
    toHz: hz,
    gain: layer.stepGain,
    durSec: layer.stepSec,
    atSec: site.atSec,
    filter: null,
  });
  if (combo > layer.capCombo) {
    toneLayer(site, {
      wave: 'triangle',
      fromHz: hz * PERFECT_FIFTH_RATIO,
      toHz: hz * PERFECT_FIFTH_RATIO,
      gain: layer.stepGain,
      durSec: layer.stepSec,
      atSec: site.atSec,
      filter: null,
    });
  }
}

/**
 * 콤보 끊김 경고 (§12.2 · §17). 커지는 반복은 게임 전체에서 이것 하나뿐이라 안 섞인다.
 *
 * 핍이 경고 구간을 넘어가면 이미 끊긴 콤보를 경고하는 소리가 된다. 구간의 유일 소스는
 * `config/scoring.ts`의 `COMBO_WARN_SEC`이고, `render/hud.ts`의 게이지 색이 같은 값을 읽는다
 * (12 §8-5).
 */
export function comboWarnPatch(site: PatchSite): MergeAnchor | null {
  const layer = AUDIO.combo;
  for (let index = 0; index < layer.warnGains.length; index += 1) {
    const gain = layer.warnGains[index];
    const offsetSec = layer.warnGapSec * index;
    if (gain === undefined || offsetSec + layer.warnNoteSec > COMBO_WARN_SEC) {
      continue;
    }
    toneLayer(site, {
      wave: 'sine',
      fromHz: layer.warnHz,
      toHz: layer.warnHz,
      gain,
      durSec: layer.warnNoteSec,
      atSec: site.atSec + offsetSec,
      filter: null,
    });
  }
  return null;
}

/** 피격 무적 종료 (§4.2 · §17). 패리 무적 0.14초에는 붙이지 않는다 (07 §3.15) */
export function invulnEndPatch(site: PatchSite): MergeAnchor | null {
  const end = AUDIO.invulnEnd;
  toneLayer(site, {
    wave: 'sine',
    fromHz: end.hz,
    toHz: end.hz,
    gain: end.gain,
    durSec: end.durSec,
    atSec: site.atSec,
    filter: null,
  });
  return null;
}
