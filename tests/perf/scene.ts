/**
 * P1 게이트용 786개 스트레스 씬 — 06_렌더링과_게임필.md §3.7.2 · 12_통합_계약.md §10 E-16
 *
 * 씬 구성은 §3.7.2의 표 그대로다: 적 탄환 280 + 반사탄 240 + 잡몹 20 + 장판 6 = 엔티티 546,
 * 그 위에 파티클 240. 배경은 S5 노량이고 정적 굽기가 걸린다.
 *
 * **그리는 것은 실제 렌더러다.** `render/frame.ts`의 `drawFrame` 한 번이 프레임 하나이고,
 * 층 순서·글로우·HUD·비네트가 전부 게임과 같은 코드에서 나온다. P1 당시의 stand-in 판(호출 수만
 * 맞춘 대역)은 P4가 오기 전의 물건이었고, 그것으로 재면 §3.5의 예산 표가 실제 프레임과 맞는지를
 * 물을 수 없다 — 그 질문이 이 게이트의 전부다(§3.7.2 판정 행).
 *
 * **sim 한 스텝은 이 씬에 없다.** 여기서 도는 것은 이동·수명·연쇄 사건 발행뿐이고 `sim/step.ts`는
 * 부르지 않는다. 280발과 240발을 동시에 띄운 상태를 sim으로 만들려면 가드가 던지는 상태를 계속
 * 만들어야 해서 측정이 아니라 우회가 된다. 그러므로 이 씬이 재는 값은 **렌더 프레임 시간**이고
 * sim 비용은 여기 안 들어간다 — 판정을 적을 때 그 사실을 같이 적어야 한다.
 *
 * 위치는 `tests/`다. `src/dev/`는 eslint가 `render`·`boot` import를 막는데(03 §5 · §2.4),
 * 실제 렌더러로 재려면 그 둘이 필요하다. `tests/visual/`이 같은 이유로 같은 자리에 산다.
 */

import { BULLETS } from '../../src/config/bullets';
import { ENEMIES } from '../../src/config/enemies';
import type { EnemyDef } from '../../src/config/types';
import { CHAIN_STAGGER_SEC, PARTICLES } from '../../src/config/feel';
import type { EnemyId, ParryableBulletId, StageId } from '../../src/config/ids';
import { PARRY } from '../../src/config/parry';
import { PLAYER } from '../../src/config/player';
import { PLAYFIELD } from '../../src/config/playfield';
import { STAGE_SCALING } from '../../src/config/difficulty';
import { ZONE } from '../../src/config/feel';
import { bus } from '../../src/core/bus';
import { createRng, deriveStream } from '../../src/core/rng';
import { bakeStageBackground } from '../../src/render/backgrounds/index';
import type { BulletLayerBatch } from '../../src/render/bullet';
import { createCamera, type Camera } from '../../src/render/camera';
import { bakeEnemyBodies, type EnemyBodyBakeSpec, type EnemyView } from '../../src/render/enemy';
import { drawFrame, type FrameDeps, type FrameEnemy, type FrameView } from '../../src/render/frame';
import { createHudAnim } from '../../src/render/hud';
import { createImpactLayer, type ImpactLayer } from '../../src/render/impact';
import { createParticleLayer, type ParticleLayer } from '../../src/render/particles';
import { createPlayerFx } from '../../src/render/player';
import type { TelegraphView } from '../../src/render/telegraph';
import type { ZoneView } from '../../src/render/zone';

/** 게이트가 재는 스테이지 (§3.7.2 「배경 S5 노량」) */
const STAGE_ID: StageId = 5;

/** D-05 — render 전용 시드. 값이 아니라 고정되어 있다는 것이 뜻이다 */
const RENDER_SEED = 20260808;

/** §3.2 동시 적 탄환 상한. `difficulty.ts`가 유일 소스다 (12 §10 E-13) */
const ENEMY_BULLET_COUNT = STAGE_SCALING[STAGE_ID].maxEnemyBullets;
/** §3.2 동시 반사탄 상한 */
const REFLECT_BULLET_COUNT = PLAYFIELD.maxReflectBullets;
/** §3.2 동시 잡몹 상한 */
const ENEMY_COUNT = PLAYFIELD.maxEnemies;
/** §4.3 동시 장판 상한 */
const ZONE_COUNT = ZONE.maxConcurrent;

