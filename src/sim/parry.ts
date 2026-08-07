/**
 * 패리 — 스펙 §5, 05_시스템_설계.md §3. 05 §1의 2번(입력 소비)과 9번(판정)을 갖는다.
 *
 * ── 판정은 활성 구간의 매 스텝이다 ─────────────────────────────────────────────────
 *
 * 목업은 입력 순간에 한 번만 전체 탄을 훑는다. 그러면 누르는 타이밍이 등급에 영향을 주지
 * 않게 되고, 일찍 누르면 낮은 등급 · 늦게 누를수록 높은 등급이라는 이 게임의 타이밍 설계
 * 전체가 사라진다. 활성 구간 도중 새로 반경 안에 들어온 발사체도 그 진입 스텝에 판정된다.
 *
 * ── 스윕을 쓰지 않는다 ──────────────────────────────────────────────────────────
 *
 * 스윕이 주는 것은 선분 위의 최근접 거리인데 스펙은 등급을 "패리가 성립한 프레임의 거리"로
 * 정의한다. 패리를 스윕으로 판정하면 등급이 GREAT 쪽으로 체계적으로 편향되고, 그건 최적화가
 * 아니라 스펙 변경이다.
 *
 * ── 1회와 개수만큼이 갈린다 ─────────────────────────────────────────────────────
 *
 * 각 발사체는 자기 거리로 개별 등급을 받는다. 히트스톱·점수·패리 사건은 **활성 구간당 한 번**
 * 이고 그때의 최고 등급을 쓴다. 콤보만 처리한 발사체 개수만큼 오른다. 무적은 성립할 때마다
 * 다시 설정되지만 등급에 따라 길이가 달라지지 않는다.
 */
import type { Input } from '../core/input';
import { distanceSq, dot } from '../core/vec';
import type { Projectile } from './bullets';
import { grantParryInvuln } from './player';
import { GUARDS_ENABLED, checkReflect } from './guards';
import { assertMovingAway, reflectProjectile } from './reflect';
import { applyReflectLaunchEffects } from './reflect-effects';
import { addCombo, awardParry } from './score';
import type { EffectiveParryBand, World } from './world';

/** 활성 구간 ID의 시작값. 발사체의 초기값과 같으면 첫 패리가 C4에 걸린다 */
const FIRST_SESSION_ID = 1;

export interface ParryState {
  /** §5.2 C4가 발사체에 기록하는 값. 눌릴 때마다 오른다 */
  sessionId: number;
  /** 활성 구간이 열려 있는가. 닫히는 스텝에 빈 패리가 확정된다 */
  isActive: boolean;
  activeStartedSec: number;
  activeUntilSec: number;
  /** §5.1 쿨다운은 활성 시작 시점 기준이다. 빈 패리로 끝나면 이 값이 뒤에 당겨진다 */
  cooldownUntilSec: number;
  /** 이번 활성 구간이 처리한 발사체 수. 0으로 닫히면 빈 패리다 */
  sessionParryCount: number;
  /** 이번 활성 구간이 이미 히트스톱·점수를 받았는가 */
  sessionRewarded: boolean;
  /** cooldownReady를 구간마다 한 번만 내기 위한 표시 */
  cooldownAnnounced: boolean;
}

export function createParryState(): ParryState {
  return {
    sessionId: FIRST_SESSION_ID - 1,
    isActive: false,
    activeStartedSec: 0,
    activeUntilSec: 0,
    cooldownUntilSec: 0,
    sessionParryCount: 0,
    sessionRewarded: false,
    cooldownAnnounced: true,
  };
}

/**
 * 한 스텝에서 조건을 통과한 발사체와 그 거리. 모듈 수준에 두고 돌려 쓴다 —
 * 반사가 발사체를 풀 사이로 옮기므로 활성 목록을 순회하면서 처리할 수 없고, 스텝마다 배열을
 * 새로 만들면 초당 120개의 쓰레기가 된다. stepWorld가 한 번에 한 세계만 돌린다는 전제에 기댄다.
 */
const candidates: Projectile[] = [];
const candidateDistU: number[] = [];

