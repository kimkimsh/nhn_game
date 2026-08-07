/**
 * core/ 다섯 모듈과 고정 스텝 루프의 단위 테스트 — 09_검증_전략.md §3.7.
 *
 * 여기서만 볼 수 있는 것 넷: 스윕이 상대 변위로 계산되는지, clock이 히트스톱 초과분을 잘라내는지,
 * 선입력 버퍼가 sim 시간으로만 줄어드는지, 루프가 스텝 상한에서 남은 sim 시간을 버리는지. 전부
 * 동작이라 config 대조 테스트(§3.5)가 못 본다. 규칙을 정하는 숫자는 전부 config/에서 읽는다.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { BOSSES } from '../src/config/bosses';
import { BULLETS } from '../src/config/bullets';
import { RARE_CARDS } from '../src/config/cards/rare';
import { HITSTOP_BUDGET_PER_SEC } from '../src/config/feel';
import { HARD_LIMITS, INV_1_MARGIN_E07_SEC, PARRY, PARRY_BANDS } from '../src/config/parry';
import { PLAYER } from '../src/config/player';
import { PLAYFIELD } from '../src/config/playfield';
import { REFLECT } from '../src/config/reflect';
import { bus } from '../src/core/bus';
import { createClock } from '../src/core/clock';
import { createInput, type Input } from '../src/core/input';
import { FIXED_DT_SEC, MAX_STEPS_PER_FRAME, createLoop, type FrameResult } from '../src/core/loop';
import { createPool } from '../src/core/pool';
import { NO_HIT, sweepRelativeBox, sweepRelativeCircle, sweepSegmentCircle } from '../src/core/sweep';

/** 초 단위 배정도 비교 자릿수. 누산 오차보다 크고 어떤 규칙 값보다 작다 */
const SEC_DIGITS = 9;
const MILLIS_PER_SEC = 1000;
/** 60Hz 화면 한 프레임 (실시간 초). 고정 스텝 두 번이 여기 들어간다 */
const REAL_FRAME_SEC = 1 / 60;

// D-04가 "손맛의 절반"이라 부른 스윕 (12 §10 E-07)
const PLAYER_XU = (PLAYFIELD.playerBounds.minXU + PLAYFIELD.playerBounds.maxXU) / 2;
const PLAYER_YU = (PLAYFIELD.playerBounds.minYU + PLAYFIELD.playerBounds.maxYU) / 2;
/** 한 스텝 동안 플레이어가 갈 수 있는 최대 거리 (u) — 카드로 오른 이동 속도 상한 기준 */
const PLAYER_STEP_U = HARD_LIMITS.moveSpeedMaxUPerSec * FIXED_DT_SEC;
/** 한 스텝 동안 반사탄이 갈 수 있는 최대 거리 (u) — §7.1 속도 상한 기준 */
const REFLECT_STEP_U = REFLECT.speedMaxUPerSec * FIXED_DT_SEC;
/** 마주 보고 움직일 때의 한 스텝 상대 변위 (u) */
const CLOSING_STEP_U = REFLECT_STEP_U + PLAYER_STEP_U;
/** 반사탄이 플레이어 코어를 맞히는 중심 거리 (u). 반사된 조총탄이 가장 작은 반경이다 */
const HIT_SUM_U = BULLETS.P2.radiusU + PLAYER.hitRadiusU;

/**
 * 마주 보고 움직이는 한 스텝을 상대 변위 스윕에 넘긴다 — 플레이어는 위로 최대 속도, 반사탄은
 * 아래로 속도 상한. 인자는 스텝 시작 시점의 (발사체 − 플레이어) 상대 위치다.
 */
function sweepHeadOn(relXU: number, relYU: number): number {
  const startXU = PLAYER_XU + relXU;
  const startYU = PLAYER_YU + relYU;
  return sweepRelativeCircle(startXU, startYU, startXU, startYU + REFLECT_STEP_U,
    PLAYER_XU, PLAYER_YU, PLAYER_XU, PLAYER_YU - PLAYER_STEP_U, HIT_SUM_U);
}

/** 같은 스텝을 플레이어가 멈춰 있다고 보고 재는 형태. 상대 변위를 안 쓴 계산이 이것이다 */
function sweepIgnoringPlayerMove(relXU: number, relYU: number): number {
  return sweepSegmentCircle(relXU, relYU, relXU, relYU + REFLECT_STEP_U, 0, 0, HIT_SUM_U);
}

