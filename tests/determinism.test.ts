/**
 * D-05 결정론과 HR-06 프레임률 독립 — 09_검증_전략.md §3.6.
 *
 * 앞의 셋은 결과를 보고 뒤의 둘은 원인을 본다. 결과만 보면 "지금은 우연히 같다"를 통과시키고,
 * 원인만 보면 규칙을 지킨 코드가 실제로 같은 런을 내는지는 모른다.
 *
 * 09 §3.6이 부르는 src/dev/headless.ts가 아직 없어서 하네스를 여기 둔다. sim/waves.ts와
 * sim/enemies.ts도 없어 world.rng를 소비하는 코드가 하나도 없고, 그대로면 "시드가 다르면
 * 달라진다"가 구조적으로 성립하지 않는다 — 아래 fireScript가 그 몫만 대신한다. 세 파일이
 * 생기면 fireScript를 지운다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HITSTOP_BUDGET_PER_SEC } from '../src/config/feel';
import type { StageId } from '../src/config/ids';
import { PLAYER } from '../src/config/player';
import { PLAYFIELD } from '../src/config/playfield';
import { createClock } from '../src/core/clock';
import { createInput } from '../src/core/input';
import { FIXED_DT_SEC, MAX_STEPS_PER_FRAME, createLoop } from '../src/core/loop';
import { createRng, deriveStream } from '../src/core/rng';
import { aimAt } from '../src/core/vec';
import { fireEnemyBullet } from '../src/sim/bullets';
import { stepWorld } from '../src/sim/step';
import { createWorld, type World } from '../src/sim/world';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SEED = 20260807;
const STAGE_ID: StageId = 1;
const MS_PER_SEC = 1000;

/** 발사 주기와 발사원의 y. 값이 아니라 "런이 계속 살아 있게" 하는 하네스 설정이다 */
const FIRE_PERIOD_SEC = 0.35;
const SHOOTER_YU = 220;
/** 조준에 얹는 흔들림 (rad). 크게 주면 전부 빗나가 피격·무적·콤보 리셋이 한 번도 안 돈다 */
const AIM_JITTER_RAD = 0.02;

/** FNV-1a 32비트. 상태 문자열을 한 값으로 접는다 */
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

function hashText(text: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME_32);
  }
  return hash >>> 0;
}

/**
 * 스텝이 바꿀 수 있는 값을 빠짐없이 적는다. 한 칸이라도 빠지면 그 칸의 비결정은 해시를 통과한다.
 * 반올림하지 않는 것도 같은 이유다 — 부동소수 하위 비트의 드리프트가 곧 잡으려는 대상이다.
 */
function serializeWorld(world: World): string {
  const player = world.player;
  const run = world.run;
  const parry = world.parry;
  const parts: unknown[] = [
    world.simTimeSec, world.parrySeq, world.chainIndex, world.isGameOver,
    player.xU, player.yU, player.prevXU, player.prevYU, player.lives,
    player.hitInvulnUntilSec, player.parryInvulnUntilSec,
    player.hitInvulnWasActive, player.parryInvulnWasActive,
    run.score, run.combo, run.comboUntilSec, run.comboWarned, run.shieldCharges,
    parry.sessionId, parry.isActive, parry.activeStartedSec, parry.activeUntilSec,
    parry.cooldownUntilSec, parry.sessionParryCount, parry.sessionRewarded, parry.cooldownAnnounced,
  ];
  for (const pool of [world.enemyBullets, world.reflectBullets]) {
    for (const b of pool.active) {
      parts.push(
        'b', b.bulletId, b.owner, b.xU, b.yU, b.prevXU, b.prevYU, b.vxUPerSec, b.vyUPerSec,
        b.radiusU, b.brp, b.isParryable, b.homingRemainingSec, b.lifeRemainingSec,
        b.graceRemainingSec, b.parriedSessionId, b.lastGrade, b.damage, b.pierceRemaining,
      );
    }
  }
  for (const e of world.enemies.active) {
    parts.push('e', e.xU, e.yU, e.prevXU, e.prevYU, e.hp, e.frontShieldIntact);
  }
  return parts.join('|');
}

interface RunSpec {
  readonly seed: number;
  /** 프레임 목록. totalMs가 있으면 그 시각에서 끊고, frames가 있으면 그 개수만큼 돈다 */
  readonly frameMsAt: (index: number) => number;
  readonly totalMs?: number;
  readonly frames?: number;
  /** 렌더가 자기 몫 스트림에서 뽑는 횟수. sim 결과가 이 값에 흔들리면 D-05가 깨진 것이다 */
  readonly renderDrawsPerFrame: number;
  /** 패리 눌림의 실시간 시각 (ms). 비우면 눌림 없는 런이다 */
  readonly parryPressAtMs: readonly number[];
  /** 적 발사를 돌릴 것인가. 끄면 히트스톱도 피격도 없는 순수 누산기 런이 된다 */
  readonly fire: boolean;
}

