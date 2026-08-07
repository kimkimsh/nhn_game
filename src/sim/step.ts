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
import { createBossState, stepBoss } from './boss';
import { bossBodyHitsPlayer, resolveBossHits } from './boss-hits';
import { decayReflectGrace, integrateProjectiles } from './bullets';
import { applyPlayerHit, resolvePlayerHits, resolveReflectHits } from './collision';
import { stepEnemies, stepEnemySpawns } from './enemies';
import { checkStep, createGuardState, GUARDS_ENABLED, type GuardState } from './guards';
import { resolveLanceHits } from './lance';
import { consumeParryInput, resolveParry } from './parry';
import { announceInvulnEnd, isPlayerInvulnerable, movePlayer } from './player';
import { settleCombo } from './score';
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

interface StepGuards {
  readonly state: GuardState;
  /**
   * 이 스테이지가 적 탄환을 한 번이라도 낸 뒤인가.
   *
   * HR-03을 스테이지 시작 시각부터 재면 다섯 스테이지가 전부 시작 즉시 던진다. §9의 웨이브가
   * 0:00에 시작하는데 §8.2의 진입 궤적은 활동 영역 밖에서 출발하므로, 첫 탄까지의 공백은
   * 편성이 아니라 진입에 걸리는 시간 자체다 — 웨이브 표로는 없앨 수 없다. HR-03이 금지한
   * 것은 플레이 중에 벌어지는 공백이므로 재는 시작점을 첫 탄으로 잡는다.
   *
   * **면제가 아니라 시작점이다.** 첫 탄이 나온 뒤의 공백은 09 §2.4의 면제 넷 말고는 그대로
   * 던진다. 진짜 해결은 §9.1의 웨이브 시작 시각이나 HR-03 조문의 개정이고 구현이 못 한다.
   */
  armed: boolean;
}

/**
 * 가드 상태를 World가 아니라 여기 둔다. 릴리스에서 `GUARDS_ENABLED`가 상수 false가 되면
 * 아래 블록과 함께 guards.ts로 가는 유일한 호출이 사라져 모듈이 통째로 트리 셰이킹된다 —
 * World의 필드로 두면 createWorld가 무조건 만들어야 해서 그 길이 막힌다.
 */
const GUARD_STATES = new WeakMap<World, StepGuards>();

function guardsOf(world: World): StepGuards {
  let guards = GUARD_STATES.get(world);
  if (guards === undefined) {
    guards = { state: createGuardState(), armed: false };
    GUARD_STATES.set(world, guards);
  }
  return guards;
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
  const guards = guardsOf(world);
  if (!guards.armed) {
    if (world.enemyBullets.activeCount === 0) {
      return;
    }
    guards.armed = true;
  }
  const boss = world.boss;
  checkStep(world, guards.state, dtSec, {
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
