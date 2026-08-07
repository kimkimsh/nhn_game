/**
 * §17 사건 → 소리 — 07_오디오_설계.md §3.
 *
 * 이 파일의 함수는 `sim/`도 `screens/`도 직접 부르지 않는다. `core/bus.ts`의 피드백 이벤트를
 * 구독해서만 발화한다(07 §1.2). 같은 이벤트를 `render/particles.ts`·`render/camera.ts`·
 * `render/impact.ts`가 함께 구독하므로 **소리만 있고 그림이 없는 사건은 이벤트 타입을 하나 더
 * 만들어야만 성립한다** — 실수로는 생기지 않는다. 소리는 정보의 강화이지 전달이 아니다(07 §1.1).
 *
 * 여기 있는 것은 정책뿐이다. 어느 사건에 어느 패치가 붙는지, 언제 안 붙는지, 상태를 들고 있어야
 * 하는 둘(쿨다운 억제 · 연쇄 큐)이 그것이다. 소리 자체는 `patches-parry.ts`(§3.1~§3.7)와
 * `patches-world.ts`(§3.8~§3.15)가 만들고, 동시 발성 상한·병합 창·예비동작 동시 상한은
 * `voices.ts`가 센다. 발화는 `fire` 하나를 지나고, 그 첫 줄이 `audioCtx()`·`sfxBus()`의 null을
 * 본다(07 §2.5 함정 6) — 타이틀 어트랙트가 실제 sim을 돌리므로(12 §1 C-03) 첫 제스처 전에도
 * 패리가 성립하고 이 파일이 실제로 불린다. 09 §6 E-01의 합격 기준이 "콘솔 경고 없음"이다.
 *
 * **소리를 주지 않는 사건 넷.** 07 §3.0의 표가 정본이고 아래 넷은 그 표에 행이 없다. 빠뜨린 게 아니라 config/audio.ts에 패치가
 * 없다는 뜻이라, 다른 패치를 빌려 쓰면 07 §5가 확정한 표 밖의 소리가 생긴다. 넷 다 §17이 시각으로
 * 요구한 항목이므로 소리의 부재가 정보의 부재가 아니다.
 *   reflectHit       반사탄이 적에 맞았지만 안 죽었다. 처치음이 "유효했다"를 이미 맡는다
 *   shieldBlocked    §7.3 방패병 정면. 아무 일도 안 일어났다는 것이 정보다
 *   bossPartBroken   §10.4 B3 포문 파괴
 *   bossChargeLand   보스 돌진 착지. 예고 방향선(§3.10)이 그 앞을 이미 맡는다
 */

import { AUDIO } from '../config/audio';
import { CHAIN_STAGGER_SEC } from '../config/feel';
import type { ParryGradeId } from '../config/ids';
import { PARRY, PARRY_BANDS } from '../config/parry';
import { REFLECT } from '../config/reflect';
import { bus } from '../core/bus';
import type { FeedbackEventKind, FeedbackEventOf, TelegraphShape, Unsubscribe } from '../core/bus';
import { audioCtx, audioRng, sfxBus } from './context';
import type { MergeAnchor, PatchSite } from './patch-kit';
import {
  chainConfirmArp,
  chainLinkPatch,
  hitPatch,
  killPatch,
  parryPatch,
  parryPatchSec,
  reflectLaunchPatch,
  reparryClick,
  upgradeArp,
  whiffPatch,
} from './patches-parry';
import {
  bossDefeatPatch,
  bossPhasePatch,
  chargeLinePatch,
  comboStepPatch,
  comboWarnPatch,
  cooldownTick,
  impactCirclePatch,
  invulnEndPatch,
  pierceLinePatch,
  uiConfirmPatch,
  uiMovePatch,
  uiRerollPatch,
  windupPatch,
  zoneEnterPatch,
} from './patches-world';
import type { VoiceCategory } from './voices';
import { beginMerged, registerMerged, tryHold } from './voices';

const MS_PER_SEC = 1000;

/** 07 §3.9의 예비동작 동시 상한이 세는 판의 이름. `voices.ts`의 `tryHold`가 이 키로 센다 */
const WINDUP_HOLD_KEY = 'windup';