function isParryable(world: World, projectile: Projectile): boolean {
  // C3 — 패리 가능 플래그. P9·P12는 애초에 반사탄이 되지 않는다
  if (!projectile.isParryable) {
    return false;
  }
  // C4 — 이번 활성 구간에서 아직 패리되지 않았을 것
  if (projectile.parriedSessionId === world.parry.sessionId) {
    return false;
  }
  // C5 — 반사탄이면 자해 유예가 지났을 것
  if (projectile.graceRemainingSec > 0) {
    return false;
  }
  return true;
}

/**
 * C1과 C2. n의 크기는 판정에 쓰이지 않고 부호만 쓰이므로 정규화하지 않는다 —
 * v·(발사체위치 − 플레이어위치)의 부호가 v·n의 부호와 같다.
 */
function collectCandidates(world: World, pool: readonly Projectile[], radiusU: number): void {
  const player = world.player;
  const radiusSqU = radiusU * radiusU;
  for (const projectile of pool) {
    if (!isParryable(world, projectile)) {
      continue;
    }
    const distSqU = distanceSq(player.xU, player.yU, projectile.xU, projectile.yU);
    if (distSqU > radiusSqU) {
      continue;
    }
    if (
      dot(
        projectile.vxUPerSec,
        projectile.vyUPerSec,
        projectile.xU - player.xU,
        projectile.yU - player.yU,
      ) >= 0
    ) {
      continue;
    }
    candidates.push(projectile);
    candidateDistU.push(Math.sqrt(distSqU));
  }
}

/**
 * §5.3 등급. 밴드는 좁은 것부터 나열되어 있으므로 거리를 덮는 첫 밴드가 답이다.
 * 마지막 밴드의 상한은 스냅샷을 만들 때 실효 패리 반경으로 채워지므로 C1을 통과한 거리는
 * 반드시 어느 밴드에 걸린다 — null은 그 계약이 깨졌다는 뜻이고 호출자가 던진다.
 */
export function gradeFor(
  bands: readonly EffectiveParryBand[],
  distU: number,
): EffectiveParryBand | null {
  for (const band of bands) {
    if (distU <= band.maxDistU) {
      return band;
    }
  }
  return null;
}

function startSession(world: World, input: Input): void {
  const parry = world.parry;
  parry.sessionId += 1;
  parry.isActive = true;
  parry.activeStartedSec = world.simTimeSec;
  parry.activeUntilSec = world.simTimeSec + world.stats.parryActiveSec;
  parry.cooldownUntilSec = world.simTimeSec + world.stats.cooldownSecFor('hit');
  parry.sessionParryCount = 0;
  parry.sessionRewarded = false;
  parry.cooldownAnnounced = false;
  input.clearParryBuffer();
}

/**
 * 05 §1의 2번. 쿨다운 종료를 알리는 것도 여기다 — 선입력이 발동하는 자리와 같은 스텝이어야
 * 소리와 실제 발동이 어긋나지 않는다.
 *
 * 눌림에 실린 시각(atMs)으로 소비 상한을 받는 이유는 프레임이 아니라 스텝 단위로 접수해야
 * 등급을 고를 수 있는 해상도가 고정 스텝만큼 남기 때문이다.
 */
export function consumeParryInput(world: World, input: Input, untilMs: number): void {
  const parry = world.parry;
  const ready = world.simTimeSec >= parry.cooldownUntilSec;
  if (ready && !parry.cooldownAnnounced) {
    parry.cooldownAnnounced = true;
    world.bus.emit({ kind: 'cooldownReady' });
  }
  // 선입력은 쿨다운이 끝나는 즉시 발동한다. 눌림보다 먼저 보는 것이 그 "즉시"의 뜻이다
  if (ready && input.hasParryBuffer()) {
    startSession(world, input);
    return;
  }

  for (const press of input.takePressesUntil(untilMs)) {
    if (press.action !== 'parry') {
      continue;
    }
    if (world.simTimeSec >= parry.cooldownUntilSec) {
      startSession(world, input);
      return;
    }
    // §5.1 쿨다운 중 입력은 버퍼 구간 안일 때만 접수된다. 나머지는 버린다
    if (parry.cooldownUntilSec - world.simTimeSec <= world.stats.parryBufferSec) {
      input.armParryBuffer(world.stats.parryBufferSec);
    }
  }
}