interface RunResult {
  readonly hash: number;
  readonly steps: number;
  readonly simSec: number;
  readonly realSec: number;
  readonly droppedSimSec: number;
  readonly firedCount: number;
  readonly lives: number;
  readonly score: number;
}

interface FireState {
  timerSec: number;
  count: number;
}

/**
 * sim/enemies.ts가 할 몫의 최소 대역. 발사 위치와 조준 흔들림을 world.rng에서 뽑으므로
 * 시드가 바뀌면 런이 갈린다 — 그 갈림이 없으면 "시드가 다르면 달라진다"를 확인할 수 없다.
 */
function fireScript(world: World, dtSec: number, state: FireState): void {
  state.timerSec -= dtSec;
  if (state.timerSec > 0) {
    return;
  }
  state.timerSec += FIRE_PERIOD_SEC;
  const xU = world.rng.range(PLAYFIELD.enemyBounds.minXU, PLAYFIELD.enemyBounds.maxXU);
  const aimRad = aimAt(xU, SHOOTER_YU, world.player.xU, world.player.yU);
  const angleRad = aimRad + world.rng.range(-AIM_JITTER_RAD, AIM_JITTER_RAD);
  const shot = { bulletId: 'P1', xU, yU: SHOOTER_YU, angleRad, hasTelegraph: false } as const;
  if (fireEnemyBullet(world, shot) !== null) {
    state.count += 1;
  }
}

/** 고정 스텝 루프를 rAF 없이 돌린다. runFrame이 프레임 간격을 인자로 받는 유일한 입구다 */
function runSim(spec: RunSpec): RunResult {
  const clock = createClock(HITSTOP_BUDGET_PER_SEC);
  const world = createWorld({ stageId: STAGE_ID, seed: spec.seed, clock });
  const input = createInput();
  const renderRng = deriveStream(spec.seed, 'render/particles');
  const fireState: FireState = { timerSec: FIRE_PERIOD_SEC, count: 0 };

  // 눌림은 실시간 시각을 달고 큐에 들어가고 소비는 그 시각으로 갈린다. 미리 넣어 두는 것과
  // 그 시각에 넣는 것이 같은 이유가 그것이다
  input.pressKey({ code: 'KeyD', atMs: 0, shiftHeld: false, repeat: false });
  for (const atMs of spec.parryPressAtMs) {
    input.pressKey({ code: 'Space', atMs, shiftHeld: false, repeat: false });
    input.releaseKey('Space');
  }

  let nowMs = 0;
  let steps = 0;
  let droppedSimSec = 0;
  const loop = createLoop({
    clock,
    hooks: {
      beginFrame(): void {
        input.beginFrame(nowMs);
      },
      step(fixedDtSec: number): void {
        if (spec.fire) {
          fireScript(world, fixedDtSec, fireState);
        }
        stepWorld(world, fixedDtSec, { input, untilMs: nowMs });
        steps += 1;
      },
      render(): void {
        for (let i = 0; i < spec.renderDrawsPerFrame; i += 1) {
          renderRng.float();
        }
      },
    },
  });

  const totalMs = spec.totalMs;
  let index = 0;
  for (;;) {
    if (spec.frames !== undefined && index >= spec.frames) {
      break;
    }
    let dtMs = spec.frameMsAt(index);
    if (totalMs !== undefined) {
      if (nowMs >= totalMs) {
        break;
      }
      dtMs = Math.min(dtMs, totalMs - nowMs);
    }
    nowMs += dtMs;
    droppedSimSec += loop.runFrame(dtMs / MS_PER_SEC).droppedSimSec;
    index += 1;
  }

  return {
    hash: hashText(serializeWorld(world)),
    steps,
    simSec: world.simTimeSec,
    realSec: nowMs / MS_PER_SEC,
    droppedSimSec,
    firedCount: fireState.count,
    lives: world.player.lives,
    score: world.run.score,
  };
}

const STEADY_FRAME_MS = 16.667;
/** 09 §3.6. 최댓값이 41.0인 것은 한 프레임이 소화하는 상한 아래에 두기 위해서다 */
const JITTER_FRAME_MS = [16.667, 33.3, 8.0, 41.0, 16.667];
/** 4초를 조금 넘긴다. 스텝 경계에 정확히 떨어지는 총합이면 반올림 하나로 스텝 수가 갈린다 */
const RUN_TOTAL_MS = 4004;

function steadyFrame(): number {
  return STEADY_FRAME_MS;
}