/**
 * 동시에 살아 있을 수 있는 연쇄 큐 수. 반사탄이 수명 내내 날아가는 동안 쿨다운마다 새 패리가
 * 성립할 수 있어 그만큼의 연쇄가 시간상 겹친다. `render/particles.ts`가 같은 식으로 자기 큐 수를
 * 잡는다 — 두 곳이 다른 수를 쓰면 한쪽만 큐를 잃고 소리와 그림의 링크가 어긋난다.
 */
const CHAIN_SLOTS = Math.ceil(REFLECT.lifetimeSec / PARRY.cooldownSec) + 1;

/** 한 패리가 낳은 연쇄의 오디오 쪽 상태 */
interface ChainSlot {
  parrySeq: number;
  /** 다음 링크가 울릴 수 있는 가장 이른 시각 (s, `AudioContext` 시계) */
  nextPlayAtSec: number;
  /** 이 패리가 지금까지 낸 처치 수 */
  links: number;
  /** 연쇄가 끝났는지 보는 타이머. 0이면 없다 */
  idleTimerId: number;
}

/** 등급 순위. `PARRY_BANDS`는 좁은 밴드부터, 곧 강한 등급부터 나열되므로 첨자가 곧 순위다 */
function buildGradeRanks(): Record<ParryGradeId, number> {
  const ranks: Record<ParryGradeId, number> = { GREAT: 0, GOOD: 0, NOT_BAD: 0 };
  for (let index = 0; index < PARRY_BANDS.length; index += 1) {
    const band = PARRY_BANDS[index];
    if (band !== undefined) {
      ranks[band.id] = index;
    }
  }
  return ranks;
}

const GRADE_RANK = buildGradeRanks();

/** 07 §3.10의 예고 3종. `core/bus.ts`의 도형 이름과 `config/audio.ts`의 패치 이름을 잇는다 */
const TELEGRAPH_PATCH: Readonly<Record<TelegraphShape, (site: PatchSite) => MergeAnchor | null>> = {
  impactCircle: impactCirclePatch,
  pierceLine: pierceLinePatch,
  dash: chargeLinePatch,
};

let attached: Unsubscribe | null = null;

/** 쿨다운 억제(§3.8)가 재는 시각. 패리 성공음이 마지막으로 난 때다 */
let lastParryAtSec = -Infinity;
const chainSlots: ChainSlot[] = [];
let nextChainSlot = 0;

function nowSec(): number {
  const ctx = audioCtx();
  return ctx === null ? 0 : ctx.currentTime;
}

/**
 * 패치 하나를 낸다. 컨텍스트가 없거나 병합 창에 걸리면 노드를 하나도 안 만들고 돌아선다.
 *
 * `mergeKey`가 null인 것은 연쇄 처치와 예비동작뿐이다 — 연쇄는 시간축 자체가 정보라 병합하면
 * D-09가 무너지고(07 §2.6의 유일한 예외), 예비동작은 0.4~0.7초라 병합 창 0.03초로는 동시에
 * 울리는 것들을 하나도 못 만나 `tryHold`가 대신 센다.
 */
function fire(
  category: VoiceCategory,
  mergeKey: string | null,
  atSec: number,
  patch: (site: PatchSite) => MergeAnchor | null,
): void {
  const ctx = audioCtx();
  const dest = sfxBus();
  if (ctx === null || dest === null) {
    return;
  }
  if (mergeKey !== null && !beginMerged(mergeKey, atSec)) {
    return;
  }
  const anchor = patch({ ctx, dest, rng: audioRng(), atSec, category });
  if (mergeKey !== null && anchor !== null) {
    registerMerged(mergeKey, anchor.gain, anchor.peak);
  }
}

function findChainSlot(parrySeq: number): ChainSlot | null {
  for (const slot of chainSlots) {
    if (slot.parrySeq === parrySeq) {
      return slot;
    }
  }
  return null;
}

function clearIdleTimer(slot: ChainSlot): void {
  if (slot.idleTimerId !== 0) {
    window.clearTimeout(slot.idleTimerId);
    slot.idleTimerId = 0;
  }
}

