/**
 * 타이틀 어트랙트 녹화 생성기 — 08_화면과_UI.md §6.2.1의 「녹화 시점: P7」이 여기다.
 *
 * 출력은 `src/screens/title-attract.ts`의 `ATTRACT_RECORDING`에 그대로 붙여 넣는 리터럴이다.
 * 이 파일은 빌드에 안 들어간다.
 *
 * ── 왜 dev/bot.ts를 안 쓰는가 ──────────────────────────────────────────────────
 *
 * 두 이유가 각각 독립적이다.
 *
 * ① **형식이 안 맞는다.** 봇은 패리 눌림에 반응 지연 3스텝을 얹은 **미래 시각**을 찍고
 *    (`bot.ts`의 `press`), 같은 스텝에 떼기까지 한다. 재생기가 적는 것은 스텝 경계의 held
 *    집합이라 그 눌림은 기록에 남지 않는다. 그래서 이 파일은 재생기와 **같은 방식으로만**
 *    입력을 넣는다 — 스텝 시작 시각으로 누르고, 다음 스텝에 뗀다. 넣는 방법이 같아야 D-05의
 *    결정론이 「녹화한 장면 = 재생되는 장면」을 보장한다.
 *
 * ② **목적이 반대다.** 봇은 §14.4의 전제(성공률 50% · 평균 GOOD)에 맞춰 **일부러 못 치게**
 *    묶여 있다. 타이틀은 그 반대로 잘 치는 판이 필요하다 — 08 §6.2가 어트랙트를 「이 게임이
 *    무엇인지 보여 주는 것」으로 정의했고, 같은 녹화가 제출 영상의 소스다(§6.2.1).
 *
 * 규칙이 바뀌면 이 녹화는 낡는다. 그때 다시 돌려서 나온 리터럴로 갈아 끼운다.
 */

import { PLAYFIELD } from '../../src/config/playfield';
import { createInput, type Input } from '../../src/core/input';
import { FIXED_DT_SEC } from '../../src/core/loop';
import { dot } from '../../src/core/vec';
import type { Projectile } from '../../src/sim/bullets';
import { createRun, stepRun, type Run } from '../../src/sim/run';
import type { World } from '../../src/sim/world';
import {
  ATTRACT_ENTRY, ATTRACT_LENGTH_SEC, ATTRACT_SEED, ATTRACT_STAGE_ID,
} from '../../src/screens/title-attract';

const MS_PER_SEC = 1000;
const STEP_COUNT = Math.round(ATTRACT_LENGTH_SEC / FIXED_DT_SEC);

/** `core/input.ts`의 키 표에서 이 파일이 쓰는 다섯 자리 */
const KEY = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  parry: 'KeyJ',
} as const;

/** x 정렬의 무시 폭 (u). 이보다 가까우면 키를 놓는다 — 안 두면 매 스텝 좌우가 뒤집힌다 */
const ALIGN_DEADZONE_U = 10;

/** y 정렬의 무시 폭 (u). x보다 넓다 — 세로는 어차피 앵커 한 점으로 수렴만 하면 된다 */
const ANCHOR_DEADZONE_U = 24;

/**
 * 세로 정박 위치 — 이동 가능 영역의 **위쪽 끝**이다.
 *
 * 아래에 서면 안 된다. `title-attract.ts`의 `PLAYER_DRAW_OFFSET_YU`가 「이동 영역 상단 620u를
 * 목업의 중심 545u에 맞추는 평행이동」이라, 그 상단에서 멀어진 만큼 그대로 로고 판 뒤로 내려가
 * 플레이어가 안 보인다. 목업(`00_title/scene.js:31`)이 놓은 자리가 곧 이 자리다.
 *
 * 적 활동 영역(y ≤ 1000)과 겹치지만 HR-09는 안 걸린다 — 잡몹이 y 150~400에서 쏘므로 거리가
 * 220u 이상이고, 억제 거리는 탄속 400u/s × 0.45초 = 180u다.
 */
const ANCHOR_YU = PLAYFIELD.playerBounds.minYU;

/**
 * 패리를 거는 거리 — GREAT 밴드 상한의 배수. 1보다 작게 두는 것은 눌린 스텝의 판정이
 * **그 스텝의 적분 뒤 거리**로 나기 때문이다(05 §1의 8 → 9). 한 스텝에 탄이 7~10u 오므로
 * 밴드 상한에 딱 맞추면 판정 시각에는 이미 밴드 밖이다.
 */
const GREAT_AIM_RATIO = 0.72;

