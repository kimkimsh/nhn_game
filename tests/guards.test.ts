/**
 * 가드·단일 소스 관계·주석 규약 — 09_검증_전략.md §3.5 · §3.5.1 · §3.5.2, 04 §1.1.
 *
 * 세 종류가 한 파일에 있는 것은 셋 다 "코드의 동작"이 아니라 "규칙이 아직 서 있는가"를 묻기
 * 때문이다. 앞의 둘은 값을, 셋째는 소스 텍스트를 본다.
 *
 * 가드 절반은 일부러 위반한 상태를 만들어 넣는다. 조용히 통과하는 가드는 없는 것보다 나쁘다 —
 * 검증했다는 착각을 만든다.
 *
 * 관계 단언에서 삭제된 필드를 묻는 셋(bossHp · deathSec · maxEnemyBullets · hitstopSec)은
 * 타입을 넓혀서 읽는다. **삭제됐다는 사실 자체가 검사 대상**이라 타입이 접근을 막으면 검사가
 * 성립하지 않는다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOSSES } from '../src/config/bosses';
import { BULLETS } from '../src/config/bullets';
import { STAGE_SCALING } from '../src/config/difficulty';
import { ENEMIES } from '../src/config/enemies';
import { HITSTOP_BUDGET_PER_SEC, ZONE } from '../src/config/feel';
import type { StageId } from '../src/config/ids';
import { PARRY, PARRY_BANDS, PARRY_LOCKOUT_SEC } from '../src/config/parry';
import { PLAYER } from '../src/config/player';
import { PLAYFIELD } from '../src/config/playfield';
import { STAGES } from '../src/config/stages';
import { TELEGRAPH } from '../src/config/telegraph';
import {
  checkHR01, checkHR03, checkHR05, checkHR07, checkHR08, checkHR09,
  checkInvariants, checkStatsSnapshot, checkZoneCap,
  createGuardState, findWavesMissingRangedEnemy, GuardViolation,
} from '../src/sim/guards';
import { computeStats } from '../src/sim/stats';
import { createWorld, type World } from '../src/sim/world';

const SEED = 20260808;
const FIXED_DT_SEC = 1 / 120;
/** §2 HR-03 적 탄환 공백 상한 (s). config/에 없는 값이라 sim/guards.ts와 여기가 같이 갖는다 */
const HR03_MAX_EMPTY_SEC = 2.0;

function worldAt(stageId: StageId): World {
  const world = createWorld({ stageId, seed: SEED });
  world.player.xU = 540;
  world.player.yU = 1240;
  return world;
}

describe('HR-03 — 적 탄환 공백 2.0초', () => {
  it('2.0초까지는 통과하고 그 다음 스텝에서 던진다', () => {
    const state = createGuardState();
    state.emptyBulletSec = HR03_MAX_EMPTY_SEC;
    expect(() => checkHR03(state)).not.toThrow();
    state.emptyBulletSec = HR03_MAX_EMPTY_SEC + FIXED_DT_SEC;
    expect(() => checkHR03(state)).toThrow(/HR-03/);
  });
});

describe('HR-07 — 반사탄은 양쪽에 유효, 적 탄환은 적에게 무해', () => {
  it('반사탄 풀에 적 소유가 섞이면 던진다', () => {
    const world = worldAt(1);
    const shot = world.reflectBullets.acquire()!;
    shot.owner = 'enemy';
    expect(() => checkHR07(world)).toThrow(/HR-07/);
  });

  it('적 탄환 풀에 플레이어 소유가 섞이면 던진다', () => {
    const world = worldAt(1);
    const shot = world.enemyBullets.acquire()!;
    shot.owner = 'player';
    expect(() => checkHR07(world)).toThrow(/HR-07/);
  });

  it('풀과 owner가 맞으면 통과한다', () => {
    const world = worldAt(1);
    world.reflectBullets.acquire()!.owner = 'player';
    world.enemyBullets.acquire()!.owner = 'enemy';
    expect(() => checkHR07(world)).not.toThrow();
  });
});

