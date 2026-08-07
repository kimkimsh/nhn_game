/**
 * 스크립트 봇 — 09_검증_전략.md §4.2. 헤드리스 밸런스 시뮬의 기본 입력원이다.
 *
 * 기록 재생은 밸런스를 고치는 순간 어긋난다(입력이 시각 기반이라 탄속을 1% 바꾸면 그 뒤가 전부
 * 딴 판이 된다). 그래서 §14.4의 검산표를 대조하는 쪽은 언제나 이 봇이고, 기록 재생은 촬영과
 * 버그 재현에만 쓴다.
 *
 * ── 잘 치도록 만들면 안 된다 ────────────────────────────────────────────────────
 *
 * §14.4의 보스 HP는 T-02의 전제(패리 성공률 50% · 평균 등급 GOOD · 재패리 0회) 위에 세워져
 * 있다. 성공률 100%짜리 봇으로 잰 격파 시간은 그 표의 어떤 칸과도 비교할 수 없다. 그래서 봇의
 * 자유도를 목표 거리의 오차 하나(`timingSigmaU`)로 줄이고, 헤드리스가 그 값을 성공률 50%에
 * 맞춘 뒤에야 격파 시간을 잰다.
 *
 * ── 「언제」만으로는 모자란다 ────────────────────────────────────────────────────
 *
 * 스펙 §5.5가 "몸 위치가 조준이다"라고 못 박았으므로, 봇이 어디에 서 있는지가 반사각을 정하고
 * 반사각이 명중률을 정하고 명중률이 곧 보스 격파 시간이다. 아래 세 규칙이 09 §4.2의 이동 정책
 * 표 그대로이고, 셋 다 리포트에 찍힌다 — 바꾼 채로 잰 값은 §14.4와 대조하지 않는다.
 *
 *   1. y 하한을 적 활동 영역 아래로 고정한다 (01 §4-C S-04)
 *   2. 가장 가까운 접근 중인 발사체를 향해 x축으로만 정렬한다
 *   3. 반사탄을 쫓지 않는다 (T-02의 재패리 0회)
 *
 * ── sim 스트림을 건드리지 않는다 ────────────────────────────────────────────────
 *
 * 오차는 주입된 시드 스트림에서 뽑는다(D-05). 전역 난수를 쓰면 같은 시드의 두 시뮬이 갈리고,
 * `world.rng`를 쓰면 봇의 소비 횟수가 보스 난사 각도를 민다.
 */
import { PLAYFIELD } from '../config/playfield';
import { createInput, type Input } from '../core/input';
import { FIXED_DT_SEC } from '../core/loop';
import type { Rng } from '../core/rng';
import { dot } from '../core/vec';
import type { Projectile } from '../sim/bullets';
import type { Run } from '../sim/run';
import type { World } from '../sim/world';

const MS_PER_SEC = 1000;

/** core/input.ts의 키 표에서 봇이 쓰는 다섯 자리. 동작이 아니라 코드로 넣어야 그 표를 지난다 */
const KEY = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  parry: 'KeyJ',
} as const;

/**
 * 판단에서 눌림까지의 지연 (고정 스텝 수). 이것이 빈 패리의 유일한 발생원이다 —
 * 목표 거리를 아주 작게 뽑은 시행에서는 지연 동안 탄이 플레이어를 지나쳐 C2(v·n < 0)가 깨지고,
 * 그 시행이 그대로 빈 패리가 된다. 0으로 두면 성공률이 100%에 붙어 캘리브레이션이 성립하지 않는다.
 */
const REACTION_STEPS = 3;

/** x 정렬의 무시 폭 (u). 이보다 가까우면 키를 놓는다 — 안 두면 매 스텝 좌우가 뒤집힌다 */
const ALIGN_DEADZONE_U = 6;

/** 목표 거리의 하한 (u). 0까지 허용하면 뽑기의 절반이 피격으로 끝나 T-06 측정이 봇의 함수가 된다 */
const MIN_TARGET_DIST_U = 6;

/** 최근접을 지났다고 보는 여유 (u). 좁게 두면 적분 한 스텝의 흔들림이 늦은 누름으로 잡힌다 */
const LATE_PRESS_MARGIN_U = 12;