describe('sweep — 상대 변위로 재야 마주 보고 움직일 때 안 뚫린다', () => {
  it('한 스텝 변위 + 반경 합이 닿는 거리의 경계다', () => {
    const reachU = HIT_SUM_U + CLOSING_STEP_U;
    const entryT = sweepHeadOn(0, -reachU + 1);
    expect(entryT).toBeGreaterThan(0);
    expect(entryT).toBeLessThanOrEqual(1);
    // 못 닿는 거리를 앞당겨 잡으면 스텝 경계에서 유령 피격이 생긴다
    expect(sweepHeadOn(0, -reachU - 1)).toBe(NO_HIT);
  });
  it('최근접이 스텝 중간에 생겨도 잡는다 — 양 끝만 보면 뚫린다', () => {
    // 가로로 어긋난 채 스쳐 지나간다. 아래 세 단언이 "양 끝은 밖, 가운데는 안"을 확인한다
    const offsetXU = 12;
    const startYU = -CLOSING_STEP_U / 2;
    expect(Math.hypot(offsetXU, startYU)).toBeGreaterThan(HIT_SUM_U);
    expect(Math.hypot(offsetXU, startYU + CLOSING_STEP_U)).toBeGreaterThan(HIT_SUM_U);
    expect(offsetXU).toBeLessThan(HIT_SUM_U);
    const entryT = sweepHeadOn(offsetXU, startYU);
    expect(entryT).toBeGreaterThan(0);
    expect(entryT).toBeLessThan(1);
  });
  it('플레이어 이동을 빼고 재면 같은 스텝이 뚫린다', () => {
    const offsetXU = 12;
    // 그 어긋남에서 반경 합 원의 세로 반현. 원의 아래 끝이 이만큼 아래에 있다
    const halfChordU = Math.sqrt(HIT_SUM_U ** 2 - offsetXU ** 2);
    // 발사체 몫만으로는 원 아래 끝에 못 닿고, 플레이어 몫을 더하면 닿는 구간의 한가운데
    const startYU = -(halfChordU + REFLECT_STEP_U + PLAYER_STEP_U / 2);
    expect(sweepHeadOn(offsetXU, startYU)).toBeGreaterThan(0);
    expect(sweepIgnoringPlayerMove(offsetXU, startYU)).toBe(NO_HIT);
  });
  it('정지·저속에서 점 판정으로 퇴화한다 — 호출자가 속도로 분기하지 않는다', () => {
    const insideU = HIT_SUM_U / 2;
    expect(sweepSegmentCircle(0, insideU, 0, insideU, 0, 0, HIT_SUM_U)).toBe(0);
    expect(sweepSegmentCircle(0, HIT_SUM_U * 2, 0, HIT_SUM_U * 2, 0, 0, HIT_SUM_U)).toBe(NO_HIT);
    expect(sweepHeadOn(0, -insideU)).toBe(0);
  });
});
// B3만 사각형 히트박스를 두 겹으로 갖는다 (12 §10 E-04)
const B3_HULL = BOSSES.B3.hitBox;
const B3_PORT = BOSSES.B3.parts[0];
const BOSS_XU = (PLAYFIELD.bossHomeBounds.minXU + PLAYFIELD.bossHomeBounds.maxXU) / 2;
const BOSS_YU = (PLAYFIELD.bossHomeBounds.minYU + PLAYFIELD.bossHomeBounds.maxYU) / 2;
/** 포문이 쏘는 함포탄이 되돌아온다 — 선분 쪽 반경이 그만큼이라 상자가 그만큼 부푼다 */
const REFLECT_PAD_U = BULLETS.P6.radiusU;

/** 정지한 상자에 대고 위로 올라가는 반사탄 한 스텝을 쓸어 본다 */
function sweepUpwardIntoBox(
  xU: number, startYU: number, boxXU: number, boxYU: number, boxWU: number, boxHU: number,
): number {
  return sweepRelativeBox(xU, startYU, xU, startYU - REFLECT_STEP_U,
    boxXU, boxYU, boxXU, boxYU, boxWU / 2, boxHU / 2, REFLECT_PAD_U);
}