function jitterFrame(index: number): number {
  return JITTER_FRAME_MS[index % JITTER_FRAME_MS.length]!;
}

const PRESS_PERIOD_MS = 290;
const PRESS_AT_MS: readonly number[] = Array.from(
  { length: Math.floor(RUN_TOTAL_MS / PRESS_PERIOD_MS) },
  (_, i) => (i + 1) * PRESS_PERIOD_MS,
);

function baseSpec(): RunSpec {
  return {
    seed: SEED,
    frameMsAt: steadyFrame,
    totalMs: RUN_TOTAL_MS,
    renderDrawsPerFrame: 0,
    parryPressAtMs: PRESS_AT_MS,
    fire: true,
  };
}

describe('D-05 — 같은 시드 + 같은 입력 = 같은 상태', () => {
  it('두 번 돌린 런의 최종 상태 해시가 같다', () => {
    const a = runSim(baseSpec());
    const b = runSim(baseSpec());

    // 아무 일도 안 일어난 두 빈 세계가 같은 것은 결정론의 증거가 아니다
    expect(a.firedCount).toBeGreaterThan(0);
    expect(a.score).toBeGreaterThan(0);
    expect(a.steps).toBeGreaterThan(0);

    expect(b.hash).toBe(a.hash);
    expect(b.steps).toBe(a.steps);
    expect(b.simSec).toBe(a.simSec);
    expect(b.score).toBe(a.score);
  });

  it('입력이 다르면 해시가 달라진다 — 해시가 상수로 굳어 있지 않다', () => {
    const pressed = runSim(baseSpec());
    const silent = runSim({ ...baseSpec(), parryPressAtMs: [] });
    expect(silent.hash).not.toBe(pressed.hash);
  });

  it('시드가 다르면 해시가 달라진다', () => {
    const a = runSim(baseSpec());
    const b = runSim({ ...baseSpec(), seed: SEED + 1 });
    expect(b.hash).not.toBe(a.hash);
  });
});

describe('D-05 — render가 난수를 더 써도 sim이 밀리지 않는다', () => {
  it('render 스트림 소비 횟수를 바꿔도 sim 런의 해시가 같다', () => {
    const quiet = runSim({ ...baseSpec(), renderDrawsPerFrame: 0 });
    const busy = runSim({ ...baseSpec(), renderDrawsPerFrame: 997 });
    expect(busy.hash).toBe(quiet.hash);
    expect(busy.score).toBe(quiet.score);
  });

  it('deriveStream은 (시드, 이름)만의 함수다 — 파생 순서와 횟수에 무관하다', () => {
    const alone = deriveStream(SEED, 'sim/waves');
    const expected = [alone.float(), alone.float(), alone.float()];

    // 렌더 쪽을 먼저 만들고 잔뜩 소비한 뒤에 sim 스트림을 만든다.
    // 루트 생성기에서 순서대로 뽑는 방식이면 여기서 수열이 밀린다
    const renderA = deriveStream(SEED, 'render/particles');
    for (let i = 0; i < 500; i += 1) {
      renderA.float();
    }
    const renderB = deriveStream(SEED, 'render/background');
    renderB.float();
    const later = deriveStream(SEED, 'sim/waves');
    expect([later.float(), later.float(), later.float()]).toEqual(expected);
  });

  it('이름이 다른 스트림은 같은 시드에서도 수열이 다르다', () => {
    const sim = deriveStream(SEED, 'sim/waves');
    const render = deriveStream(SEED, 'render/particles');
    expect(render.float()).not.toBe(sim.float());
  });

  it('createRng는 같은 시드에서 같은 수열을 낸다', () => {
    const a = createRng(SEED);
    const b = createRng(SEED);
    const drawn = Array.from({ length: 8 }, () => a.float());
    expect(Array.from({ length: 8 }, () => b.float())).toEqual(drawn);
  });
});

describe('HR-06 — 프레임 간격이 흔들려도 같은 실시간에 같은 결과', () => {
  it('지터를 줘도 같은 총 실시간에서 sim 시간·스텝 수·해시가 모두 같다', () => {
    // 눌림을 넣지 않는다. 눌림은 실시간 시각으로 소비되므로 프레임 경계가 바뀌면 소비되는
    // 스텝이 바뀌고, 그것은 HR-06 위반이 아니라 §16의 설계 그대로다
    const steady = runSim({ ...baseSpec(), frameMsAt: steadyFrame, parryPressAtMs: [] });
    const jittery = runSim({ ...baseSpec(), frameMsAt: jitterFrame, parryPressAtMs: [] });

    expect(steady.firedCount).toBeGreaterThan(0);
    expect(steady.lives).toBeLessThan(PLAYER.startLife);
    expect(steady.droppedSimSec).toBe(0);
    expect(jittery.droppedSimSec).toBe(0);

    expect(jittery.steps).toBe(steady.steps);
    expect(jittery.simSec).toBeCloseTo(steady.simSec, 9);
    expect(jittery.hash).toBe(steady.hash);
  });
});

