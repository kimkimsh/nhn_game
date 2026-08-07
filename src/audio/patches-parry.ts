/**
 * 07 §3.1~§3.7 — 칼이 낸 사건의 소리.
 *
 * 패리 3등급 · 빈 패리 · 재패리 · 반사탄 발생 · 적 처치 · 다수 동시 처치 · 플레이어 피격.
 * 07 §7.2의 티어 A와 B가 여기 다 들어 있다 — 여기까지만 있어도 플레이어가 하는 일과 그
 * 결과가 전부 소리를 갖는다.
 *
 * 층은 `patch-kit.ts`가 만들고, 어느 사건에 어느 패치를 붙일지는 `sfx.ts`가 정한다.
 */

import { AUDIO } from '../config/audio';
import type { ParryGradeId } from '../config/ids';
import { PARRY_BANDS } from '../config/parry';
import { filterNode, jitter } from './synth';
import type { MergeAnchor, PatchSite } from './patch-kit';
import {
  BODY_ATTACK_SEC,
  CLICK_ATTACK_SEC,
  FLAT_Q,
  arpeggio,
  blast,
  noiseLayer,
  selfDecayFor,
  toneLayer,
} from './patch-kit';

/** 금속 헤드의 꼬리 (s)와 bandpass Q (무단위). 07 §3.7 발췌 코드 */
const CLANG_HEAD_TAIL_SEC = 0.05;
const CLANG_HEAD_Q = 3;
/** 재패리 선행 클릭의 꼬리 (s). 07 §3.3의 12ms — preClickLeadSec 0.03초 안에서 끝난다 */
const REPARRY_CLICK_TAIL_SEC = 0.012;

/**
 * 패리 성공음 (§5.3 · §17).
 *
 * 세 등급은 네 축을 동시에 움직여 구분하지만, 정체를 결정하는 것은 음정 방향 하나다 —
 * NOT BAD는 음정이 없고, GOOD은 내려가고, GREAT는 올라간다. 대역·길이·게인만으로 나누면
 * 노트북 스피커에서 셋이 같은 "탁"으로 뭉친다. 그래서 `tones`가 빈 배열인 것이 NOT BAD의
 * 정체이고, 아래 반복문이 등급마다 도는 횟수가 곧 §17의 "명확히 다른"이다.
 *
 * 금속 코어(8ms 노이즈 → bandpass)는 셋이 공유한다. 같은 행위라는 사실이 그것으로 전달된다.
 */
export function parryPatch(site: PatchSite, grade: ParryGradeId): MergeAnchor | null {
  const patch = AUDIO.parry[grade];
  const anchor = noiseLayer(site, {
    durSec: AUDIO.parry.clangSec,
    decay: AUDIO.parry.clangDecay,
    filter: filterNode(site.ctx, 'bandpass', jitter(patch.bandHz, site.rng), patch.bandQ),
    peak: patch.gain,
    attackSec: CLICK_ATTACK_SEC,
    tailSec: patch.tailSec,
    atSec: site.atSec,
  });
  for (const layer of patch.tones) {
    toneLayer(site, {
      wave: layer.wave,
      fromHz: jitter(layer.fromHz, site.rng),
      toHz: jitter(layer.toHz, site.rng),
      gain: layer.gain,
      durSec: layer.durSec,
      atSec: site.atSec + layer.delaySec,
      filter: null,
    });
  }
  return anchor;
}

/** 패리 패치 한 벌의 길이 (s). 재패리가 상승 아르페지오를 그 뒤에 잇는다 (§3.3) */
export function parryPatchSec(grade: ParryGradeId): number {
  return AUDIO.parry.clangSec + AUDIO.parry[grade].tailSec;
}

/**
 * 빈 패리 (§5.4 · §17).
 *
 * 금속 대역(3.5~5.5kHz)의 부재가 곧 접촉의 부재이고, 접촉의 부재가 곧 무적의 부재다.
 * lowpass 900이 그 대역을 통째로 비운다 — 임의로 다른 소리를 배정한 게 아니라 물리적
 * 인과를 그대로 옮긴 것이라, 플레이어가 이 규칙을 따로 배우지 않아도 된다.
 */