/**
 * 연쇄가 끝났는지 다시 재운다.
 *
 * **버스가 연쇄의 길이를 싣지 않는다** — 명중이 시간에 흩어져 도착하므로 sim이 emit하는 시점에
 * 그 값을 모르기 때문이다(`core/bus.ts`). 그래서 07 §3.6의 `linkIndex === linkCount - 1`을 그대로
 * 쓸 수 없고 "마지막 링크"를 침묵으로 판정한다. 창이 링크음 자기 길이(`kill.noiseSec`)인 것은,
 * `confirmDelaySec`을 창으로 쓰면 06 §6.1이 예시로 든 자연 간격 0.071초가 매 링크를 "마지막"으로
 * 만들어 확인음이 연쇄 내내 반복되기 때문이다.
 *
 * 아르페지오는 `confirmDelaySec`을 앞세워 오디오 시계에 건다. `setTimeout`은 탭 상태에 따라
 * 밀리는데 그 오차가 착지 시각에 그대로 남으면 안 된다.
 */
function armChainConfirm(slot: ChainSlot, linkAtSec: number): void {
  clearIdleTimer(slot);
  if (slot.links < AUDIO.chain.confirmMinLinks) {
    return;
  }
  const waitSec = Math.max(0, linkAtSec - nowSec()) + AUDIO.kill.noiseSec;
  slot.idleTimerId = window.setTimeout(() => {
    slot.idleTimerId = 0;
    fire('chain', null, nowSec() + AUDIO.chain.confirmDelaySec, chainConfirmArp);
  }, waitSec * MS_PER_SEC);
}

/**
 * 패리 성공 (§5.3). 콤보 상승음(§3.14)이 같은 트리거에 깔린다 — 등급이 사건이고 콤보는 카운터라,
 * 카운터가 사건보다 크면 안 된다. 연쇄 큐도 여기서 연다.
 *
 * 첫 링크가 지연 없이 나가도록 `nextPlayAtSec`을 과거로 잡는 것은
 * `render/particles.ts`와 같다 — 스태거는 링크 사이의 규칙이지 패리와 첫 처치 사이의 규칙이 아니다.
 */
function onParry(event: FeedbackEventOf<'parry'>): void {
  const atSec = nowSec();
  lastParryAtSec = atSec;

  const slot = chainSlots[nextChainSlot];
  if (slot !== undefined) {
    clearIdleTimer(slot);
    slot.parrySeq = event.parrySeq;
    slot.nextPlayAtSec = atSec - CHAIN_STAGGER_SEC;
    slot.links = 0;
    nextChainSlot = (nextChainSlot + 1) % chainSlots.length;
  }

  fire('parry', `parry:${event.grade}`, atSec, (site) => {
    const anchor = parryPatch(site, event.grade);
    comboStepPatch(site, event.combo);
    return anchor;
  });
}

/**
 * 재패리 (§7.4). 선행 클릭 → 등급 패치 → (등급이 올랐을 때만) 상승 2음. 등급 패치를 여기서
 * 다시 내므로 쿨다운 억제(§3.8)의 기준 시각도 같이 민다 — 안 그러면 재패리 직후에 쿨다운 틱이
 * 그 위로 겹친다.
 */
function onReparry(event: FeedbackEventOf<'reparry'>): void {
  const atSec = nowSec();
  const gradeAtSec = atSec + AUDIO.reparry.preClickLeadSec;
  lastParryAtSec = gradeAtSec;
  fire('parry', `reparry:${event.grade}`, atSec, (site) => {
    const anchor = reparryClick(site);
    parryPatch({ ...site, atSec: gradeAtSec }, event.grade);
    if (GRADE_RANK[event.grade] < GRADE_RANK[event.prevGrade]) {
      upgradeArp({ ...site, atSec: gradeAtSec + parryPatchSec(event.grade) });
    }
    return anchor;
  });
}

/**
 * 반사탄 발생 (§7.1). 패리와 같은 프레임이라 독립 소리가 아니라 레이어다.
 *
 * 키를 등급으로 잡아 같은 등급의 여러 발이 병합 창 안에서 합쳐지게 한다. 07 §3.4는 이 레이어가
 * 패리 패치의 보이스에 얹히는 것을 전제로 병합을 면제했는데, 버스에서는 패리와 반사가 별개
 * 이벤트라 그 보이스를 건너 받을 수 없다 — 등급별 병합이 같은 결과를 낸다.
 */