describe('HR-01 — 적 HP를 깎는 것은 반사탄뿐이다', () => {
  it('owner만 player로 세운 적 탄환은 통과하지 못한다', () => {
    const world = worldAt(1);
    const shot = world.enemyBullets.acquire()!;
    shot.owner = 'player';
    expect(() => checkHR01(world, shot)).toThrow(/HR-01/);
  });

  it('반사탄 풀에 있는 것만 통과한다', () => {
    const world = worldAt(1);
    const shot = world.reflectBullets.acquire()!;
    shot.owner = 'player';
    expect(() => checkHR01(world, shot)).not.toThrow();
  });
});

describe('HR-09 — 최소 비행 시간 0.45초', () => {
  const STAGE_ID: StageId = 5;
  const suppressU = Math.round(
    BULLETS.P2.speedUPerSec * STAGE_SCALING[STAGE_ID].bulletSpeedMul * TELEGRAPH.minFlightSec,
  );

  it('S5 조총탄의 억제 거리는 458u다 (§6.2 최악 조건 검산)', () => {
    expect(suppressU).toBe(458);
  });

  it.each([
    [suppressU - 1, true],
    [suppressU + 1, false],
  ])('플레이어에게서 %iu 떨어진 발사 → 던지는가 %s', (distanceU, shouldThrow) => {
    const world = worldAt(STAGE_ID);
    const shot = {
      bulletId: 'P2', xU: world.player.xU, yU: world.player.yU - distanceU,
      angleRad: Math.PI / 2, hasTelegraph: false,
    } as const;
    if (shouldThrow) {
      expect(() => checkHR09(world, shot)).toThrow(/HR-09/);
    } else {
      expect(() => checkHR09(world, shot)).not.toThrow();
    }
  });

  it('예고가 붙은 발사는 억제 대상이 아니다', () => {
    const world = worldAt(STAGE_ID);
    expect(() => checkHR09(world, {
      bulletId: 'P2', xU: world.player.xU, yU: world.player.yU - 1,
      angleRad: Math.PI / 2, hasTelegraph: true,
    })).not.toThrow();
  });
});

describe('HR-05 · HR-08 — 예고 도형과 보스 정위치', () => {
  it('예고 3종 밖의 도형은 던진다', () => {
    expect(() => checkHR05('impactCircle', 'P7')).not.toThrow();
    expect(() => checkHR05('beam', 'P7')).toThrow(/HR-05/);
  });

  it('짝이 어긋난 예고도 던진다 — pierceLine은 P12 전용이다', () => {
    expect(() => checkHR05('pierceLine', 'P7')).toThrow(/HR-05/);
  });

  it('정위치를 벗어난 보스는 던지고, 돌진 중이면 면제다', () => {
    const outside = { xU: PLAYFIELD.bossHomeBounds.maxXU + 1, yU: 300, isCharging: false };
    expect(() => checkHR08(outside)).toThrow(/HR-08/);
    expect(() => checkHR08({ ...outside, isCharging: true })).not.toThrow();
  });
});

describe('§9.6 · §11.5 장판 동시 상한', () => {
  it('상한까지는 통과하고 한 개 넘으면 던진다', () => {
    expect(() => checkZoneCap(ZONE.maxConcurrent)).not.toThrow();
    expect(() => checkZoneCap(ZONE.maxConcurrent + 1)).toThrow(GuardViolation);
  });
});

describe('INV-1 · INV-2', () => {
  it('INV-1 위반 상태를 넣으면 던진다', () => {
    expect(() => checkInvariants({
      activeSec: 0.18, cooldownSec: 0.22, invulnSec: 0.14, hasE07: false,
    })).toThrow(/INV-1/);
  });

  it('같은 쿨다운도 E07 보유 시에는 통과한다 (§11.6 예외)', () => {
    expect(() => checkInvariants({
      activeSec: 0.18, cooldownSec: 0.22, invulnSec: 0.165, hasE07: true,
    })).not.toThrow();
  });

  it('E07은 부등식이 아니라 등식이다 — 0.23초는 오히려 위반이다', () => {
    expect(() => checkInvariants({
      activeSec: 0.18, cooldownSec: 0.23, invulnSec: 0.16, hasE07: true,
    })).toThrow(/INV-1/);
  });

  it('INV-2 위반 상태를 넣으면 던진다', () => {
    expect(() => checkInvariants({
      activeSec: 0.18, cooldownSec: 0.23, invulnSec: 0.18, hasE07: false,
    })).toThrow(/INV-2/);
  });

  it('§11.6 검산 둘의 스냅샷은 스냅샷 검사를 통과한다', () => {
    const worst1 = computeStats([
      { id: 'N04', stack: 3 }, { id: 'N05', stack: 3 }, { id: 'N10', stack: 1 }, { id: 'R10', stack: 1 },
    ]);
    const worst2 = computeStats([{ id: 'E07', stack: 1 },
      { id: 'N04', stack: 3 }, { id: 'N05', stack: 3 }, { id: 'N10', stack: 1 }, { id: 'R10', stack: 1 },
    ]);
    expect(() => checkStatsSnapshot(worst1, false)).not.toThrow();
    expect(() => checkStatsSnapshot(worst2, true)).not.toThrow();
  });
});

