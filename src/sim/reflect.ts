/**
 * 반사 — 스펙 §5.5 방향, §7.2 데미지, §7.1 반사탄의 일생. 05_시스템_설계.md §4.
 *
 * 이 파일이 지키는 것 넷.
 *
 * ① 데미지 기준값은 언제나 탄환 BRP다. 직전 데미지에 배수를 다시 곱하면 GREAT 3연속이
 *    등급 배수의 네제곱이 되어 밸런스가 무너진다. 재패리로 달라지는 것은 이번에 받은 등급뿐이다.
 * ② 등급 배수는 스냅샷의 밴드에서 읽는다. 상수를 박으면 E05가 GREAT 배수를 다시 정하는 경로가
 *    표현되지 않는다.
 * ③ 반사되는 순간 유도를 잃는다. 남겨 두면 플레이어가 쳐낸 탄이 플레이어를 쫓아오고,
 *    §5.5가 보장한 "반사탄은 언제나 멀어지며 출발한다"가 다음 스텝에 깨진다.
 * ④ 반사 직후 v'·n > 0이다. C2가 v·n < 0인 것만 통과시키므로 이것은 우연이 아니라 구조적
 *    보장이고, 그 부등식이 HR-07 아래에서 자기 탄에 즉시 맞지 않는 유일한 근거다.
 */
import { clamp } from '../core/math';
import { createVec2, dot, lengthOf, reflectAboutCenterInto, setLengthInto } from '../core/vec';
import { convertToReflect, type Projectile } from './bullets';
import type { EffectiveParryBand, World } from './world';

/** 스텝마다 재사용한다. 발사체마다 {x, y}를 새로 만들면 그 쓰레기가 프레임 안에서 회수된다 */
const reflectedVelocity = createVec2();

export interface ReflectResult {
  /** 반사 뒤의 발사체. 적 탄환이었으면 반사탄 풀로 옮겨진 새 슬롯이다 */
  readonly projectile: Projectile;
  /** 반사 전 등급. 처음 반사면 null이고, 그 null이 곧 "재패리가 아니다"를 뜻한다 */
  readonly previousGrade: EffectiveParryBand['id'] | null;
}

/**
 * 발사체 하나를 반사한다. 부르는 쪽은 §5.2의 C1~C5를 이미 통과시킨 상태여야 한다 —
 * 특히 C2(v·n < 0)를 거치지 않고 부르면 ④의 보장이 성립하지 않는다.
 *
 * 슬롯이 바뀔 수 있으므로 반환값을 써야 한다. 인자로 넘긴 발사체는 적 탄환이었던 경우
 * 이 호출 뒤에 반납된 슬롯이고, 그 자리를 계속 읽으면 다음 발사가 덮어쓴 값을 본다.
 */
export function reflectProjectile(
  world: World,
  source: Projectile,
  band: EffectiveParryBand,
): ReflectResult {
  const player = world.player;
  reflectAboutCenterInto(
    reflectedVelocity,
    source.vxUPerSec,
    source.vyUPerSec,
    source.xU,
    source.yU,
    player.xU,
    player.yU,
  );

  const projectile = source.owner === 'enemy' ? convertToReflect(world, source) : source;
  const previousGrade = projectile.lastGrade;

  const speedUPerSec = clamp(
    lengthOf(reflectedVelocity.x, reflectedVelocity.y) * band.speedMul,
    0,
    world.stats.reflectSpeedMaxUPerSec,
  );
  setLengthInto(reflectedVelocity, reflectedVelocity.x, reflectedVelocity.y, speedUPerSec);
  projectile.vxUPerSec = reflectedVelocity.x;
  projectile.vyUPerSec = reflectedVelocity.y;

  projectile.owner = 'player';
  projectile.homingRemainingSec = 0;
  projectile.lifeRemainingSec = world.stats.reflectLifetimeSec;
  projectile.graceRemainingSec = world.stats.reflectGraceSec;
  projectile.pierceRemaining = world.stats.reflectPierceCount;
  projectile.parriedSessionId = world.parry.sessionId;
  projectile.lastGrade = band.id;
  projectile.damage = Math.floor(
    projectile.brp * band.damageMul * world.stats.reflectDamageMulFor(world.run.combo),
  );

  return { projectile, previousGrade };
}

/**
 * 05 §13의 가드가 반사 직후 보는 부등식. 개발 빌드에서만 부르고, 깨지면 게임의 안전 전제가
 * 무너진 것이라 계속 돌 수 없다.
 */
export function assertMovingAway(world: World, projectile: Projectile): void {
  const player = world.player;
  const normalXU = projectile.xU - player.xU;
  const normalYU = projectile.yU - player.yU;
  if (dot(projectile.vxUPerSec, projectile.vyUPerSec, normalXU, normalYU) <= 0) {
    throw new Error('반사탄이 플레이어에게서 멀어지지 않는다 — §5.5의 구조적 보장이 깨졌다');
  }
}
