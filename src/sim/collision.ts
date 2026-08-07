/**
 * 피격과 명중 — 스펙 §4.2 · §7.3, 05_시스템_설계.md §5. 05 §1의 10번과 11번.
 *
 * ── 10번만 스윕을 쓴다 ──────────────────────────────────────────────────────────
 *
 * 선분은 발사체 궤적이 아니라 상대 변위 `Δ = 발사체 이동 − 플레이어 이동`이고 대상은 정지한
 * 코어 원이다. 발사체 선분 대 프레임 끝 플레이어 원으로 잡으면 둘이 마주 보고 움직일 때
 * 최근접이 스텝 중간에 생겨 여전히 뚫린다. 11번은 한 스텝 상대 이동보다 반경 합이 커서 점
 * 표본으로 충분하다.
 *
 * ── 처리 순서의 0단계 ───────────────────────────────────────────────────────────
 *
 * 보호막을 먼저 보지 않고 라이프 −1로 시작하면 E03은 스냅샷에만 존재하고 게임에는 없다.
 * 보호막이 막은 것은 피격이 성립하지 않은 것이므로 라이프도 콤보도 건드리지 않는다.
 *
 * ── 2단계의 예외 둘 ─────────────────────────────────────────────────────────────
 *
 * 지우는 것은 적 탄환뿐이다. 반사탄은 플레이어의 자산이라 남기되, 나를 맞힌 그 반사탄 하나는
 * 지운다 — 무적이 끝난 직후 같은 탄에 다시 맞는 것을 막는다.
 */
import { PLAYER } from '../config/player';
import { HITSTOP_SEC } from '../config/feel';
import type { PlayerHitCause } from '../core/bus';
import { distanceSq, lengthOf } from '../core/vec';
import { NO_HIT, sweepRelativeCircle } from '../core/sweep';
import type { Projectile } from './bullets';
import { grantHitInvuln, isPlayerInvulnerable } from './player';
import { addScore, resetCombo, type Enemy, type World } from './world';

interface HitCandidate {
  cause: PlayerHitCause;
  projectile: Projectile | null;
  dirX: number;
  dirY: number;
  entryT: number;
}

/** 스텝마다 덮어쓴다. 한 스텝에 성립하는 피격은 어차피 하나뿐이다 — 그 뒤는 무적이 먹는다 */
const bestHit: HitCandidate = { cause: 'enemyBullet', projectile: null, dirX: 0, dirY: 0, entryT: 0 };

function considerProjectile(
  world: World,
  projectile: Projectile,
  cause: PlayerHitCause,
  bestT: number,
): number {
  const player = world.player;
  const entryT = sweepRelativeCircle(
    projectile.prevXU,
    projectile.prevYU,
    projectile.xU,
    projectile.yU,
    player.prevXU,
    player.prevYU,
    player.xU,
    player.yU,
    projectile.radiusU + PLAYER.hitRadiusU,
  );
  if (entryT === NO_HIT || entryT >= bestT) {
    return bestT;
  }
  const speedUPerSec = lengthOf(projectile.vxUPerSec, projectile.vyUPerSec);
  bestHit.cause = cause;
  bestHit.projectile = projectile;
  bestHit.dirX = speedUPerSec === 0 ? 0 : projectile.vxUPerSec / speedUPerSec;
  bestHit.dirY = speedUPerSec === 0 ? 0 : projectile.vyUPerSec / speedUPerSec;
  bestHit.entryT = entryT;
  return entryT;
}

function considerEnemyBody(world: World, enemy: Enemy, bestT: number): number {
  const player = world.player;
  const entryT = sweepRelativeCircle(
    enemy.prevXU,
    enemy.prevYU,
    enemy.xU,
    enemy.yU,
    player.prevXU,
    player.prevYU,
    player.xU,
    player.yU,
    enemy.hitRadiusU + PLAYER.hitRadiusU,
  );
  if (entryT === NO_HIT || entryT >= bestT) {
    return bestT;
  }
  const towardPlayerXU = player.xU - enemy.xU;
  const towardPlayerYU = player.yU - enemy.yU;
  const lengthU = lengthOf(towardPlayerXU, towardPlayerYU);
  bestHit.cause = 'body';
  bestHit.projectile = null;
  bestHit.dirX = lengthU === 0 ? 0 : towardPlayerXU / lengthU;
  bestHit.dirY = lengthU === 0 ? 0 : towardPlayerYU / lengthU;
  bestHit.entryT = entryT;
  return entryT;
}

/**
 * 05 §1의 10번. 9번(패리)이 이미 돌았으므로 이번 스텝에 패리된 발사체는 여기 오지 않는다 —
 * 소유권이 바뀌었고 자해 유예가 붙었다.
 */
