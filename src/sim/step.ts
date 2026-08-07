/**
 * 한 스텝의 순서 — 05_시스템_설계.md §1.
 *
 * **순서를 아는 파일은 이것 하나다.** 각 단계가 무엇을 하는지는 전부 이웃 모듈에 있고 여기는
 * 그 호출을 번호순으로 늘어놓기만 한다. world.ts에 두지 않은 것은 sim/ 거의 전부가 world.ts를
 * import하기 때문이다 — 순서가 거기 있으면 아무 파일이나 단계를 앞당길 수 있다.
 *
 * 바꾸면 스펙이 깨지는 자리 넷은 그 줄에 이유를 적었다(05 §1의 ①~④). 요약하면
 * 9번 > 10번 · 8번 > 9번(+이전 위치) · 5번 > 6번 · 13번 > 9번이다.
 *
 * ── 여기서 하지 않는 것 ─────────────────────────────────────────────────────────
 *
 * 스테이지 클리어와 게임오버의 **화면 전환**은 15번이 아니라 sim/run.ts다. 이 함수는 월드
 * 하나만 알고 런을 모른다 — 라이프 0(isGameOver)과 보스 격파 종료(boss.isFinished)를 상태로
 * 남기고, 그것을 읽어 다음 화면을 고르는 것은 런의 일이다.
 */
import { STAGES } from '../config/stages';
import type { Input } from '../core/input';
import { lengthOf } from '../core/vec';
import { createBossState, enterPhaseDirectly, stepBoss } from './boss';
import { bossBodyHitsPlayer, resolveBossHits } from './boss-hits';
import { decayReflectGrace, integrateProjectiles } from './bullets';
import { applyPlayerHit, resolvePlayerHits, resolveReflectHits } from './collision';
import { stepEnemies, stepEnemySpawns } from './enemies';
import { checkStep, guardStateOf, GUARDS_ENABLED } from './guards';
import { resolveLanceHits } from './lance';
import { consumeParryInput, resolveParry } from './parry';
import { announceInvulnEnd, isPlayerInvulnerable, movePlayer } from './player';
import { reflectProjectile } from './reflect';
import { flushReflectHitEffects } from './reflect-effects';
import { addCombo, settleCombo } from './score';
import { stepWaves, wavePhase } from './waves';
import type { World } from './world';
import { decayZones, resolveZones } from './zones';

export interface StepFrame {
  readonly input: Input;
  /**
   * 이 스텝이 소비해도 되는 눌림의 상한 (ms). 프레임 단위로 소비하면 등급을 고를 수 있는
   * 해상도가 고정 스텝이 아니라 프레임 간격이 된다.
   */
  readonly untilMs: number;
}

/**
 * §11.5 E04 「각 보스전 진입 시 화면 내 모든 적 탄환을 자동 GREAT 패리」.
 *
 * 보스를 세우는 자리가 하나뿐이라 「각 보스전」이 여기 한 줄로 표현된다. 등급을 거리로 매기지
 * 않고 카드가 정한 등급을 그대로 먹이는 것이 이 카드의 내용이고, 그래서 §5.2의 C1~C5 중
 * 거리 조건(C1)과 접근 조건(C2)을 지나지 않는다 — 화면 **전부**가 대상이다.
 */
export function autoParryOnBossEnter(world: World): void {
  const gradeId = world.stats.autoParryGradeOnBossEnter;
  if (gradeId === null || world.enemyBullets.activeCount === 0) {
    return;
  }
  const band = world.stats.bands.find((entry) => entry.id === gradeId);
  if (band === undefined) {
    return;
  }
  world.parry.sessionId += 1;
  let count = 0;
  // convertToReflect가 활성 목록에서 원소를 빼므로 사본을 훑는다
  for (const projectile of [...world.enemyBullets.active]) {
    if (!projectile.isParryable) {
      continue;
    }
    const result = reflectProjectile(world, projectile, band);
    count += 1;
    world.bus.emit({
      kind: 'reflectLaunched',
      grade: band.id,
      xU: result.projectile.xU,
      yU: result.projectile.yU,
    });
  }
  if (count === 0) {
    return;
  }
  addCombo(world, count);
  world.clock.requestHitstop(band.hitstopSec, world.simTimeSec);
}

/**
 * 05 §1의 7번. 보스는 웨이브가 끝나고 소강이 지난 뒤에 한 번만 세워진다 — 구간을 읽어 만드는
 * 것이 이 자리 하나라 「보스가 두 번 등장한다」가 만들어질 수 없다.
 */
function stepBossPhase(world: World, dtSec: number): void {
  if (world.boss === null) {
    if (wavePhase(world) !== 'boss') {
      return;
    }
    world.boss = createBossState(STAGES[world.stageId].bossId);
    enterPhaseDirectly(world.boss, world.entryBossPhaseIndex);
    autoParryOnBossEnter(world);
  }
  stepBoss(world, world.boss, dtSec);
}

