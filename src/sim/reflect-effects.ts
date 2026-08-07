/**
 * 반사탄에 얹히는 카드 효과 — 스펙 §11.4 R01·R07·R08, §11.5 E01·E02·E06.
 *
 * `sim/reflect.ts`가 「한 발을 어떻게 되돌리는가」를 갖고 이 파일이 「그 한 발이 몇 발이 되고
 * 무엇을 남기는가」를 갖는다. 둘을 한 파일에 두면 카드가 없는 기본 경로를 읽는 사람이 여섯
 * 갈래를 함께 읽어야 한다.
 *
 * ── 발동 시점이 둘이다 ──────────────────────────────────────────────────────────
 *
 * 분열(R01·E01) · 교체(E02) · 감속(R07)은 **패리가 성립한 순간**, 파편(R08) · 장판(E06)은
 * **반사탄이 적에 명중한 순간**이다. 앞의 셋은 sim/parry.ts가, 뒤의 둘은 sim/collision.ts와
 * sim/boss-hits.ts가 부른다.
 *
 * ── 새로 나오는 발사체도 전부 반사탄이다 ────────────────────────────────────────
 *
 * §7.1이 분열탄·파편·화전을 「반사탄. 플레이어에게 유해, 재패리 가능」으로 못 박았다. 그래서
 * 여기서 만드는 것은 예외 없이 반사탄 풀에 들어가고 자해 유예 0.15초를 그대로 받는다 —
 * 적 탄환 풀로 보내면 HR-07이 그 자리에서 던진다.
 */
import { BULLETS } from '../config/bullets';
import type { BulletId } from '../config/ids';
import type { BulletDef } from '../config/types';
import { acquireReflectSlot } from './caps';
import type { Projectile } from './bullets';
import type { ReflectSplit } from './cards';
import type { EffectiveStats, World } from './world';
import { spawnCardZone, type ZoneWorld } from './zones';

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_RAD = Math.PI * 2;

/** §11.5 E02 화전이 나가는 방향. 플레이어가 보는 쪽이고 y가 아래로 증가하므로 −90°다 */
const FORWARD_RAD = -Math.PI / 2;

/** 스텝마다 덮어쓴다. 분열은 목록을 두 번 훑으므로 배열이 필요하고, 매번 만들면 쓰레기가 된다 */
const launched: Projectile[] = [];

function speedOf(projectile: Projectile): number {
  return Math.hypot(projectile.vxUPerSec, projectile.vyUPerSec);
}

function aimAtRad(projectile: Projectile, angleRad: number, speedUPerSec: number): void {
  projectile.vxUPerSec = Math.cos(angleRad) * speedUPerSec;
  projectile.vyUPerSec = Math.sin(angleRad) * speedUPerSec;
}

/**
 * 원본과 같은 자리에서 출발하는 반사탄 하나. 상한에 닿으면 가장 오래된 반사탄이 회수된다 —
 * 패리가 낳은 발사체는 버려지지 않는다는 §3.2의 규칙이 분열탄에도 그대로 걸린다.
 */
function cloneReflect(world: World, source: Projectile, angleRad: number): Projectile {
  const clone = acquireReflectSlot(world);
  clone.bulletId = source.bulletId;
  clone.owner = 'player';
  clone.xU = source.xU;
  clone.yU = source.yU;
  clone.prevXU = source.prevXU;
  clone.prevYU = source.prevYU;
  clone.radiusU = source.radiusU;
  clone.brp = source.brp;
  clone.isParryable = source.isParryable;
  clone.homingRemainingSec = source.homingRemainingSec;
  clone.homingTurnRateDegPerSec = source.homingTurnRateDegPerSec;
  clone.homingExitSpeedUPerSec = source.homingExitSpeedUPerSec;
  clone.lifeRemainingSec = source.lifeRemainingSec;
  clone.graceRemainingSec = source.graceRemainingSec;
  clone.parriedSessionId = source.parriedSessionId;
  clone.lastGrade = source.lastGrade;
  clone.damage = source.damage;
  clone.pierceRemaining = source.pierceRemaining;
  aimAtRad(clone, angleRad, speedOf(source));
  return clone;
}

