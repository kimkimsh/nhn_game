/**
 * 장판 — 스펙 §4.3 피해 · §5.6 패리 불가 · §6.1 P9 · §9.6 상한 · §11.5 E06 화공.
 * 05_시스템_설계.md §9. 한 스텝에서 1번(지속 시간 감산)과 12번(판정) 둘을 갖는다.
 *
 * ── 판정 도형은 원이 아니라 그려진 7각형 그 자체다 ──────────────────────────────
 *
 * 목업의 장판은 꼭짓점마다 반경이 흔들리는 다각형이라, 판정을 원으로 잡으면 어느 반경을
 * 골라도 오차가 남는다. 바깥 반경을 쓰면 "안 닿았는데 맞았다"와 "닿았는데 안 맞았다"가
 * 동시에 나고, 내접원으로 낮추면 후자만 남을 뿐 사라지지 않는다. 패리로 지울 수 없는
 * 위협이라 그 오차가 그대로 억울한 피격이 된다(10_스펙_목업_불일치.md A20).
 *
 * 그래서 고치는 것은 그림이 아니라 판정이다 — 승인된 다각형은 한 픽셀도 바뀌지 않고
 * sim이 그 외곽선 자체를 판정으로 쓴다(12_통합_계약.md §8-6이 A20의 ⓐ를 택했다).
 * 꼭짓점 식의 유일 소스는 config/feel.ts의 ZONE이고 render/zone.ts가 같은 표를 읽는다.
 *
 * **곱셈 순서까지 render/zone.ts와 같다.** 반경을 먼저 만들고(radiusU × ratio) 거기에
 * cos·sin을 곱한다. 순서를 바꾸면 마지막 비트가 갈라져 경계 위의 점에서 그림과 판정이
 * 어긋나는데, 그 어긋남을 없애려고 이 파일이 있다.
 *
 * ── 판정 대상은 코어의 중심점이다 ───────────────────────────────────────────────
 *
 * 코어 반경만큼 부풀리면 판정 도형이 다각형이 아니라 다각형 + 원이 되고, §17이 요구한
 * "피해 판정 범위와 표시 범위의 일치"가 A20이 잡은 것과 같은 크기로 다시 깨진다.
 * 외곽선을 그대로 판정으로 쓴다는 결정이 성립하는 형태는 점 하나뿐이다.
 *
 * ── world.ts에 아직 zones가 없다 ────────────────────────────────────────────────
 *
 * 05 §1의 12번이 빈 자리라 World에 풀이 없다. 아래 ZoneWorld는 그 한 줄이 붙으면 World와
 * 같아지는 형태이고, 풀을 인자로 따로 받는 형태로 만들면 그 줄이 붙은 뒤에도 인자가 영원히
 * 남는다.
 */
import { BULLETS } from '../config/bullets';
import { ZONE } from '../config/feel';
import type { CardEffect } from '../config/types';
import { createPool, type Pool } from '../core/pool';
import { lengthOf } from '../core/vec';
import { applyPlayerHit } from './collision';
import { isPlayerInvulnerable } from './player';
import { addScore } from './score';
import type { Enemy, World } from './world';

/** §11.5 E06 카드 효과. 반경·지속·초당 데미지 비율의 소스가 config/cards/epic.ts 하나가 된다 */
export type SpawnZoneEffect = Extract<CardEffect, { kind: 'spawnZone' }>;

export interface Zone {
  xU: number;
  yU: number;
  /** §6.1 P9와 §11.5 E06이 서로 다른 값을 갖는다. 꼭짓점 반경 계수가 여기에 곱해진다 */
  radiusU: number;
  /** render/zone.ts의 ZoneView가 이 이름을 그대로 읽는다 — 맥동의 위상이 이 값이다 */
  ageSec: number;
  remainingSec: number;
  /** §11.5 E06만 0보다 크다. P9는 적을 태우지 않는다 */
  enemyDamagePerSec: number;
  /** §4.3 다음 피격 판정까지 남은 시간. 코어가 밖으로 나가면 재진입 즉시 1회를 위해 0이 된다 */
  damageCooldownSec: number;
  /** 진입 사건을 진입마다 한 번만 내기 위한 직전 상태 */
  coreWasInside: boolean;
}