/** §3.7.2 「연쇄 20링크」 */
const CHAIN_LINK_COUNT = 20;
/** §5.1 패리 주기. 연쇄를 이 간격으로 다시 시작해 최악 프레임이 반복되게 한다 */
const PARRY_PERIOD_SEC = PARRY.cooldownSec;

/** §9.7 S5 W5 편성 (§3.7.2가 지목한 넷) */
const ENEMY_IDS: readonly EnemyId[] = ['E-A', 'E-E', 'E-G', 'E-H'];

/**
 * 탄환 종류 배합 — §3.7.2 「P2 위주, 일부 P5·P6·P7로 큰 글로우 포함」.
 * 글로우 스프라이트 지름이 `r × 1.6 + 26`의 두 배라 종류가 곧 fill 면적이다.
 */
const BULLET_MIX: readonly ParryableBulletId[] = [
  'P2', 'P2', 'P2', 'P2', 'P2', 'P2', 'P2', 'P3', 'P5', 'P6', 'P7', 'P10',
];

/** 반사탄 중 자해 유예가 남아 있는 비율. 유예 중과 정상은 rim이 달라 스프라이트가 갈린다 (06 §5.3) */
const REFLECT_GRACE_STRIDE = 7;

const BULLET_SPEED_MIN_U = 260;
const BULLET_SPEED_MAX_U = 620;
const REFLECT_SPEED_MIN_U = 700;
const REFLECT_SPEED_MAX_U = 1100;

/** 잡몹 예비동작 주기 (s). 씬의 20기가 서로 다른 위상으로 예비동작을 돈다 */
const WINDUP_CYCLE_SEC = 1.6;
const WINDUP_TELL_SEC = 0.45;

const ZONE_RADIUS_U = 90;

/** 화면 밖으로 나간 탄을 되돌리는 여유 (u) */
const WRAP_MARGIN_U = 120;

interface Bullet {
  id: ParryableBulletId;
  xU: number;
  yU: number;
  vxU: number;
  vyU: number;
  angleRad: number;
  spinRad: number;
  graceRemainingSec: number;
  reparryCount: number;
}

interface Minion {
  id: EnemyId;
  xU: number;
  yU: number;
  phaseSec: number;
  hpRatio: number;
}

interface Zone {
  xU: number;
  yU: number;
  ageSec: number;
}

export interface StressCounts {
  readonly enemyBullets: number;
  readonly reflectBullets: number;
  readonly enemies: number;
  readonly zones: number;
  readonly particles: number;
  readonly entities: number;
  readonly total: number;
}

export interface StressScene {
  /** 한 프레임 전진 + 그리기. `realDtSec`은 rAF 간격이다 */
  frame(ctx: CanvasRenderingContext2D, realDtSec: number): void;
  /** 이번 프레임의 동시 개수. 게이트가 786을 요구하므로 표시가 아니라 검증 대상이다 */
  counts(): StressCounts;
  /** 연쇄가 지금 몇 번째 링크인가. -1이면 연쇄 밖이다 */
  chainLink(): number;
  dispose(): void;
}

function bakeSpecs(): EnemyBodyBakeSpec[] {
  return ENEMY_IDS.map((id) => ({
    shape: ENEMIES[id].shape,
    widthU: ENEMIES[id].hitRadiusU / 0.6,
  }));
}