describe('sweep — 선분 대 AABB는 B3 선체와 포문 좌표로 성립한다', () => {
  const portXU = BOSS_XU + B3_PORT.offsetU.xU;
  const portYU = BOSS_YU + B3_PORT.offsetU.yU;
  /** 선체 아래 끝에서 한 스텝 안쪽. 어느 상자든 이 스텝 안에서 만난다 */
  const startYU = BOSS_YU + B3_HULL.hU / 2 + REFLECT_PAD_U + REFLECT_STEP_U / 2;

  it('선체 폭 안에서 아래로부터 올라오면 닿고, 폭 밖은 안 닿는다', () => {
    const insideXU = BOSS_XU + B3_HULL.wU / 4;
    const entryT = sweepUpwardIntoBox(insideXU, startYU, BOSS_XU, BOSS_YU, B3_HULL.wU, B3_HULL.hU);
    expect(entryT).toBeGreaterThan(0);
    expect(entryT).toBeLessThan(1);
    const outXU = BOSS_XU + B3_HULL.wU / 2 + REFLECT_PAD_U + 1;
    expect(sweepUpwardIntoBox(outXU, startYU, BOSS_XU, BOSS_YU, B3_HULL.wU, B3_HULL.hU)).toBe(NO_HIT);
  });
  it('포문은 선체보다 아래로 튀어나와 있어 같은 반사탄이 더 일찍 닿는다', () => {
    const hullT = sweepUpwardIntoBox(portXU, startYU, BOSS_XU, BOSS_YU, B3_HULL.wU, B3_HULL.hU);
    const box = B3_PORT.hitBox;
    const portT = sweepUpwardIntoBox(portXU, startYU, portXU, portYU, box.wU, box.hU);
    expect(hullT).toBeGreaterThan(0);
    expect(portT).toBeGreaterThan(0);
    // 이 순서가 §10.4의 "어느 포문을 먼저 부술지"가 성립할 수 있는 기하학적 근거다
    expect(portT).toBeLessThan(hullT);
  });

});
// 히트스톱 초과분의 절단은 clock에서만 일어난다 (12 §10 E-02, §3.5.1이 남긴 절반)
const GREAT_HITSTOP_SEC = PARRY_BANDS[0].hitstopSec;
/** §11.5 E07은 INV-1을 자기 값으로 덮는다 — 쿨다운이 활성 + 이 간극이 된다 */
const E07_COOLDOWN_SEC = PARRY.activeSec + INV_1_MARGIN_E07_SEC;
/** §11.4 R10은 성립한 패리에서 쿨다운을 지우고 이 간격만 남긴다 */
const R10_MIN_GAP_SEC = RARE_CARDS.R10.effects[0].minGapSec;

/** 간격 gapSec마다 GREAT 정지를 요청하며 sim 1초를 채운다. 요청 총량과 승인 총량을 낸다 */
function fillOneSimSecond(gapSec: number): { requestedSec: number; grantedSec: number } {
  const clock = createClock(HITSTOP_BUDGET_PER_SEC);
  let requestedSec = 0;
  let grantedSec = 0;
  for (let atSimSec = 0; atSimSec < 1; atSimSec += gapSec) {
    requestedSec += GREAT_HITSTOP_SEC;
    grantedSec += clock.requestHitstop(GREAT_HITSTOP_SEC, atSimSec);
  }
  return { requestedSec, grantedSec };
}