/**
 * 이 거리 안에 접근 탄이 있으면 회피로 전환한다 (u). 쿨다운 중에만 본다.
 *
 * 150·300·380으로도 재 봤고 220이 제일 오래 산다 — 좁으면 피하기 시작할 때 이미 늦고,
 * 넓으면 아직 안 위험한 탄을 보고 자리를 떠서 다음 패리의 정렬이 늦는다.
 */
const EVADE_TRIGGER_U = 220;

/** 회피가 목표로 삼는 가로 이격 (u) */
const EVADE_OFFSET_U = 190;

interface Keyframe {
  readonly step: number;
  readonly codes: readonly string[];
}

/** 규칙 그대로 dev/bot.ts의 것과 같다 — 멀어지는 탄을 쫓으면 화면을 가로지른다 */
function nearestApproaching(world: World): Projectile | null {
  const player = world.player;
  let best: Projectile | null = null;
  let bestDistSqU = Number.POSITIVE_INFINITY;
  for (const shot of world.enemyBullets.active) {
    if (!shot.isParryable) {
      continue;
    }
    const towardX = shot.xU - player.xU;
    const towardY = shot.yU - player.yU;
    if (dot(shot.vxUPerSec, shot.vyUPerSec, towardX, towardY) >= 0) {
      continue;
    }
    const distSqU = towardX * towardX + towardY * towardY;
    if (distSqU < bestDistSqU) {
      bestDistSqU = distSqU;
      best = shot;
    }
  }
  return best;
}

/** 이번 스텝의 적분이 끝난 뒤의 거리. 판정이 서는 자리가 거기다 */
function distanceAfterStepU(world: World, shot: Projectile): number {
  const player = world.player;
  const dx = shot.xU + shot.vxUPerSec * FIXED_DT_SEC - player.xU;
  const dy = shot.yU + shot.vyUPerSec * FIXED_DT_SEC - player.yU;
  return Math.sqrt(dx * dx + dy * dy);
}

function greatAimDistU(world: World): number {
  const band = world.stats.bands[0];
  return (band?.maxDistU ?? world.stats.parryRadiusU) * GREAT_AIM_RATIO;
}

/**
 * 이 스텝에 눌러 두고 싶은 키 집합.
 *
 * 패리가 준비됐으면 표적의 x로 정렬하고 밴드에 들어오는 순간 패리 키를 얹는다. 쿨다운 중에는
 * 정렬을 멈추고 표적에서 옆으로 비킨다 — 받을 수단이 없는 동안 정면에 서 있으면 그냥 맞는다.
 */
function desiredKeys(world: World): Set<string> {
  const wanted = new Set<string>();
  const player = world.player;
  const ready = world.simTimeSec >= world.parry.cooldownUntilSec || world.parry.isActive;
  const shot = nearestApproaching(world);

  let wantXU = player.xU;
  if (shot !== null) {
    if (ready) {
      wantXU = shot.xU;
    } else {
      const distU = Math.hypot(shot.xU - player.xU, shot.yU - player.yU);
      if (distU < EVADE_TRIGGER_U) {
        // 벽 쪽으로 비키면 클램프에 걸려 목표가 발밑에 서고, 데드존 근처에서 키가 매 스텝
        // 뒤집힌다. 남은 폭이 넓은 쪽을 고르면 그 자리가 안 생긴다
        const roomLeftU = player.xU - PLAYFIELD.playerBounds.minXU;
        const roomRightU = PLAYFIELD.playerBounds.maxXU - player.xU;
        const goRight = roomRightU >= roomLeftU;
        wantXU = goRight
          ? Math.min(player.xU + EVADE_OFFSET_U, PLAYFIELD.playerBounds.maxXU)
          : Math.max(player.xU - EVADE_OFFSET_U, PLAYFIELD.playerBounds.minXU);
      }
    }
  }

  const deltaXU = wantXU - player.xU;
  if (deltaXU < -ALIGN_DEADZONE_U) {
    wanted.add(KEY.left);
  } else if (deltaXU > ALIGN_DEADZONE_U) {
    wanted.add(KEY.right);
  }

  const deltaYU = ANCHOR_YU - player.yU;
  if (deltaYU < -ANCHOR_DEADZONE_U) {
    wanted.add(KEY.up);
  } else if (deltaYU > ANCHOR_DEADZONE_U) {
    wanted.add(KEY.down);
  }

  if (ready && !world.parry.isActive && shot !== null
    && distanceAfterStepU(world, shot) <= greatAimDistU(world)) {
    wanted.add(KEY.parry);
  }
  return wanted;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const code of a) {
    if (!b.has(code)) {
      return false;
    }
  }
  return true;
}