function rewardSession(world: World, best: EffectiveParryBand, bestWasReparry: boolean, count: number): void {
  const parry = world.parry;
  parry.sessionRewarded = true;
  world.parrySeq += 1;
  world.chainIndex = 0;
  world.clock.requestHitstop(best.hitstopSec, world.simTimeSec);
  awardParry(world, best, bestWasReparry);
  world.bus.emit({
    kind: 'parry',
    parrySeq: world.parrySeq,
    grade: best.id,
    count,
    combo: world.run.combo,
    xU: world.player.xU,
    yU: world.player.yU,
  });
}

/**
 * 05 §1의 9번. 10번(피격)보다 반드시 앞이다 — GREAT 밴드 안에서 대형 탄환은 이미 코어를
 * 덮고 있으므로, 뒤집히면 참격파의 GREAT가 성립하는 즉시 피격으로 처리되어 영원히 나오지 않는다.
 */
export function resolveParry(world: World, input: Input): void {
  const parry = world.parry;
  if (!parry.isActive) {
    return;
  }

  if (world.simTimeSec < parry.activeUntilSec) {
    judgeStep(world);
  }

  if (world.simTimeSec >= parry.activeUntilSec) {
    closeSession(world, input);
  }
}

function judgeStep(world: World): void {
  candidates.length = 0;
  candidateDistU.length = 0;
  const radiusU = world.stats.parryRadiusU;
  collectCandidates(world, world.enemyBullets.active, radiusU);
  collectCandidates(world, world.reflectBullets.active, radiusU);
  if (candidates.length === 0) {
    return;
  }

  let best: EffectiveParryBand | null = null;
  let bestWasReparry = false;
  for (let index = 0; index < candidates.length; index += 1) {
    const projectile = candidates[index];
    const distU = candidateDistU[index];
    if (projectile === undefined || distU === undefined) {
      continue;
    }
    const band = gradeFor(world.stats.bands, distU);
    if (band === null) {
      throw new Error('패리 반경 안인데 등급이 없다 — 마지막 밴드 상한이 반경과 어긋났다');
    }
    const wasReparry = projectile.owner === 'player';
    const result = reflectProjectile(world, projectile, band);
    if (GUARDS_ENABLED) {
      checkReflect(world, result.projectile, world.stats.reflectHomingDegPerSec > 0);
    } else {
      assertMovingAway(world, result.projectile);
    }

    world.bus.emit({
      kind: 'reflectLaunched',
      grade: band.id,
      xU: result.projectile.xU,
      yU: result.projectile.yU,
    });
    if (wasReparry && result.previousGrade !== null) {
      world.bus.emit({
        kind: 'reparry',
        grade: band.id,
        prevGrade: result.previousGrade,
        xU: result.projectile.xU,
        yU: result.projectile.yU,
      });
    }
    // 카드 효과는 사건을 낸 뒤에 건다. 교체(E02)가 result.projectile을 반납하므로 그 뒤에는
    // 그 슬롯을 읽을 수 없다
    applyReflectLaunchEffects(world, result.projectile, band.id === 'GREAT');

    if (best === null || band.damageMul > best.damageMul) {
      best = band;
      bestWasReparry = wasReparry;
    }
  }

  const count = candidates.length;
  const parry = world.parry;
  parry.sessionParryCount += count;
  addCombo(world, count);
  grantParryInvuln(world);
  if (best !== null && !parry.sessionRewarded) {
    rewardSession(world, best, bestWasReparry, count);
  }
}

/**
 * 빈 패리는 활성 구간이 끝나는 시점에 확정한다. 중간에 "아직 0개"로 판정하면 뒤늦게 반경 안에
 * 들어온 탄을 놓친다. 쿨다운을 여기서 다시 쓰는 것은 N13이 결과를 보고 값을 고르기 때문이고,
 * 활성 종료가 쿨다운 종료보다 먼저라 아직 아무도 그 값을 소비하지 않았다.
 */
function closeSession(world: World, input: Input): void {
  const parry = world.parry;
  parry.isActive = false;
  if (parry.sessionParryCount > 0) {
    return;
  }
  parry.cooldownUntilSec = parry.activeStartedSec + world.stats.cooldownSecFor('empty');
  input.clearParryBuffer();
  world.bus.emit({ kind: 'parryWhiff', xU: world.player.xU, yU: world.player.yU });
}
