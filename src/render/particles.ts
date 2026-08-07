/**
 * 파편 파티클과 연쇄 재생 — 레이어 8과 그 위의 `×N`
 * (06_렌더링과_게임필.md §4.3 · §4.4 · §6, 12_통합_계약.md §6 · §7.4)
 *
 * 이식: docs/sample_image/_shared/engine.js burst (1925-1930) · 파편 갱신 (1917-1922) ·
 * 파편 그리기 (1951-1956)
 *
 * sim은 명중 즉시 처치를 확정하고, 어긋나게 재생하는 것은 여기뿐이다 — 동시에 사라지면 그냥
 * 삭제이고 순차적이어야 연쇄로 읽힌다(§6). 그래서 연쇄 큐가 이 파일에 있다.
 *
 * **난수는 주입받는다.** 목업 burst의 전역 난수 두 자리(engine.js:1927-1928)가 D-05 위반이고,
 * 분포도 §4.3의 균등 링 + 지터로 바꿨다 — 순수 난수 각도는 뭉치고 빈틈을 남긴다. 넘기는 것은
 * render 전용 스트림이어야 한다(core/rng.ts 머리말). **실시간(realDt)으로 돈다** — 히트스톱이
 * sim을 세워도 파편은 계속 날아간다(§4.1). 등급 팝업과 재패리 계단은 impact.ts가 갖는다(08 §2.4).
 */

import { CHAIN_STAGGER_SEC, PARTICLES } from '../config/feel';
import { PALETTE } from '../config/palette';
import { PARRY } from '../config/parry';
import { PLAYFIELD } from '../config/playfield';
import { REFLECT } from '../config/reflect';
import { FONTS } from '../config/ui';
import type { FeedbackBus, ParryGrade, Unsubscribe } from '../core/bus';
import { clamp01, easeOutBack } from '../core/math';
import { createPool } from '../core/pool';
import type { Rng } from '../core/rng';

const FULL_TURN_RAD = Math.PI * 2;

/** alpha의 분모 (초). 목업은 파편마다 `max: 0.9`를 들고 다녔지만 수명 상한과 같은 수 하나다 */
const PARTICLE_MAX_LIFE_SEC = PARTICLES.lifetimeBaseSec + PARTICLES.lifetimeRandSec;

/** 파편 사각형 (engine.js:1954). 반쪽을 빼서 중심을 맞춘다 */
const PARTICLE_SIZE_U = 6;
const PARTICLE_HALF_U = PARTICLE_SIZE_U / 2;
/** 셋 중 하나만 백색이다 (engine.js:1928 `i % 3 ? C.hwang : C.baek`) */
const PARTICLE_BAEK_STRIDE = 3;
/** 파편 수가 감쇠하는 첫 링크 (0부터 센 번호). 3이 「링크 4 이상」이다 (12 §7.4) */
const CHAIN_DAMPED_FROM_LINK = 3;
/** `×N`이 뜨는 최소 처치 수 (§6.2). 2기는 「여러 기」로 안 읽힌다 */
const KILL_COUNT_MIN = 3;

/**
 * `×N` 팝업. §6.2가 고정한 것은 56px · hwang · 0.9초 · 등장 ease-out-back 0.15초뿐이고, 상승
 * 거리와 소멸 이득은 등급 팝업(engine.js:1959-1973)에서 가져왔다 — 나란히 뜨는 글자 둘이 다르게
 * 움직이면 하나는 오작동으로 보인다. **config/ui.ts에 팝업 블록이 생기면 옮긴다.**
 */
const KILL_COUNT_PX = 56;
const KILL_COUNT_LIFE_SEC = 0.9;
const KILL_COUNT_POP_SEC = 0.15;
const KILL_COUNT_RISE_U = 46;
/** alpha = 남은 수명 비율 × 이 값. 1을 넘겨야 앞쪽이 불투명하게 유지된다 (engine.js:1961) */
const POPUP_FADE_GAIN = 1.6;

