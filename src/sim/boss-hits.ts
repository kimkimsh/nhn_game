/**
 * 보스 명중 판정 — 반사탄 대 보스(05 §1의 11번)와 본체 접촉(10번).
 * `sim/collision.ts`의 잡몹 판정과 나란히 부른다.
 *
 * ── 부위를 본체보다 먼저 판정한다 (05 §8.3) ─────────────────────────────────────
 *
 * B3 선체 히트박스가 포문 넷의 좌표를 전부 덮는다. 명중을 배열 순서로 풀면 선체가 먼저 걸려
 * **반사탄이 포문에 도달할 방법이 없다** — 목업이 그렇게 고장나 있었고, 그러면 §10.4가 이 보스의
 * 유일한 새 축이라고 적은 「어느 포문을 먼저 부술지」가 실행되지 않는다. 겹치는 히트박스에서
 * 어느 쪽이 이기는지는 배열 순서가 아니라 규칙이 정한다.
 *
 * 훑는 순서는 **부위 → 부하 → 본체**다. 파괴된 부위는 건너뛰므로 그 자리는 그때부터 본체
 * 판정으로 넘어간다.
 *
 * ── 도형이 원이 아니다 ──────────────────────────────────────────────────────────
 *
 * 선체와 포문이 사각형이라 `core/sweep.ts`의 선분–AABB를 쓴다(12 §10 E-04). A14의 부하 조총병만
 * 잡몹과 같은 원이고, 그쪽은 `EnemyDef.hitRadiusU`에서 온다.
 */
import { PLAYER } from '../config/player';
import { NO_HIT, sweepRelativeBox, sweepRelativeCircle } from '../core/sweep';
import {
  applyBossDamage,
  isBossInvulnerable,
  type BossPart,
  type BossState,
} from './boss';
import type { Projectile } from './bullets';
import type { World } from './world';

function sweepPart(projectile: Projectile, part: BossPart): number {
  return sweepRelativeBox(
    projectile.prevXU,
    projectile.prevYU,
    projectile.xU,
    projectile.yU,
    part.prevXU,
    part.prevYU,
    part.xU,
    part.yU,
    part.def.hitBox.wU / 2,
    part.def.hitBox.hU / 2,
    projectile.radiusU,
  );
}

function sweepBody(projectile: Projectile, boss: BossState): number {
  return sweepRelativeBox(
    projectile.prevXU,
    projectile.prevYU,
    projectile.xU,
    projectile.yU,
    boss.prevXU,
    boss.prevYU,
    boss.xU,
    boss.yU,
    boss.def.hitBox.wU / 2,
    boss.def.hitBox.hU / 2,
    projectile.radiusU,
  );
}

/** 관통이 남아 있으면 발사체를 살린다. 참을 돌려주면 그 자리에서 회수된다 */
function consumePierce(projectile: Projectile): boolean {
  if (projectile.pierceRemaining > 0) {
    projectile.pierceRemaining -= 1;
    return false;
  }
  return true;
}

/** 겹친 부위 중 가장 먼저 닿는 하나. 없으면 null이고 그때만 부하와 본체를 본다 */
function nearestPart(projectile: Projectile, boss: BossState): BossPart | null {
  let best: BossPart | null = null;
  let bestT = Number.POSITIVE_INFINITY;
  for (const part of boss.parts) {
    if (part.destroyed) {
      continue;
    }
    const entryT = sweepPart(projectile, part);
    if (entryT !== NO_HIT && entryT < bestT) {
      bestT = entryT;
      best = part;
    }
  }
  return best;
}

export function resolveBossHits(world: World, boss: BossState): void {
  if (boss.isFinished || isBossInvulnerable(boss)) {
    return;
  }
  const bonusU = world.stats.reflectHitRadiusBonusU;
  world.reflectBullets.releaseWhere((projectile) => {
    const part = nearestPart(projectile, boss);
    if (part !== null) {
      applyBossDamage(world, boss, part, projectile.damage);
      world.bus.emit({ kind: 'reflectHit', xU: part.xU, yU: part.yU });
      return consumePierce(projectile);
    }

    for (const satellite of boss.satellites) {
      const entryT = sweepRelativeCircle(
        projectile.prevXU,
        projectile.prevYU,
        projectile.xU,
        projectile.yU,
        satellite.prevXU,
        satellite.prevYU,
        satellite.xU,
        satellite.yU,
        satellite.hitRadiusU + projectile.radiusU + bonusU,
      );
      if (entryT === NO_HIT) {
        continue;
      }
      applyBossDamage(world, boss, null, projectile.damage);
      world.bus.emit({ kind: 'reflectHit', xU: satellite.xU, yU: satellite.yU });
      return consumePierce(projectile);
    }

    if (sweepBody(projectile, boss) === NO_HIT) {
      return false;
    }
    applyBossDamage(world, boss, null, projectile.damage);
    world.bus.emit({ kind: 'reflectHit', xU: projectile.xU, yU: projectile.yU });
    return consumePierce(projectile);
  });
}

/**
 * §10.1 「본체 접촉 시 피격」. 판정만 하고 피해는 주지 않는다 — 피격 확정은 05 §1의 10번이
 * 한 스텝에 하나만 고르는 일이고, 그 선택은 `sim/collision.ts`가 갖는다.
 */
export function bossBodyHitsPlayer(world: World, boss: BossState): boolean {
  if (boss.isFinished || isBossInvulnerable(boss)) {
    return false;
  }
  const player = world.player;
  return (
    sweepRelativeBox(
      boss.prevXU,
      boss.prevYU,
      boss.xU,
      boss.yU,
      player.prevXU,
      player.prevYU,
      player.xU,
      player.yU,
      boss.def.hitBox.wU / 2,
      boss.def.hitBox.hU / 2,
      PLAYER.hitRadiusU,
    ) !== NO_HIT
  );
}
