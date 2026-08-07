/**
 * 웨이브 — 스펙 §9.1, 05_시스템_설계.md §7. 05 §1의 4번.
 *
 * 전환은 시간 기반이다. 앞 웨이브의 적이 살아 있어도 startSec에 다음 웨이브가 시작하고, 잔존
 * 적은 그대로 남는다. 그래서 이 파일은 「지금 몇 번째 웨이브인가」를 세지 않고 누적 sim 시간과
 * 표를 대조하기만 한다 — 처치 수를 세는 순간 시간 기반이 아니게 된다.
 *
 * ── 스폰을 여기서 만들지 않는다 ─────────────────────────────────────────────────
 *
 * 05 §1이 4번(웨이브 진행 · 스폰 예약)과 5번(적 스폰 · 상한 검사)을 나눠 놓았고, 그 경계가
 * 곧 §3.2의 「상한에 걸리면 지연, 취소 아님」이다. 여기는 편성을 예약으로 펼쳐 시각순으로
 * 늘어놓기만 하고, 상한이 막혀 못 나간 예약은 큐 머리에 그대로 남는다. 취소하려면 큐에서
 * 빼야 하는데 그 코드가 없다는 것이 규칙의 구현이다.
 *
 * ── 소강 3초와 강제 퇴장 (S-07) ────────────────────────────────────────────────
 *
 * 스펙 §9.1의 「4초 유예」를 쓰지 않는다. 소강이 3초이고 그 구간의 정의가 「적 탄환 없음」인데
 * 유예가 더 길면 잔존 적이 소강 내내 살아서 쏜다. 마지막 웨이브가 끝나는 즉시 퇴장이 시작되고
 * (isRetreating), 유예가 끝나는 시각에 남은 것은 강제로 지운다. 퇴장은 점수를 주지 않는다.
 *
 * 소강은 안전 구간이 아니다. 플레이어는 무적이 아니고 잔존 반사탄도 그대로 살아 있다(HR-07) —
 * 이 파일이 소강에 대해 하는 일이 「신규 스폰과 신규 발사를 멈추는 것」뿐인 이유다.
 */
import type { EnemyId, FormationId } from '../config/ids';
import { ENEMIES } from '../config/enemies';
import { FORMATIONS } from '../config/formations';
import { STAGES } from '../config/stages';
import type { LanceDef, StageDef, WaveDef } from '../config/types';
import { fireLance, lanceColumnsU, stepLances } from './lance';
import type { World } from './world';

/** §9.1 스테이지 한 판의 세 구간. 보스 등장 이후는 전부 'boss'다 */
export type WavePhase = 'waves' | 'lull' | 'boss';

/**
 * §18.3 스테이지를 어디서 시작하는가. 정상 진행은 언제나 stageStart다.
 *
 * 이 타입이 run.ts가 아니라 여기 있는 것은 진입 지점이 곧 「웨이브 표의 어느 시각인가」이기
 * 때문이다 — 소유자를 런에 두면 시각을 유도하는 식이 표에서 멀어진다.
 */
export type StageEntry =
  | { readonly kind: 'stageStart' }
  | { readonly kind: 'wave'; readonly waveIndex: number }
  | { readonly kind: 'lull' }
  | { readonly kind: 'bossPhase'; readonly phaseIndex: number };

/**
 * 05 §1의 5번이 소비하는 예약 한 건. 한 건이 잡몹 한 기다.
 *
 * slotIndex·slotCount는 같은 웨이브에서 **같은 진입 형태로** 들어오는 무리 안의 순번과 크기다.
 * 궤적을 그리는 쪽이 종대의 몇 번째인지, 횡대 몇 기 중 몇 번째인지를 이 둘로만 정할 수 있어야
 * 편성과 궤적이 서로를 열지 않고 고쳐진다.
 */
export interface SpawnReservation {
  readonly waveIndex: number;
  readonly enemy: EnemyId;
  readonly formation: FormationId;
  readonly slotIndex: number;
  readonly slotCount: number;
  /** 이 시각이 지나야 꺼낼 수 있다 (누적 sim 초) */
  readonly dueSec: number;
}

/** §8.2 F-2 좌·우 동시 진입. 진입 간격이 개체마다가 아니라 쌍마다 흐른다 */
const SIMULTANEOUS_SIDES = 2;