describe('MAX_STEPS_PER_FRAME — 따라잡을 수 없는 지연은 sim 시간을 버린다', () => {
  const SLOW_FRAME_MS = 50;
  const SLOW_FRAMES = 100;

  it('한 프레임은 상한만큼만 돌고 남은 누산분을 버린다', () => {
    // 발사를 끄면 히트스톱이 없어 sim 시간이 누산기 하나로만 결정된다.
    // 켜 두면 버리기와 정지가 같은 숫자를 함께 밀어 어느 쪽이 얼마를 뺐는지 갈 수 없다
    const slow = runSim({
      seed: SEED,
      frameMsAt: () => SLOW_FRAME_MS,
      frames: SLOW_FRAMES,
      renderDrawsPerFrame: 0,
      parryPressAtMs: [],
      fire: false,
    });

    expect(slow.steps).toBe(SLOW_FRAMES * MAX_STEPS_PER_FRAME);
    expect(slow.simSec).toBeCloseTo(SLOW_FRAMES * MAX_STEPS_PER_FRAME * FIXED_DT_SEC, 9);
    expect(slow.realSec).toBeCloseTo((SLOW_FRAMES * SLOW_FRAME_MS) / MS_PER_SEC, 9);
    expect(slow.droppedSimSec).toBeGreaterThan(0);
    // sim이 실시간에 뒤지는 것이 버그가 아니라 규격이다. 여기를 맞추려고 상한을 올리면
    // spiral of death 방어가 사라진다
    expect(slow.simSec).toBeLessThan(slow.realSec);
  });

});

/** 소스 텍스트를 그대로 대조한다. 주석에 적힌 이름도 코드와 똑같이 걸린다 (core/rng.ts 머리말) */
const FORBIDDEN =
  /\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bperformance\s*\.\s*now\b|\bnew\s+Date\b/;
const SCOPES = ['src/sim', 'src/config', 'src/core/rng.ts'];

/** render/는 시각 회귀와 촬영 재현 때문에 난수만 따로 막는다 (02 §4.1) */
const RENDER_FORBIDDEN = /\bMath\s*\.\s*random\b/;
const RENDER_SCOPES = ['src/render'];

/**
 * 프레임 수로 세는 타이머 (HR-06). 이름이 frame으로 끝나는 값의 증감과, 이름만으로 프레임
 * 카운터인 것을 본다. core/loop.ts는 대상이 아니다 — 한 프레임의 스텝 수를 세는 것이 그 파일의
 * 일이고, 금지된 것은 그 수를 **게임 규칙의 시간**으로 쓰는 쪽이다.
 */
const FRAME_COUNTER = [
  /\b\w*[Ff]rames?\s*(?:--|\+\+|[-+]=)/,
  /\b(?:frameCount|frameCounter|framesLeft|framesRemaining|remainingFrames|frameTimer|frameTicks|tickCount|ticksLeft|ticksRemaining)\b/,
];
const FRAME_COUNTER_SCOPES = ['src/sim', 'src/config'];

function tsFiles(relative: string): string[] {
  const path = join(REPO_ROOT, relative);
  if (statSync(path).isFile()) {
    return relative.endsWith('.ts') ? [relative] : [];
  }
  return readdirSync(path).flatMap((entry) => tsFiles(join(relative, entry)));
}

function offendingLines(relative: string, patterns: readonly RegExp[]): string[] {
  const lines = readFileSync(join(REPO_ROOT, relative), 'utf8').split('\n');
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (patterns.some((pattern) => pattern.test(line))) {
      hits.push(`${relative}:${i + 1}: ${line.trim()}`);
    }
  }
  return hits;
}

describe('D-05 — 소스에 비결정 소스가 없다', () => {
  it.each(SCOPES.flatMap(tsFiles))('%s', (file) => {
    expect(offendingLines(file, [FORBIDDEN])).toEqual([]);
  });

  it.each(RENDER_SCOPES.flatMap(tsFiles))('render %s', (file) => {
    expect(offendingLines(file, [RENDER_FORBIDDEN])).toEqual([]);
  });
});

describe('HR-06 — 프레임 수로 세는 타이머가 없다', () => {
  it.each(FRAME_COUNTER_SCOPES.flatMap(tsFiles))('%s', (file) => {
    expect(offendingLines(file, FRAME_COUNTER)).toEqual([]);
  });
});