/** 부채꼴 i번째 각. n이 1이면 중심 하나다 */
function fanRad(centerRad: number, halfSpreadRad: number, count: number, index: number): number {
  if (count <= 1) {
    return centerRad;
  }
  return centerRad - halfSpreadRad + ((halfSpreadRad * 2) / (count - 1)) * index;
}

/**
 * §11.5 E02. GREAT 패리가 반사탄을 P10 5연발로 갈아 끼운다. 반경·속도가 원본 탄이 아니라
 * P10의 것을 따르는 것이 「교체」의 뜻이다 — 값을 얹는 카드가 아니다.
 */
function replaceWithFan(
  world: World,
  source: Projectile,
  bulletId: BulletId,
  count: number,
  spreadDeg: number,
  damageRatio: number,
): void {
  const def: BulletDef = BULLETS[bulletId];
  const speedUPerSec = Math.min(def.speedUPerSec, world.stats.reflectSpeedMaxUPerSec);
  const damage = Math.floor(source.damage * damageRatio);
  for (let index = 0; index < count; index += 1) {
    const shot = cloneReflect(world, source, fanRad(FORWARD_RAD, spreadDeg * DEG_TO_RAD, count, index));
    shot.bulletId = bulletId;
    shot.radiusU = def.radiusU;
    shot.brp = def.brp;
    shot.isParryable = def.isParryable;
    shot.damage = damage;
    aimAtRad(shot, Math.atan2(shot.vyUPerSec, shot.vxUPerSec), speedUPerSec);
    launched.push(shot);
  }
  world.reflectBullets.release(source);
}

/**
 * §11.4 R01 · §11.5 E01. 한 발을 count발로 가른다. 두 카드를 함께 들면 이 함수가 두 번 돌아
 * 발수가 곱해진다 — 스펙 §11.6이 "두 카드를 동시 보유하면 총 6발"로 그 곱을 명시했다.
 *
 * 데미지 계수는 여기서 곱하지 않는다. `reflectSplitDamageRatio`가 이미 두 계수의 곱이고
 * sim/reflect.ts가 반사 시점에 한 번 먹였다 — 여기서 또 곱하면 R01+E01이 네 번 감쇠된다.
 */
function splitOnce(world: World, split: ReflectSplit): void {
  const halfSpreadRad = split.spreadDeg * DEG_TO_RAD;
  const sourceCount = launched.length;
  for (let index = 0; index < sourceCount; index += 1) {
    const source = launched[index]!;
    const speedUPerSec = speedOf(source);
    const centerRad = Math.atan2(source.vyUPerSec, source.vxUPerSec);
    aimAtRad(source, fanRad(centerRad, halfSpreadRad, split.count, 0), speedUPerSec);
    for (let extra = 1; extra < split.count; extra += 1) {
      launched.push(cloneReflect(world, source, fanRad(centerRad, halfSpreadRad, split.count, extra)));
    }
  }
}

/** §11.4 R07. 속도를 깎지 않고 적분 배율만 세운다 — 되돌릴 자리가 없는 파괴적 수정이 된다 */
function applySlow(world: World, stats: EffectiveStats): void {
  const slow = stats.enemyBulletSlowOnGreat;
  if (slow === null) {
    return;
  }
  world.run.enemyBulletSlowUntilSec = world.simTimeSec + slow.durationSec;
  world.run.enemyBulletSlowMul = slow.speedMul;
}

/**
 * 패리 한 발이 성립한 직후. 인자로 받은 발사체는 교체(E02)가 걸리면 이 호출 뒤에 반납된
 * 슬롯이므로, 부르는 쪽은 그 자리를 다시 읽지 않는다.
 */
export function applyReflectLaunchEffects(
  world: World,
  projectile: Projectile,
  isGreat: boolean,
): void {
  const stats = world.stats;
  launched.length = 0;
  launched.push(projectile);

  const replacement = stats.reflectReplaceOnGreat;
  if (isGreat && replacement !== null) {
    launched.length = 0;
    replaceWithFan(
      world,
      projectile,
      replacement.bullet,
      replacement.count,
      replacement.spreadDeg,
      replacement.damageRatio,
    );
  }
  for (const split of stats.reflectSplits) {
    splitOnce(world, split);
  }
  if (isGreat) {
    applySlow(world, stats);
  }
  launched.length = 0;
}