interface WaveRuntime {
  readonly stage: StageDef;
  /** dueSec 오름차순. 만들고 나면 길이가 변하지 않는다 — 소비는 head가 맡는다 */
  readonly queue: readonly SpawnReservation[];
  head: number;
  phase: WavePhase;
  /** 현재 웨이브의 LanceDef. 같은 객체를 이어 쓰는 웨이브는 일정을 다시 세지 않는다 */
  lanceDef: LanceDef | null;
  lanceNextFireSec: number | null;
  straggleCleared: boolean;
}

/**
 * 웨이브 상태를 World가 아니라 여기 둔다. 밖에서 읽는 곳은 여럿이지만 쓰는 곳은 stepWaves
 * 하나여야 한다 — World의 필드로 두면 아무 파일이나 구간을 앞당길 수 있고, 그때 「시간 기반
 * 전환」의 소유자가 사라진다.
 */
const RUNTIMES = new WeakMap<World, WaveRuntime>();

function formationList(wave: WaveDef): readonly FormationId[] {
  return typeof wave.formation === 'string' ? [wave.formation] : wave.formation;
}

/**
 * 「F-5 + F-6」처럼 두 형태를 함께 쓰는 웨이브에서 편성 한 종이 어느 쪽으로 들어오는지.
 *
 * 통과 형태(정지하지 않는 것)는 측면을 가로지르는 적에게만 맞는다 — 정지하는 적에게 주면
 * 그 적은 자기 자리에 서지 못하고 화면을 빠져나간다. 그래서 통과 여부를 먼저 가르고, 남은
 * 형태들 사이에서만 편성 순서로 돌린다. 스펙 §9.3~§9.7의 「A + B」 표기가 어느 편성을 어느
 * 형태에 붙일지 적지 않았으므로 규칙이 그 자리를 메운다.
 */
function pickFormation(
  formations: readonly FormationId[],
  enemy: EnemyId,
  squadIndex: number,
): FormationId {
  const passesThrough = ENEMIES[enemy].behavior === 'crossPass';
  const matching = formations.filter(
    (id) => (FORMATIONS[id].stopYU === null) === passesThrough,
  );
  const pool = matching.length > 0 ? matching : formations;
  return pool[squadIndex % pool.length] ?? formations[0]!;
}

/**
 * 무리 안 순번이 진입까지 기다리는 시간. 형태가 갖는 간격을 몇 번 곱할지만 다르다.
 *
 * 좌우에서 동시에 들어오는 형태는 쌍이 한 묶음이라 순번 둘이 같은 시각을 갖는다(§8.2 F-2).
 * 같은 bothSides라도 정지하지 않는 통과 형태는 한쪽씩 번갈아 나므로 개체마다 간격이 흐른다.
 */
function entryDelaySec(formation: FormationId, slotIndex: number): number {
  const def = FORMATIONS[formation];
  const entersInPairs = def.entrySide === 'bothSides' && def.stopYU !== null;
  const steps = entersInPairs ? Math.floor(slotIndex / SIMULTANEOUS_SIDES) : slotIndex;
  return steps * def.spawnIntervalSec;
}

/**
 * 스테이지 전체의 예약을 시작 시점에 한 번에 펼친다.
 *
 * 진행 중에 만들지 않는 이유는 예약이 시간의 함수일 뿐이기 때문이다 — 스텝마다 만들면 같은
 * 표에서 같은 목록이 나온다는 사실을 매번 다시 보장해야 한다. 여기서 만들면 큐에 남아 있는
 * 것이 곧 「아직 안 나온 편성」이고, 지연은 그 목록을 건드리지 않는다.
 */