export function whiffPatch(site: PatchSite): MergeAnchor | null {
  const whiff = AUDIO.whiff;
  const anchor = noiseLayer(site, {
    durSec: whiff.noiseSec,
    decay: selfDecayFor(site.ctx, whiff.noiseSec),
    filter: filterNode(site.ctx, 'lowpass', whiff.lowpassHz, whiff.lowpassQ),
    peak: whiff.gain,
    attackSec: BODY_ATTACK_SEC,
    tailSec: whiff.noiseSec,
    atSec: site.atSec,
  });
  toneLayer(site, {
    wave: 'triangle',
    fromHz: whiff.toneFromHz,
    toHz: whiff.toneToHz,
    gain: whiff.toneGain,
    durSec: whiff.toneSec,
    atSec: site.atSec,
    filter: null,
  });
  return anchor;
}

/** 재패리의 선행 클릭 (§7.4). 등급 패치보다 먼저 들어와 "두 번 때린 소리"를 만든다 */
export function reparryClick(site: PatchSite): MergeAnchor | null {
  const reparry = AUDIO.reparry;
  return noiseLayer(site, {
    durSec: AUDIO.parry.clangSec,
    decay: AUDIO.parry.clangDecay,
    filter: filterNode(site.ctx, 'bandpass', jitter(reparry.preClickHz, site.rng), reparry.preClickQ),
    peak: reparry.preClickGain,
    attackSec: CLICK_ATTACK_SEC,
    tailSec: REPARRY_CLICK_TAIL_SEC,
    atSec: site.atSec,
  });
}

/**
 * 등급이 오른 재패리에만 붙는 상승 2음 (§7.2 · §17).
 *
 * 등급이 같거나 내려간 재패리에는 붙이지 않는다. 붙이면 소리가 거짓말을 한다 —
 * §7.2의 계산상 NOT BAD로 다시 친 탄은 데미지가 오히려 내려간다.
 */
export function upgradeArp(site: PatchSite): void {
  const reparry = AUDIO.reparry;
  arpeggio(site, reparry.upgradeArpHz, 'triangle', reparry.upgradeNoteSec, reparry.upgradeGain, site.atSec);
}

/** 등급별 반사 속도 배수. 유일 소스는 config/parry.ts라 여기 옮겨 적지 않는다 (07 §3.4) */
function buildSpeedMuls(): Record<ParryGradeId, number> {
  const muls: Record<ParryGradeId, number> = { GREAT: 1, GOOD: 1, NOT_BAD: 1 };
  for (const band of PARRY_BANDS) {
    muls[band.id] = band.speedMul;
  }
  return muls;
}

const SPEED_MUL = buildSpeedMuls();

/**
 * 반사탄 발생 (§7.1). 패리 성립과 같은 프레임이라 독립 소리가 아니라 얹는 레이어다 —
 * 따로 세우면 두 소리가 서로를 가린다.
 *
 * 게인이 등급 속도 배수에 비례하므로 빠르게 나가는 반사탄이 더 크게 튄다.
 */
export function reflectLaunchPatch(site: PatchSite, grade: ParryGradeId): MergeAnchor | null {
  const launch = AUDIO.reflectLaunch;
  toneLayer(site, {
    wave: 'sawtooth',
    fromHz: jitter(launch.fromHz, site.rng),
    toHz: jitter(launch.toHz, site.rng),
    gain: launch.gainAtNotBad * (SPEED_MUL[grade] / SPEED_MUL.NOT_BAD),
    durSec: launch.durSec,
    atSec: site.atSec,
    filter: filterNode(site.ctx, 'highpass', launch.highpassHz, FLAT_Q),
  });
  return null;
}

/** 잡몹 처치 (§8). 연쇄의 첫 링크도 이것이다 — 첫 처치는 단발과 구분되지 않는다 */
export function killPatch(site: PatchSite): MergeAnchor | null {
  const kill = AUDIO.kill;
  return blast(site, {
    noiseSec: kill.noiseSec,
    decay: kill.noiseDecay,
    cutoffFromHz: kill.cutoffFromHz,
    cutoffToHz: kill.cutoffToHz,
    cutoffSweepSec: kill.cutoffSweepSec,
    gain: kill.gain,
    subFromHz: kill.subFromHz,
    subToHz: kill.subToHz,
    subSec: kill.subSec,
    subGain: kill.subGain,
  });
}