export function resolvePlayerHits(world: World): void {
  // §13.3 라이프 0은 즉시 정지다. 화면 전환은 screens/가 하지만, 그 사이에도 스텝이 도는 이상
  // 여기서 막지 않으면 라이프가 음수로 내려가고 결과 화면이 그 값을 그대로 읽는다
  if (world.isGameOver || isPlayerInvulnerable(world)) {
    return;
  }
  let bestT = Number.POSITIVE_INFINITY;
  for (const projectile of world.enemyBullets.active) {
    bestT = considerProjectile(world, projectile, 'enemyBullet', bestT);
  }
  for (const projectile of world.reflectBullets.active) {
    // §7.1 자해 유예 동안은 피격 판정을 하지 않는다
    if (projectile.graceRemainingSec > 0) {
      continue;
    }
    bestT = considerProjectile(world, projectile, 'reflectedBullet', bestT);
  }
  for (const enemy of world.enemies.active) {
    if (!enemy.contactDamage) {
      continue;
    }
    bestT = considerEnemyBody(world, enemy, bestT);
  }
  if (bestT === Number.POSITIVE_INFINITY) {
    return;
  }
  applyPlayerHit(world, bestHit.cause, bestHit.projectile, bestHit.dirX, bestHit.dirY);
}

/**
 * §4.2의 0~6단계. 장판(§4.3)도 여기로 들어오므로 원인을 인자로 받는다.
 *
 * 0단계에서 끝나는 경로는 라이프도 콤보도 줄이지 않고, 피격을 일으킨 반사탄도 지우지 않는다 —
 * 피격이 성립하지 않았으므로 2단계 자체를 지나지 않는다. 히트스톱은 준다: 무언가 막혔다는
 * 사실은 읽혀야 하는 사건이다.
 */
export function applyPlayerHit(
  world: World,
  cause: PlayerHitCause,
  source: Projectile | null,
  dirX: number,
  dirY: number,
): void {
  const player = world.player;
  if (world.run.shieldCharges > 0) {
    world.run.shieldCharges -= 1;
    grantHitInvuln(world);
    world.clock.requestHitstop(HITSTOP_SEC.playerHit, world.simTimeSec);
    world.bus.emit({ kind: 'shieldBlocked', xU: player.xU, yU: player.yU });
    return;
  }

  player.lives -= 1;

  const clearRadiusSqU = PLAYER.hitClearRadiusU * PLAYER.hitClearRadiusU;
  world.enemyBullets.releaseWhere(
    (projectile) =>
      distanceSq(player.xU, player.yU, projectile.xU, projectile.yU) <= clearRadiusSqU,
  );
  if (source !== null && source.owner === 'player') {
    world.reflectBullets.release(source);
  }

  grantHitInvuln(world);
  resetCombo(world);
  world.clock.requestHitstop(HITSTOP_SEC.playerHit, world.simTimeSec);
  world.bus.emit({ kind: 'playerHit', cause, xU: player.xU, yU: player.yU, dirX, dirY });

  if (player.lives <= 0) {
    world.isGameOver = true;
  }
}

/**
 * §7.3 "정면". 반사탄이 위를 향하고(vy < 0) 세로 성분이 가로 성분보다 클 때다.
 * 이 판정이 곧 정답 행동을 만든다 — 원형 거울 반사로 각도를 틀어 옆에서 때린다.
 */
function isFrontal(projectile: Projectile): boolean {
  return (
    projectile.vyUPerSec < 0 && Math.abs(projectile.vyUPerSec) > Math.abs(projectile.vxUPerSec)
  );
}

function killEnemy(world: World, enemy: Enemy): void {
  addScore(world, enemy.scoreValue);
  world.bus.emit({
    kind: 'enemyKilled',
    parrySeq: world.parrySeq,
    chainIndex: world.chainIndex,
    xU: enemy.xU,
    yU: enemy.yU,
  });
  world.chainIndex += 1;
  world.enemies.release(enemy);
}

/**
 * 05 §1의 11번. 점 표본이다 — 한 스텝 상대 이동이 반경 합을 넘지 못한다.
 * 자해 유예는 여기에 걸리지 않는다: 유예가 막는 것은 플레이어 피격과 패리뿐이다(§7.1).
 */
export function resolveReflectHits(world: World): void {
  const bonusU = world.stats.reflectHitRadiusBonusU;
  const enemies = world.enemies.active;
  world.reflectBullets.releaseWhere((projectile) => {
    // 처치가 활성 목록에서 원소를 빼므로 for...of로 돌 수 없다 — 빠진 자리로 다음 원소가
    // 당겨져 한 기를 건너뛴다. 인덱스를 되돌리는 것이 관통이 여러 기를 훑는 경로를 살린다
    for (let index = 0; index < enemies.length; index += 1) {
      const enemy = enemies[index];
      if (enemy === undefined) {
        continue;
      }
      const reachU = enemy.hitRadiusU + projectile.radiusU + bonusU;
      if (distanceSq(enemy.xU, enemy.yU, projectile.xU, projectile.yU) > reachU * reachU) {
        continue;
      }
      if (enemy.frontShieldIntact && isFrontal(projectile)) {
        enemy.frontShieldIntact = false;
        world.bus.emit({ kind: 'shieldBlocked', xU: enemy.xU, yU: enemy.yU });
        return true;
      }
      enemy.hp -= projectile.damage;
      world.bus.emit({ kind: 'reflectHit', xU: enemy.xU, yU: enemy.yU });
      if (enemy.hp <= 0) {
        killEnemy(world, enemy);
        index -= 1;
      }
      if (projectile.pierceRemaining > 0) {
        projectile.pierceRemaining -= 1;
        continue;
      }
      return true;
    }
    return false;
  });
}