/**
 * world.ts가 World에 `readonly zones: Pool<Zone>` 한 줄을 붙이면 이 별칭은 World와 같아지고
 * 호출부는 world를 그대로 넘긴다.
 */
export type ZoneWorld = World & { readonly zones: Pool<Zone> };

const FULL_TURN_RAD = Math.PI * 2;

/** P9는 적을 태우지 않는다 — 적이 만든 장판이라 적에게 무해하다(§6.1) */
const NO_ENEMY_DAMAGE_PER_SEC = 0;

const VERTEX_COUNT = ZONE.polyVertices;

/**
 * 꼭짓점 하나의 각과 반경 비율. 장판마다 같으므로 radiusU를 곱하기 전 상태로 한 번만 만든다.
 * 세 값을 한 객체로 묶은 것은 판정 루프가 인덱스 없이 돌게 하기 위해서다 — 인덱스로 읽으면
 * 값이 없을 때의 대체값을 적어야 하고, 그 대체값이 곧 틀린 판정 도형이 된다.
 */
interface ZoneVertex {
  readonly cos: number;
  readonly sin: number;
  readonly ratio: number;
}

function makeVertex(index: number): ZoneVertex {
  const angleRad = (index / ZONE.polyVertices) * FULL_TURN_RAD + ZONE.polyStartAngleRad;
  return {
    cos: Math.cos(angleRad),
    sin: Math.sin(angleRad),
    ratio:
      ZONE.polyBaseRatio + ((index * ZONE.polyStrideIndex) % ZONE.polyModulus) * ZONE.polyStepRatio,
  };
}

const ZONE_VERTICES: readonly ZoneVertex[] = Array.from({ length: VERTEX_COUNT }, (_slot, index) =>
  makeVertex(index),
);

/** 교차 판정은 변 단위라 첫 꼭짓점의 짝이 마지막 꼭짓점이다. 같은 함수로 만들어 갈라질 수 없다 */
const LAST_VERTEX = makeVertex(VERTEX_COUNT - 1);

/** 다각형을 완전히 감싸는 원의 반경 비율. 계수 표가 바뀌어도 따라오도록 표에서 구한다 */
const OUTER_RATIO = ZONE_VERTICES.reduce((widest, vertex) => Math.max(widest, vertex.ratio), 0);

function createZone(): Zone {
  return {
    xU: 0,
    yU: 0,
    radiusU: 0,
    ageSec: 0,
    remainingSec: 0,
    enemyDamagePerSec: 0,
    damageCooldownSec: 0,
    coreWasInside: false,
  };
}

function resetZone(zone: Zone): void {
  zone.ageSec = 0;
  zone.enemyDamagePerSec = NO_ENEMY_DAMAGE_PER_SEC;
  zone.damageCooldownSec = 0;
  zone.coreWasInside = false;
}

/**
 * §9.6 상한만큼만 만든다. 풀 용량이 곧 상한이라 초과 상태 자체가 생기지 않는다.
 * P9와 E06이 이 풀 하나를 공유하는 것이 §11.5가 요구한 "같은 6개"다.
 */
export function createZonePool(): Pool<Zone> {
  return createPool({ capacity: ZONE.maxConcurrent, create: createZone, reset: resetZone });
}

/**
 * 점이 이 장판의 다각형 안인가. 짝수-홀수 교차 판정이고 꼭짓점 수가 고정이라 비용이
 * 무시할 수준이다.
 *
 * 바깥 원으로 먼저 기각하는 것은 최적화가 아니라 호출 규모 때문이다 — 잡몹 상한 × 장판
 * 상한만큼 도는 자리라 대부분의 호출이 여기서 끝나야 한다.
 */