function buildQueue(stage: StageDef): SpawnReservation[] {
  const queue: SpawnReservation[] = [];
  stage.waves.forEach((wave, waveIndex) => {
    const formations = formationList(wave);
    const groups = new Map<FormationId, EnemyId[]>();
    wave.squads.forEach((squad, squadIndex) => {
      const formation = pickFormation(formations, squad.enemy, squadIndex);
      let group = groups.get(formation);
      if (group === undefined) {
        group = [];
        groups.set(formation, group);
      }
      for (let count = 0; count < squad.count; count += 1) {
        group.push(squad.enemy);
      }
    });
    for (const [formation, members] of groups) {
      members.forEach((enemy, slotIndex) => {
        queue.push({
          waveIndex,
          enemy,
          formation,
          slotIndex,
          slotCount: members.length,
          dueSec: wave.startSec + entryDelaySec(formation, slotIndex),
        });
      });
    }
  });
  // 정렬이 안정적이라 같은 시각의 예약은 편성에 적힌 순서를 지킨다
  queue.sort((left, right) => left.dueSec - right.dueSec);
  return queue;
}

function runtimeOf(world: World): WaveRuntime {
  let runtime = RUNTIMES.get(world);
  if (runtime === undefined) {
    const stage: StageDef = STAGES[world.stageId];
    runtime = {
      stage,
      queue: buildQueue(stage),
      head: 0,
      phase: 'waves',
      lanceDef: null,
      lanceNextFireSec: null,
      straggleCleared: false,
    };
    RUNTIMES.set(world, runtime);
  }
  return runtime;
}

function lastWaveEndSec(stage: StageDef): number {
  const last = stage.waves[stage.waves.length - 1];
  return last === undefined ? 0 : last.endSec;
}

function currentWave(runtime: WaveRuntime, timeSec: number): WaveDef | null {
  const waves = runtime.stage.waves;
  for (let index = waves.length - 1; index >= 0; index -= 1) {
    const wave = waves[index];
    if (wave !== undefined && timeSec >= wave.startSec && timeSec < wave.endSec) {
      return wave;
    }
  }
  return null;
}

/**
 * §9.7 배경 함대. 간격은 대창이 처음 붙은 웨이브부터 연속으로 흐르고 웨이브 경계에서 다시
 * 세지 않는다 — 「W4부터」이지 「W4마다」가 아니다. 같은 LanceDef를 이어 쓰는지로 그것을 가른다.
 *
 * 예고와 판정이 마지막 웨이브 안에서 끝나지 못하면 아예 쏘지 않는다. 소강은 신규 적 탄환이
 * 없는 구간이므로 판정이 그 안으로 넘어갈 수 없고, 그렇다고 이미 그은 예고선을 지우면 예고가
 * 거짓말이 된다. 남는 답은 시작하지 않는 것 하나뿐이다.
 */
function updateLance(world: World, runtime: WaveRuntime, wave: WaveDef): void {
  const def = wave.lance ?? null;
  if (def !== runtime.lanceDef) {
    runtime.lanceDef = def;
    runtime.lanceNextFireSec = def === null ? null : wave.startSec;
  }
  if (def === null) {
    return;
  }
  const deadlineSec = lastWaveEndSec(runtime.stage);
  const cycleSec = def.telegraphSec + def.activeSec;
  while (runtime.lanceNextFireSec !== null && runtime.lanceNextFireSec <= world.simTimeSec) {
    if (runtime.lanceNextFireSec + cycleSec > deadlineSec) {
      runtime.lanceNextFireSec = null;
      return;
    }
    fireLance(world, {
      columnsU: lanceColumnsU(def.lanes, def.safeCorridorU),
      telegraphSec: def.telegraphSec,
      activeSec: def.activeSec,
    });
    runtime.lanceNextFireSec += def.intervalSec;
  }
}

/**
 * 05 §1의 4번. 대창 갱신을 먼저 부르는 것이 이 함수의 계약이다 — 보스 구간에도 4번은 돌아야
 * B5 페이즈 4가 세운 예고선이 시간에 맞춰 사라진다.
 *
 * 강제 퇴장은 유예가 끝나는 그 스텝 한 번뿐이다. 매 스텝 지우면 보스가 부르는 잡몹(§10.2 연막
 * 돌격)이 나오는 즉시 사라진다.
 */
