/**
 * 화면 흔들림 — trauma 기반 (06_렌더링과_게임필.md §4.2)
 *
 * 이식: docs/sample_image/_shared/engine.js render (1935-1940) — **수정.**
 * 목업은 `sin(t·41.3)`·`cos(t·37.7)` 두 사인파에 `trauma² × 26u`를 곱한 평행이동뿐이었다.
 * 여기서는 세 가지가 바뀐다. 셋 다 06 §4.2가 근거를 적어 둔 자리다.
 *
 *   ① 사인파 → 시드 value noise 3채널. 부드러운 노이즈라야 히트스톱(=슬로모션) 중에도 저절로
 *      맞고, D-05의 결정론과 §7의 촬영 재현이 프레임 단위로 성립한다. 전역 난수는 쓰지 않는다.
 *   ② 회전 채널이 붙는다. 2D는 이동 + 회전을 둘 다 쓴다 — 순수 평행이동은 카메라가 흔들린 것이
 *      아니라 물체가 미끄러진 것(glitch)으로 읽힌다.
 *   ③ 방향성 킥이 무방향 노이즈 위에 더해진다. 흔들림 방향이 사건을 가리켜야 한다.
 *
 * **원본 카메라를 옮기지 않는다.** 여기서 만드는 것은 그리기 변위뿐이고 sim은 이 값을 모른다.
 * 03 §5가 그것을 구조로 강제한다 — 이 파일은 sim/을 import할 수 없다.
 *
 * 수치는 전부 config/feel.ts에서 읽는다. 이 파일에 숫자가 남는 자리는 노이즈 표의 크기와
 * 슬롯 개수뿐이고, 둘 다 그림이 아니라 자료구조의 치수다.
 */

import { KICK, SHAKE, TRAUMA_ON } from '../config/feel';
import { PLAYFIELD } from '../config/playfield';
import type { FeedbackBus, FeedbackEventOf, ParryGrade, Unsubscribe } from '../core/bus';
import { clamp01, easeOutCubic } from '../core/math';
import type { Rng } from '../core/rng';

/** 2의 거듭제곱이라 인덱스를 나머지 대신 마스크로 자른다 */
const NOISE_TABLE_SIZE = 256;
const NOISE_INDEX_MASK = NOISE_TABLE_SIZE - 1;

/** x 이동 · y 이동 · 회전. 채널마다 표를 따로 두어야 세 축이 같은 파형으로 묶이지 않는다 */
const NOISE_CHANNEL_X = 0;
const NOISE_CHANNEL_Y = 1;
const NOISE_CHANNEL_ROTATION = 2;
const NOISE_CHANNEL_COUNT = 3;

const DEGREES_PER_HALF_TURN = 180;

/**
 * 동시에 살아 있을 수 있는 킥의 수. 가장 긴 것이 0.20초(chainStart)이고 그 안에 겹칠 수 있는
 * 사건은 피격 + 연쇄 시작 + 보스 돌진 착탄 셋뿐이라 넷이면 남는다. 넘치면 가장 오래된 것을 덮는다.
 */
const KICK_SLOTS = 4;

/**
 * 패리 좌표와 첫 처치 좌표를 몇 개까지 기억할지. 반사탄은 반사된 뒤 몇 초를 더 날아가므로
 * 두 패리의 연쇄가 시간상 겹친다 — parrySeq로 갈라 담아야 킥 방향이 다른 패리의 것과 안 섞인다.
 * render/impact.ts가 집중선에 쓰는 슬롯 수와 같다.
 */
const CHAIN_SLOTS = 8;

/** 연쇄의 몇 번째 처치가 어느 가산량을 쓰는가 — 06 §4.2의 표 3행 */
const CHAIN_LINK_SECOND = 1;

interface Kick {
  dirX: number;
  dirY: number;
  magnitudeU: number;
  ageSec: number;
  decaySec: number;
}

/** 한 패리가 남긴 좌표 한 벌. `parrySeq`가 -1이면 빈 슬롯이다 */
interface ChainSlot {
  parrySeq: number;
  parryXU: number;
  parryYU: number;
  hasFirstKill: boolean;
  firstKillXU: number;
  firstKillYU: number;
}

