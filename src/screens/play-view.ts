/**
 * World 한 장을 `render/frame.ts`의 `FrameView`로 옮기는 어댑터 — 계층이 만나는 자리.
 *
 * `render/`는 `sim/`의 타입만 읽고 `sim/`은 `render/`를 아예 못 본다(03 §5). 그래서 둘을 잇는
 * 일은 양쪽을 다 볼 수 있는 `screens/`의 몫이고, `screens/play.ts`에서 이 파일로 갈라 둔 이유는
 * 한 파일 400줄 상한 하나다 — 상태 기계와 입력은 그쪽에, 값 옮기기는 여기에 산다.
 *
 * **이 파일은 sim 상태를 한 줄도 바꾸지 않는다** (HR-06). 읽어서 새 객체를 만들 뿐이다.
 */

import { ENEMIES } from '../config/enemies';
import type { BossDef, EnemyDef, StageDef } from '../config/types';
import type { EnemyId, ParryableBulletId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import { STAGES } from '../config/stages';
import { TELEGRAPH } from '../config/telegraph';
import { BOSS_SILHOUETTE_WIDTH_U, bossSilhouetteHeightU } from '../render/boss';
import { drawLance } from '../render/bullet';
import type { BulletLayerBatch, LanceView } from '../render/bullet';
import { enemyHeaderColors } from '../render/enemy';
import type { EnemyBodyBakeSpec, HitstopShake } from '../render/enemy';
import type { FrameBoss, FrameEnemy, FrameView, ScenePaint } from '../render/frame';
import type { HudBossView, HudComboView } from '../render/hud';
import type { TelegraphView } from '../render/telegraph';
import type { ZoneView } from '../render/zone';
import { bossHpRatio, bossPhaseWarning, type BossState } from '../sim/boss';
import { enemyRuntimeOf } from '../sim/enemies';
import { lancePhaseOf, lancesOf } from '../sim/lance';
import type { Run } from '../sim/run';
import { comboMul, comboRemainSec } from '../sim/score';
import type { World } from '../sim/world';

/** config/enemies.ts의 hitRadiusU가 실루엣 폭 × 0.6이라, 폭을 되돌리려면 그 역수를 곱한다 */
const SILHOUETTE_WIDTH_PER_HIT_RADIUS = 1 / 0.6;

/** 돌진 방향선의 길이 (u). 돌진 종점은 sim이 들고 있지 않으므로 화면 세로만큼 긋는다 */
const DASH_LINE_LENGTH_U = PLAYFIELD.heightU;

/** A14 B1 부하 조총병의 실루엣. 개별 HP가 없어 HP 바도 접지 그림자도 안 그린다(12 §8-16) */
const SATELLITE_ENEMY_ID: EnemyId = 'E-A';


/** §12.3 성공률의 분모가 아니라 화면 표시용. 초를 `m:ss`로 적는다 */
function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** §15.1 'W4 0:51 / 1:00'. 웨이브 구간 밖에서는 빈 문자열이다(engine.js:1696) */
function waveText(stage: StageDef, timeSec: number): string {
  let index = 0;
  for (const wave of stage.waves) {
    index += 1;
    if (timeSec >= wave.startSec && timeSec < wave.endSec) {
      const spanSec = wave.endSec - wave.startSec;
      return `W${index}  ${clockText(timeSec - wave.startSec)} / ${clockText(spanSec)}`;
    }
  }
  return '';
}

/** §15.1 스테이지 내 진행률. 마지막 웨이브가 끝나면 1이고 그 뒤는 보스 바가 진행도를 맡는다 */
function stageProgress(stage: StageDef, timeSec: number): number {
  const endSec = stage.waves[stage.waves.length - 1]?.endSec ?? 0;
  return endSec <= 0 ? 1 : Math.min(1, timeSec / endSec);
}

/** 이 스테이지가 낼 수 있는 실루엣 전부. 진입 연출 동안 한 번에 굽는다 */
export function stageBakeSpecs(stage: StageDef): EnemyBodyBakeSpec[] {
  const ids = new Set<EnemyId>();
  for (const wave of stage.waves) {
    for (const squad of wave.squads) {
      ids.add(squad.enemy);
    }
  }
  if (stage.bossId === 'B1') {
    ids.add(SATELLITE_ENEMY_ID);
  }
  const specs: EnemyBodyBakeSpec[] = [];
  for (const id of ids) {
    const def: EnemyDef = ENEMIES[id];
    specs.push({ shape: def.shape, widthU: def.hitRadiusU * SILHOUETTE_WIDTH_PER_HIT_RADIUS });
  }
  return specs;
}

/** 목업이 P9(장판)와 P12(대창)를 탄환으로 그리지 않는다 — switch에 case가 없다(12 §1 C-04) */
function isParryableId(id: string): id is ParryableBulletId {
  return id !== 'P9' && id !== 'P12';
}

/** `BulletLayerBatch`는 전부 readonly다 — 채우는 쪽에서만 이 가변 형태로 들고 있는다 */
export interface MutableBatch {
  count: number;
  bulletId: ParryableBulletId[];
  state: BulletLayerBatch['state'][number][];
  xU: Float32Array;
  yU: Float32Array;
  angleRad: Float32Array;
  spinRad: Float32Array;
  graceRemainingSec: Float32Array;
  reparryCount: Int32Array;
}

export function createBatch(capacity: number): MutableBatch {
  return {
    count: 0,
    bulletId: new Array<ParryableBulletId>(capacity).fill('P2'),
    state: new Array<BulletLayerBatch['state'][number]>(capacity).fill('enemy'),
    xU: new Float32Array(capacity),
    yU: new Float32Array(capacity),
    angleRad: new Float32Array(capacity),
    spinRad: new Float32Array(capacity),
    graceRemainingSec: new Float32Array(capacity),
    reparryCount: new Int32Array(capacity),
  };
}

/**
 * 프레임마다 배열을 새로 만들지 않는다 — 최대 수백 발이면 프레임당 타입 배열 여섯이 GC로 가고
 * 그 GC가 p99에 그대로 나타난다. 유효 구간은 언제나 [0, count)다.
 */
function fillBatch(batch: MutableBatch, world: World): BulletLayerBatch {
  let n = 0;
  for (const owner of [world.enemyBullets.active, world.reflectBullets.active]) {
    for (const shot of owner) {
      if (n >= batch.xU.length || !isParryableId(shot.bulletId)) {
        continue;
      }
      batch.bulletId[n] = shot.bulletId;
      batch.state[n] = shot.owner === 'enemy'
        ? 'enemy'
        : shot.graceRemainingSec > 0 ? 'reflectGrace' : 'reflect';
      batch.xU[n] = shot.xU;
      batch.yU[n] = shot.yU;
      batch.angleRad[n] = Math.atan2(shot.vyUPerSec, shot.vxUPerSec);
      batch.spinRad[n] = 0;
      batch.graceRemainingSec[n] = shot.graceRemainingSec;
      batch.reparryCount[n] = 0;
      n += 1;
    }
  }
  batch.count = n;
  return batch;
}

function collectEnemies(world: World, shake: HitstopShake | null): FrameEnemy[] {
  const out: FrameEnemy[] = [];
  for (const enemy of world.enemies.active) {
    const runtime = enemyRuntimeOf(enemy);
    const def: EnemyDef = ENEMIES[runtime?.typeId ?? SATELLITE_ENEMY_ID];
    const totalSec = runtime?.windupTotalSec ?? 0;
    const remainSec = runtime?.windupRemainingSec ?? 0;
    out.push({
      view: {
        shape: def.shape,
        widthU: def.hitRadiusU * SILHOUETTE_WIDTH_PER_HIT_RADIUS,
        xU: enemy.xU,
        yU: enemy.yU,
        windup01: totalSec > 0 && remainSec > 0 ? 1 - remainSec / totalSec : 0,
        windupRemainingSec: remainSec,
        aimXU: runtime?.aimXU ?? 0,
        aimYU: runtime?.aimYU ?? 1,
        // sim이 적별 피격 플래시를 들고 있지 않다. 반사탄이 유효했다는 확인은 파티클과 팝업이 맡는다
        flash01: 0,
        frontShieldIntact: enemy.frontShieldIntact,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        noHpBar: false,
        noContactShadow: false,
        partGauge: false,
      },
      shake,
    });
  }
  const satelliteDef: EnemyDef = ENEMIES[SATELLITE_ENEMY_ID];
  for (const satellite of world.boss?.satellites ?? []) {
    out.push({
      view: {
        shape: satelliteDef.shape,
        widthU: satelliteDef.hitRadiusU * SILHOUETTE_WIDTH_PER_HIT_RADIUS,
        xU: satellite.xU,
        yU: satellite.yU,
        windup01: 0,
        windupRemainingSec: 0,
        aimXU: 0,
        aimYU: 1,
        flash01: 0,
        frontShieldIntact: false,
        hp: 1,
        maxHp: 1,
        noHpBar: true,
        noContactShadow: true,
        partGauge: false,
      },
      shake,
    });
  }
  return out;
}

/**
 * `FrameView.lance`가 줄 하나만 받는데 S5 W4는 2줄, B5 페이즈 4는 3줄이다. 안 그리면 보이지
 * 않는 즉사 판정이 생기므로 둘째 줄부터는 층 2에서라도 그린다 — 적 아래라 층은 틀렸고,
 * 옳은 자리는 `render/frame.ts`가 `lance`를 배열로 받는 것이다.
 */
function drawExtraLances(ctx: CanvasRenderingContext2D, lances: readonly LanceView[]): void {
  for (let index = 1; index < lances.length; index += 1) {
    const lance = lances[index];
    if (lance !== undefined) {
      drawLance(ctx, lance);
    }
  }
}

function collectTelegraphs(world: World): TelegraphView[] {
  const out: TelegraphView[] = [];
  for (const enemy of world.enemies.active) {
    const runtime = enemyRuntimeOf(enemy);
    if (runtime === undefined || runtime.telegraphRemainingSec <= 0) {
      continue;
    }
    const durationSec = TELEGRAPH.shapes.dash.durationSec;
    out.push({
      kind: 'dash',
      ageSec: durationSec - runtime.telegraphRemainingSec,
      durationSec,
      xU: enemy.xU,
      yU: enemy.yU,
      radiusU: 0,
      widthU: 0,
      angleRad: Math.atan2(runtime.dashDirYU, runtime.dashDirXU),
      lengthU: DASH_LINE_LENGTH_U,
    });
  }
  for (const telegraph of world.boss?.telegraphs ?? []) {
    // sim은 도형 종류를 `shape`으로, render는 `kind`로 부른다. 나머지 칸은 이름이 같다
    out.push({ ...telegraph, kind: telegraph.shape });
  }
  for (const lance of lancesOf(world)) {
    if (lancePhaseOf(lance) !== 'telegraph') {
      continue;
    }
    for (const centerXU of lance.columnsU) {
      out.push({
        kind: 'pierceLine',
        ageSec: lance.telegraphSec - lance.telegraphRemainingSec,
        durationSec: lance.telegraphSec,
        xU: centerXU,
        yU: PLAYFIELD.heightU / 2,
        radiusU: 0,
        widthU: lance.halfWidthU * 2,
        angleRad: 0,
        lengthU: PLAYFIELD.heightU,
      });
    }
  }
  return out;
}

/** 판정이 살아 있는 대창 줄 전부. `FrameView.lance`가 한 줄뿐이라 나머지는 호출부가 따로 그린다 */
function activeLanceColumns(world: World): LanceView[] {
  const out: LanceView[] = [];
  for (const lance of lancesOf(world)) {
    if (lancePhaseOf(lance) !== 'active') {
      continue;
    }
    for (const centerXU of lance.columnsU) {
      out.push({ centerXU, elapsedSec: lance.activeSec - lance.activeRemainingSec });
    }
  }
  return out;
}

function collectZones(world: World): ZoneView[] {
  const out: ZoneView[] = [];
  for (const zone of world.zones.active) {
    out.push({ xU: zone.xU, yU: zone.yU, radiusU: zone.radiusU, ageSec: zone.ageSec });
  }
  return out;
}

function bossViewOf(boss: BossState, phaseTelegraphElapsedSec: number | null): FrameBoss {
  const def: BossDef = boss.def;
  const widthU = BOSS_SILHOUETTE_WIDTH_U[def.id];
  const colors = enemyHeaderColors(boss.charging ? 1 : 0, 0);
  return {
    bossId: def.id,
    shape: def.shape,
    xU: boss.xU,
    yU: boss.yU,
    silhouette: {
      widthU,
      heightU: bossSilhouetteHeightU(def.shape, widthU),
      hot: colors.hot,
      body: colors.body,
      seam: colors.seam,
      charging: boss.charging,
    },
    phase: { index: boss.phaseIndex, count: def.phases.length },
    hpByPart: boss.parts.map((part) => part.hp),
    phaseTelegraphElapsedSec,
  };
}

/** §15.1 보스 바. 시작 페이즈의 임계값 1.00은 눈금이 아니므로 뺀다 */
function hudBossOf(boss: BossState): HudBossView {
  const def: BossDef = boss.def;
  return {
    name: def.name,
    phase: boss.phaseIndex + 1,
    hpRatio: bossHpRatio(boss),
    phaseThresholds: def.phases.map((phase) => phase.hpThreshold).filter((value) => value > 0 && value < 1),
  };
}

/** §15.1 콤보. 배수는 sim이 이미 상한 3.0으로 자른 값이다 — 렌더에서 다시 계산하지 않는다(08 §2.5 A) */
function hudComboOf(world: World): HudComboView | null {
  if (world.run.combo === 0) {
    return null;
  }
  return {
    count: world.run.combo,
    multiplier: comboMul(world.run.combo),
    remainSec: comboRemainSec(world),
    holdSec: world.stats.comboHoldSec,
  };
}

/** 한 프레임을 서술하는 데 필요한, World 밖에서 오는 값 전부 */
export interface FrameViewParams {
  readonly run: Run;
  readonly renderSeed: number;
  /** **스테이지 진입 기준** realDt 누적 (초) */
  readonly backgroundTimeSec: number;
  readonly muted: boolean;
  readonly batch: MutableBatch;
  readonly shake: HitstopShake | null;
  /** 페이즈 전환 예고의 경과 (초). 예고 구간이 아니면 null이다 */
  readonly phaseTelegraphElapsedSec: number;
  readonly overlay: ScenePaint | null;
}

export function buildFrameView(params: FrameViewParams): FrameView {
  const world = params.run.world;
  const stage: StageDef = STAGES[world.stageId];
  const boss = world.boss;
  const player = world.player;
  const stats = world.stats;
  const lances = activeLanceColumns(world);
  const warning = boss !== null && boss.mode === 'fighting' && bossPhaseWarning(boss);
  return {
    backgroundId: stage.background,
    backgroundTimeSec: params.backgroundTimeSec,
    renderSeed: params.renderSeed,
    // 층 2. `FrameView.lance`가 한 줄뿐이라 둘째 줄부터가 여기로 내려간다
    paint: lances.length < 2 ? null : (ctx) => drawExtraLances(ctx, lances),
    zones: collectZones(world),
    telegraphs: collectTelegraphs(world),
    enemies: collectEnemies(world, params.shake),
    boss: boss === null ? null : bossViewOf(boss, warning ? params.phaseTelegraphElapsedSec : null),
    bullets: fillBatch(params.batch, world),
    lance: lances[0] ?? null,
    player: {
      xU: player.xU,
      yU: player.yU,
      parryRadiusU: stats.parryRadiusU,
      parryActive: {
        remainSec: world.parry.isActive ? Math.max(0, world.parry.activeUntilSec - world.simTimeSec) : 0,
        totalSec: stats.parryActiveSec,
      },
      cooldown: {
        remainSec: Math.max(0, world.parry.cooldownUntilSec - world.simTimeSec),
        totalSec: stats.cooldownSecFor('hit'),
      },
      parryInvuln: {
        remainSec: Math.max(0, player.parryInvulnUntilSec - world.simTimeSec),
        totalSec: stats.parryInvulnSec,
      },
      hitInvuln: {
        remainSec: Math.max(0, player.hitInvulnUntilSec - world.simTimeSec),
        totalSec: stats.hitInvulnSec,
      },
    },
    hud: {
      life: player.lives,
      maxLife: stats.maxLife,
      score: world.run.score,
      stage: world.stageId,
      progress: stageProgress(stage, world.simTimeSec),
      wave: waveText(stage, world.simTimeSec),
      boss: boss === null ? null : hudBossOf(boss),
      combo: hudComboOf(world),
      muted: params.muted,
      cheated: params.run.contaminated,
    },
    overlay: params.overlay,
  };
}