/**
 * 목표 거리의 상한을 패리 반경의 몇 배까지 허용하는가.
 *
 * 반경에서 자르면 안 된다 — 그러면 크게 뽑힌 시행이 전부 「반경에 들어오는 즉시 누름」이 되어
 * 반드시 성립하고, 오차를 키워도 성공률이 안 떨어져 캘리브레이션의 이분법이 표적을 못 감싼다.
 * 반경 밖에서 누르는 것이 곧 §5.4의 빈 패리이고, 그것이 이 게임에서 실패가 생기는 실제 경로다.
 */
const MAX_TARGET_DIST_FACTOR = 4;

/**
 * 세 규칙의 값. 리포트가 이 객체를 그대로 실어 "어떤 봇이 잰 숫자인가"를 값과 같이 다니게 한다.
 *
 * `minYU`가 적 활동 영역의 아래 끝인 것은 그 위로 올라가면 보스의 발사원 전체가 HR-09로 억제되어
 * 측정이 숫자 대신 guard-violation으로 끝나기 때문이다. 대가는 플레이어 영역의 약 30%를 한 번도
 * 안 밟는다는 것이고, 그 사실이 리포트 머리에 찍힌다.
 */
export const BOT_POLICY = {
  minYU: PLAYFIELD.enemyBounds.maxYU,
  // 하한과 상한 사이의 어디든 규칙 2를 만족하지만 상한을 고른다 — 발사원에서 가장 멀면 반응
  // 시간이 최대가 되고, 그러면 남는 자유도가 목표 거리 오차 하나가 되어 캘리브레이션이 성립한다
  anchorYU: PLAYFIELD.playerBounds.maxYU,
  alignsOnXOnly: true,
  chasesReflects: false,
  reactionSteps: REACTION_STEPS,
} as const;

export interface BotSpec {
  readonly rng: Rng;
  /** 목표 거리에 얹는 정규 오차의 표준편차 (u). 헤드리스가 성공률 50%에 맞춘다 */
  readonly timingSigmaU: number;
  /** 목표 거리의 중심 (u). 생략하면 GOOD 밴드의 상한을 쓴다 */
  readonly targetDistU?: number;
}

export interface Bot {
  readonly input: Input;
  /**
   * `stepRun` 직전에 부른다. 이동 키를 갱신하고 조건이 맞으면 패리를 예약한 뒤,
   * 그 스텝의 눌림 소비 상한(ms)을 돌려준다.
   */
  beginStep(run: Run): number;
  readonly targetDistU: number;
}