export interface CameraDeps {
  readonly bus: FeedbackBus;
  /** render 전용 스트림 (D-05). 노이즈 표가 여기서 나온다 */
  readonly rng: Rng;
}

export interface Camera {
  /**
   * realDt다 — 히트스톱으로 sim이 멈춘 프레임에도 흔들림은 감쇠한다. sim의 FIXED_DT를 넣으면
   * 정지 구간 동안 진폭이 얼어붙어 「멈춤」이 「고장」으로 읽힌다.
   */
  update(realDtSec: number): void;
  /** 레이어 1~9를 감싸는 변위를 건다. `save()`를 포함하므로 end()와 짝이다 */
  begin(ctx: CanvasRenderingContext2D): void;
  end(ctx: CanvasRenderingContext2D): void;
  /** OS의 `prefers-reduced-motion`. 참이면 이동·회전·킥이 전부 0이 된다 (§4.2) */
  setReducedMotion(reduced: boolean): void;
  /**
   * 글을 읽는 화면으로 넘어갈 때 부른다 — 카드 선택·결과·일시정지·모바일 안내.
   * trauma를 0으로 내리고 킥을 버린다. 텍스트를 읽는 중에 흔들면 안 된다.
   */
  reset(): void;
  /** 현재 누적 trauma. 계측과 테스트가 읽는다 */
  readonly trauma: number;
  readonly offsetXU: number;
  readonly offsetYU: number;
  readonly rotationRad: number;
  dispose(): void;
}

/** 06 §4.2 표의 등급 3행 */
function traumaForGrade(grade: ParryGrade): number {
  if (grade === 'GREAT') {
    return TRAUMA_ON.parryGreat;
  }
  return grade === 'GOOD' ? TRAUMA_ON.parryGood : TRAUMA_ON.parryNotBad;
}

/**
 * 1D value noise. 정수 격자에 난수를 놓고 smoothstep으로 잇는다.
 *
 * 격자를 쓰는 이유는 표본이 시간의 함수여야 하기 때문이다 — 프레임마다 새로 뽑으면 일시정지
 * 중에 값이 바뀌고, 같은 시각을 다시 그리면 다른 그림이 나온다.
 */
function sampleNoise(table: Float64Array, channel: number, position: number): number {
  const cell = Math.floor(position);
  const fraction = position - cell;
  const base = channel * NOISE_TABLE_SIZE;
  const low = table[base + (cell & NOISE_INDEX_MASK)]!;
  const high = table[base + ((cell + 1) & NOISE_INDEX_MASK)]!;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return low + (high - low) * smooth;
}