/**
 * 연쇄 처치 한 링크 (D-09 · §17 "다수 동시 처치").
 *
 * **음정 상승이 이 함수의 존재 이유다.** 같은 소리를 여덟 번 내면 반복이지 연쇄가 아니다.
 * 음정이 오르면 "끝나지 않았다"가 매 링크에 실린다.
 *
 * 처치 패치의 저역 톤(130 → 60Hz 고정)을 링크 음정 `baseHz × stepRatio^n`으로 갈아 끼운다.
 * 두 톤을 같이 내면 링크마다 저역이 둘씩 쌓여 20링크에서 저역이 먼저 뭉개진다.
 * `pitchCapIndex` 위로는 음정을 고정하고 대신 게인을 링크마다 떨어뜨린다.
 *
 * `linkIndex`는 반사탄이 아니라 **패리 이벤트 하나**가 낸 처치의 번호다 (12 §6) —
 * 반사탄 단위로 세면 분열탄에서 길이 1짜리 연쇄가 N개 나고 상승이 한 번도 안 들린다.
 */
export function chainLinkPatch(site: PatchSite, linkIndex: number): MergeAnchor | null {
  const kill = AUDIO.kill;
  const chain = AUDIO.chain;
  const stepped = Math.min(linkIndex, chain.pitchCapIndex);
  const toneHz = chain.baseHz * Math.pow(chain.stepRatio, stepped);
  const overCap = Math.max(0, linkIndex - chain.pitchCapIndex);
  const fade = Math.max(chain.gainFloor, chain.gain - chain.gainFalloff * overCap);
  return blast(site, {
    noiseSec: kill.noiseSec,
    decay: kill.noiseDecay,
    cutoffFromHz: kill.cutoffFromHz,
    cutoffToHz: kill.cutoffToHz,
    cutoffSweepSec: kill.cutoffSweepSec,
    gain: fade,
    subFromHz: toneHz,
    subToHz: toneHz,
    subSec: kill.subSec,
    subGain: kill.subGain,
  });
}

/** 연쇄가 끝난 뒤의 확인 아르페지오 (§17). 상승이 "정리됐다"다 */
export function chainConfirmArp(site: PatchSite): MergeAnchor | null {
  const chain = AUDIO.chain;
  arpeggio(site, chain.confirmArpHz, 'triangle', chain.confirmNoteSec, chain.confirmGain, site.atSec);
  return null;
}

/**
 * 피격음 (§4.2 · §17).
 *
 * 원인 구분은 §12.3의 "반사탄 자해로 잃은 라이프 수"와 §14.3 T-06 실측의 전제다 —
 * 플레이어가 원인을 그 자리에서 알아야 그 통계가 의미를 갖는다. 자해음이 금속 클랭으로
 * 시작하는 것은 임의의 차이가 아니라 원인 그 자체다. 그 반사탄을 만든 것이 자신의 패리이므로
 * 소리도 패리음에서 출발해 피격음으로 떨어진다.
 */
export function hitPatch(site: PatchSite, cause: 'ENEMY' | 'REFLECT'): MergeAnchor | null {
  const patch = AUDIO.hit[cause];
  if (patch.clangHeadGain > 0) {
    noiseLayer(site, {
      durSec: AUDIO.parry.clangSec,
      decay: AUDIO.parry.clangDecay,
      filter: filterNode(site.ctx, 'bandpass', jitter(patch.clangHeadHz, site.rng), CLANG_HEAD_Q),
      peak: patch.clangHeadGain,
      attackSec: CLICK_ATTACK_SEC,
      tailSec: CLANG_HEAD_TAIL_SEC,
      atSec: site.atSec,
    });
  }
  toneLayer(site, {
    wave: 'sawtooth',
    fromHz: jitter(patch.fromHz, site.rng),
    toHz: jitter(patch.toHz, site.rng),
    gain: patch.gain,
    durSec: patch.sweepSec,
    atSec: site.atSec,
    filter: null,
  });
  return noiseLayer(site, {
    durSec: patch.bodySec,
    decay: AUDIO.hit.bodyDecay,
    filter: filterNode(site.ctx, 'lowpass', patch.bodyHz, FLAT_Q),
    peak: patch.bodyGain,
    attackSec: BODY_ATTACK_SEC,
    tailSec: patch.bodySec,
    atSec: site.atSec,
  });
}