/** Box–Muller. 두 값 중 하나만 쓴다 — 남는 쪽을 캐시하면 소비 횟수가 시행마다 달라진다 */
function gaussian(rng: Rng, mean: number, sigma: number): number {
  const u1 = Math.max(Number.MIN_VALUE, rng.float());
  const u2 = rng.float();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** §5.3 GOOD 밴드의 상한. 카드가 밴드를 넓히면 이 값도 함께 움직인다 */
function goodBandMaxDistU(world: World): number {
  const bands = world.stats.bands;
  return bands[1]?.maxDistU ?? world.stats.parryRadiusU;
}

/**
 * 규칙 3 — 적 탄환만 본다. 반사탄 풀을 후보에 넣는 순간 봇이 자기가 쳐낸 탄을 쫓게 되고,
 * T-02가 전제한 재패리 0회를 벗어난다.
 */
function nearestApproaching(world: World): Projectile | null {
  const player = world.player;
  let best: Projectile | null = null;
  let bestDistSqU = Number.POSITIVE_INFINITY;
  for (const shot of world.enemyBullets.active) {
    if (!shot.isParryable) {
      continue;
    }
    const towardX = shot.xU - player.xU;
    const towardY = shot.yU - player.yU;
    // C2와 같은 부등식. 멀어지는 탄을 쫓으면 봇이 화면을 가로질러 규칙 1의 하한을 넘는다
    if (dot(shot.vxUPerSec, shot.vyUPerSec, towardX, towardY) >= 0) {
      continue;
    }
    const distSqU = towardX * towardX + towardY * towardY;
    if (distSqU < bestDistSqU) {
      bestDistSqU = distSqU;
      best = shot;
    }
  }
  return best;
}

/** 반응 지연이 흐른 뒤의 거리. 플레이어 변위는 탄속에 비해 작아 무시한다 */
function predictedDistU(world: World, shot: Projectile): number {
  const aheadSec = REACTION_STEPS * FIXED_DT_SEC;
  const player = world.player;
  const dx = shot.xU + shot.vxUPerSec * aheadSec - player.xU;
  const dy = shot.yU + shot.vyUPerSec * aheadSec - player.yU;
  return Math.sqrt(dx * dx + dy * dy);
}

export function createBot(spec: BotSpec): Bot {
  const input = createInput();
  const held = new Set<string>();
  let targetDistU = 0;
  let armed = false;
  /** 이번 시행에서 본 최근접 예측 거리 (u). 늦은 누름을 가르는 기준이다 */
  let closestSeenU = Number.POSITIVE_INFINITY;

  function hold(code: string, down: boolean, atMs: number): void {
    if (down === held.has(code)) {
      return;
    }
    if (down) {
      held.add(code);
      input.pressKey({ code, atMs, shiftHeld: false, repeat: false });
    } else {
      held.delete(code);
      input.releaseKey(code);
    }
  }

  /**
   * 규칙 1·2. y는 고정 앵커로 수렴하고 x만 표적을 따라간다.
   *
   * **쿨다운 중에는 정렬하지 않는다.** 정렬은 §5.5의 "정면으로 받는다"를 만드는 행동인데 받을
   * 수단이 없는 동안 그것을 하면 그냥 탄에 걸어 들어가는 것이 된다. 규칙 2보다 영리한 회피가
   * 아니라 규칙 2를 그것이 뜻하는 구간에만 거는 것이다.
   */
  function steer(world: World, shot: Projectile | null, atMs: number): void {
    const player = world.player;
    const ready = world.simTimeSec >= world.parry.cooldownUntilSec || world.parry.isActive;
    const wantXU = shot === null || !ready ? player.xU : shot.xU;
    const deltaXU = wantXU - player.xU;
    hold(KEY.left, deltaXU < -ALIGN_DEADZONE_U, atMs);
    hold(KEY.right, deltaXU > ALIGN_DEADZONE_U, atMs);
    const deltaYU = BOT_POLICY.anchorYU - player.yU;
    hold(KEY.up, deltaYU < -ALIGN_DEADZONE_U, atMs);
    hold(KEY.down, deltaYU > ALIGN_DEADZONE_U, atMs);
  }

  function drawTarget(world: World): void {
    const center = spec.targetDistU ?? goodBandMaxDistU(world);
    const drawn = gaussian(spec.rng, center, spec.timingSigmaU);
    const ceilingU = world.stats.parryRadiusU * MAX_TARGET_DIST_FACTOR;
    targetDistU = Math.min(Math.max(drawn, MIN_TARGET_DIST_U), ceilingU);
    closestSeenU = Number.POSITIVE_INFINITY;
    armed = true;
  }

  function press(atMs: number): void {
    // 반응 지연만큼 뒤의 시각을 찍는다. 그 사이에 탄이 지나가면 그대로 빈 패리가 된다
    input.pressKey({
      code: KEY.parry,
      atMs: atMs + REACTION_STEPS * FIXED_DT_SEC * MS_PER_SEC,
      shiftHeld: false,
      repeat: false,
    });
    input.releaseKey(KEY.parry);
    armed = false;
  }

  return {
    input,
    get targetDistU(): number {
      return targetDistU;
    },

    beginStep(run: Run): number {
      const world = run.world;
      const atMs = world.simTimeSec * MS_PER_SEC;
      input.beginFrame(atMs);

      const shot = nearestApproaching(world);
      steer(world, shot, atMs);

      // 쿨다운 중에는 시행 자체가 없다. 선입력으로 밀어 넣으면 발동 시각이 봇의 판단을 떠난다
      if (world.simTimeSec < world.parry.cooldownUntilSec || world.parry.isActive) {
        armed = false;
        return atMs;
      }
      if (!armed) {
        drawTarget(world);
      }
      if (shot === null) {
        return atMs;
      }
      const distU = predictedDistU(world, shot);
      if (distU <= targetDistU) {
        press(atMs);
        return atMs;
      }
      /**
       * 약속한 거리에 못 닿은 채로 최근접을 지났으면 늦게라도 누른다.
       *
       * 이것이 없으면 목표 거리를 작게 뽑은 시행이 **아예 눌리지 않아** 시행 자체가 사라지고,
       * 빈 패리가 구조적으로 나오지 않는다. 그러면 성공률이 sigma에 거의 반응하지 않아
       * 캘리브레이션의 이분법이 표적 50%를 감쌀 구간을 못 찾는다.
       */
      if (distU > closestSeenU + LATE_PRESS_MARGIN_U) {
        press(atMs);
        return atMs;
      }
      closestSeenU = Math.min(closestSeenU, distU);
      return atMs;
    },
  };
}
