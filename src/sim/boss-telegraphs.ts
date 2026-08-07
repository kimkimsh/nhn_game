/**
 * 예고가 붙는 두 프리미티브 — `charge`(돌진 방향선)와 `mortar`(착탄 예고 원). 스펙 §6.2 · §10.
 *
 * 나머지 일곱과 갈라 둔 이유는 파일 길이가 아니라 규칙이다. HR-05는 예고 도형을 「패리로 지울 수
 * 없는 공격」에만 붙이고, HR-09의 억제는 「예고 표시가 없는 탄환」에만 건다. 그 둘이 정확히
 * 여기 있는 것과 `boss-shots.ts`에 있는 것을 가른다 — 이 파일의 둘은 예고를 **반드시** 발행하고
 * 억제 검사를 받지 않으며, 예고 없이 실행되면 `guards.ts`가 오류를 낸다.
 *
 * 억제하면 B4의 곡사 포격과 B2·B3·B5의 돌진이 근거리에서 통째로 사라지는데, §6.2가 근접 위협을
 * 담당시킨 수단이 바로 그것들이다.
 *
 * 후속(`onEnd` · `onImpact`)은 여기서 시작하지 않고 `FollowUp`으로 돌려준다. 패턴을 시작하는 것은
 * `boss-runner.ts`의 일이고, 여기서 부르면 두 파일이 서로의 값을 부르게 된다.
 */
import { PLAYFIELD } from '../config/playfield';
import type { BossPattern } from '../config/types';
import { aimAt, distance } from '../core/vec';
import { bossStrafeXU, releasePatternPosition, type BossState, type BossTelegraph } from './boss';
import { GUARDS_ENABLED, checkHR05 } from './guards';
import { DOWN_RAD, effectiveSpeedUPerSec, fireBossShot } from './boss-shots';
import { applyPlayerHit } from './collision';
import { isPlayerInvulnerable } from './player';
import { spawnFireZone, type ZoneWorld } from './zones';

export type ChargePattern = Extract<BossPattern, { readonly kind: 'charge' }>;
export type MortarPattern = Extract<BossPattern, { readonly kind: 'mortar' }>;

/** 후속 패턴 요청. 어디서 시작할지까지가 요청의 내용이다 — 후속은 보스를 따라가지 않는다 */
export interface FollowUp {
  readonly pattern: BossPattern;
  readonly xU: number;
  readonly yU: number;
}

/** §10.3 · §10.4 · §10.6 돌진의 네 구간. 경계 시각은 시작 시점에 전부 정해진다 */
export interface ChargeRun {
  readonly startXU: number;
  readonly startYU: number;
  readonly targetXU: number;
  readonly targetYU: number;
  readonly travelSec: number;
  readonly returnSec: number;
  telegraph: BossTelegraph | null;
  landed: boolean;
  /** duringInterval이 이미 흘린 탄 수 */
  trailFired: number;
}

export function pushTelegraph(boss: BossState, telegraph: BossTelegraph): BossTelegraph {
  boss.telegraphs.push(telegraph);
  return telegraph;
}

export function dropTelegraph(boss: BossState, telegraph: BossTelegraph): void {
  const at = boss.telegraphs.indexOf(telegraph);
  if (at >= 0) {
    boss.telegraphs.splice(at, 1);
  }
}

/**
 * 방향선을 띄우고 돌진 구간의 길이를 확정한다. 방향선이 떠 있는 동안 본체를 세우는 것이
 * `positionOwnedByPattern` 대입이다 — 좌우 왕복을 계속하면 예고가 끝날 때 보스가 선이 그려진
 * 자리에 없고, 그 선은 HR-04가 안전 지대를 약속한 근거다.
 */
