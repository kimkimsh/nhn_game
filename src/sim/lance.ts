/**
 * 관통 대창 P12 — 스펙 §9.7 · §10.6, 05_시스템_설계.md §1의 4번·§8.2, 12_통합_계약.md §10 E-10.
 *
 * BossPattern이 아니다. 웨이브 위협(S5 W4 배경 함대)과 보스 페이즈(B5 페이즈 4)가 **같은
 * fireLance를 부른다** — 하나는 sim/waves.ts가, 하나는 boss-runner가 부르고, 둘이 서로를 모른다.
 * 그래서 이 파일이 예고·판정·소멸을 통째로 갖고 부르는 쪽은 「어디에 몇 줄」만 정한다.
 *
 * ── 세 함수가 서로 다른 단계에 산다 ─────────────────────────────────────────────
 *
 *   stepLances        05 §1의 4번. 남은 시간을 깎고 수명이 끝난 볼리를 회수한다
 *   fireLance         4번(웨이브)과 7번(보스) 양쪽에서 불린다
 *   resolveLanceHits  05 §1의 10번, resolvePlayerHits **뒤**. 순서가 뒤집히면 같은 스텝에
 *                     피격이 두 번 성립한다 — 무적을 먼저 붙이는 쪽이 이겨야 한다
 *
 * ── HR-09 억제 대상이 아니다 ────────────────────────────────────────────────────
 *
 * 예고가 붙은 공격은 억제하지 않는다(05 §8.2). 억제 거리 검사는 예고 없는 탄환에만 걸리고,
 * 관통 예고선이 이미 반응 시간을 주므로 이 파일은 sim/bullets.ts의 발사 경로를 지나지 않는다.
 * 같은 이유로 §3.2의 동시 적 탄환 상한도 세지 않는다 — 발사체를 만들지 않기 때문이다.
 *
 * ── 패리 불가다 ─────────────────────────────────────────────────────────────────
 *
 * P12는 ParryableBulletId에서 빠져 있고, 여기서 Projectile을 만들지 않으므로 패리 판정이
 * 훑는 두 풀 어디에도 들어가지 않는다. 무해해지는 경로는 무적 하나뿐이다(§5.6).
 */
import { BULLETS } from '../config/bullets';
import { PLAYER } from '../config/player';
import { PLAYFIELD } from '../config/playfield';
import { createPool, type Pool } from '../core/pool';
import { applyPlayerHit } from './collision';
import { isPlayerInvulnerable } from './player';
import type { World } from './world';

/** §6.1 폭 40u 직선의 절반. 예고선과 관통 본체가 같은 폭이다(06 §5.4) */
export const LANCE_HALF_WIDTH_U = BULLETS.P12.radiusU;

/**
 * 한 볼리의 수명은 예고 + 판정이고, 가장 촘촘한 발사원조차 그보다 긴 간격으로 부른다.
 * 그래도 둘을 잡아 두는 것은 회수가 「가장 오래된 것부터」라서다 — 자리가 없어 살아 있는
 * 예고선이 지워지면 예고가 거짓말이 된다. 이 상한에 닿는 것 자체가 부르는 쪽의 버그다.
 */
const MAX_CONCURRENT_VOLLEYS = 4;

/** 한 줄만 있으면 「줄 사이」가 없다. 상한이 아니라 그 개념이 성립하지 않는다는 뜻이다 */
const NO_ADJACENT_LANE = Number.POSITIVE_INFINITY;

/** 예고선이 사라진 뒤의 관통 판정. 05 §1의 10번이 이 상태만 본다 */
export type LancePhase = 'telegraph' | 'active';

/**
 * 한 번의 발사로 동시에 서는 줄 전부. 줄마다 객체를 만들지 않는 이유는 예고·판정·소멸이
 * 줄마다 따로 일어날 수 없기 때문이다 — 한 줄만 먼저 사라지는 상태가 규칙에 없다.
 */
export interface Lance {
  /** 각 줄의 중심 x (u). 왼쪽부터다 */
  readonly columnsU: readonly number[];
  readonly halfWidthU: number;
  readonly telegraphSec: number;
  readonly activeSec: number;
  readonly telegraphRemainingSec: number;
  readonly activeRemainingSec: number;
}

interface MutableLance {
  columnsU: number[];
  halfWidthU: number;
  telegraphSec: number;
  activeSec: number;
  telegraphRemainingSec: number;
  activeRemainingSec: number;
}

/** 부르는 쪽이 정하는 것 전부. 「어디에 몇 줄」과 두 시간뿐이다 */
export interface LanceSpec {
  readonly columnsU: readonly number[];
  readonly telegraphSec: number;
  readonly activeSec: number;
}

function createLance(): MutableLance {
  return {
    columnsU: [],
    halfWidthU: LANCE_HALF_WIDTH_U,
    telegraphSec: 0,
    activeSec: 0,
    telegraphRemainingSec: 0,
    activeRemainingSec: 0,
  };
}

function resetLance(lance: MutableLance): void {
  lance.columnsU.length = 0;
  lance.telegraphRemainingSec = 0;
  lance.activeRemainingSec = 0;
}

/**
 * 대창 상태를 World가 아니라 여기 둔다. 밖에서 읽히지만 쓰이는 자리는 fireLance 하나이고,
 * World의 필드로 두면 누구든 쓸 수 있게 되어 「예고 없이 판정이 서는」 상태를 만들 수 있다.
 */
const RUNTIMES = new WeakMap<World, Pool<MutableLance>>();