function makeBatch(capacity: number): {
  count: number;
  bulletId: ParryableBulletId[];
  state: BulletLayerBatch['state'][number][];
  xU: Float32Array;
  yU: Float32Array;
  angleRad: Float32Array;
  spinRad: Float32Array;
  graceRemainingSec: Float32Array;
  reparryCount: Int32Array;
} {
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
 * 층을 하나씩 빼서 어느 층이 시간을 먹는지 가르는 손잡이. 게이트 본 측정은 전부 기본값으로
 * 돌리고, 실패했을 때 원인을 좁히는 데만 쓴다 (06 §3.6 손잡이 순서 · 12 §10 E-17).
 * `enemyBulletCount`는 스펙 §14.3 T-07 — 동시 적 탄환 상한 인하가 얼마를 돌려주는지 재는 자리다.
 */
export interface StressOptions {
  readonly enemyBulletCount?: number;
  readonly reflectBulletCount?: number;
  readonly enemyCount?: number;
  readonly zoneCount?: number;
  readonly telegraphCount?: number;
  /** false면 연쇄를 발행하지 않는다 — 파티클·집중선·팝업이 통째로 빠진다 */
  readonly chain?: boolean;
  /** false면 배경 동적 레이어를 안 그린다. 정적 굽기 한 장은 남는다 */
  readonly background?: boolean;
}

export function createStressScene(options: StressOptions = {}): StressScene {
  const enemyBulletCount = options.enemyBulletCount ?? ENEMY_BULLET_COUNT;
  const reflectBulletCount = options.reflectBulletCount ?? REFLECT_BULLET_COUNT;
  const enemyCount = options.enemyCount ?? ENEMY_COUNT;
  const zoneCount = options.zoneCount ?? ZONE_COUNT;
  const telegraphCount = options.telegraphCount ?? 4;
  const chainOn = options.chain ?? true;

  bakeStageBackground('noryang', RENDER_SEED);
  bakeEnemyBodies(bakeSpecs());

  const rng = createRng(RENDER_SEED);
  const camera: Camera = createCamera({ bus, rng: deriveStream(RENDER_SEED, 'render/camera') });
  const particles: ParticleLayer = createParticleLayer({ bus, rng: deriveStream(RENDER_SEED, 'render/particles') });
  const impact: ImpactLayer = createImpactLayer({ bus, rng: deriveStream(RENDER_SEED, 'render/impact') });
  const playerFx = createPlayerFx();
  const hudAnim = createHudAnim();

  const enemyBullets: Bullet[] = [];
  const reflectBullets: Bullet[] = [];
  const minions: Minion[] = [];
  const zones: Zone[] = [];

  for (let i = 0; i < enemyBulletCount; i += 1) {
    const id = BULLET_MIX[i % BULLET_MIX.length]!;
    const angle = rng.range(Math.PI * 0.15, Math.PI * 0.85);
    const speed = rng.range(BULLET_SPEED_MIN_U, BULLET_SPEED_MAX_U);
    enemyBullets.push({
      id,
      xU: rng.range(0, PLAYFIELD.widthU),
      yU: rng.range(0, PLAYFIELD.heightU),
      vxU: Math.cos(angle) * speed,
      vyU: Math.sin(angle) * speed,
      angleRad: angle,
      spinRad: 0,
      graceRemainingSec: 0,
      reparryCount: 0,
    });
  }
  for (let i = 0; i < reflectBulletCount; i += 1) {
    const id = BULLET_MIX[(i * 5) % BULLET_MIX.length]!;
    const angle = rng.range(-Math.PI * 0.85, -Math.PI * 0.15);
    const speed = rng.range(REFLECT_SPEED_MIN_U, REFLECT_SPEED_MAX_U);
    reflectBullets.push({
      id,
      xU: rng.range(0, PLAYFIELD.widthU),
      yU: rng.range(0, PLAYFIELD.heightU),
      vxU: Math.cos(angle) * speed,
      vyU: Math.sin(angle) * speed,
      angleRad: angle,
      spinRad: 0,
      // 유예 중과 정상이 섞여 있어야 굽힌 스프라이트 세 상태가 다 나온다
      graceRemainingSec: i % REFLECT_GRACE_STRIDE === 0 ? 0.1 : 0,
      reparryCount: i % 3,
    });
  }
  for (let i = 0; i < enemyCount; i += 1) {
    minions.push({
      id: ENEMY_IDS[i % ENEMY_IDS.length]!,
      xU: PLAYFIELD.widthU * (0.12 + 0.19 * (i % 5)),
      yU: 220 + 150 * Math.floor(i / 5),
      phaseSec: (i / Math.max(1, enemyCount)) * WINDUP_CYCLE_SEC,
      // 피해를 입은 상태여야 HP 바 2회가 다 든다 (06 §3.5)
      hpRatio: 0.25 + 0.6 * ((i % 7) / 7),
    });
  }
  for (let i = 0; i < zoneCount; i += 1) {
    zones.push({
      xU: PLAYFIELD.widthU * (0.18 + 0.14 * i),
      yU: PLAYFIELD.heightU * (0.55 + 0.05 * (i % 3)),
      ageSec: i * 0.4,
    });
  }

  const batch = makeBatch(Math.max(1, enemyBulletCount + reflectBulletCount));
  const enemyViews: FrameEnemy[] = [];

  let sceneSec = 0;
  let backgroundSec = 0;
  let nextParryAtSec = 0;
  let parrySeq = 0;
  let chainStartedAtSec = -1;
  let playerXU = PLAYFIELD.widthU / 2;
  let playerYU = PLAYFIELD.heightU * 0.72;
  let combo = 0;

  function moveBullets(list: Bullet[], dtSec: number): void {
    for (const shot of list) {
      shot.xU += shot.vxU * dtSec;
      shot.yU += shot.vyU * dtSec;
      shot.spinRad += dtSec * 6;
      if (shot.graceRemainingSec > 0) {
        shot.graceRemainingSec = Math.max(0, shot.graceRemainingSec - dtSec);
      }
      // 소멸 대신 되돌린다. 개수가 상한에서 안 내려가야 게이트가 재려는 프레임이 유지된다
      if (shot.xU < -WRAP_MARGIN_U) { shot.xU = PLAYFIELD.widthU + WRAP_MARGIN_U; }
      if (shot.xU > PLAYFIELD.widthU + WRAP_MARGIN_U) { shot.xU = -WRAP_MARGIN_U; }
      if (shot.yU < -WRAP_MARGIN_U) { shot.yU = PLAYFIELD.heightU + WRAP_MARGIN_U; }
      if (shot.yU > PLAYFIELD.heightU + WRAP_MARGIN_U) { shot.yU = -WRAP_MARGIN_U; }
    }
  }

  function fillBatch(): BulletLayerBatch {
    let n = 0;
    for (const shot of enemyBullets) {
      batch.bulletId[n] = shot.id;
      batch.state[n] = 'enemy';
      batch.xU[n] = shot.xU;
      batch.yU[n] = shot.yU;
      batch.angleRad[n] = shot.angleRad;
      batch.spinRad[n] = BULLETS[shot.id].shape === 'star' ? shot.spinRad : 0;
      batch.graceRemainingSec[n] = 0;
      batch.reparryCount[n] = 0;
      n += 1;
    }
    for (const shot of reflectBullets) {
      batch.bulletId[n] = shot.id;
      batch.state[n] = shot.graceRemainingSec > 0 ? 'reflectGrace' : 'reflect';
      batch.xU[n] = shot.xU;
      batch.yU[n] = shot.yU;
      batch.angleRad[n] = shot.angleRad;
      batch.spinRad[n] = BULLETS[shot.id].shape === 'star' ? shot.spinRad : 0;
      batch.graceRemainingSec[n] = shot.graceRemainingSec;
      batch.reparryCount[n] = shot.reparryCount;
      n += 1;
    }
    batch.count = n;
    return batch as BulletLayerBatch;
  }

  function fillEnemies(): FrameEnemy[] {
    enemyViews.length = 0;
    for (const minion of minions) {
      const def: EnemyDef = ENEMIES[minion.id];
      const cycle = (sceneSec + minion.phaseSec) % WINDUP_CYCLE_SEC;
      const remainSec = Math.max(0, WINDUP_TELL_SEC - cycle);
      const view: EnemyView = {
        shape: def.shape,
        widthU: def.hitRadiusU / 0.6,
        xU: minion.xU,
        yU: minion.yU,
        // 20기가 전부 예비동작 중인 프레임이 최악 프레임이다 (06 §3.5 「헤더 글로우 못 굽는다」)
        windup01: remainSec > 0 ? 1 - remainSec / WINDUP_TELL_SEC : 0,
        windupRemainingSec: remainSec,
        aimXU: playerXU,
        aimYU: playerYU,
        flash01: 0,
        frontShieldIntact: def.frontShield === true,
        hp: Math.max(1, Math.round(def.hp * minion.hpRatio)),
        maxHp: def.hp,
        noHpBar: false,
        noContactShadow: false,
        partGauge: false,
      };
      enemyViews.push({ view, shake: null });
    }
    return enemyViews;
  }

  function zoneViews(): ZoneView[] {
    return zones.map((zone) => ({ xU: zone.xU, yU: zone.yU, radiusU: ZONE_RADIUS_U, ageSec: zone.ageSec }));
  }

  /** §3.5 예산 표의 「예고 4 × 4」. 잡몹 넷이 돌진 예고를 켠 상태로 둔다 */
  function telegraphViews(): TelegraphView[] {
    const out: TelegraphView[] = [];
    for (let i = 0; i < Math.min(telegraphCount, minions.length); i += 1) {
      const minion = minions[i]!;
      out.push({
        kind: 'dash',
        ageSec: (sceneSec + i * 0.1) % 0.5,
        durationSec: 0.5,
        xU: minion.xU,
        yU: minion.yU,
        radiusU: 0,
        widthU: 0,
        angleRad: Math.PI / 2,
        lengthU: PLAYFIELD.heightU,
      });
    }
    return out;
  }

  /**
   * 연쇄 한 벌을 발행한다. `parry` 하나 + `enemyKilled` 20개이고, 링크 사이의 0.04초 간격은
   * `render/particles.ts`가 `CHAIN_STAGGER_SEC`으로 스스로 벌린다 — 여기서 벌리면 그 파일이
   * 이미 갖고 있는 규칙이 두 벌이 된다.
   */
  function emitChain(): void {
    parrySeq += 1;
    combo += CHAIN_LINK_COUNT;
    chainStartedAtSec = sceneSec;
    bus.emit({
      kind: 'parry', parrySeq, grade: 'GREAT', count: CHAIN_LINK_COUNT,
      combo, xU: playerXU, yU: playerYU,
    });
    for (let link = 0; link < CHAIN_LINK_COUNT; link += 1) {
      const angle = (link / CHAIN_LINK_COUNT) * Math.PI * 2;
      bus.emit({
        kind: 'enemyKilled',
        parrySeq,
        chainIndex: link,
        xU: playerXU + Math.cos(angle) * 320,
        yU: playerYU + Math.sin(angle) * 320,
      });
    }
    bus.flush();
  }

  return {
    frame(ctx: CanvasRenderingContext2D, realDtSec: number): void {
      sceneSec += realDtSec;
      backgroundSec += realDtSec;
      moveBullets(enemyBullets, realDtSec);
      moveBullets(reflectBullets, realDtSec);
      for (const zone of zones) {
        zone.ageSec += realDtSec;
      }
      playerXU = PLAYFIELD.widthU / 2 + Math.sin(sceneSec * 0.9) * 260;
      playerYU = PLAYFIELD.heightU * 0.72 + Math.cos(sceneSec * 0.6) * 90;
      if (chainOn && sceneSec >= nextParryAtSec) {
        nextParryAtSec = sceneSec + PARRY_PERIOD_SEC;
        emitChain();
      }

      const view: FrameView = {
        backgroundId: 'noryang',
        backgroundTimeSec: backgroundSec,
        renderSeed: RENDER_SEED,
        paint: null,
        zones: zoneViews(),
        telegraphs: telegraphViews(),
        enemies: fillEnemies(),
        boss: null,
        bullets: fillBatch(),
        lance: null,
        player: {
          xU: playerXU,
          yU: playerYU,
          parryRadiusU: PARRY.radiusU,
          parryActive: { remainSec: Math.max(0, nextParryAtSec - sceneSec - PARRY_PERIOD_SEC + PARRY.activeSec), totalSec: PARRY.activeSec },
          cooldown: { remainSec: Math.max(0, nextParryAtSec - sceneSec), totalSec: PARRY.cooldownSec },
          parryInvuln: { remainSec: 0, totalSec: PARRY.invulnSec },
          hitInvuln: { remainSec: 0, totalSec: PLAYER.hitInvulnSec },
        },
        hud: {
          life: 3,
          maxLife: PLAYER.maxLife,
          score: 1_234_567 + Math.floor(sceneSec * 900),
          stage: STAGE_ID,
          progress: 0.82,
          wave: 'W5  0:41 / 1:00',
          boss: null,
          combo: { count: combo, multiplier: 3, remainSec: 2.1, holdSec: 3 },
          muted: false,
          cheated: false,
        },
        overlay: null,
      };
      const deps: FrameDeps = { camera, particles, impact, playerFx, hudAnim, realDtSec };
      drawFrame(ctx, view, deps);
    },

    counts(): StressCounts {
      const entities = enemyBullets.length + reflectBullets.length + minions.length + zones.length;
      return {
        enemyBullets: enemyBullets.length,
        reflectBullets: reflectBullets.length,
        enemies: minions.length,
        zones: zones.length,
        particles: particles.aliveCount,
        entities,
        total: entities + particles.aliveCount,
      };
    },

    chainLink(): number {
      if (chainStartedAtSec < 0) {
        return -1;
      }
      const link = Math.floor((sceneSec - chainStartedAtSec) / CHAIN_STAGGER_SEC);
      return link >= CHAIN_LINK_COUNT ? -1 : link;
    },

    dispose(): void {
      camera.dispose();
      particles.dispose();
      impact.dispose();
    },
  };
}

/** 게이트가 요구하는 파티클 동시 생존 상한 (§3.7.2). 확인용으로 내보낸다 */
export const PARTICLE_CAP = PARTICLES.maxAlive;
