/**
 * 잡몹의 발사 — 예비동작 길이 · 발사각 · 주기. 스펙 §8.1 · §6.2, 05_시스템_설계.md §6.1.
 *
 * `sim/enemies.ts`에서 갈라져 나온 절반이다. 저쪽이 「어디로 움직이는가」를 갖고 이쪽이
 * 「언제 무엇을 몇 발 내는가」를 갖는다. 두 축이 아키타입마다 따로 정해져서(행동 6종 × 발사
 * 형태 3종) 한 파일에 두면 분기가 곱해진다.
 *
 * 이 파일은 enemies.ts를 import하지 않는다. 필요한 칸만 ShotState로 좁혀 받으므로 두 파일이
 * 서로를 열지 않고, EnemyRuntime이 그 형태를 구조적으로 만족한다.
 *
 * HR-09 억제와 §3.2 탄환 상한은 여기서 판정하지 않는다. `sim/bullets.ts`의 fireEnemyBullet
 * 하나가 그 둘을 보고, 어느 쪽으로 막히든 결과가 같다 — 이번 발사는 취소되고 다음 주기를
 * 기다린다. 그래서 아래 어디에도 「쐈는지」를 되묻는 분기가 없다.
 */
import { SPREAD_TELL_SEC, STAGE_SCALING } from '../config/difficulty';
import type { BulletId } from '../config/ids';
import type { EnemyDef } from '../config/types';
import { aimAt } from '../core/vec';
import { fireEnemyBullet } from './bullets';
import type { FormationEntry } from './formations';
import type { Enemy, World } from './world';

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_RAD = Math.PI * 2;

/** EnemyDef.spreadDeg가 이 값이면 반각이 아니라 등간격 전방위 링이라는 표시다 */
const RING_SPREAD_DEG = 360;

/**
 * §6.2 유도탄 행. 그 행은 예비동작 시간을 주지 않았고 §14.1의 스테이지 값은 「단발 직선
 * (P1~P3)」 행에만 걸리므로 읽을 수 없다. 목업 실측이 확산·링과 같아 그 상수를 가리킨다 —
 * §6.2가 이 행에 자기 시간을 넣는 날 여기를 고친다.
 */
const HOMING_BULLET: BulletId = 'P11';

/** 발사가 읽고 쓰는 칸만. enemies.ts의 EnemyRuntime이 이 형태를 만족한다 */
export interface ShotState {
  fireTimerSec: number;
  windupRemainingSec: number;
  windupTotalSec: number;
  shotsDone: number;
  readonly entry: FormationEntry;
  readonly traveledU: number;
}

/**
 * §6.2 발사 예비동작의 길이. **발사 형태가 고른다** — §14.1의 스테이지 값은 「단발 직선
 * (P1~P3)」 행에만 걸리고 확산과 링은 스테이지와 무관하게 고정이다(A15). 목업 다섯 화면이
 * 3발 부채꼴과 2발 부채꼴에도 스테이지 값을 먹였고 그것이 틀렸다 — 이 값은 §14.2의 난이도
 * 축 2를 직접 움직이므로 「그림상 차이가 없다」는 이유로 넘길 수 없다.
 *
 * 참격파(P5) 행의 분기는 없다. 9종 중 그 탄을 쓰는 아키타입이 없다.
 */
export function enemyWindupSec(world: World, def: EnemyDef): number {
  if (def.spreadDeg > 0 || def.bullet === HOMING_BULLET) {
    return SPREAD_TELL_SEC;
  }
  return STAGE_SCALING[world.stageId].tellSec;
}

/** 조준선에 수직으로 발사원을 벌린 뒤 한 발 낸다 */
function launchShot(
  world: World,
  enemy: Enemy,
  bulletId: BulletId,
  angleRad: number,
  originOffsetU: number,
): void {
  fireEnemyBullet(world, {
    bulletId,
    xU: enemy.xU - Math.sin(angleRad) * originOffsetU,
    yU: enemy.yU + Math.cos(angleRad) * originOffsetU,
    angleRad,
    // §6.2가 허용한 예고 도형 3종 중 잡몹의 탄에 붙는 것은 없다. 전부 HR-09 억제 대상이다
    hasTelegraph: false,
  });
}

