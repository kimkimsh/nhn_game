/**
 * 동시 존재 상한 셋 — 스펙 §3.2, 05_시스템_설계.md §2.
 *
 * 셋의 처리 방식이 서로 다르고, 그 차이가 이 파일이 존재하는 이유 전부다. 하나의 일반화된
 * "상한 처리"로 묶으면 테스트는 통과하는데 게임 감각이 틀어진다.
 *
 *   적 탄환  신규 발사를 억제한다. 화면의 탄을 지우지 않는다 — 이미 날아오는 탄이 사라지면
 *            플레이어가 읽고 있던 정보가 증발한다. 억제된 발사는 취소되고 다음 주기를 기다린다
 *   반사탄    가장 오래된 것을 회수해서라도 신규를 만든다. 패리는 언제나 성립해야 한다
 *   잡몹      신규 스폰을 지연시킨다. 예정 편성은 취소되지 않는다
 *
 * 그래서 함수 셋의 반환형이 서로 다르다. 억제와 지연은 "이번엔 안 만든다"라서 boolean이고,
 * 반사탄만 실패할 수 없어서 슬롯 자체를 돌려준다.
 */
import { STAGE_SCALING } from '../config/difficulty';
import { PLAYFIELD } from '../config/playfield';
import type { Projectile } from './bullets';
import type { Enemy, World } from './world';

/**
 * §3.2 적 탄환 상한. 스테이지마다 다른 값이라 유일 소스가 difficulty.ts다.
 * 거짓이면 그 발사는 취소된다 — 다음 발사 주기를 기다리는 것이지 미뤄 두는 것이 아니다.
 */
export function canFireEnemyBullet(world: World): boolean {
  return world.enemyBullets.activeCount < STAGE_SCALING[world.stageId].maxEnemyBullets;
}

/**
 * §3.2 반사탄 상한. 05 §1의 13번이 9번보다 뒤에 있는 이유가 이 함수의 형태다 —
 * 상한에 걸렸다는 이유로 신규 반사탄을 버리면 그 순간의 패리가 실패하고, 스펙은 패리가 언제나
 * 성립해야 한다고 못 박았다. 그래서 여유가 없으면 가장 오래된 반사탄을 회수해서 자리를 만든다.
 *
 * 풀 용량이 곧 상한이므로 초과 상태 자체가 만들어지지 않는다. 13번이 따로 훑을 대상이 없는
 * 것은 그 때문이고, 정리가 사라진 것이 아니라 만들어지는 자리로 옮겨 온 것이다.
 */
export function acquireReflectSlot(world: World): Projectile {
  return world.reflectBullets.acquireRecyclingOldest();
}

/**
 * §3.2 잡몹 상한. 거짓이면 편성을 취소하지 않고 상한 아래로 내려갈 때까지 기다린다 —
 * 취소하면 웨이브 설계가 무의미해진다.
 */
export function canSpawnEnemy(world: World): boolean {
  return world.enemies.activeCount < PLAYFIELD.maxEnemies;
}

/** 상한을 넘기지 않는 스폰. 지연이 걸린 스텝에서는 null이고, 부르는 쪽이 편성을 들고 있는다 */
export function acquireEnemySlot(world: World): Enemy | null {
  if (!canSpawnEnemy(world)) {
    return null;
  }
  return world.enemies.acquire();
}
