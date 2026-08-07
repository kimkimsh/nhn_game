/**
 * 보스 패턴 실행기 — 프리미티브 9종을 **언제** 내보낼지. 05_시스템_설계.md §8.2, 12_통합_계약.md §4.
 * `sim/boss.ts`의 stepBoss가 fighting 상태에서만 부른다.
 *
 * 무엇을 내보내는지는 이웃 둘이 갖는다 — 예고 없는 발사는 `boss-shots.ts`, 예고가 붙는
 * `charge`·`mortar`는 `boss-telegraphs.ts`다. `lance`는 프리미티브가 아니라 웨이브와 공유하는
 * 위협이라 `sim/lance.ts`를 부른다(12 §10 E-10).
 *
 * ── 겹침 규칙이 패턴 안팎에서 다르다 ────────────────────────────────────────────
 *
 * 패턴 **사이**는 겹치지 않는다 — 하나가 끝나야 다음이 시작한다. 패턴 **안**에는 그 규칙이
 * 걸리지 않는다: `parallel`의 자식들은 겹치는 것이 목적이고, `charge.onEnd`·`mortar.onImpact`가
 * 낳는 후속도 부모의 남은 시간과 겹친다. 그래서 패턴이 끝났는지는 자기 시계만이 아니라
 * 자식 전부가 끝났는지까지 본다.
 *
 * ── kind 분기는 never 대입으로 끝난다 ───────────────────────────────────────────
 *
 * 없으면 union에 kind를 추가하고 이 파일을 안 고쳐도 타입 오류 0개에 테스트 통과이고
 * 보스만 그 차례에 조용히 아무것도 안 한다(12 §4.1). 아래 두 switch가 모두 그 줄로 끝난다.
 */
import { BOSS_COMMON } from '../config/bosses';
import type { BossPattern, BossPhase } from '../config/types';
import type { BossState, BossTelegraph } from './boss';
import {
  fireArcSlash,
  fireBarrageShot,
  fireRing,
  fireSpreadSet,
  fireVolleyRound,
  type ShotOrigin,
} from './boss-shots';
import {
  chargeDurationSec,
  explodeMortarCircle,
  spawnMortarCircle,
  startCharge,
  stepCharge,
  type ChargeRun,
  type FollowUp,
} from './boss-telegraphs';
import { spawnEnemyGroup } from './enemies';
import { fireLance, lanceColumnsU } from './lance';
import type { ZoneWorld } from './zones';

/** 순환의 시작. 고정 순환에서 `(-1 + 1) % n`이 첫 패턴 0이 되게 하는 값이다 */
const NO_PATTERN_YET = -1;
/** 페이즈에 들어온 뒤 아직 관통 대창 주기를 세우지 않았다는 표시 */
const LANCE_NOT_ARMED = -1;

/**
 * 실행 중인 패턴 하나. `parallel`의 자식과 후속(onEnd·onImpact)도 같은 구조를 쓴다 —
 * 후속만 다른 타입으로 두면 후속 안에 다시 후속이 붙는 자리에서 형태가 갈린다.
 */
interface PatternTask {
  readonly pattern: BossPattern;
  elapsedSec: number;
  /** 자식과 후속을 빼고 이 패턴 자신이 도는 시간 (s). 시작 시점에 정해지고 그 뒤로 안 바뀐다 */
  durationSec: number;
  /** 예비동작 (s). 이 시간 안에는 보스가 charging이다 */
  windupSec: number;
  readonly origin: ShotOrigin;
  /** 이미 내보낸 하위 단위 수 (volley의 라운드, mortar의 예고 원, barrage의 탄 …) */
  fired: number;
  /** mortar 전용 — 이미 터진 예고 원 수 */
  resolved: number;
  readonly children: PatternTask[];
  /** mortar가 띄운 예고 원. 인덱스는 생성 순서 그대로다 */
  readonly circles: BossTelegraph[];
  charge: ChargeRun | null;
}

export interface RunnerState {
  task: PatternTask | null;
  /** 패턴 사이 간격의 남은 시간 (s) */
  gapRemainingSec: number;
  lastPatternIndex: number;
  lanceRemainingSec: number;
}

export function createRunnerState(): RunnerState {
  return {
    task: null,
    gapRemainingSec: 0,
    lastPatternIndex: NO_PATTERN_YET,
    lanceRemainingSec: LANCE_NOT_ARMED,
  };
}

/** 페이즈 전환·격파가 진행 중이던 패턴을 통째로 버린다. 순환은 새 페이즈의 첫 패턴부터다 */
export function resetRunner(runner: RunnerState): void {
  runner.task = null;
  runner.gapRemainingSec = 0;
  runner.lastPatternIndex = NO_PATTERN_YET;
  runner.lanceRemainingSec = LANCE_NOT_ARMED;
}

