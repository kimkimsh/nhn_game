/**
 * 보스 발사 프리미티브 — 탄이 **어디서 몇 발 어느 각으로** 나가는가. 스펙 §10 · 05_시스템_설계.md §8.2.
 *
 * `boss-runner.ts`가 언제 쏠지를 정하고 이 파일이 그 한 번을 실제 탄으로 바꾼다. 둘을 한 파일에
 * 두면 03_파일_구조.md §6의 400줄을 넘긴다. 의존은 한 방향이다 — runner가 여기를 부르고
 * 여기는 runner를 모른다. 그래서 발사원 정보를 `PatternTask`가 아니라 `ShotOrigin`으로 받는다.
 *
 * ── HR-09 억제는 여기 한 자리에서만 걸린다 ──────────────────────────────────────
 *
 * 이 파일이 내보내는 것은 전부 예고 도형이 없는 탄이다. 예고가 붙는 셋(곡사 착탄 원 ·
 * 돌진 방향선 · 관통 예고선)은 여기를 지나지 않는다 — 곡사와 돌진은 runner가, 관통 대창은
 * `sim/lance.ts`가 갖는다. 그래서 `fireBossShot` 하나가 `hasTelegraph: false`로 내려보내면
 * 「예고 없는 발사만 억제받는다」가 구조로 지켜진다. 억제 자체는 `sim/bullets.ts`가 판정하고,
 * 여기는 그 판정이 쓸 실효 탄속을 함께 넘긴다.
 */