function onReflectLaunched(event: FeedbackEventOf<'reflectLaunched'>): void {
  fire('parry', `reflect:${event.grade}`, nowSec(), (site) => reflectLaunchPatch(site, event.grade));
}

/**
 * 쿨다운 종료 (§5.1 · §17). §17이 소리에게만 맡긴 유일한 항목이다 —
 * 플레이어의 눈은 내려오는 탄에 있지 자기 발밑의 링에 있지 않다.
 *
 * 패리 성공 직후에는 내지 않는다. 성공한 플레이어는 쿨다운이 시작된 걸 이미 알고, 이 억제 하나가
 * 실제 발화 빈도를 절반 이하로 떨어뜨린다. 음소거 시에는 링 50u → 56u 확장(12 §8-1)이 대신한다.
 */
function onCooldownReady(): void {
  const atSec = nowSec();
  if (atSec - lastParryAtSec < AUDIO.cooldown.suppressAfterParrySec) {
    return;
  }
  fire('other', 'cooldown', atSec, cooldownTick);
}

/** 무적 종료 (§4.2). 패리 무적 0.14초에는 붙이지 않는다 — 패리마다 소리가 하나씩 더 붙는다 */
function onInvulnEnded(event: FeedbackEventOf<'invulnEnded'>): void {
  if (event.source === 'playerHit') {
    fire('other', 'invulnEnd', nowSec(), invulnEndPatch);
  }
}

/**
 * 잡몹 처치 (§8) 또는 연쇄 링크 (D-09).
 *
 * `render/particles.ts`와 같은 최소 간격으로 늦춘다. 소리가 간격을 안 갖는다는 07 §3.6의 규칙이
 * 막으려던 것은 **연쇄 전체를 미리 까는 것**이고 — 그러면 자연 간격이 넓은 연쇄에서 소리가
 * 그림보다 먼저 끝나고 히트스톱이 만드는 오차가 링크마다 누적된다 — 여기서 미루는 것은 이번
 * 링크 하나뿐이다. 같은 스텝에 도착한 처치를 전부 같은 시각에 내면 20기가 한 번의 "쾅"이 되고,
 * 그건 연쇄가 아니라 삭제다.
 *
 * 첫 처치(`chainIndex === 0`)에 §3.5의 처치 패치를 그대로 주는 것은 그 시점에 연쇄인지 단발인지
 * 알 수 없어서다. `render/particles.ts`가 파티클 수를 링크 2부터 올리는 것과 같은 판정이다(12 §7.4).
 */
function onEnemyKilled(event: FeedbackEventOf<'enemyKilled'>): void {
  const slot = findChainSlot(event.parrySeq);
  const earliestSec = nowSec();
  const atSec =
    slot === null ? earliestSec : Math.max(earliestSec, slot.nextPlayAtSec + CHAIN_STAGGER_SEC);
  const index = event.chainIndex;
  fire('chain', null, atSec, (site) => (index === 0 ? killPatch(site) : chainLinkPatch(site, index)));
  if (slot !== null) {
    slot.nextPlayAtSec = atSec;
    slot.links += 1;
    armChainConfirm(slot, atSec);
  }
}

/**
 * 피격 (§4.2 · §17). 원인이 반사탄인지가 §12.3 통계와 §14.3 T-06 실측의 전제다.
 * 장판 피해와 본체 충돌은 §4.3·§4.2가 "동일하게 처리"라고 정했으므로 적 탄환 쪽 패치를 쓴다.
 */
function onPlayerHit(event: FeedbackEventOf<'playerHit'>): void {
  const cause = event.cause === 'reflectedBullet' ? 'REFLECT' : 'ENEMY';
  fire('other', `hit:${cause}`, nowSec(), (site) => hitPatch(site, cause));
}

/**
 * 적 발사 예비동작 (§6.2). 잡몹 20기가 동시에 예비동작에 들어갈 수 있는데(§3.2)
 * 20개의 상승음은 소리가 아니라 소음이다. `tryHold`가 상한을 넘긴 다섯째부터 막는다 —
 * §15.1이 요구한 총구·시위 발광이 이미 충분 조건이라 소리가 빠져도 정보가 안 빠진다.
 */