/**
 * HR-02는 현재 편성에서 전부 통과한다 — 근접 전용 웨이브가 하나도 없다. 그래서 이 검사의
 * 역할은 발견이 아니라 잠금이다. S1 W3을 「E-D ×10」으로 바꾸는 순간 빨간불이 된다.
 */
describe('HR-02 — 모든 웨이브 편성에 원거리 적 1기 이상 (정적 검사)', () => {
  const waves = Object.values(STAGES).flatMap((stage) =>
    stage.waves.map((wave, index) => [stage.id, index, wave] as const),
  );

  it.each(waves)('S%i W%i', (_stageId, _index, wave) => {
    expect(wave.squads.some((squad) => ENEMIES[squad.enemy].isRanged)).toBe(true);
  });

  it('가드가 세는 결과도 같다 — 검사가 두 벌이면 조용히 어긋난다', () => {
    expect(findWavesMissingRangedEnemy()).toEqual([]);
  });
});

/** 09 §3.5.1 · 04 §1.1. 타입이 못 잡는 것은 값 사이의 관계뿐인데 실제 고장은 전부 거기서 난다 */
describe('단일 소스 — 값 사이의 관계', () => {
  it('lockoutSec은 저장값이 아니라 유도값이다', () => {
    expect(PARRY_LOCKOUT_SEC).toBeCloseTo(PARRY.cooldownSec - PARRY.activeSec, 6);
  });

  it('마지막 밴드는 상한을 저장하지 않는다 (12 §10 E-06)', () => {
    expect(PARRY_BANDS.at(-1)!.maxDistU).toBeNull();
  });

  it('§5.3의 밴드 순서가 정의 자체에서 지켜진다', () => {
    expect(PARRY_BANDS[0].maxDistU).toBeLessThan(PARRY_BANDS[1].maxDistU);
  });

  it('difficulty.ts에 보스 HP가 남아 있지 않다 (12 §5)', () => {
    expect((STAGE_SCALING[1] as Record<string, unknown>).bossHp).toBeUndefined();
  });

  it('보스 HP의 단일 소스는 BossDef다 (§10.7 요약표와 대조)', () => {
    expect(BOSSES.B1.hp).toBe(1450);
  });

  it('격파 연출은 BOSS_COMMON으로 옮겨졌다 (12 §8)', () => {
    expect(BOSSES.B3).not.toHaveProperty('deathSec');
  });

  it('동시 적 탄환 상한의 유일 소스는 difficulty.ts다 (12 §6)', () => {
    expect(PLAYFIELD).not.toHaveProperty('maxEnemyBullets');
  });

  it('피격 히트스톱의 유일 소스는 feel.ts다 (12 §10)', () => {
    expect(PLAYER).not.toHaveProperty('hitstopSec');
  });

  it('카드 없는 기본 빌드는 §3.2의 히트스톱 누적 상한 안에 있다', () => {
    expect((1 / PARRY.cooldownSec) * PARRY_BANDS[0].hitstopSec)
      .toBeLessThanOrEqual(HITSTOP_BUDGET_PER_SEC);
  });

  it('E07 빌드는 상한을 넘어선다 — 그게 상한의 존재 이유다 (§5.3)', () => {
    const cooldownSec = computeStats([{ id: 'E07', stack: 1 }]).cooldownSecFor('hit');
    expect(cooldownSec).toBeCloseTo(0.19, 6);
    expect((1 / cooldownSec) * PARRY_BANDS[0].hitstopSec).toBeGreaterThan(HITSTOP_BUDGET_PER_SEC);
  });
});

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_ROOT = 'src/config';
const HEADER_MIN_LINES = 3;
/** 숫자 리터럴 대입으로 끝나는 줄. 뒤에 붙은 주석은 지운 상태로 본다 */
const NUMBER_ASSIGNMENT = /[:=]\s*-?\d+(?:\.\d+)?(?:e-?\d+)?\s*,?\s*$/;
/** 최상위 필드 줄만 본다. 표 항목까지 훑으면 근거를 파일 헤더가 갖는 표가 전부 걸린다 */
const TOP_LEVEL_DEPTH = 1;
/** 검사가 대상 0줄을 훑고도 통과하는 상태를 막는 하한. 현재 실측은 131줄이다 */
const MIN_CHECKED_LINES = 100;