/** 한 프레임에 도착할 수 있는 처치 수. 처치는 잡몹에만 나므로 동시 잡몹 상한을 못 넘는다 */
const ARRIVAL_CAPACITY = PLAYFIELD.maxEnemies;
/** 지연 재생 대기분. 20링크 = 0.76초를 밀리는 동안 다음 패리가 자기 연쇄를 시작할 수 있다 */
const SCHEDULED_CAPACITY = PLAYFIELD.maxEnemies * 2;
/** 동시 연쇄 큐 수 — 반사탄 수명 동안 시작된 패리 전부가 아직 처치를 낼 수 있다 */
const CHAIN_QUEUE_CAPACITY = Math.ceil(REFLECT.lifetimeSec / PARRY.cooldownSec) + 1;

/** §17 강도 티어 한 단. config/types-feel.ts의 ParticleTier와 같은 모양이다 */
interface BurstTier {
  readonly count: number; readonly spreadUPerSec: number;
}

/** 연쇄 링크의 티어. 확산은 large를 쓰고 개수만 12 §7.4의 감쇠를 탄다 */
const CHAIN_TIER: BurstTier = { count: PARTICLES.chainLinkCount, spreadUPerSec: PARTICLES.large.spreadUPerSec };
const CHAIN_TIER_DAMPED: BurstTier = { count: PARTICLES.chainLinkCountAfter4, spreadUPerSec: PARTICLES.large.spreadUPerSec };

/** 등급 → 티어 (§4.4). NOT BAD가 small인 것은 이 표의 축이 trauma가 아니라 히트스톱·파편이어서다 */
const PARRY_TIER: Record<ParryGrade, BurstTier> = {
  GREAT: PARTICLES.large,
  GOOD: PARTICLES.medium,
  NOT_BAD: PARTICLES.small,
};

/**
 * 파편 한 벌만 나면 되는 사건 (§4.4 표). 나머지 행이 빠진 것은 값이 아니라 규칙이다 — 빈
 * 패리·쿨다운 종료는 §5.4가 파편 0으로 못 박았고(없다는 것이 신호다), 발사 예비동작은 §15.1이
 * 「본체의 상태 변화만으로」를 요구하며(12 §7.5-정정), 무적 종료·장판 생성은 사건 자체가 없다.
 */
const FIXED_TIER_EVENTS = [
  ['reflectLaunched', PARTICLES.small],
  ['reflectHit', PARTICLES.small],
  ['shieldBlocked', PARTICLES.small],
  ['playerHit', PARTICLES.large],
  ['bossPhase', PARTICLES.large],
  ['bossPartBroken', PARTICLES.medium],
  ['bossDefeated', PARTICLES.large],
] as const;

interface Particle {
  xU: number; yU: number; vxU: number; vyU: number; lifeSec: number; color: string;
}

/** 이번 프레임에 도착한 처치. angleRad는 패리 지점에서 잰 각이다 */
interface KillArrival {
  parrySeq: number; xU: number; yU: number; angleRad: number;
}

/** 재생 시각이 정해진 처치 */
interface ScheduledKill {
  parrySeq: number; xU: number; yU: number; playAtSec: number;
}

/**
 * 패리 이벤트 하나가 낳은 연쇄. 큐의 단위가 반사탄이 아닌 것이 12 §6의 판정이다 — 반사탄
 * 단위로 나누면 R01·E01 분열탄이 길이 1짜리 큐 N개가 되어 `×N`이 영영 안 뜬다.
 */
interface ChainQueue {
  parrySeq: number;
  /** 정렬 키의 원점 */
  parryXU: number; parryYU: number;
  /** 다음 링크가 재생될 수 있는 가장 이른 시각 */
  nextPlayAtSec: number;
  /** 재생된 링크 수. 다음 링크의 번호이기도 하다 */
  playedCount: number;
  /** countPopupLifeSec이 0 이하면 팝업이 없다 */
  countPopupXU: number; countPopupYU: number; countPopupLifeSec: number;
}

export interface ParticleLayerDeps {
  readonly bus: FeedbackBus;
  /** render 전용 스트림 (D-05) */
  readonly rng: Rng;
}