describe('clock — 히트스톱 누적 상한의 초과분이 잘려 나간다', () => {
  it('E07 빌드는 상한을 넘게 요청하고, 승인은 상한에서 멈춘다', () => {
    const filled = fillOneSimSecond(E07_COOLDOWN_SEC);
    expect(filled.requestedSec).toBeGreaterThan(HITSTOP_BUDGET_PER_SEC);
    expect(filled.grantedSec).toBeCloseTo(HITSTOP_BUDGET_PER_SEC, SEC_DIGITS);
  });
  it('R10 빌드도 같다 — 최소 간격만 남은 쪽이 더 크게 넘는다', () => {
    const r10 = fillOneSimSecond(R10_MIN_GAP_SEC);
    expect(r10.requestedSec).toBeGreaterThan(fillOneSimSecond(E07_COOLDOWN_SEC).requestedSec);
    expect(r10.grantedSec).toBeCloseTo(HITSTOP_BUDGET_PER_SEC, SEC_DIGITS);
  });
  it('창은 sim 초로 민다 — 실시간으로 밀면 상한이 사실상 안 걸린다', () => {
    const clock = createClock(HITSTOP_BUDGET_PER_SEC);
    clock.requestHitstop(GREAT_HITSTOP_SEC, 0);
    expect(clock.budgetUsedSec(0.99)).toBeCloseTo(GREAT_HITSTOP_SEC, SEC_DIGITS);
    expect(clock.budgetUsedSec(1.01)).toBeCloseTo(0, SEC_DIGITS);
  });
  it('창이 지나가면 예산이 다시 열린다 — 한 번 쓰고 마는 예산이 아니다', () => {
    const clock = createClock(HITSTOP_BUDGET_PER_SEC);
    for (let atSimSec = 0; atSimSec < 1; atSimSec += E07_COOLDOWN_SEC) {
      clock.requestHitstop(GREAT_HITSTOP_SEC, atSimSec);
    }
    expect(clock.requestHitstop(GREAT_HITSTOP_SEC, 1.5)).toBeCloseTo(GREAT_HITSTOP_SEC, SEC_DIGITS);
  });
  it('정지가 프레임 중간에 끝나면 그 프레임의 남은 sim 시간이 살아남는다', () => {
    const clock = createClock(HITSTOP_BUDGET_PER_SEC);
    // 한 프레임보다 짧은 정지. 어떤 등급의 정지도 이보다는 길다
    const shortFreezeSec = 0.005;
    clock.requestHitstop(shortFreezeSec, 0);
    // `simDt = remaining > 0 ? 0 : realDt` 형태였다면 여기가 0이고 정지가 +67%로 늘어난다
    expect(clock.advance(REAL_FRAME_SEC)).toBeCloseTo(REAL_FRAME_SEC - shortFreezeSec, SEC_DIGITS);
    expect(clock.hitstopRemainingSec()).toBe(0);
  });
});
// 선입력 버퍼와 눌림 소비 (12 §10 E-01 · E-03)
/** 버퍼가 마를 때까지 걸리는 고정 스텝 수 */
const BUFFER_STEPS = Math.ceil(PARRY.bufferSec / FIXED_DT_SEC);

/** 안 마르는 구현에서 무한 루프가 되지 않도록 여유를 두고 끊는다 */
function stepsToDrainBuffer(input: Input): number {
  let steps = 0;
  while (input.hasParryBuffer()) {
    input.decayParryBuffer(FIXED_DT_SEC);
    steps += 1;
    if (steps > BUFFER_STEPS * 4) throw new Error('선입력 버퍼가 마르지 않는다');
  }
  return steps;
}