export function createCamera(deps: CameraDeps): Camera {
  const noise = new Float64Array(NOISE_TABLE_SIZE * NOISE_CHANNEL_COUNT);
  for (let i = 0; i < noise.length; i += 1) {
    // [0,1)을 [-1,1)로 편다. 한쪽으로 치우친 노이즈는 흔들림이 아니라 이동이 된다
    noise[i] = deps.rng.float() * 2 - 1;
  }

  const kicks: Kick[] = [];
  for (let i = 0; i < KICK_SLOTS; i += 1) {
    kicks.push({ dirX: 0, dirY: 0, magnitudeU: 0, ageSec: 0, decaySec: 1 });
  }
  let kickCursor = 0;

  const chain: ChainSlot[] = [];
  for (let i = 0; i < CHAIN_SLOTS; i += 1) {
    chain.push({
      parrySeq: -1, parryXU: 0, parryYU: 0,
      hasFirstKill: false, firstKillXU: 0, firstKillYU: 0,
    });
  }
  let chainCursor = 0;

  const subscriptions: Unsubscribe[] = [];
  const maxRotationRad = (SHAKE.maxRotationDeg / DEGREES_PER_HALF_TURN) * Math.PI;
  const centerXU = PLAYFIELD.widthU / 2;
  const centerYU = PLAYFIELD.heightU / 2;

  let trauma = 0;
  let noiseTimeSec = 0;
  let reducedMotion = false;
  let offsetXU = 0;
  let offsetYU = 0;
  let rotationRad = 0;

  /**
   * `cap`이 있는 이유는 연쇄뿐이다 — 링크가 이어지는 동안 trauma가 0.6~1.0에 머물면 진폭
   * 9.4~26u가 0.8초 지속되는데, §4.2 자신이 흔들림 1회의 체감 길이를 0.1~0.3초로 적었다.
   * **이미 상한을 넘겨 있는 trauma를 끌어내리지는 않는다** — 피격 0.85 직후의 연쇄가 화면을
   * 갑자기 안정시키면 피격이 없던 일이 된다.
   */
  function addTrauma(amount: number, cap: number): void {
    const raised = Math.min(trauma + amount, cap);
    trauma = Math.min(1, Math.max(trauma, raised));
  }

  function addKick(dirX: number, dirY: number, magnitudeU: number, decaySec: number): void {
    const slot = kicks[kickCursor]!;
    kickCursor = (kickCursor + 1) % KICK_SLOTS;
    slot.dirX = dirX;
    slot.dirY = dirY;
    slot.magnitudeU = magnitudeU;
    slot.decaySec = decaySec;
    slot.ageSec = 0;
  }

  function chainSlotFor(parrySeq: number): ChainSlot {
    for (const slot of chain) {
      if (slot.parrySeq === parrySeq) {
        return slot;
      }
    }
    const fresh = chain[chainCursor]!;
    chainCursor = (chainCursor + 1) % CHAIN_SLOTS;
    fresh.parrySeq = parrySeq;
    fresh.parryXU = 0;
    fresh.parryYU = 0;
    fresh.hasFirstKill = false;
    return fresh;
  }

  function onParry(event: FeedbackEventOf<'parry'>): void {
    addTrauma(traumaForGrade(event.grade), 1);
    const slot = chainSlotFor(event.parrySeq);
    slot.parryXU = event.xU;
    slot.parryYU = event.yU;
    slot.hasFirstKill = false;
  }

  /**
   * 연쇄 시작 킥은 **둘째 처치가 도착하는 순간**에 발동한다. 방향은 패리 지점에서 첫 처치
   * 위치로 향한다(§4.2). 첫 처치만으로는 단발 처치와 구분되지 않고 단발은 상시 일어난다 —
   * render/impact.ts의 집중선이 같은 판단을 같은 자리에서 한다.
   */
  function onEnemyKilled(event: FeedbackEventOf<'enemyKilled'>): void {
    const slot = chainSlotFor(event.parrySeq);
    if (event.chainIndex === 0) {
      addTrauma(TRAUMA_ON.enemyKilled, 1);
      slot.firstKillXU = event.xU;
      slot.firstKillYU = event.yU;
      slot.hasFirstKill = true;
      return;
    }
    const amount = event.chainIndex === CHAIN_LINK_SECOND
      ? TRAUMA_ON.chainLink2
      : TRAUMA_ON.chainLink3Up;
    addTrauma(amount, TRAUMA_ON.chainCap);
    if (event.chainIndex !== CHAIN_LINK_SECOND || !slot.hasFirstKill) {
      return;
    }
    const dx = slot.firstKillXU - slot.parryXU;
    const dy = slot.firstKillYU - slot.parryYU;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      addKick(dx / length, dy / length, KICK.chainStart.magnitudeU, KICK.chainStart.decaySec);
    }
  }

  function onPlayerHit(event: FeedbackEventOf<'playerHit'>): void {
    addTrauma(TRAUMA_ON.playerHit, 1);
    addKick(event.dirX, event.dirY, KICK.playerHit.magnitudeU, KICK.playerHit.decaySec);
  }

  subscriptions.push(deps.bus.on('parry', onParry));
  subscriptions.push(deps.bus.on('enemyKilled', onEnemyKilled));
  subscriptions.push(deps.bus.on('playerHit', onPlayerHit));
  subscriptions.push(deps.bus.on('reflectHit', () => addTrauma(TRAUMA_ON.reflectHit, 1)));
  subscriptions.push(deps.bus.on('shieldBlocked', () => addTrauma(TRAUMA_ON.shieldBlocked, 1)));
  subscriptions.push(deps.bus.on('bossPartBroken', () => addTrauma(TRAUMA_ON.bossPartBreak, 1)));
  subscriptions.push(deps.bus.on('bossPhase', () => addTrauma(TRAUMA_ON.bossPhase, 1)));
  subscriptions.push(deps.bus.on('bossDefeated', () => addTrauma(TRAUMA_ON.bossDeath, 1)));
  // 돌진 착탄은 trauma 표에 행이 없다 — 방향이 정보의 전부라 무방향 성분을 주지 않는다
  subscriptions.push(
    deps.bus.on('bossChargeLand', (event: FeedbackEventOf<'bossChargeLand'>) => {
      addKick(
        event.dirX, event.dirY,
        KICK.bossChargeLand.magnitudeU, KICK.bossChargeLand.decaySec,
      );
    }),
  );

  /**
   * 목업은 감쇠를 sim 스텝에서 했지만(engine.js:1851) 흔들림은 연출이므로 여기가 자리다.
   * 감쇠가 sim에 남으면 히트스톱 동안 화면이 최대 진폭으로 얼어붙는다.
   */
  function update(realDtSec: number): void {
    trauma = Math.max(0, trauma - SHAKE.decayPerSec * realDtSec);
    noiseTimeSec += realDtSec;

    let kickXU = 0;
    let kickYU = 0;
    for (const kick of kicks) {
      if (kick.ageSec >= kick.decaySec) {
        continue;
      }
      kick.ageSec += realDtSec;
      // easeOut을 1에서 빼면 시작이 가파르고 끝이 완만하다 — 착탄의 모양이 그것이다
      const remaining = 1 - easeOutCubic(clamp01(kick.ageSec / kick.decaySec));
      kickXU += kick.dirX * kick.magnitudeU * remaining;
      kickYU += kick.dirY * kick.magnitudeU * remaining;
    }

    if (reducedMotion) {
      offsetXU = 0;
      offsetYU = 0;
      rotationRad = 0;
      return;
    }
    // 제곱이 흔들림의 이징을 대신한다 — trauma 0.30 / 0.60 / 0.90이 3% / 22% / 73%가 된다
    const shake = Math.pow(trauma, SHAKE.exponent);
    const position = noiseTimeSec * SHAKE.noiseSpeed;
    offsetXU = sampleNoise(noise, NOISE_CHANNEL_X, position) * shake * SHAKE.maxOffsetU + kickXU;
    offsetYU = sampleNoise(noise, NOISE_CHANNEL_Y, position) * shake * SHAKE.maxOffsetU + kickYU;
    rotationRad = sampleNoise(noise, NOISE_CHANNEL_ROTATION, position) * shake * maxRotationRad;
  }

  /**
   * 회전 중심이 화면 중앙인 것은 좌상단 원점에 걸면 지렛대가 길어져서다 — 0.007 rad이
   * 원점 회전에서는 대각선 끝에서 15u를 밀지만 중앙 회전에서는 7.7u이고 좌우가 대칭이다.
   * 카메라가 도는 그림은 후자다.
   */
  function begin(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(centerXU + offsetXU, centerYU + offsetYU);
    ctx.rotate(rotationRad);
    ctx.translate(-centerXU, -centerYU);
  }

  return {
    update,
    begin,
    end(ctx: CanvasRenderingContext2D): void {
      ctx.restore();
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },
    reset(): void {
      trauma = 0;
      offsetXU = 0;
      offsetYU = 0;
      rotationRad = 0;
      for (const kick of kicks) {
        kick.ageSec = kick.decaySec;
      }
    },
    get trauma(): number {
      return trauma;
    },
    get offsetXU(): number {
      return offsetXU;
    },
    get offsetYU(): number {
      return offsetYU;
    },
    get rotationRad(): number {
      return rotationRad;
    },
    dispose(): void {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      subscriptions.length = 0;
    },
  };
}