function onEnemyWindup(event: FeedbackEventOf<'enemyWindup'>): void {
  const atSec = nowSec();
  if (tryHold(WINDUP_HOLD_KEY, AUDIO.windup.maxConcurrent, atSec, event.durationSec)) {
    fire('other', null, atSec, (site) => windupPatch(site, event.durationSec));
  }
}

/**
 * 예고 3종 (§6.2). 셋 다 sawtooth 전용이고 엔벨로프로만 구분한다 —
 * 버즈 음색이 들리면 패리로 지울 수 없는 공격이라는 규칙을 소리 쪽에도 인코딩한 것이다(HR-04).
 */
function onTelegraph(event: FeedbackEventOf<'telegraph'>): void {
  fire('other', `telegraph:${event.shape}`, nowSec(), TELEGRAPH_PATCH[event.shape]);
}

/**
 * 페이로드를 안 읽는 사건들. 왼쪽부터 버스 kind · 병합 키 · 패치다.
 *
 * 전부 'other'이고 전부 병합 대상이다 — 상태를 안 들고 인자를 안 받는다는 것이 이 표에 있을
 * 조건이고, 그 조건에서 벗어나는 순간 위의 이름 붙은 핸들러로 나간다.
 */
const SIMPLE_EVENTS: readonly (readonly [
  FeedbackEventKind,
  string,
  (site: PatchSite) => MergeAnchor | null,
])[] = [
  // §5.4 빈 패리. 무적이 안 붙었다는 사실이 이 신호의 전부다
  ['parryWhiff', 'whiff', whiffPatch],
  // §4.3 장판 진입 1회. 안에 있는 동안은 아무 소리도 없다 (07 §3.11)
  ['zoneEntered', 'zoneEnter', zoneEnterPatch],
  // §10.1 페이즈 전환. §17이 "사전에 알린다"고 요구한 항목이다
  ['bossPhase', 'bossPhase', bossPhasePatch],
  ['bossDefeated', 'bossDefeat', bossDefeatPatch],
  // §12.2 콤보 끊김. 핍 3회 한 벌이 이 이벤트 하나에 대응한다
  ['comboWarn', 'comboWarn', comboWarnPatch],
  ['uiCursorMove', 'uiMove', uiMovePatch],
  // §16.2 리롤 잔여가 0이면 card-select.ts가 이벤트를 안 낸다 — 무음이 곧 "접수되지 않았다"다
  ['uiReroll', 'uiReroll', uiRerollPatch],
  ['uiConfirm', 'uiConfirm', uiConfirmPatch],
];

function resetState(): void {
  lastParryAtSec = -Infinity;
  for (const slot of chainSlots) {
    clearIdleTimer(slot);
  }
  chainSlots.length = 0;
  for (let index = 0; index < CHAIN_SLOTS; index += 1) {
    chainSlots.push({ parrySeq: -1, nextPlayAtSec: 0, links: 0, idleTimerId: 0 });
  }
  nextChainSlot = 0;
}

/**
 * 버스에 붙는다. 부르는 자리는 하나뿐이어야 한다 — 두 번 붙으면 사건마다 소리가 둘씩 난다.
 *
 * 첫 제스처 전에 불러도 된다. 컨텍스트는 각 진입점이 그때그때 다시 본다.
 */
export function attachSfx(): Unsubscribe {
  if (attached !== null) {
    return attached;
  }
  resetState();

  const subscriptions: Unsubscribe[] = [
    bus.on('parry', onParry),
    bus.on('reparry', onReparry),
    bus.on('reflectLaunched', onReflectLaunched),
    bus.on('cooldownReady', onCooldownReady),
    bus.on('invulnEnded', onInvulnEnded),
    bus.on('enemyKilled', onEnemyKilled),
    bus.on('playerHit', onPlayerHit),
    bus.on('enemyWindup', onEnemyWindup),
    bus.on('telegraph', onTelegraph),
  ];
  for (const [kind, mergeKey, patch] of SIMPLE_EVENTS) {
    subscriptions.push(bus.on(kind, () => fire('other', mergeKey, nowSec(), patch)));
  }

  const detach = (): void => {
    if (attached === null) {
      return;
    }
    attached = null;
    for (const unsubscribe of subscriptions) {
      unsubscribe();
    }
    for (const slot of chainSlots) {
      clearIdleTimer(slot);
    }
  };
  attached = detach;
  return detach;
}