export function startCharge(
  world: ZoneWorld,
  boss: BossState,
  pattern: ChargePattern,
): ChargeRun {
  const startXU = boss.xU;
  const startYU = boss.yU;
  // targetYU가 null이면 §10.3의 「플레이어 위치로」다. 값이 있으면 §10.4·§10.6의 충각 돌진이라
  // 세로로만 밀고 내려간다 — 폭 860u짜리 선체가 가로로도 따라오면 안전 지대가 남지 않는다
  const targetXU = pattern.targetYU === null ? world.player.xU : startXU;
  const targetYU = pattern.targetYU ?? world.player.yU;
  const travelU = distance(startXU, startYU, targetXU, targetYU);
  const travelSec = pattern.speedUPerSec > 0 ? travelU / pattern.speedUPerSec : 0;
  const run: ChargeRun = {
    startXU,
    startYU,
    targetXU,
    targetYU,
    travelSec,
    returnSec: pattern.returnToStart ? travelSec : 0,
    telegraph: null,
    landed: false,
    trailFired: 0,
  };
  boss.positionOwnedByPattern = true;
  boss.returnHomeRemainingSec = 0;
  run.telegraph = pushTelegraph(boss, {
    shape: 'dash',
    xU: startXU,
    yU: startYU,
    radiusU: 0,
    widthU: pattern.safeCorridorU,
    angleRad: aimAt(startXU, startYU, targetXU, targetYU),
    lengthU: travelU,
    ageSec: 0,
    durationSec: pattern.telegraphSec,
  });
  if (GUARDS_ENABLED) {
    checkHR05('dash', 'bossCharge');
  }
  world.bus.emit({ kind: 'telegraph', shape: 'dash', xU: startXU, yU: startYU });
  return run;
}

export function chargeDurationSec(pattern: ChargePattern, run: ChargeRun): number {
  return pattern.telegraphSec + run.travelSec + pattern.holdSec + run.returnSec;
}

/** §10.3 페이즈 3 「돌진 중 0.2초 간격으로 수리검을 흘리며 이동」. 조준하지 않고 흘린다 */
function fireChargeTrail(
  world: ZoneWorld,
  boss: BossState,
  pattern: ChargePattern,
  run: ChargeRun,
  travelElapsedSec: number,
): void {
  const trail = pattern.duringInterval;
  if (trail === undefined || trail.intervalSec <= 0) {
    return;
  }
  const dueCount = Math.floor(travelElapsedSec / trail.intervalSec) + 1;
  const speedUPerSec = effectiveSpeedUPerSec(world, trail.bullet, undefined, undefined);
  while (run.trailFired < dueCount) {
    fireBossShot(world, trail.bullet, boss.xU, boss.yU, DOWN_RAD, speedUPerSec);
    run.trailFired += 1;
  }
}

/** 착지한 스텝에만 `onEnd`를 돌려준다. 그 뒤 스텝은 null이다 */
export function stepCharge(
  world: ZoneWorld,
  boss: BossState,
  pattern: ChargePattern,
  run: ChargeRun,
  elapsedSec: number,
  dtSec: number,
): FollowUp | null {
  const travelEndSec = pattern.telegraphSec + run.travelSec;
  const holdEndSec = travelEndSec + pattern.holdSec;

  if (elapsedSec < pattern.telegraphSec) {
    if (run.telegraph !== null) {
      run.telegraph.ageSec += dtSec;
    }
    return null;
  }
  if (run.telegraph !== null) {
    dropTelegraph(boss, run.telegraph);
    run.telegraph = null;
  }

  if (elapsedSec < travelEndSec) {
    const t = run.travelSec > 0 ? (elapsedSec - pattern.telegraphSec) / run.travelSec : 1;
    boss.xU = run.startXU + (run.targetXU - run.startXU) * t;
    boss.yU = run.startYU + (run.targetYU - run.startYU) * t;
    fireChargeTrail(world, boss, pattern, run, elapsedSec - pattern.telegraphSec);
    return null;
  }

  let followUp: FollowUp | null = null;
  if (!run.landed) {
    run.landed = true;
    boss.xU = run.targetXU;
    boss.yU = run.targetYU;
    const travelU = distance(run.startXU, run.startYU, run.targetXU, run.targetYU);
    const dirX = travelU === 0 ? 0 : (run.targetXU - run.startXU) / travelU;
    const dirY = travelU === 0 ? 1 : (run.targetYU - run.startYU) / travelU;
    world.bus.emit({ kind: 'bossChargeLand', xU: boss.xU, yU: boss.yU, dirX, dirY });
    if (pattern.onEnd !== null) {
      followUp = { pattern: pattern.onEnd, xU: boss.xU, yU: boss.yU };
    }
  }
  if (elapsedSec < holdEndSec) {
    return followUp;
  }
  if (run.returnSec <= 0) {
    // §10.3 복귀가 없는 돌진도 도착지에 눌러앉지는 않는다. 좌표를 그냥 놓으면 다음 스텝의
    // 왕복이 보스를 정위치로 순간이동시키고, 그 한 스텝 동안 HR-08이 정위치 밖을 본다
    releasePatternPosition(boss);
    return followUp;
  }
  // 복귀 목표는 돌진 시작 좌표가 아니라 **지금의** 왕복 좌표다. 시작 좌표로 되돌리면 그 사이
  // 흐른 몇 초만큼 왕복이 앞서 있어서, 복귀가 끝나 왕복이 다시 본체를 쥐는 순간 그 차이가
  // 한 스텝짜리 순간이동으로 나타난다
  const t = Math.min(1, (elapsedSec - holdEndSec) / run.returnSec);
  boss.xU = run.targetXU + (bossStrafeXU(world, boss) - run.targetXU) * t;
  boss.yU = run.targetYU + (boss.homeYU - run.targetYU) * t;
  if (t >= 1) {
    releasePatternPosition(boss);
  }
  return followUp;
}