/** 시작 시점에 정해지는 것 — 자기 시계의 길이, 예비동작, 돌진 구간, parallel의 자식 */
function startTask(
  world: ZoneWorld,
  boss: BossState,
  pattern: BossPattern,
  originXU: number,
  originYU: number,
  followBoss: boolean,
): PatternTask {
  const task: PatternTask = {
    pattern,
    elapsedSec: 0,
    durationSec: 0,
    windupSec: 0,
    origin: { xU: originXU, yU: originYU, followBoss },
    fired: 0,
    resolved: 0,
    children: [],
    circles: [],
    charge: null,
  };

  switch (pattern.kind) {
    case 'volley':
      task.windupSec = pattern.tellSec;
      task.durationSec = pattern.tellSec + Math.max(0, pattern.repeat - 1) * pattern.intervalSec;
      break;
    case 'spread':
      task.windupSec = pattern.tellSec;
      task.durationSec = pattern.tellSec + Math.max(0, pattern.sets - 1) * pattern.setIntervalSec;
      break;
    case 'ring':
      task.windupSec = pattern.tellSec;
      task.durationSec = pattern.tellSec;
      break;
    case 'arc':
      task.windupSec = pattern.backswingSec;
      task.durationSec =
        pattern.backswingSec + Math.max(0, pattern.count - 1) * pattern.intervalSec;
      break;
    case 'charge': {
      const run = startCharge(world, boss, pattern);
      task.charge = run;
      task.durationSec = chargeDurationSec(pattern, run);
      break;
    }
    case 'mortar':
      task.durationSec =
        Math.max(0, pattern.count - 1) * pattern.sequentialSec + pattern.telegraphSec;
      break;
    case 'barrage':
      task.durationSec = pattern.durationSec;
      break;
    case 'parallel':
      for (const part of pattern.parts) {
        task.children.push(startTask(world, boss, part, originXU, originYU, followBoss));
      }
      for (const child of task.children) {
        task.windupSec = Math.max(task.windupSec, child.windupSec);
        task.durationSec = Math.max(task.durationSec, child.durationSec);
      }
      break;
    case 'summon':
      // 스폰 자체가 이 패턴이 하는 일 전부다. 진입 궤적도 돌진 방향선도 E-D 자신의 behavior가
      // 갖고 있으므로(§8.1) 여기서 기다릴 것이 없고, 다음 패턴까지의 간격은 §10.1이 준다
      task.durationSec = 0;
      break;
    default: {
      const _never: never = pattern;
      throw new Error(`unhandled ${(_never as BossPattern).kind}`);
    }
  }

  if (task.windupSec > 0) {
    world.bus.emit({
      kind: 'enemyWindup',
      xU: task.origin.xU,
      yU: task.origin.yU,
      durationSec: task.windupSec,
    });
  }
  return task;
}

function adopt(world: ZoneWorld, boss: BossState, task: PatternTask, followUp: FollowUp | null): void {
  if (followUp === null) {
    return;
  }
  task.children.push(startTask(world, boss, followUp.pattern, followUp.xU, followUp.yU, false));
}

/** 시작 시각과 간격이 주어진 하위 단위 중 지금까지 몇 개가 나올 차례인가 */
function dueUnits(elapsedSec: number, startSec: number, intervalSec: number, total: number): number {
  if (elapsedSec < startSec) {
    return 0;
  }
  if (intervalSec <= 0) {
    return total;
  }
  return Math.min(total, Math.floor((elapsedSec - startSec) / intervalSec) + 1);
}

/** 자기 시계와 자식이 모두 끝났을 때만 참. 후속은 부모의 시계를 넘겨 이어질 수 있다 */
function stepTask(world: ZoneWorld, boss: BossState, task: PatternTask, dtSec: number): boolean {
  task.elapsedSec += dtSec;
  if (task.origin.followBoss) {
    task.origin.xU = boss.xU;
    task.origin.yU = boss.yU;
  }
  const pattern = task.pattern;

  switch (pattern.kind) {
    case 'volley': {
      const due = dueUnits(task.elapsedSec, pattern.tellSec, pattern.intervalSec, pattern.repeat);
      while (task.fired < due) {
        fireVolleyRound(world, boss, pattern, task.origin, task.fired);
        task.fired += 1;
      }
      break;
    }
    case 'spread': {
      const due = dueUnits(task.elapsedSec, pattern.tellSec, pattern.setIntervalSec, pattern.sets);
      while (task.fired < due) {
        fireSpreadSet(world, boss, pattern, task.origin, task.fired);
        task.fired += 1;
      }
      break;
    }
    case 'ring':
      if (task.fired === 0 && task.elapsedSec >= pattern.tellSec) {
        fireRing(world, boss, pattern, task.origin);
        task.fired = 1;
      }
      break;
    case 'arc': {
      const due = dueUnits(
        task.elapsedSec,
        pattern.backswingSec,
        pattern.intervalSec,
        pattern.count,
      );
      while (task.fired < due) {
        fireArcSlash(world, boss, pattern, task.origin, task.fired);
        task.fired += 1;
      }
      break;
    }
    case 'charge':
      if (task.charge !== null) {
        adopt(world, boss, task, stepCharge(world, boss, pattern, task.charge, task.elapsedSec, dtSec));
      }
      break;
    case 'mortar': {
      const spawnDue = dueUnits(task.elapsedSec, 0, pattern.sequentialSec, pattern.count);
      while (task.fired < spawnDue) {
        task.circles.push(spawnMortarCircle(world, boss, pattern));
        task.fired += 1;
      }
      for (let index = task.resolved; index < task.fired; index += 1) {
        const circle = task.circles[index];
        if (circle !== undefined) {
          circle.ageSec += dtSec;
        }
      }
      const blastDue = dueUnits(
        task.elapsedSec,
        pattern.telegraphSec,
        pattern.sequentialSec,
        pattern.count,
      );
      while (task.resolved < blastDue) {
        const circle = task.circles[task.resolved];
        if (circle !== undefined) {
          adopt(world, boss, task, explodeMortarCircle(world, boss, pattern, circle));
        }
        task.resolved += 1;
      }
      break;
    }
    case 'barrage': {
      const intervalSec = pattern.count > 0 ? pattern.durationSec / pattern.count : 0;
      const due = dueUnits(task.elapsedSec, 0, intervalSec, pattern.count);
      while (task.fired < due) {
        fireBarrageShot(world, boss, pattern, task.origin);
        task.fired += 1;
      }
      break;
    }
    case 'parallel':
      break;
    case 'summon':
      if (task.fired === 0) {
        spawnEnemyGroup(world, pattern.enemy, pattern.formation, pattern.count);
        task.fired = 1;
      }
      break;
    default: {
      const _never: never = pattern;
      throw new Error(`unhandled ${(_never as BossPattern).kind}`);
    }
  }

  let childrenDone = true;
  for (const child of task.children) {
    if (!stepTask(world, boss, child, dtSec)) {
      childrenDone = false;
    }
  }
  return childrenDone && task.elapsedSec >= task.durationSec;
}