function runtimeOf(world: World): Pool<MutableLance> {
  let pool = RUNTIMES.get(world);
  if (pool === undefined) {
    pool = createPool({
      capacity: MAX_CONCURRENT_VOLLEYS,
      create: createLance,
      reset: resetLance,
    });
    RUNTIMES.set(world, pool);
  }
  return pool;
}

/**
 * lanes개를 화면 가로 중앙에 등간격으로 세운다. 줄 사이 간격은 안전 지대 + 줄 폭이다.
 *
 * 좌표를 config가 갖지 않는 이유는 LanceDef가 「몇 줄」과 「안전 지대 폭」만 갖기 때문이고,
 * 그 둘이 x를 유일하게 정한다 — HR-04가 지키라는 것이 통로 폭이므로 통로에서 좌표를 만드는
 * 쪽이 규칙과 값이 어긋날 수 없는 유일한 방향이다.
 */
export function lanceColumnsU(lanes: number, safeCorridorU: number): number[] {
  const pitchU = safeCorridorU + LANCE_HALF_WIDTH_U * 2;
  const centerU = PLAYFIELD.widthU / 2;
  const columnsU: number[] = [];
  for (let index = 0; index < lanes; index += 1) {
    columnsU.push(centerU + (index - (lanes - 1) / 2) * pitchU);
  }
  return columnsU;
}

/**
 * HR-04가 검사하는 값. 인접한 두 줄의 안쪽 가장자리 사이에 남는 폭이고, 0 이하면 통로가 없다.
 * 줄이 하나뿐이면 인접이 없으므로 이 규칙의 대상이 아니다.
 */
export function lanceSafeCorridorU(columnsU: readonly number[]): number {
  let narrowestU = NO_ADJACENT_LANE;
  for (let index = 1; index < columnsU.length; index += 1) {
    const leftU = columnsU[index - 1];
    const rightU = columnsU[index];
    if (leftU === undefined || rightU === undefined) {
      continue;
    }
    narrowestU = Math.min(narrowestU, rightU - leftU - LANCE_HALF_WIDTH_U * 2);
  }
  return narrowestU;
}

/**
 * 웨이브(05 §1의 4번)와 보스(7번)가 함께 부르는 유일한 발사 경로.
 *
 * 예고선은 이 자리에서 한 번만 발행한다. 줄마다 한 번이라 소리와 파티클이 줄 수를 그대로 읽는다.
 */
export function fireLance(world: World, spec: LanceSpec): void {
  const lance = runtimeOf(world).acquireRecyclingOldest();
  for (const columnU of spec.columnsU) {
    lance.columnsU.push(columnU);
  }
  lance.halfWidthU = LANCE_HALF_WIDTH_U;
  lance.telegraphSec = spec.telegraphSec;
  lance.activeSec = spec.activeSec;
  lance.telegraphRemainingSec = spec.telegraphSec;
  lance.activeRemainingSec = spec.activeSec;

  for (const columnU of spec.columnsU) {
    world.bus.emit({
      kind: 'telegraph',
      shape: 'pierceLine',
      xU: columnU,
      yU: PLAYFIELD.heightU / 2,
    });
  }
}

/** 예고가 끝났고 판정이 아직 남아 있는가. 이 상태에서만 플레이어를 벤다 */
export function lancePhaseOf(lance: Lance): LancePhase {
  return lance.telegraphRemainingSec > 0 ? 'telegraph' : 'active';
}

/** 예고선과 관통 본체를 그리는 쪽이 읽는다. 목록의 순서는 발사 순서다 */
export function lancesOf(world: World): readonly Lance[] {
  return runtimeOf(world).active;
}

/**
 * 05 §1의 4번. 프레임 수가 아니라 sim 초를 깎는다(HR-06).
 *
 * 예고와 판정을 한 타이머로 합치지 않는 것은 경계에서 반올림이 어느 쪽으로 기울지가 규칙이기
 * 때문이다 — 예고가 0에 닿는 스텝부터 판정이 살아야 하고, 그 스텝이 예고 쪽으로 넘어가면
 * 판정 길이가 한 스텝 짧아진다.
 */
export function stepLances(world: World, dtSec: number): void {
  runtimeOf(world).releaseWhere((lance) => {
    if (lance.telegraphRemainingSec > 0) {
      lance.telegraphRemainingSec -= dtSec;
      return false;
    }
    lance.activeRemainingSec -= dtSec;
    return lance.activeRemainingSec <= 0;
  });
}

/**
 * 05 §1의 10번, resolvePlayerHits **뒤**.
 *
 * 점 표본이다. 판정이 한 스텝이 아니라 activeSec 내내 같은 자리에 서 있고 폭이 플레이어 한
 * 스텝 이동보다 훨씬 크므로, 스윕이 잡아 줄 「스텝 사이로 빠져나가는」 경로가 존재하지 않는다.
 *
 * 무적이면 아무 일도 없다 — P12가 무해해지는 유일한 경로다(§5.6).
 */
export function resolveLanceHits(world: World): void {
  if (world.isGameOver || isPlayerInvulnerable(world)) {
    return;
  }
  const player = world.player;
  for (const lance of runtimeOf(world).active) {
    if (lancePhaseOf(lance) !== 'active') {
      continue;
    }
    const reachU = lance.halfWidthU + PLAYER.hitRadiusU;
    for (const columnU of lance.columnsU) {
      if (Math.abs(player.xU - columnU) > reachU) {
        continue;
      }
      // 세로로 내리꽂히는 공격이라 킥은 화면 아래 방향이다. 겹친 줄이 여럿이어도 피격은
      // 한 번이고, 그 뒤는 applyPlayerHit이 붙인 무적이 먹는다
      applyPlayerHit(world, 'enemyBullet', null, 0, 1);
      return;
    }
  }
}