export function spawnMortarCircle(
  world: ZoneWorld,
  boss: BossState,
  pattern: MortarPattern,
): BossTelegraph {
  const bounds = PLAYFIELD.playerBounds;
  // §10.5 연쇄 포격만 추적 배치다. 나머지는 플레이어 이동 영역 안의 무작위 지점이고,
  // 그 영역 밖에 놓으면 피할 것이 없는 예고가 된다
  const xU = pattern.trackPlayer ? world.player.xU : world.rng.range(bounds.minXU, bounds.maxXU);
  const yU = pattern.trackPlayer ? world.player.yU : world.rng.range(bounds.minYU, bounds.maxYU);
  if (GUARDS_ENABLED) {
    checkHR05('impactCircle', 'P7');
  }
  world.bus.emit({ kind: 'telegraph', shape: 'impactCircle', xU, yU });
  return pushTelegraph(boss, {
    shape: 'impactCircle',
    xU,
    yU,
    radiusU: pattern.radiusU,
    widthU: 0,
    angleRad: 0,
    lengthU: 0,
    ageSec: 0,
    durationSec: pattern.telegraphSec,
  });
}

/**
 * 예고 원이 사라지는 순간의 폭발. 판정이 머무는 구간은 없다(§6.2).
 *
 * 폭발 자체가 피해다 — §10.5 연쇄 포격은 후속도 장판도 갖지 않으므로 여기서 피해를 주지 않으면
 * 그 패턴은 아무 일도 일으키지 않는다. 원인이 'zone'인 것은 §4.2의 넷 중 「패리로 지울 수 없는
 * 광역」이 그것뿐이기 때문이다.
 *
 * 05 §1의 9번(패리)보다 앞선 7번에서 피격이 확정되지만 순서 문제가 아니다 — 폭발은 패리 대상이
 * 아니라서 ①이 지키려는 「패리가 피격보다 먼저」가 걸리는 자리가 없다.
 */
export function explodeMortarCircle(
  world: ZoneWorld,
  boss: BossState,
  pattern: MortarPattern,
  circle: BossTelegraph,
): FollowUp | null {
  dropTelegraph(boss, circle);
  const player = world.player;
  if (
    !world.isGameOver &&
    !isPlayerInvulnerable(world) &&
    distance(circle.xU, circle.yU, player.xU, player.yU) <= pattern.radiusU
  ) {
    applyPlayerHit(world, 'zone', null, 0, 1);
  }
  // spawnsZone.radiusU는 읽지 않는다 — P9의 반경도 지속도 `sim/zones.ts`가 탄환 표에서 읽으므로
  // 이쪽에서 다시 넘기면 같은 값의 두 번째 소스가 된다
  if (pattern.spawnsZone !== undefined) {
    spawnFireZone(world, circle.xU, circle.yU);
  }
  return pattern.onImpact === null
    ? null
    : { pattern: pattern.onImpact, xU: circle.xU, yU: circle.yU };
}