function tsFiles(relative: string): string[] {
  const path = join(REPO_ROOT, relative);
  if (statSync(path).isFile()) {
    return relative.endsWith('.ts') ? [relative] : [];
  }
  return readdirSync(path).flatMap((entry) => tsFiles(join(relative, entry)));
}

/** 블록 주석과 줄 주석을 지운 코드 부분. 주석 안의 중괄호가 깊이를 흔들면 검사가 자리를 잃는다 */
function stripComments(line: string, insideBlock: boolean): { code: string; insideBlock: boolean } {
  let rest = line;
  let inside = insideBlock;
  let code = '';
  while (rest.length > 0) {
    if (inside) {
      const end = rest.indexOf('*/');
      if (end < 0) {
        return { code, insideBlock: true };
      }
      rest = rest.slice(end + 2);
      inside = false;
      continue;
    }
    const lineComment = rest.indexOf('//');
    const blockStart = rest.indexOf('/*');
    if (blockStart >= 0 && (lineComment < 0 || blockStart < lineComment)) {
      code += rest.slice(0, blockStart);
      rest = rest.slice(blockStart + 2);
      inside = true;
      continue;
    }
    code += lineComment < 0 ? rest : rest.slice(0, lineComment);
    return { code, insideBlock: false };
  }
  return { code, insideBlock: inside };
}

function braceDepthDelta(code: string): number {
  let delta = 0;
  for (const char of code) {
    if (char === '{' || char === '[' || char === '(') {
      delta += 1;
    } else if (char === '}' || char === ']' || char === ')') {
      delta -= 1;
    }
  }
  return delta;
}

interface ConventionScan {
  readonly checked: number;
  readonly missing: readonly string[];
}

function scanNumberLines(relative: string): ConventionScan {
  const lines = readFileSync(join(REPO_ROOT, relative), 'utf8').split('\n');
  const missing: string[] = [];
  let checked = 0;
  let depth = 0;
  let insideBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const stripped = stripComments(line, insideBlock);
    insideBlock = stripped.insideBlock;
    if (depth === TOP_LEVEL_DEPTH && NUMBER_ASSIGNMENT.test(stripped.code.trimEnd())) {
      checked += 1;
      if (!line.includes('§')) {
        missing.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
    }
    depth += braceDepthDelta(stripped.code);
  }
  return { checked, missing };
}

describe('03 §4.1 주석 규약', () => {
  const files = tsFiles(CONFIG_ROOT);

  it.each(files)('%s — 파일 헤더가 /** 블록 3줄 이상이다', (file) => {
    const head = readFileSync(join(REPO_ROOT, file), 'utf8').trimStart();
    expect(head.startsWith('/**')).toBe(true);
    const end = head.indexOf('*/');
    expect(end).toBeGreaterThan(0);
    expect(head.slice(0, end).split('\n').length).toBeGreaterThanOrEqual(HEADER_MIN_LINES);
  });

  it.each(files)('%s — 최상위 숫자 대입 줄에 § 번호가 있다', (file) => {
    expect(scanNumberLines(file).missing).toEqual([]);
  });

  it('검사가 실제로 훑은 줄이 있다 — 0줄을 훑고 통과하면 검사가 없는 것과 같다', () => {
    const total = files.reduce((sum, file) => sum + scanNumberLines(file).checked, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_CHECKED_LINES);
  });
});