/**
 * §10.6 페이즈 4만 무작위이고 직전 패턴을 제외한다. 나머지는 §10.1의 고정 순환이라 배열
 * 순서가 곧 스펙이 적은 순서다.
 *
 * 제외를 「다시 뽑기」로 풀지 않는다 — 한 칸 적은 구간에서 뽑고 직전 인덱스 위쪽을 밀어 올리면
 * 난수 소비가 언제나 1회로 고정되고, 그래야 같은 시드의 두 런이 갈라지지 않는다.
 */
function pickPatternIndex(world: ZoneWorld, phase: BossPhase, lastIndex: number): number {
  const count = phase.patterns.length;
  if (phase.patternOrder !== 'randomNoRepeat' || count <= 1 || lastIndex < 0) {
    return (lastIndex + 1) % count;
  }
  const drawn = world.rng.int(0, count - 1);
  return drawn >= lastIndex ? drawn + 1 : drawn;
}

/**
 * §9.7 관통 대창. `BossPattern`이 아니라 웨이브와 공유하는 `sim/lance.ts`를 부른다(12 §10 E-10).
 * 순환에 낄 수 없으므로 빈도를 내는 수단이 간격뿐이고, 그 간격이 `LanceDef.intervalSec`다.
 */
function stepPhaseLance(
  world: ZoneWorld,
  runner: RunnerState,
  phase: BossPhase,
  dtSec: number,
): void {
  const lance = phase.lance;
  if (lance === undefined) {
    return;
  }
  if (runner.lanceRemainingSec < 0) {
    runner.lanceRemainingSec = lance.intervalSec;
    return;
  }
  runner.lanceRemainingSec -= dtSec;
  if (runner.lanceRemainingSec > 0) {
    return;
  }
  runner.lanceRemainingSec = lance.intervalSec;
  fireLance(world, {
    columnsU: lanceColumnsU(lance.lanes, lance.safeCorridorU),
    telegraphSec: lance.telegraphSec,
    activeSec: lance.activeSec,
  });
}

/**
 * 05 §1의 7번 중 패턴 몫. `sim/boss.ts`가 fighting 상태에서만 부르므로 여기서 전환·격파를
 * 다시 보지 않는다.
 */
export function stepRunner(world: ZoneWorld, boss: BossState, dtSec: number): void {
  const runner = boss.runner;
  const phase = boss.def.phases[boss.phaseIndex];
  if (phase === undefined) {
    return;
  }
  stepPhaseLance(world, runner, phase, dtSec);

  if (runner.task === null) {
    runner.gapRemainingSec -= dtSec;
    if (runner.gapRemainingSec > 0 || phase.patterns.length === 0) {
      boss.charging = false;
      return;
    }
    const index = pickPatternIndex(world, phase, runner.lastPatternIndex);
    const pattern = phase.patterns[index];
    if (pattern === undefined) {
      return;
    }
    runner.lastPatternIndex = index;
    runner.task = startTask(world, boss, pattern, boss.xU, boss.yU, true);
  }

  const task = runner.task;
  if (stepTask(world, boss, task, dtSec)) {
    runner.task = null;
    runner.gapRemainingSec = BOSS_COMMON.patternGapSec;
    boss.charging = false;
    boss.positionOwnedByPattern = false;
    return;
  }
  boss.charging = task.elapsedSec < task.windupSec;
}