import { BULLETS } from '../config/bullets';
import { STAGE_SCALING } from '../config/difficulty';
import type { BulletId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import type { BossPattern } from '../config/types';
import { aimAt } from '../core/vec';
import { bossMuzzleYU, type BossPart, type BossState } from './boss';
import { fireEnemyBullet } from './bullets';
import type { World } from './world';

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_DEG = 360;

/** 화면 좌표계에서 아래 방향 (rad). y가 아래로 증가하므로 +90°다 */
export const DOWN_RAD = Math.PI / 2;

/** §10.3 · §10.6 「좌우 교차」 참격파가 본체 중심에서 벗어나는 거리 — 선체 반폭 대비 비율 */
const ARC_ALTERNATE_OFFSET_RATIO = 0.5;

/**
 * §10.5 「상단 전역」 낙하가 시작되는 y (u). 목업 08_boss4_daetong/scene.js:41과
 * 10_boss5_flagship/scene.js:36이 둘 다 −40에서 떨어뜨린다.
 *
 * **적 활동 영역의 minYU(−200)를 쓰면 한 발도 안 나간다.** 발사체 소멸 경계는 화면 밖
 * `despawnMarginU`(150u)까지이고 −200은 이미 그 밖이라, 생성된 탄이 같은 스텝의 적분에서
 * 곧바로 회수된다 — B4 페이즈 1의 2.4초와 B5 페이즈 4의 2.7초가 통째로 무발사 구간이 된다.
 */
const TOP_SPAN_SPAWN_YU = -40;

export type VolleyPattern = Extract<BossPattern, { readonly kind: 'volley' }>;
export type SpreadPattern = Extract<BossPattern, { readonly kind: 'spread' }>;
export type RingPattern = Extract<BossPattern, { readonly kind: 'ring' }>;
export type ArcPattern = Extract<BossPattern, { readonly kind: 'arc' }>;
export type BarragePattern = Extract<BossPattern, { readonly kind: 'barrage' }>;

/**
 * 이 패턴의 발사원. `followBoss`가 참이면 본체를 따라가고, 거짓이면 태어난 자리에 고정된다 —
 * `charge.onEnd`의 링과 `mortar.onImpact`의 링은 보스가 아니라 착탄 지점에서 나간다.
 */
export interface ShotOrigin {
  xU: number;
  yU: number;
  readonly followBoss: boolean;
}

/** 총구선 (u). 본체를 따라가는 발사는 선체 중심이 아니라 아래 모서리에서 나간다 */
function muzzleYU(boss: BossState, origin: ShotOrigin): number {
  return origin.followBoss ? bossMuzzleYU(boss) : origin.yU;
}

/**
 * §14.1 실효 탄속. 표의 기본 속도에 스테이지 배율을 곱하고, 패턴이 준 값이 있으면 그것을 쓴다.
 * `barrage.speedUPerSec`는 표를 통째로 대신하고 `volley.speedMul`은 그 위에 다시 곱한다.
 */
export function effectiveSpeedUPerSec(
  world: World,
  bulletId: BulletId,
  overrideUPerSec: number | undefined,
  speedMul: number | undefined,
): number {
  const baseUPerSec = overrideUPerSec ?? BULLETS[bulletId].speedUPerSec;
  return baseUPerSec * STAGE_SCALING[world.stageId].bulletSpeedMul * (speedMul ?? 1);
}

/**
 * 예고 없는 보스 발사의 유일한 경로. 억제됐거나 상한에 걸리면 거짓이고, 부르는 쪽은
 * 그 발사 하나만 건너뛴다 — 패턴 전체를 지연시키지 않는다(05 §8.2).
 *
 * 억제 판정은 `fireEnemyBullet`에 실효 탄속을 넘겨 그쪽 한 곳에서만 한다. 여기서 한 번 더
 * 보면 표 속도로 재는 내부 검사와 둘이 되고, **둘 중 엄한 쪽이 이기므로 속도를 낮춘 패턴에서
 * 과억제가 남는다** — §10.4 B3 P8(speedMul 0.5)은 스펙 억제 거리가 125u인데 표 속도로는 251u다.
 */
export function fireBossShot(
  world: World,
  bulletId: BulletId,
  xU: number,
  yU: number,
  angleRad: number,
  speedUPerSec: number,
): boolean {
  return fireEnemyBullet(world, { bulletId, xU, yU, angleRad, hasTelegraph: false, speedUPerSec })
    !== null;
}

function aimRad(world: World, xU: number, yU: number, aim: 'player' | 'down'): number {
  return aim === 'down' ? DOWN_RAD : aimAt(xU, yU, world.player.xU, world.player.yU);
}

/** 발사원 n개를 폭 spanU에 등간격으로 편 뒤 i번째 x (u). n이 1이면 중심 한 점이다 */
function spreadOriginXU(centerXU: number, spanU: number, count: number, index: number): number {
  if (count <= 1 || spanU <= 0) {
    return centerXU;
  }
  return centerXU - spanU / 2 + (spanU / (count - 1)) * index;
}

/** §10.4 교차 포격 — 좌우가 번갈아 한 문씩. 한쪽이 전멸하면 남은 쪽이 이어 쏜다 */
function pickAlternatingPart(alive: BossPart[], round: number): BossPart {
  const wantsRight = round % 2 === 1;
  const side = alive.filter((part) => (part.def.offsetU.xU >= 0) === wantsRight);
  const pool = side.length > 0 ? side : alive;
  return pool[Math.floor(round / 2) % pool.length]!;
}

/**
 * §10.2 일제사격 · 엄폐 전진 · 일제사격 강화, §10.4 좌현 일제포격 · 갑판 조총 사격 · 교차 포격,
 * §10.5 대통 직사, §10.6 총력 일제사격 · 전현 포격의 한 라운드.
 */
export function fireVolleyRound(
  world: World,
  boss: BossState,
  pattern: VolleyPattern,
  origin: ShotOrigin,
  round: number,
): void {
  const speedUPerSec = effectiveSpeedUPerSec(world, pattern.bullet, undefined, pattern.speedMul);
  if (pattern.from === 'boss') {
    const yU = muzzleYU(boss, origin);
    for (let index = 0; index < pattern.count; index += 1) {
      const xU = spreadOriginXU(origin.xU, pattern.sourceSpread, pattern.count, index);
      fireBossShot(world, pattern.bullet, xU, yU, aimRad(world, xU, yU, pattern.aim), speedUPerSec);
    }
    return;
  }
  const alive = boss.parts.filter((part) => !part.destroyed);
  if (alive.length === 0) {
    // §10.4 포문이 전부 파괴되면 그 발사 위치는 영구 정지다. 본체가 대신 쏘지 않는다
    return;
  }
  const chosen = pattern.from === 'partsAlternating' ? [pickAlternatingPart(alive, round)] : alive;
  for (const part of chosen) {
    for (let index = 0; index < pattern.count; index += 1) {
      const angleRad = aimRad(world, part.xU, part.yU, pattern.aim);
      fireBossShot(world, pattern.bullet, part.xU, part.yU, angleRad, speedUPerSec);
    }
  }
}

/** §10.3 투척 수리검, §10.4 최후 포격의 함포 6발, §10.5 화차 일제사격의 한 세트 */
export function fireSpreadSet(
  world: World,
  boss: BossState,
  pattern: SpreadPattern,
  origin: ShotOrigin,
  set: number,
): void {
  const xU = origin.xU + (pattern.setOriginsU?.[set] ?? 0);
  const yU = muzzleYU(boss, origin);
  const centerRad = aimAt(xU, yU, world.player.xU, world.player.yU);
  const halfRad = pattern.halfAngleDeg * DEG_TO_RAD;
  // halfAngleDeg는 전각이 아니라 반각이다 — 최외곽 탄이 조준선에서 몇 도 떨어지는가이므로
  // 간격은 2 × 반각을 (발수 − 1)로 나눈 값이다(10_스펙_목업_불일치.md A5)
  const stepRad = pattern.count > 1 ? (halfRad * 2) / (pattern.count - 1) : 0;
  const speedUPerSec = effectiveSpeedUPerSec(world, pattern.bullet, undefined, undefined);
  for (let index = 0; index < pattern.count; index += 1) {
    const angleRad = pattern.count > 1 ? centerRad - halfRad + stepRad * index : centerRad;
    fireBossShot(world, pattern.bullet, xU, yU, angleRad, speedUPerSec);
  }
}

/** §10.3 · §10.5 · §10.6 등간격 전방위 링. 시작 각은 patterns.ts의 규약이 정한다 */
export function fireRing(
  world: World,
  boss: BossState,
  pattern: RingPattern,
  origin: ShotOrigin,
): void {
  if (pattern.count <= 0) {
    return;
  }
  const yU = muzzleYU(boss, origin);
  const stepDeg = FULL_TURN_DEG / pattern.count;
  const speedUPerSec = effectiveSpeedUPerSec(world, pattern.bullet, undefined, undefined);
  for (let index = 0; index < pattern.count; index += 1) {
    const angleRad = (pattern.startAngleDeg + stepDeg * index) * DEG_TO_RAD;
    fireBossShot(world, pattern.bullet, origin.xU, yU, angleRad, speedUPerSec);
  }
}

/** §10.3 참격파 계열, §10.6 총대장 등판의 한 발 */
export function fireArcSlash(
  world: World,
  boss: BossState,
  pattern: ArcPattern,
  origin: ShotOrigin,
  index: number,
): void {
  const offsetU = pattern.alternate
    ? (index % 2 === 0 ? -1 : 1) * (boss.def.hitBox.wU / 2) * ARC_ALTERNATE_OFFSET_RATIO
    : 0;
  const xU = origin.xU + offsetU;
  const yU = muzzleYU(boss, origin);
  const speedUPerSec = effectiveSpeedUPerSec(world, pattern.bullet, undefined, undefined);
  const angleRad = aimAt(xU, yU, world.player.xU, world.player.yU);
  fireBossShot(world, pattern.bullet, xU, yU, angleRad, speedUPerSec);
}

/**
 * §10.2 난사는 본체에서 무작위 각으로, §10.5 불화살 비는 상단 전역에서 수직 낙하로 나간다.
 * 무작위 각을 아래 반원으로 제한하는 이유는 위로 나간 탄이 플레이어에게 닿기 전에 경계에서
 * 사라져 발수만 세고 위협이 되지 않기 때문이다.
 */
export function fireBarrageShot(
  world: World,
  boss: BossState,
  pattern: BarragePattern,
  origin: ShotOrigin,
): void {
  const speedUPerSec = effectiveSpeedUPerSec(world, pattern.bullet, pattern.speedUPerSec, undefined);
  if (pattern.origin === 'topSpan') {
    const spanU = pattern.spanU ?? PLAYFIELD.widthU;
    const centerXU = PLAYFIELD.widthU / 2;
    const xU = world.rng.range(centerXU - spanU / 2, centerXU + spanU / 2);
    fireBossShot(world, pattern.bullet, xU, TOP_SPAN_SPAWN_YU, DOWN_RAD, speedUPerSec);
    return;
  }
  const yU = muzzleYU(boss, origin);
  fireBossShot(world, pattern.bullet, origin.xU, yU, world.rng.range(0, Math.PI), speedUPerSec);
}