export function zoneContains(zone: Zone, xU: number, yU: number): boolean {
  const localXU = xU - zone.xU;
  const localYU = yU - zone.yU;
  const outerU = zone.radiusU * OUTER_RATIO;
  if (localXU * localXU + localYU * localYU > outerU * outerU) {
    return false;
  }

  const lastRadiusU = zone.radiusU * LAST_VERTEX.ratio;
  let previousXU = LAST_VERTEX.cos * lastRadiusU;
  let previousYU = LAST_VERTEX.sin * lastRadiusU;
  let inside = false;
  for (const vertex of ZONE_VERTICES) {
    const currentRadiusU = zone.radiusU * vertex.ratio;
    const currentXU = vertex.cos * currentRadiusU;
    const currentYU = vertex.sin * currentRadiusU;
    // 변이 수평선 y = localYU를 가로지를 때만 교점을 구한다. 두 끝점이 같은 쪽이면 나눗셈의
    // 분모가 0이 되는 경우까지 여기서 걸러진다
    if ((currentYU > localYU) !== (previousYU > localYU)) {
      const ratio = (localYU - currentYU) / (previousYU - currentYU);
      if (localXU < currentXU + ratio * (previousXU - currentXU)) {
        inside = !inside;
      }
    }
    previousXU = currentXU;
    previousYU = currentYU;
  }
  return inside;
}

function spawnZone(
  world: ZoneWorld,
  xU: number,
  yU: number,
  radiusU: number,
  durationSec: number,
  enemyDamagePerSec: number,
): Zone {
  // §9.6 초과 생성은 가장 오래된 것을 회수한다. 그 순서 규칙이 곧 core/pool.ts의 활성 목록
  // 순서라 여기서 따로 정렬하지 않는다
  const zone = world.zones.acquireRecyclingOldest();
  zone.xU = xU;
  zone.yU = yU;
  zone.radiusU = radiusU;
  zone.remainingSec = durationSec;
  zone.enemyDamagePerSec = enemyDamagePerSec;
  return zone;
}

/**
 * §6.1 화염 장판 P9. P7 대통 폭탄의 착탄, P8 불화살의 착탄, B4의 곡사 포격과 화공선이
 * 부르는 유일한 경로다.
 */
export function spawnFireZone(world: ZoneWorld, xU: number, yU: number): Zone {
  return spawnZone(
    world,
    xU,
    yU,
    BULLETS.P9.radiusU,
    ZONE.p9DurationSec,
    NO_ENEMY_DAMAGE_PER_SEC,
  );
}

/**
 * §11.5 E06 화공. 반사탄이 적에 명중한 지점에서 부른다.
 *
 * 초당 데미지가 반사탄 데미지에 대한 비율이라 그 데미지를 인자로 받는다 — 카드로 반사탄
 * 데미지가 오르면 장판 화력도 같이 오르고, 그 연동이 비율의 존재 이유다.
 *
 * 이 장판은 플레이어에게도 유효하다. HR-04를 위반하지 않는 이유는 생성 위치다: 반사탄이
 * 적에 명중한 지점에 생기는데 적 활동 영역과 플레이어 이동 영역은 위쪽 띠에서만 겹치므로,
 * 플레이어는 언제든 아래쪽으로 물러날 수 있다(§11.5).
 */
export function spawnCardZone(
  world: ZoneWorld,
  xU: number,
  yU: number,
  effect: SpawnZoneEffect,
  reflectDamage: number,
): Zone {
  return spawnZone(
    world,
    xU,
    yU,
    effect.radiusU,
    effect.durationSec,
    reflectDamage * effect.dpsRatio,
  );
}

/**
 * 05 §1의 1번 중 장판 몫. 전부 초 단위 감산이고 프레임 수를 세지 않는다(HR-06).
 *
 * ageSec을 remainingSec에서 되계산하지 않고 따로 드는 것은 render/zone.ts가 그 이름을
 * 읽기 때문이다 — 되계산하려면 지속 시간을 한 칸 더 들고 있어야 한다.
 */
export function decayZones(world: ZoneWorld, dtSec: number): void {
  world.zones.releaseWhere((zone) => {
    zone.ageSec += dtSec;
    zone.remainingSec -= dtSec;
    if (zone.damageCooldownSec > 0) {
      zone.damageCooldownSec -= dtSec;
    }
    return zone.remainingSec <= 0;
  });
}

/** §18.3 스테이지 자유 입장의 화면 정리. 적·탄환·반사탄과 함께 장판도 지운다 */
export function clearZones(world: ZoneWorld): void {
  world.zones.releaseAll();
}