describe('input — 버퍼는 sim 시간으로 줄고, 눌림은 타임스탬프가 속한 스텝에서 소비된다', () => {
  it('고정 스텝으로 감산하면 버퍼 길이만큼 버틴다', () => {
    const input = createInput();
    input.armParryBuffer(PARRY.bufferSec);
    expect(stepsToDrainBuffer(input)).toBe(BUFFER_STEPS);
  });
  it('히트스톱으로 얼어 있는 프레임은 버퍼를 한 톨도 안 깎는다', () => {
    const clock = createClock(HITSTOP_BUDGET_PER_SEC);
    const input = createInput();
    input.armParryBuffer(PARRY.bufferSec);
    clock.requestHitstop(GREAT_HITSTOP_SEC, 0);
    // 프레임이 통째로 얼어 있는 동안만 돈다. 정지가 프레임 중간에 끝나는 프레임은 sim 시간을
    // 내주므로 여기 넣으면 "실시간으로 안 깎는다"와 "sim 시간으로 깎는다"가 섞인다
    let frozenRealSec = 0;
    while (clock.hitstopRemainingSec() >= REAL_FRAME_SEC) {
      const simDtSec = clock.advance(REAL_FRAME_SEC);
      expect(simDtSec).toBe(0);
      input.decayParryBuffer(simDtSec);
      frozenRealSec += REAL_FRAME_SEC;
    }
    expect(frozenRealSec).toBeGreaterThan(0);
    // 실시간으로 깎는 구현이면 frozenRealSec만큼 이미 사라져 여기가 더 짧게 나온다
    expect(stepsToDrainBuffer(input)).toBe(BUFFER_STEPS);
  });

  const frameStartMs = 1000;
  const stepMs = FIXED_DT_SEC * MILLIS_PER_SEC;

  function pressAt(input: Input, code: string, atMs: number): void {
    input.pressKey({ code, atMs, shiftHeld: false, repeat: false });
    input.releaseKey(code);
  }

  it('첫 스텝 뒤에 찍힌 눌림은 다음 스텝 몫으로 남는다', () => {
    const input = createInput();
    input.beginFrame(frameStartMs + stepMs * 2);
    pressAt(input, 'KeyJ', frameStartMs + stepMs * 0.5);
    pressAt(input, 'Space', frameStartMs + stepMs * 1.5);
    expect(input.takePressesUntil(frameStartMs + stepMs).map((p) => p.action)).toEqual(['parry']);
    // Space는 한 물리 키가 두 동작을 낸다 — 화면이 자기가 읽는 것만 골라 읽는다
    const second = input.takePressesUntil(frameStartMs + stepMs * 2);
    expect(second.map((p) => p.action)).toEqual(['parry', 'confirm']);
    // 지우지 않으면 60Hz에서 같은 눌림이 두 스텝에 걸쳐 두 번 소비된다
    expect(input.takePressesUntil(frameStartMs + stepMs * 2)).toHaveLength(0);
  });
  it('프레임 시각 뒤에 찍힌 눌림은 untilMs가 아무리 커도 안 나온다', () => {
    const input = createInput();
    input.beginFrame(frameStartMs);
    pressAt(input, 'KeyJ', frameStartMs + stepMs);
    expect(input.takePressesUntil(Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    input.beginFrame(frameStartMs + stepMs * 2);
    expect(input.takePressesUntil(Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });
});
// 상한에 닿았을 때의 회수 규칙이 스펙 §3.2의 상한 셋을 떠받친다
type Slot = { tag: string };

function createSlotPool(capacity: number) {
  const clear = (slot: Slot): void => { slot.tag = ''; };
  return createPool<Slot>({ capacity, create: () => ({ tag: '' }), reset: clear });
}

/** 획득한 슬롯에 표를 붙여 돌려준다. 풀이 비는 것은 이 헬퍼를 쓰는 케이스의 전제가 아니다 */
function acquireTagged(pool: ReturnType<typeof createSlotPool>, tag: string): Slot {
  const slot = pool.acquire();
  if (slot === null) throw new Error(`풀이 비었다: ${tag}`);
  slot.tag = tag;
  return slot;
}

describe('pool — 상한과 회수 순서', () => {
  it('용량을 다 쓰면 acquire가 null이다 — 이번엔 안 만든다가 답인 자리용', () => {
    const pool = createSlotPool(PLAYFIELD.maxReflectBullets);
    for (let i = 0; i < PLAYFIELD.maxReflectBullets; i += 1) {
      expect(pool.acquire()).not.toBeNull();
    }
    expect(pool.acquire()).toBeNull();
    expect(pool.activeCount).toBe(PLAYFIELD.maxReflectBullets);
  });
  it('acquireRecyclingOldest는 가장 오래된 것을 회수하고 비워서 넘긴다', () => {
    // 순서만 보므로 용량은 셋이면 충분하다
    const pool = createSlotPool(3);
    const first = acquireTagged(pool, 'A');
    acquireTagged(pool, 'B');
    acquireTagged(pool, 'C');
    const recycled = pool.acquireRecyclingOldest();
    expect(recycled).toBe(first);
    expect(recycled.tag).toBe('');
    expect(pool.active.map((slot) => slot.tag)).toEqual(['B', 'C', '']);
  });
  it('release는 획득 순서를 지키고, 두 번 반납해도 풀이 안 망가진다', () => {
    const pool = createSlotPool(3);
    acquireTagged(pool, 'A');
    const second = acquireTagged(pool, 'B');
    acquireTagged(pool, 'C');
    expect(pool.release(second)).toBe(true);
    expect(pool.release(second)).toBe(false);
    expect(pool.active.map((slot) => slot.tag)).toEqual(['A', 'C']);
    expect(pool.acquire()).not.toBeNull();
    expect(pool.activeCount).toBe(3);
  });
});

describe('bus — 스텝 안에서 쌓고 스텝이 끝나면 비운다', () => {
  beforeEach(() => {
    bus.reset();
  });
  it('emit은 큐에만 넣는다 — flush 전까지 구독자가 아무것도 못 본다', () => {
    const seen: number[] = [];
    bus.on('parry', (event) => seen.push(event.combo));
    bus.emit({ kind: 'parry', parrySeq: 1, grade: 'GREAT', count: 1, combo: 7, xU: 0, yU: 0 });
    bus.emit({ kind: 'parry', parrySeq: 2, grade: 'GOOD', count: 2, combo: 8, xU: 0, yU: 0 });
    expect(seen).toEqual([]);
    bus.flush();
    expect(seen).toEqual([7, 8]);
  });
  it('배출 도중에 emit된 것은 다음 flush로 넘어간다', () => {
    const order: string[] = [];
    bus.on('parryWhiff', () => {
      order.push('whiff');
      bus.emit({ kind: 'cooldownReady' });
    });
    bus.on('cooldownReady', () => { order.push('ready'); });
    bus.emit({ kind: 'parryWhiff', xU: 0, yU: 0 });
    bus.flush();
    expect(order).toEqual(['whiff']);
    bus.flush();
    expect(order).toEqual(['whiff', 'ready']);
  });
  it('구독을 해제하면 그 뒤로 안 온다', () => {
    let count = 0;
    const unsubscribe = bus.on('comboWarn', () => { count += 1; });
    bus.emit({ kind: 'comboWarn' });
    bus.flush();
    unsubscribe();
    unsubscribe();
    bus.emit({ kind: 'comboWarn' });
    bus.flush();
    expect(count).toBe(1);
  });
});

/** 한 프레임이 소화할 수 있는 sim 시간의 최대치 (초) */
const FRAME_BUDGET_SEC = MAX_STEPS_PER_FRAME * FIXED_DT_SEC;

function createTestLoop(): { runFrame: (realSec: number) => FrameResult; steppedSec: () => number } {
  let steppedSec = 0;
  const noop = (): void => {};
  const countStep = (fixedDtSec: number): void => { steppedSec += fixedDtSec; };
  const loop = createLoop({
    clock: createClock(HITSTOP_BUDGET_PER_SEC),
    hooks: { beginFrame: noop, step: countStep, render: noop },
  });
  return { runFrame: loop.runFrame, steppedSec: () => steppedSec };
}

describe('loop — 예산 안이면 sim 시간이 안 사라지고, 넘기면 남은 몫을 버린다', () => {
  // 09 §3.6의 지터 배열. 최댓값 41.0ms가 계약이다 — 프레임 예산을 넘기면 아래 describe의
  // 버리기 경로가 타서 sim 시간이 어긋난다
  const JITTER_MS = [16.667, 33.3, 8.0, 41.0, 16.667];

  it('배열 최댓값이 한 프레임 예산 안이다', () => {
    expect(Math.max(...JITTER_MS)).toBeLessThanOrEqual(FRAME_BUDGET_SEC * MILLIS_PER_SEC);
  });
  it('버리는 프레임이 없고, 돈 스텝과 남은 잔여분의 합이 실시간과 같다', () => {
    const loop = createTestLoop();
    let realSec = 0;
    let lastAlpha = 0;
    for (let i = 0; i < JITTER_MS.length * 12; i += 1) {
      const frameSec = JITTER_MS[i % JITTER_MS.length]! / MILLIS_PER_SEC;
      const result = loop.runFrame(frameSec);
      expect(result.droppedSimSec).toBe(0);
      realSec += frameSec;
      lastAlpha = result.alpha;
    }
    expect(loop.steppedSec() + lastAlpha * FIXED_DT_SEC).toBeCloseTo(realSec, SEC_DIGITS);
  });

  // 지터 배열이 원래 갖고 있던 프레임. 예산 밖이라 sim 시간이 어긋났고 그래서 최댓값이 41.0으로
  // 내려갔다. 스텝 상한을 올려 이 프레임을 예산 안에 넣으면 spiral of death 방어가 사라진다
  const SPIRAL_FRAME_SEC = 50 / MILLIS_PER_SEC;

  it('50ms 프레임은 한 프레임 예산 밖이다', () => {
    expect(SPIRAL_FRAME_SEC).toBeGreaterThan(FRAME_BUDGET_SEC);
  });
  it('예산을 넘긴 프레임에서 초과분이 droppedSimSec으로 드러난다', () => {
    const loop = createTestLoop();
    const result = loop.runFrame(SPIRAL_FRAME_SEC);
    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(result.droppedSimSec).toBeGreaterThan(0);
    expect(result.droppedSimSec).toBeCloseTo(SPIRAL_FRAME_SEC - FRAME_BUDGET_SEC, SEC_DIGITS);
    // 다음 프레임으로 넘기면 밀린 만큼을 따라잡느라 다음 프레임이 더 밀린다
    expect(result.alpha).toBe(0);
    expect(loop.steppedSec()).toBeCloseTo(FRAME_BUDGET_SEC, SEC_DIGITS);
  });

});