/**
 * 명중 한 건이 남길 것. 05 §1의 11번이 `releaseWhere` 안에서 돌기 때문에 그 자리에서 곧바로
 * 만들 수 없다 — 반사탄 상한이 「가장 오래된 것을 회수」라, 순회 중에 슬롯을 집으면 아직 판정이
 * 남은 발사체가 발밑에서 사라진다. 그래서 인자를 베껴 두고 순회가 끝난 뒤에 만든다.
 */
interface PendingHit {
  xU: number;
  yU: number;
  bulletId: BulletId;
  radiusU: number;
  brp: number;
  isParryable: boolean;
  damage: number;
  speedUPerSec: number;
}

const pendingHits: PendingHit[] = [];

/**
 * §11.4 R08 · §11.5 E06. 반사탄이 적에 명중한 자리에서 부른다. 실제 생성은 flush가 한다.
 */
export function noteReflectHit(
  world: World,
  projectile: Projectile,
  xU: number,
  yU: number,
): void {
  const stats = world.stats;
  if (stats.shardOnReflectHit === null && stats.zoneOnReflectHit === null) {
    return;
  }
  pendingHits.push({
    xU,
    yU,
    bulletId: projectile.bulletId,
    radiusU: projectile.radiusU,
    brp: projectile.brp,
    isParryable: projectile.isParryable,
    damage: projectile.damage,
    speedUPerSec: speedOf(projectile),
  });
}

/**
 * 파편이 원본과 같은 탄종인 것은 §6.1 표에 파편 전용 행이 없기 때문이다. 지어낸 반경과 BRP를
 * 넣는 것보다 「그 탄의 조각」으로 두는 쪽이 스펙에 없는 숫자를 만들지 않는다.
 */
function spawnShards(world: World, hit: PendingHit, count: number, damageRatio: number): void {
  const damage = Math.floor(hit.damage * damageRatio);
  for (let index = 0; index < count; index += 1) {
    const piece = acquireReflectSlot(world);
    piece.bulletId = hit.bulletId;
    piece.owner = 'player';
    piece.xU = hit.xU;
    piece.yU = hit.yU;
    piece.prevXU = hit.xU;
    piece.prevYU = hit.yU;
    piece.radiusU = hit.radiusU;
    piece.brp = hit.brp;
    piece.isParryable = hit.isParryable;
    piece.homingRemainingSec = 0;
    piece.lifeRemainingSec = world.stats.reflectLifetimeSec;
    piece.graceRemainingSec = world.stats.reflectGraceSec;
    piece.parriedSessionId = world.parry.sessionId;
    piece.lastGrade = null;
    piece.damage = damage;
    // 파편이 또 파편을 낳으면 한 번의 명중이 무한히 갈라진다. 관통을 0으로 두어 한 기만 때린다
    piece.pierceRemaining = 0;
    aimAtRad(piece, (index / count) * FULL_TURN_RAD, hit.speedUPerSec);
  }
}

/** 05 §1의 11번이 끝난 뒤 한 번. 12번(장판 판정)보다 앞이라 이 스텝에 생긴 장판도 판정을 받는다 */
export function flushReflectHitEffects(world: World): void {
  if (pendingHits.length === 0) {
    return;
  }
  const shard = world.stats.shardOnReflectHit;
  const zone = world.stats.zoneOnReflectHit;
  for (const hit of pendingHits) {
    if (shard !== null && shard.count > 0) {
      spawnShards(world, hit, shard.count, shard.damageRatio);
    }
    if (zone !== null) {
      spawnCardZone(
        world as ZoneWorld,
        hit.xU,
        hit.yU,
        { kind: 'spawnZone', on: 'reflectHit', ...zone },
        hit.damage,
      );
    }
  }
  pendingHits.length = 0;
}