/**
 * §4.3 코어 진입 즉시 1회, 이후 정해진 간격으로 반복.
 *
 * 판정은 무적과 무관하게 간격대로 일어나고, 무적은 그 판정이 피해로 이어지지 않게 할 뿐이다 —
 * §4.3이 간격에 건 것이 "피격 판정"이고, 그 판정이 §4.2와 같은 처리를 거치므로 무적 동안
 * 추가 피해가 없다는 문장이 성립한다.
 */
function judgePlayerInZone(world: ZoneWorld, zone: Zone): void {
  const player = world.player;
  if (!zoneContains(zone, player.xU, player.yU)) {
    zone.coreWasInside = false;
    return;
  }

  if (!zone.coreWasInside) {
    zone.coreWasInside = true;
    zone.damageCooldownSec = 0;
    world.bus.emit({ kind: 'zoneEntered', xU: player.xU, yU: player.yU });
  }
  if (zone.damageCooldownSec > 0) {
    return;
  }
  // 대입이 아니라 가산인 것은 감산이 0을 지나치며 남긴 잉여를 다음 주기에 되돌려 주기
  // 위해서다. 대입하면 주기가 매번 스텝 길이만큼 길어진다
  zone.damageCooldownSec += ZONE.damageIntervalSec;

  // §13.3 게임오버 뒤에도 스텝은 돌고, 여기서 막지 않으면 라이프가 음수로 내려간다
  if (world.isGameOver || isPlayerInvulnerable(world)) {
    return;
  }

  // 킥 방향은 장판 중심에서 코어 쪽이다. 발사체가 없으므로 진행 방향을 물려받을 곳이 없고,
  // 불이 번져 온 방향이 그 자리를 대신한다
  const towardCoreXU = player.xU - zone.xU;
  const towardCoreYU = player.yU - zone.yU;
  const lengthU = lengthOf(towardCoreXU, towardCoreYU);
  applyPlayerHit(
    world,
    'zone',
    null,
    lengthU === 0 ? 0 : towardCoreXU / lengthU,
    lengthU === 0 ? 0 : towardCoreYU / lengthU,
  );
}

/**
 * collision.ts의 처치와 같은 세 줄(점수·사건·반납)이다. 두 벌이 있는 것은 그쪽이 모듈
 * 내부 함수이기 때문이고, 갈라지면 장판 처치만 점수나 연쇄 키를 잃는다 — 한쪽을 고칠 때
 * 반드시 다른 쪽을 함께 본다.
 */
function killBurnedEnemy(world: ZoneWorld, enemy: Enemy): void {
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
 * §11.5 E06 장판만 적을 태운다. 초당 데미지라 dtSec을 곱한다 — 스텝마다 고정량을 깎으면
 * 고정 스텝 길이가 바뀌는 순간 화력이 같이 바뀐다(HR-06).
 */
function burnEnemies(world: ZoneWorld, zone: Zone, dtSec: number): void {
  const damage = zone.enemyDamagePerSec * dtSec;
  const enemies = world.enemies.active;
  // 처치가 활성 목록에서 원소를 빼므로 for...of로 돌 수 없다 — 빠진 자리로 다음 원소가
  // 당겨져 한 기를 건너뛴다
  for (let index = 0; index < enemies.length; index += 1) {
    const enemy = enemies[index];
    if (enemy === undefined) {
      continue;
    }
    if (!zoneContains(zone, enemy.xU, enemy.yU)) {
      continue;
    }
    enemy.hp -= damage;
    if (enemy.hp > 0) {
      continue;
    }
    killBurnedEnemy(world, enemy);
    index -= 1;
  }
}

/**
 * 05 §1의 12번. 8번(적분)과 10번(피격)이 이미 돌았으므로 플레이어와 적의 위치는 이번 스텝의
 * 확정 위치다. 장판은 패리 불가라 9번과 아무 관계가 없다(§5.6).
 */
export function resolveZones(world: ZoneWorld, dtSec: number): void {
  for (const zone of world.zones.active) {
    judgePlayerInZone(world, zone);
    if (zone.enemyDamagePerSec > NO_ENEMY_DAMAGE_PER_SEC) {
      burnEnemies(world, zone, dtSec);
    }
  }
}