export interface ParticleLayer {
  /** 실시간 dt다. 히트스톱 중에도 파편은 계속 난다 (§4.1) */
  update(realDtSec: number): void;
  /** 레이어 8 — 플레이어 **위**. 아래에 두면 90u 실루엣이 파편을 삼킨다 (§2) */
  drawParticles(ctx: CanvasRenderingContext2D): void;
  /** 레이어 9의 일부 — `×N`. 등급 팝업은 impact.ts가 같은 층에 그린다 */
  drawKillCounts(ctx: CanvasRenderingContext2D): void;
  /** 살아 있는 파편 수. §3.7의 상한 240을 재는 쪽이 읽는다 */
  readonly aliveCount: number;
  dispose(): void;
}

function isExpired(item: Particle): boolean {
  return item.lifeSec <= 0;
}

/** 같은 패리 안에서는 각도 오름차순이 곧 시계 방향이다 — y가 아래로 증가하는 좌표계이므로 */
function arrivalComesAfter(a: KillArrival, b: KillArrival): boolean {
  return a.parrySeq !== b.parrySeq ? a.parrySeq > b.parrySeq : a.angleRad > b.angleRad;
}

/** 삽입 정렬인 것은 n이 잡몹 상한 20 이하이고, 비교 함수를 넘기면 프레임마다 클로저가 하나 늘어서다 */
function sortArrivals(items: KillArrival[], count: number): void {
  for (let i = 1; i < count; i += 1) {
    const moving = items[i]!;
    let j = i - 1;
    while (j >= 0 && arrivalComesAfter(items[j]!, moving)) {
      items[j + 1] = items[j]!;
      j -= 1;
    }
    items[j + 1] = moving;
  }
}

/**
 * 링크 번호별 티어. **링크 1이 §6.2의 28이 아니라 §4.4의 18인 것은 판정이다** — §6.2가 첫 처치에
 * large를 주려면 render가 그때 "연쇄의 시작"임을 알아야 하는데 §6.1이 연쇄 길이를 사건에 안
 * 싣기로 했다. 단발 처치와 구분이 안 되고 단발은 상시 일어나므로 링크 2부터 올린다 (12 §7.4).
 */
function killTier(linkOrdinal: number): BurstTier {
  if (linkOrdinal === 0) {
    return PARTICLES.medium;
  }
  return linkOrdinal < CHAIN_DAMPED_FROM_LINK ? CHAIN_TIER : CHAIN_TIER_DAMPED;
}