/**
 * 한 번의 발사. shotCount가 인자인 것은 측면 통과 때문이다 — 그쪽은 주기가 아니라 통과 중
 * 정해진 횟수라 한 번에 한 발씩 나가고, EnemyDef의 shotsPerCycle이 그 총수를 뜻한다.
 */
function fireShots(world: World, enemy: Enemy, def: EnemyDef, shotCount: number): void {
  const bulletId = def.bullet;
  if (bulletId === null) {
    return;
  }
  const shots = Math.max(1, shotCount);
  if (def.spreadDeg >= RING_SPREAD_DEG) {
    for (let index = 0; index < shots; index += 1) {
      launchShot(world, enemy, bulletId, (index / shots) * FULL_TURN_RAD, 0);
    }
    return;
  }
  const baseRad = aimAt(enemy.xU, enemy.yU, world.player.xU, world.player.yU);
  // 반각이므로 최외곽 두 발이 조준선에서 각각 spreadDeg만큼 벌어진다(A5)
  const halfRad = def.spreadDeg * DEG_TO_RAD;
  for (let index = 0; index < shots; index += 1) {
    const offset01 = shots === 1 ? 0 : (2 * index) / (shots - 1) - 1;
    if (halfRad > 0) {
      launchShot(world, enemy, bulletId, baseRad + halfRad * offset01, 0);
    } else {
      // 부채꼴이 아닌 다발은 각이 아니라 발사원을 벌린다. 같은 점에서 같은 각으로 내면
      // 함포문의 일제 사격이 한 발로 보인다
      launchShot(world, enemy, bulletId, baseRad, enemy.hitRadiusU * offset01);
    }
  }
}

/** §17 예비동작 시작. HR-05가 궤적 예고를 금지했으므로 「곧 쏜다」를 전하는 것이 이것뿐이다 */
export function beginEnemyWindup(
  world: World,
  enemy: Enemy,
  shot: ShotState,
  durationSec: number,
): void {
  shot.windupRemainingSec = durationSec;
  shot.windupTotalSec = durationSec;
  world.bus.emit({ kind: 'enemyWindup', xU: enemy.xU, yU: enemy.yU, durationSec });
}

/**
 * §8.1 발사 주기. 주기가 예비동작 시간을 포함하므로 예비동작은 주기 끝에서 그 길이만큼 앞에서
 * 시작한다. 부르는 쪽이 진입이 끝난 개체에만 부른다 — 「진입 후 정지, 예비동작 → 발사」다.
 */
export function advanceFireCycle(
  world: World,
  enemy: Enemy,
  shot: ShotState,
  def: EnemyDef,
  dtSec: number,
): void {
  if (def.bullet === null || def.fireCycleSec <= 0) {
    return;
  }
  const windupSec = enemyWindupSec(world, def);
  shot.fireTimerSec -= dtSec;
  if (shot.windupRemainingSec <= 0 && shot.fireTimerSec <= windupSec) {
    beginEnemyWindup(world, enemy, shot, Math.min(windupSec, def.fireCycleSec));
  }
  if (shot.windupRemainingSec > 0) {
    shot.windupRemainingSec -= dtSec;
  }
  if (shot.fireTimerSec <= 0) {
    fireShots(world, enemy, def, def.shotsPerCycle);
    shot.fireTimerSec += def.fireCycleSec;
    shot.windupRemainingSec = 0;
  }
}

/**
 * §8.1 E-F. 주기가 아니라 통과 중 정해진 횟수다. 발사 지점을 통과 거리로 등분하므로 이동
 * 속도가 달라져도 화면 위의 자리가 같다.
 */
export function advanceCrossPassFire(
  world: World,
  enemy: Enemy,
  shot: ShotState,
  def: EnemyDef,
  dtSec: number,
): void {
  if (def.bullet === null) {
    return;
  }
  const shots = def.shotsPerCycle;
  if (shot.windupRemainingSec > 0) {
    shot.windupRemainingSec -= dtSec;
    if (shot.windupRemainingSec <= 0) {
      shot.windupRemainingSec = 0;
      fireShots(world, enemy, def, 1);
      shot.shotsDone += 1;
    }
    return;
  }
  if (shot.shotsDone >= shots) {
    return;
  }
  const nextAtU = (shot.entry.pathLengthU * (shot.shotsDone + 1)) / (shots + 1);
  if (shot.traveledU >= nextAtU) {
    beginEnemyWindup(world, enemy, shot, enemyWindupSec(world, def));
  }
}