/**
 * §10.1 본체 접촉. 10번의 뒤에 붙는 것은 한 스텝의 피격이 하나뿐이기 때문이다 —
 * resolvePlayerHits가 이미 하나를 확정했으면 그때 붙은 무적이 여기를 막는다.
 */
function resolveBossContact(world: World): void {
  const boss = world.boss;
  if (boss === null || world.isGameOver || isPlayerInvulnerable(world)) {
    return;
  }
  if (!bossBodyHitsPlayer(world, boss)) {
    return;
  }
  const player = world.player;
  const towardPlayerXU = player.xU - boss.xU;
  const towardPlayerYU = player.yU - boss.yU;
  const lengthU = lengthOf(towardPlayerXU, towardPlayerYU);
  applyPlayerHit(
    world,
    'body',
    null,
    lengthU === 0 ? 0 : towardPlayerXU / lengthU,
    lengthU === 0 ? 0 : towardPlayerYU / lengthU,
  );
}

/** 05 §1의 16번. 개발 빌드만 돈다 */
function checkGuards(world: World, dtSec: number): void {
  const boss = world.boss;
  checkStep(world, guardStateOf(world), dtSec, {
    hr03Exemption:
      boss !== null && boss.mode === 'defeated'
        ? 'bossDefeat'
        : wavePhase(world) === 'lull'
          ? 'lull'
          : null,
    boss:
      boss === null
        ? null
        : { xU: boss.xU, yU: boss.yU, isCharging: boss.positionOwnedByPattern },
  });
}

/** 05 §1의 한 스텝. 인자 dtSec은 언제나 고정 스텝이다 */
export function stepWorld(world: World, dtSec: number, frame: StepFrame): void {
  // 1. 타이머 감산 — 전부 sim 시계다. 실시간에 남는 것은 press edge 검출뿐이다
  world.simTimeSec += dtSec;
  frame.input.decayParryBuffer(dtSec);
  decayReflectGrace(world, dtSec);
  decayZones(world, dtSec);
  announceInvulnEnd(world);

  // 2. 입력 소비
  consumeParryInput(world, frame.input, frame.untilMs);

  // 3. 플레이어 이동
  movePlayer(world, dtSec, frame.input);

  // 4. 웨이브 진행. 대창 감산이 여기 묶여 있어 보스 구간에도 돌아야 한다
  stepWaves(world, dtSec);

  // 5. 적 스폰. 6번보다 앞이다 — 같은 스텝에 스폰된 적이 예비동작 없이 쏘면 안 된다
  stepEnemySpawns(world);

  // 6. 적 행동·발사. 이전 위치는 개체를 옮기기 직전에 stepEnemies가 남긴다
  stepEnemies(world, dtSec);

  // 7. 보스 진행
  stepBossPhase(world, dtSec);

  // 8. 발사체 적분. 9번은 적분 후 위치로 등급을 매기고 10번은 이전 위치로 선분을 만든다
  integrateProjectiles(world, dtSec);

  // 9. 패리 판정. 10번보다 반드시 앞이다 — GREAT 밴드 안에서 대형 탄환은 이미 코어를 덮고 있다
  resolveParry(world, frame.input);

  // 10. 피격 판정. 셋 다 무적을 먼저 붙이는 쪽이 이긴다
  resolvePlayerHits(world);
  resolveBossContact(world);
  resolveLanceHits(world);

  // 11. 반사탄 대 적 판정
  resolveReflectHits(world);
  if (world.boss !== null) {
    resolveBossHits(world, world.boss);
  }

  // 11.5 반사탄 명중이 남긴 것 — 12번보다 앞이라 이 스텝에 생긴 장판도 같은 스텝에 판정된다.
  //      11번이 releaseWhere 안에서 도는 이상 그 안에서 새 반사탄을 집을 수 없어 여기로 밀렸다
  flushReflectHitEffects(world);

  // 12. 장판 판정
  resolveZones(world, dtSec);

  // 13. 상한 정리. 반사탄 상한은 9번의 슬롯 획득이 이미 지킨다 — sim/caps.ts의 acquireReflectSlot이
  //     여유가 없으면 가장 오래된 것을 회수하므로 신규 반사탄이 버려지는 경로가 없다

  // 14. 점수·콤보 정산
  settleCombo(world);

  // 15. 런 상태 검사 — 라이프 0은 applyPlayerHit이 그 자리에서 확정한다

  // 16. 가드 검사
  if (GUARDS_ENABLED) {
    checkGuards(world, dtSec);
  }

  // 17. 이벤트 큐 배출
  world.bus.flush();
}
