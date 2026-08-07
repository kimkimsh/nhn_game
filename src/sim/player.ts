/**
 * 플레이어 — 스펙 §4.1 이동, §4.2·§5.1 무적. 05_시스템_설계.md §1의 3번과 §5.1.
 *
 * 무적을 한 필드에 담지 않는 것이 이 파일의 함정이다. 피격 무적이 도는 중에도 패리는 성립하고
 * 성립하면 패리 무적이 다시 설정되므로 두 개가 동시에 살아 있는 구간이 실재한다. 한 필드에
 * 쓰면 짧은 쪽이 긴 쪽을 덮어써 피격 보호가 잘린다. 실효 보호는 언제나 둘 중 큰 쪽이다.
 *
 * 무적은 남은 시간이 아니라 만료 시각으로 들고 있다. 겹칠 때 "남은 시간에 더하지 않고 다시
 * 설정한다"(§5.1)가 대입 한 줄이 되고, 두 종류를 비교하는 것도 max 한 번이 된다.
 */
import { PLAYER } from '../config/player';
import { PLAYFIELD } from '../config/playfield';
import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { lengthOf } from '../core/vec';
import type { World } from './world';

export interface Player {
  xU: number;
  yU: number;
  /** 05 §1의 8번이 저장하는 것과 같은 뜻이다 — 10번의 상대 변위 스윕이 이 값에서 선분을 만든다 */
  prevXU: number;
  prevYU: number;
  lives: number;
  /** §4.2 피격 무적의 만료 시각 (누적 sim 초) */
  hitInvulnUntilSec: number;
  /** §5.1 패리 무적의 만료 시각 (누적 sim 초). 패리가 성립했을 때만 미래로 간다 */
  parryInvulnUntilSec: number;
  /** 종료를 사건으로 한 번만 알리기 위한 직전 상태. §17이 무적 종료를 읽을 수 있게 요구한다 */
  hitInvulnWasActive: boolean;
  parryInvulnWasActive: boolean;
}

export function createPlayer(): Player {
  const bounds = PLAYFIELD.playerBounds;
  const startXU = (bounds.minXU + bounds.maxXU) / 2;
  const startYU = (bounds.minYU + bounds.maxYU) / 2;
  return {
    xU: startXU,
    yU: startYU,
    prevXU: startXU,
    prevYU: startYU,
    lives: PLAYER.startLife,
    hitInvulnUntilSec: 0,
    parryInvulnUntilSec: 0,
    hitInvulnWasActive: false,
    parryInvulnWasActive: false,
  };
}

/**
 * 05 §1의 3번. 이전 위치를 여기서 남긴다 — 10번의 스윕 선분이 플레이어 쪽 변위를 이 두 값에서
 * 만들고, 8번의 발사체 적분과 같은 스텝의 값이어야 상대 변위가 성립한다.
 *
 * 대각선을 정규화하지 않으면 최적 이동이 대각선 하나가 되어 §4.1의 8방향이 사실상 4방향이 된다.
 */
export function movePlayer(world: World, dtSec: number, input: Input): void {
  const player = world.player;
  player.prevXU = player.xU;
  player.prevYU = player.yU;

  let dirX = 0;
  let dirY = 0;
  if (input.isDown('moveLeft')) {
    dirX -= 1;
  }
  if (input.isDown('moveRight')) {
    dirX += 1;
  }
  if (input.isDown('moveUp')) {
    dirY -= 1;
  }
  if (input.isDown('moveDown')) {
    dirY += 1;
  }

  const length = lengthOf(dirX, dirY);
  if (length === 0) {
    return;
  }
  const stepU = (world.stats.moveSpeedUPerSec * dtSec) / length;
  const bounds = PLAYFIELD.playerBounds;
  player.xU = clamp(player.xU + dirX * stepU, bounds.minXU, bounds.maxXU);
  player.yU = clamp(player.yU + dirY * stepU, bounds.minYU, bounds.maxYU);
}

/** §4.2 · §5.1 실효 보호. 둘 중 하나라도 살아 있으면 무해하다 */
export function isPlayerInvulnerable(world: World): boolean {
  const player = world.player;
  return (
    world.simTimeSec < player.hitInvulnUntilSec || world.simTimeSec < player.parryInvulnUntilSec
  );
}

/** §5.1 겹쳐도 남은 시간에 더하지 않는다 */
export function grantParryInvuln(world: World): void {
  world.player.parryInvulnUntilSec = world.simTimeSec + world.stats.parryInvulnSec;
}

export function grantHitInvuln(world: World): void {
  world.player.hitInvulnUntilSec = world.simTimeSec + world.stats.hitInvulnSec;
}

/**
 * 두 무적의 종료를 각각 한 번씩만 사건으로 낸다. 05 §1의 1번(타이머 감산) 자리에서 부른다 —
 * 만료 시각을 쓰는 이상 "이번 스텝에 끝났다"를 알 방법이 직전 상태와의 대조뿐이다.
 */
export function announceInvulnEnd(world: World): void {
  const player = world.player;
  const hitActive = world.simTimeSec < player.hitInvulnUntilSec;
  if (player.hitInvulnWasActive && !hitActive) {
    world.bus.emit({ kind: 'invulnEnded', source: 'playerHit' });
  }
  player.hitInvulnWasActive = hitActive;

  const parryActive = world.simTimeSec < player.parryInvulnUntilSec;
  if (player.parryInvulnWasActive && !parryActive) {
    world.bus.emit({ kind: 'invulnEnded', source: 'parry' });
  }
  player.parryInvulnWasActive = parryActive;
}