export function stepWaves(world: World, dtSec: number): void {
  stepLances(world, dtSec);

  const runtime = runtimeOf(world);
  const stage = runtime.stage;
  const endSec = lastWaveEndSec(stage);
  const timeSec = world.simTimeSec;

  if (timeSec < endSec) {
    runtime.phase = 'waves';
    const wave = currentWave(runtime, timeSec);
    if (wave !== null) {
      updateLance(world, runtime, wave);
    }
    return;
  }

  // 마지막 웨이브가 끝난 뒤로는 예약이 남아 있어도 내보내지 않는다. 소강의 정의가 「적 탄환
  // 없음」이라 이 시점에 새로 나온 적은 그 규칙을 어기는 것 말고 할 일이 없다
  runtime.head = runtime.queue.length;
  runtime.phase = timeSec < endSec + stage.lullSec ? 'lull' : 'boss';

  if (!runtime.straggleCleared && timeSec >= endSec + stage.stragglerGraceSec) {
    runtime.straggleCleared = true;
    world.enemies.releaseAll();
  }
}

/**
 * §18.3 진입 지점이 가리키는 누적 sim 초.
 *
 * 구간 판정이 전부 `simTimeSec`의 함수라 진입은 시계를 옮기는 것 하나로 끝난다. 웨이브 상태를
 * 따로 조작하면 「지금 몇 번째 웨이브인가」의 소유자가 둘이 된다.
 */
export function entryStartSec(stage: StageDef, entry: StageEntry): number {
  const endSec = lastWaveEndSec(stage);
  switch (entry.kind) {
    case 'stageStart':
      return 0;
    case 'wave':
      return stage.waves[entry.waveIndex]?.startSec ?? 0;
    case 'lull':
      return endSec;
    case 'bossPhase':
      return endSec + stage.lullSec;
    default: {
      const unreachable: never = entry;
      throw new Error(`알 수 없는 진입 지점: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * 스테이지를 세운 직후에 한 번. 시계를 옮기고, 지나친 편성을 큐에서 건너뛴다.
 *
 * 건너뛰지 않으면 이미 시각이 지난 예약이 한 스텝에 하나씩 쏟아져 나와 §9의 편성과 전혀 다른
 * 밀도가 만들어진다 — 「W3부터 시작」이 「W1~W3 전부가 동시에 나온다」가 된다.
 */
export function applyStageEntry(world: World, entry: StageEntry): void {
  const runtime = runtimeOf(world);
  const startSec = entryStartSec(runtime.stage, entry);
  if (startSec <= 0) {
    return;
  }
  world.simTimeSec = startSec;
  while (runtime.head < runtime.queue.length) {
    const next = runtime.queue[runtime.head];
    if (next === undefined || next.dueSec >= startSec) {
      break;
    }
    runtime.head += 1;
  }
}

/** 05 §1의 15번·17번이 읽는 구간. 보스 등장 조건이 이 값 하나다 */
export function wavePhase(world: World): WavePhase {
  return runtimeOf(world).phase;
}

/**
 * §9.1 잔존 잡몹이 퇴장 중인가. 05 §1의 6번이 이 값을 읽어 이동을 화면 밖으로 돌리고 신규
 * 발사를 멈춘다 — 퇴장은 그 자리에서 사라지는 것이 아니라 화면을 나가는 것이고, 유예가 끝날
 * 때까지 나가지 못한 것만 여기서 지운다.
 */
export function isRetreating(world: World): boolean {
  return runtimeOf(world).phase === 'lull';
}

/**
 * 05 §1의 5번이 부른다. 상한이 막혀 만들 수 없으면 **부르지 않는다** — 꺼낸 예약을 되돌리는
 * 경로가 없으므로, 꺼냈다는 것이 곧 그 기를 만들었다는 뜻이어야 한다.
 *
 * 아직 시각이 안 된 예약이 앞에 있으면 뒤의 것도 꺼내지 않는다. 큐가 시각순이라 그 하나가
 * 곧 「지금 나올 것이 없다」이고, 지연으로 밀린 예약은 머리에 남아 다음 스텝에 먼저 나간다.
 */
export function takeDueSpawn(world: World): SpawnReservation | null {
  const runtime = runtimeOf(world);
  const next = runtime.queue[runtime.head];
  if (next === undefined || next.dueSec > world.simTimeSec) {
    return null;
  }
  runtime.head += 1;
  return next;
}

/** 아직 나오지 않은 편성 수. 지연이 걸렸는지를 밖에서 볼 수 있어야 §3.2가 검증된다 */
export function pendingSpawnCount(world: World): number {
  const runtime = runtimeOf(world);
  return runtime.queue.length - runtime.head;
}