/** 재생기의 `applyKeyframe`과 같은 순서다 — 떼고 나서 누른다 */
function applyKeys(input: Input, held: Set<string>, codes: ReadonlySet<string>, atMs: number): void {
  for (const code of [...held]) {
    if (!codes.has(code)) {
      input.releaseKey(code);
      held.delete(code);
    }
  }
  for (const code of codes) {
    if (!held.has(code)) {
      input.pressKey({ code, atMs, shiftHeld: false, repeat: false });
      held.add(code);
    }
  }
}

interface Recording {
  readonly keyframes: readonly Keyframe[];
  readonly endedAtStep: number;
  readonly endPhase: string;
  readonly grades: Record<string, number>;
  readonly parries: number;
  readonly whiffs: number;
  readonly kills: number;
  readonly livesLeft: number;
  readonly score: number;
  readonly guards: readonly string[];
}

export function record(): Recording {
  const input = createInput();
  const run: Run = createRun({ seed: ATTRACT_SEED, stageId: ATTRACT_STAGE_ID, at: ATTRACT_ENTRY });
  const grades: Record<string, number> = { GREAT: 0, GOOD: 0, 'NOT BAD': 0 };
  let parries = 0;
  let whiffs = 0;
  let kills = 0;
  const offs = [
    run.bus.on('parry', (event) => {
      parries += 1;
      grades[event.grade] = (grades[event.grade] ?? 0) + 1;
    }),
    run.bus.on('parryWhiff', () => {
      whiffs += 1;
    }),
    run.bus.on('enemyKilled', () => {
      kills += 1;
    }),
  ];

  const keyframes: Keyframe[] = [];
  const guardMessages = new Set<string>();
  const held = new Set<string>();
  let previous = new Set<string>();
  let step = 0;
  for (; step < STEP_COUNT && run.phase === 'combat'; step += 1) {
    const startMs = step * FIXED_DT_SEC * MS_PER_SEC;
    const wanted = desiredKeys(run.world);
    if (!sameSet(wanted, previous)) {
      keyframes.push({ step, codes: [...wanted].sort() });
      previous = new Set(wanted);
    }
    applyKeys(input, held, wanted, startMs);
    input.beginFrame(startMs + FIXED_DT_SEC * MS_PER_SEC);
    try {
      stepRun(run, FIXED_DT_SEC, { input, untilMs: startMs + FIXED_DT_SEC * MS_PER_SEC });
    } catch (cause: unknown) {
      // 헤드리스와 같은 처리다 (dev/headless.ts) — 가드는 05 §1의 16번에서 던지므로 세계는
      // 온전하고 남은 것은 큐 배출뿐이다. HR-03의 공백은 03_검토_기록.md §3.1·§3.2가
      // 스펙 개정 대기로 걸어 둔 것이라 녹화가 없앨 수 있는 것이 아니다
      guardMessages.add(cause instanceof Error ? cause.message : String(cause));
      run.bus.flush();
    }
  }

  for (const off of offs) {
    off();
  }
  return {
    keyframes,
    endedAtStep: step,
    endPhase: run.phase,
    grades,
    parries,
    whiffs,
    kills,
    livesLeft: run.world.player.lives,
    score: run.world.run.score,
    guards: [...guardMessages],
  };
}

function literalOf(keyframes: readonly Keyframe[]): string {
  const lines = keyframes.map(
    (frame) => `  { step: ${frame.step}, codes: [${frame.codes.map((code) => `'${code}'`).join(', ')}] },`,
  );
  return `export const ATTRACT_RECORDING: readonly AttractKeyframe[] = [\n${lines.join('\n')}\n];`;
}

const result = record();
console.error(
  `steps ${result.endedAtStep}/${STEP_COUNT} · phase ${result.endPhase}`
  + ` · keyframes ${result.keyframes.length}`
  + ` · parry ${result.parries} (GREAT ${result.grades.GREAT} / GOOD ${result.grades.GOOD}`
  + ` / NOT BAD ${result.grades['NOT BAD']}) · whiff ${result.whiffs}`
  + ` · kill ${result.kills} · life ${result.livesLeft} · score ${result.score}`
  + `\nguards: ${result.guards.length === 0 ? '없음' : result.guards.join(' · ')}`,
);
console.log(literalOf(result.keyframes));