export function createParticleLayer(deps: ParticleLayerDeps): ParticleLayer {
  const rng = deps.rng;
  const particles = createPool<Particle>({
    capacity: PARTICLES.maxAlive,
    create: () => ({ xU: 0, yU: 0, vxU: 0, vyU: 0, lifeSec: 0, color: PALETTE.hwang }),
    reset: (item) => {
      item.lifeSec = 0;
    },
  });
  const scheduled = createPool<ScheduledKill>({
    capacity: SCHEDULED_CAPACITY,
    create: () => ({ parrySeq: 0, xU: 0, yU: 0, playAtSec: 0 }),
    reset: (item) => {
      item.playAtSec = 0;
    },
  });
  const queues = createPool<ChainQueue>({
    capacity: CHAIN_QUEUE_CAPACITY,
    create: () => ({
      parrySeq: 0, parryXU: 0, parryYU: 0, nextPlayAtSec: 0,
      playedCount: 0, countPopupXU: 0, countPopupYU: 0, countPopupLifeSec: 0,
    }),
    reset: (item) => {
      item.playedCount = 0;
      item.countPopupLifeSec = 0;
    },
  });

  const arrivals: KillArrival[] = [];
  for (let i = 0; i < ARRIVAL_CAPACITY; i += 1) {
    arrivals.push({ parrySeq: 0, xU: 0, yU: 0, angleRad: 0 });
  }
  let arrivalCount = 0;
  let nowSec = 0;
  const subscriptions: Unsubscribe[] = [];

  /**
   * 이식: engine.js burst (1925-1930) — 각도 분포와 난수원을 바꿨다. 초기 dy의 −30과 매 프레임
   * 260 u/s²를 둘 다 쓴다: −30은 궤적의 시작 모양을, 260은 낙하를 만든다(§4.3). 상한 240에
   * 닿으면 가장 오래된 것부터 회수한다(12 §7.4) — 신규 파편은 버리지 않는다.
   */
  function burst(xU: number, yU: number, tier: BurstTier): void {
    for (let i = 0; i < tier.count; i += 1) {
      const angleRad = (FULL_TURN_RAD * i) / tier.count + rng.float() * PARTICLES.angleJitterRad;
      const speedUPerSec =
        tier.spreadUPerSec *
        (PARTICLES.distanceMinRatio + rng.float() * PARTICLES.distanceRandRatio);
      const item = particles.acquireRecyclingOldest();
      item.xU = xU;
      item.yU = yU;
      item.vxU = Math.cos(angleRad) * speedUPerSec;
      item.vyU = Math.sin(angleRad) * speedUPerSec + PARTICLES.initialKickUPerSec;
      item.lifeSec = PARTICLES.lifetimeBaseSec + rng.float() * PARTICLES.lifetimeRandSec;
      item.color = i % PARTICLE_BAEK_STRIDE === 0 ? PALETTE.baek : PALETTE.hwang;
    }
  }

  function findQueue(parrySeq: number): ChainQueue | null {
    const active = queues.active;
    for (let i = 0; i < active.length; i += 1) {
      const queue = active[i]!;
      if (queue.parrySeq === parrySeq) {
        return queue;
      }
    }
    return null;
  }

  /** 재생 시각이 지난 처치를 터뜨리고 회수한다. 술어가 부수 효과를 갖는 유일한 자리다 */
  function playIfDue(kill: ScheduledKill): boolean {
    if (kill.playAtSec > nowSec) {
      return false;
    }
    const queue = findQueue(kill.parrySeq);
    const linkOrdinal = queue === null ? 0 : queue.playedCount;
    burst(kill.xU, kill.yU, killTier(linkOrdinal));
    if (queue !== null) {
      queue.playedCount = linkOrdinal + 1;
      if (queue.playedCount >= KILL_COUNT_MIN) {
        // §6.2의 자리는 「마지막 처치 위치」다. 링크마다 자리와 수명을 다시 잡는다 — 큐가
        // 마르기를 기다렸다 띄우면 연쇄가 끝난 뒤에야 수가 보인다
        queue.countPopupXU = kill.xU;
        queue.countPopupYU = kill.yU;
        queue.countPopupLifeSec = KILL_COUNT_LIFE_SEC;
      }
    }
    return true;
  }

  /**
   * 각도 순으로 늘어놓고 0.04초 **최소** 간격으로 예약한다(§6.1) — 이미 그보다 벌어져 명중하면
   * `nowSec`이 커서 지연이 0이다. 앞당기면 아직 안 죽은 적이 죽은 것처럼 보이므로 늦추기만 한다.
   */
  function scheduleArrivals(): void {
    if (arrivalCount === 0) {
      return;
    }
    sortArrivals(arrivals, arrivalCount);
    for (let i = 0; i < arrivalCount; i += 1) {
      const arrival = arrivals[i]!;
      const queue = findQueue(arrival.parrySeq);
      const earliestSec =
        queue === null ? nowSec : Math.max(nowSec, queue.nextPlayAtSec + CHAIN_STAGGER_SEC);
      if (queue !== null) {
        queue.nextPlayAtSec = earliestSec;
      }
      const kill = scheduled.acquireRecyclingOldest();
      kill.parrySeq = arrival.parrySeq;
      kill.xU = arrival.xU;
      kill.yU = arrival.yU;
      kill.playAtSec = earliestSec;
    }
    arrivalCount = 0;
  }

  function onParry(event: { grade: ParryGrade; parrySeq: number; xU: number; yU: number }): void {
    burst(event.xU, event.yU, PARRY_TIER[event.grade]);
    const queue = queues.acquireRecyclingOldest();
    queue.parrySeq = event.parrySeq;
    queue.parryXU = event.xU;
    queue.parryYU = event.yU;
    // 첫 링크가 지연 없이 나가도록 과거로 잡는다. 스태거는 링크 사이의 규칙이지 패리와 첫
    // 처치 사이의 규칙이 아니다
    queue.nextPlayAtSec = nowSec - CHAIN_STAGGER_SEC;
  }

  function onEnemyKilled(event: { parrySeq: number; xU: number; yU: number }): void {
    if (arrivalCount >= ARRIVAL_CAPACITY) {
      return;
    }
    const queue = findQueue(event.parrySeq);
    const arrival = arrivals[arrivalCount]!;
    arrival.parrySeq = event.parrySeq;
    arrival.xU = event.xU;
    arrival.yU = event.yU;
    arrival.angleRad =
      queue === null ? 0 : Math.atan2(event.yU - queue.parryYU, event.xU - queue.parryXU);
    arrivalCount += 1;
  }

  /** 재패리는 medium, 등급이 올랐으면 large다(§4.4) — 계단(§5.7)을 못 본 눈도 파편 수로 받는다 */
  function onReparry(event: { grade: ParryGrade; prevGrade: ParryGrade; xU: number; yU: number }): void {
    const rose = PARRY_TIER[event.grade].count > PARRY_TIER[event.prevGrade].count;
    burst(event.xU, event.yU, rose ? PARTICLES.large : PARTICLES.medium);
  }

  subscriptions.push(deps.bus.on('parry', onParry));
  subscriptions.push(deps.bus.on('enemyKilled', onEnemyKilled));
  subscriptions.push(deps.bus.on('reparry', onReparry));
  for (const [kind, tier] of FIXED_TIER_EVENTS) {
    subscriptions.push(
      deps.bus.on(kind, (event) => {
        burst(event.xU, event.yU, tier);
      }),
    );
  }

  return {
    update(realDtSec: number): void {
      nowSec += realDtSec;
      scheduleArrivals();
      scheduled.releaseWhere(playIfDue);
      const alive = particles.active;
      for (let i = 0; i < alive.length; i += 1) {
        const item = alive[i]!;
        item.lifeSec -= realDtSec;
        item.xU += item.vxU * realDtSec;
        item.yU += item.vyU * realDtSec;
        item.vyU += PARTICLES.gravityUPerSec2 * realDtSec;
      }
      particles.releaseWhere(isExpired);
      const chains = queues.active;
      for (let i = 0; i < chains.length; i += 1) {
        const queue = chains[i]!;
        if (queue.countPopupLifeSec > 0) {
          queue.countPopupLifeSec -= realDtSec;
        }
      }
    },

    /** 이식: engine.js 파편 그리기 (1951-1956) — 그대로. save/restore도 목업에 없다 */
    drawParticles(ctx: CanvasRenderingContext2D): void {
      const active = particles.active;
      for (let i = 0; i < active.length; i += 1) {
        const item = active[i]!;
        ctx.globalAlpha = clamp01(item.lifeSec / PARTICLE_MAX_LIFE_SEC);
        ctx.fillStyle = item.color;
        ctx.fillRect(item.xU - PARTICLE_HALF_U, item.yU - PARTICLE_HALF_U, PARTICLE_SIZE_U, PARTICLE_SIZE_U);
      }
      ctx.globalAlpha = 1;
    },

    drawKillCounts(ctx: CanvasRenderingContext2D): void {
      const active = queues.active;
      for (let i = 0; i < active.length; i += 1) {
        const queue = active[i]!;
        if (queue.countPopupLifeSec <= 0) {
          continue;
        }
        const remain = queue.countPopupLifeSec / KILL_COUNT_LIFE_SEC;
        const grown = easeOutBack(clamp01((KILL_COUNT_LIFE_SEC - queue.countPopupLifeSec) / KILL_COUNT_POP_SEC));
        ctx.save();
        ctx.globalAlpha = clamp01(remain * POPUP_FADE_GAIN);
        ctx.translate(queue.countPopupXU, queue.countPopupYU - (1 - remain) * KILL_COUNT_RISE_U);
        ctx.scale(grown, grown);
        ctx.textAlign = 'center';
        ctx.fillStyle = PALETTE.hwang;
        ctx.font = `700 ${KILL_COUNT_PX}px ${FONTS.data}`;
        ctx.fillText(`×${queue.playedCount}`, 0, 0);
        ctx.restore();
      }
    },

    get aliveCount(): number {
      return particles.activeCount;
    },

    dispose(): void {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      subscriptions.length = 0;
    },
  };
}
