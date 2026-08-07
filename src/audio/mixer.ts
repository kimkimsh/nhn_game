/**
 * master / sfx / music 게인과 음소거 — 07 §6.1.
 *
 * `setMuted`가 screens/manager.ts가 audio/에서 부르는 유일한 함수다(screens/registry.ts의
 * `loadMuteSetter`). 상태의 소유자는 이쪽이고 매니저는 자기 HUD 표시용 사본만 갖는다.
 *
 * ── 음소거는 출력 단 하나만 바꾼다 ────────────────────────────────────────────
 *
 * 음소거 중에도 소리는 **정상적으로 노드를 만들고 재생한다.** master가 0이라 안 들릴 뿐이다.
 * 트리거 자체를 막으면 음소거 코드 경로가 무음 전용 경로가 되어, 07 §1.2가 요구하는
 * 소리·그림 1:1 페어링이 음소거일 때만 다르게 돈다 — 그 순간 무음 플레이스루(§6.3)가
 * 검사하는 대상이 실제 게임이 아니게 된다.
 *
 * `ctx.suspend()`를 쓰지 않는 이유도 같은 급이다. 컨텍스트를 세우면 BGM 스케줄러의
 * `currentTime` 기준이 멈춰서, 해제하는 순간 밀린 노트가 한꺼번에 쏟아진다.
 *
 * ── 이 파일이 audio/의 시동을 건다 ────────────────────────────────────────────
 *
 * 아래 마지막 줄이 첫 제스처 리스너를 건다. screens/가 audio/에서 잡는 것이 `setMuted`
 * 하나뿐이라(registry.ts) 이 모듈이 로드되는 것 말고는 audio/에 시동을 걸 경로가 없고,
 * M만 기다리면 M을 안 누르는 플레이어에게 게임 전체가 무음으로 끝난다(07 §1.3).
 */

import { AUDIO } from '../config/audio';
import { audioCtx, installFirstGestureResume, masterBus } from './context';
import { warmNoiseCache } from './voices';

/**
 * 음소거 전환 램프 (s) — 07 §6.1.
 *
 * 즉시 대입하면 파형이 중간에서 끊기며 딱 소리가 난다. config/audio.ts에 자리가 없는 값이라
 * 여기 있다(그 파일 머리말 ③과 같은 이유).
 */
const MUTE_RAMP_SEC = 0.02;

let muted = false;

/** HUD가 아니라 audio/ 안에서 쓰는 판이다. §15.1의 표시는 매니저가 자기 사본으로 그린다 */
export function isMuted(): boolean {
  return muted;
}

/**
 * §16.1 M. 전환은 언제든 가능하다.
 *
 * 첫 제스처 전에는 컨텍스트가 없어 아무것도 안 하고 판만 바꾼다 — 그 판은 컨텍스트가
 * 깨어나는 순간 `applyMasterGain`이 그대로 반영한다. M 자체가 그 첫 제스처인 경우가
 * 실제로 있으므로(07 §1.3) 이 순서가 필요하다.
 */
export function setMuted(next: boolean): void {
  muted = next;
  applyMasterGain(MUTE_RAMP_SEC);
}

function applyMasterGain(rampSec: number): void {
  const ctx = audioCtx();
  const master = masterBus();
  if (ctx === null || master === null) {
    return;
  }
  const now = ctx.currentTime;
  // 진행 중인 램프가 남아 있으면 새 목표가 그 뒤에 줄을 선다. 연타하면 소리가 계단으로 돌아온다
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(muted ? 0 : AUDIO.mixer.masterGain, now + rampSec);
}

/**
 * 컨텍스트가 깨어난 직후 한 번.
 *
 * 노이즈 버퍼를 여기서 굽는다 — 첫 발화 프레임에 굽으면 그 프레임이 밀리고, 밀린 프레임은
 * 패리 하나를 실패시킨다(07 §2.7). 램프 길이가 0인 것은 이 시점에 들려줄 이전 값이 없어서다.
 */
function onAudioStarted(): void {
  warmNoiseCache();
  applyMasterGain(0);
}

installFirstGestureResume(onAudioStarted);
