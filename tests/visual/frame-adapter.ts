/**
 * 주입 payload → 게임 렌더러의 프레임 뷰. 09 §5.2의 3번이 끝나는 자리다.
 *
 * `adapt.ts`가 목업 상태를 `MockupFrame`으로 옮겨 적었고, 여기서는 그것을 `render/frame.ts`가
 * 읽는 형태로 **다시 옮겨 적기만** 한다. 재시뮬레이션도, 보정도 없다 — 값이 어긋나면 그것은
 * 대조가 잡아야 할 차이지 이 파일이 메워야 할 구멍이 아니다.
 *
 * **메울 수 없는 칸은 목업이 그 칸을 안 갖고 있기 때문이다.** 세 자리가 그렇고, 아래 각 자리에
 * 무엇을 넣었는지 적어 두었다. 리포트를 읽는 사람이 "게임이 다르게 그렸다"와 "목업에 그 값이
 * 없었다"를 갈라 봐야 한다.
 */

import { BULLETS } from '../../src/config/bullets';
import { ENEMIES } from '../../src/config/enemies';
import type { BackgroundId, BossId, BossSpriteId, EnemyId, ParryableBulletId, StageId } from '../../src/config/ids';
import { PARRY } from '../../src/config/parry';
import { PLAYER } from '../../src/config/player';
import { BOSSES } from '../../src/config/bosses/index';
import { bus } from '../../src/core/bus';
import { deriveStream } from '../../src/core/rng';
import { bakeStageBackground, isStageBackgroundBaked } from '../../src/render/backgrounds/index';
import { BOSS_SILHOUETTE_WIDTH_U, bossSilhouetteHeightU } from '../../src/render/boss';
import { createCamera } from '../../src/render/camera';
import { enemyHeaderColors } from '../../src/render/enemy';
import type { EnemyView } from '../../src/render/enemy';
import { createHudAnim } from '../../src/render/hud';
import { createImpactLayer } from '../../src/render/impact';
import { createParticleLayer } from '../../src/render/particles';
import { createPlayerFx } from '../../src/render/player';
import type { FrameBoss, FrameDeps, FrameEnemy, FrameView } from '../../src/render/frame';
import type { BulletLayerBatch } from '../../src/render/bullet';
import type { TelegraphView } from '../../src/render/telegraph';
import type { MockupFrame } from './adapt';

/** 목업 `ENEMIES` 표(engine.js:65-72)의 보스 행 → 게임 BossId */
const BOSS_ID_BY_MOCKUP_TYPE: Record<string, BossId | undefined> = {
  'B-GUN': 'B1',
  'B-SAM': 'B2',
  'B-SHIP': 'B3',
  'B-ART': 'B4',
  'B-FLAG': 'B5',
};

/** 목업 `tele.kind`(engine.js:1026-1063) → 게임 TelegraphId */
const TELEGRAPH_KIND: Record<MockupFrame['telegraphs'][number]['kind'], TelegraphView['kind']> = {
  circle: 'impactCircle',
  lance: 'pierceLine',
  dash: 'dash',
};

/** `config/enemies.ts`의 hitRadiusU가 목업 실루엣 폭 w × 0.6이므로 되돌린다 */
const HIT_RADIUS_TO_WIDTH = 1 / 0.6;

function isParryable(type: string): type is ParryableBulletId {
  return type in BULLETS && type !== 'P9' && type !== 'P12';
}

function isMinion(type: string): type is EnemyId {
  return type in ENEMIES;
}

/**
 * 목업은 발사체에 각도를 안 싣고 속도만 싣는다. 목업 자신이 `atan2(vy, vx)`로 매 프레임
 * 되계산했으므로(engine.js:175) 여기서도 같은 식을 쓴다 — 계산이 아니라 같은 유도다.
 */
function bulletBatchOf(frame: MockupFrame): BulletLayerBatch {
  const rows = frame.bullets.filter((b) => isParryable(b.bulletType));
  const count = rows.length;
  const batch = {
    count,
    bulletId: rows.map((b) => b.bulletType as ParryableBulletId),
    state: rows.map((b) =>
      b.owner === 'enemy' ? 'enemy' : b.graceRemainingSec > 0 ? 'reflectGrace' : 'reflect',
    ),
    xU: new Float32Array(count),
    yU: new Float32Array(count),
    angleRad: new Float32Array(count),
    spinRad: new Float32Array(count),
    graceRemainingSec: new Float32Array(count),
    reparryCount: new Int32Array(count),
  } as const satisfies BulletLayerBatch;
  for (let i = 0; i < count; i += 1) {
    const row = rows[i]!;
    batch.xU[i] = row.xU;
    batch.yU[i] = row.yU;
    batch.angleRad[i] = Math.atan2(row.vyUPerSec, row.vxUPerSec);
    // 목업은 `spin`을 모든 발사체에 누산하지만 그리기에는 `star`(P4 수리검)에서만 쓴다
    // (engine.js:232). 나머지 종류까지 넘기면 게임 쪽 본체 회전이 목업과 어긋나고, 그 어긋남은
    // 게임의 결함이 아니라 이 어댑터가 만든 것이다. 06 §3.1도 "P4만 + spin"으로 못 박았다
    batch.spinRad[i] = BULLETS[batch.bulletId[i]!].shape === 'star' ? row.spinRad : 0;
    batch.graceRemainingSec[i] = row.graceRemainingSec;
    batch.reparryCount[i] = row.reparryCount;
  }
  return batch;
}

/**
 * 잡몹 하나. 세 칸이 목업에 없다.
 * - `windupRemainingSec`·`aimXU`·`aimYU` — 목업은 `charge` 하나만 들고 조준선을 안 그린다.
 *   조준 좌표는 플레이어 위치를 넣는다(목업 `aimAt`이 언제나 그쪽이다).
 * - `partGauge` — B3 포문의 개별 게이지는 목업이 `scene.overlay`에서 그렸다(06 §1.6이 수정으로
 *   표시한 자리). 잡몹 경로에서는 끈다.
 * - 히트스톱 진동(`shake`) — 목업에 그 축이 없다. 언제나 null이다.
 */
function minionOf(row: MockupFrame['enemies'][number], frame: MockupFrame): FrameEnemy | null {
  if (!isMinion(row.enemyType)) {
    return null;
  }
  const def = ENEMIES[row.enemyType];
  const view: EnemyView = {
    shape: def.shape,
    widthU: def.hitRadiusU * HIT_RADIUS_TO_WIDTH,
    xU: row.xU,
    yU: row.yU,
    windup01: row.charge,
    windupRemainingSec: 0,
    aimXU: frame.player.xU,
    aimYU: frame.player.yU,
    flash01: row.flash,
    frontShieldIntact: row.shieldCharges > 0,
    hp: row.hp,
    maxHp: row.maxHp,
    noHpBar: row.hideHpBar,
    noContactShadow: false,
    partGauge: false,
  };
  return { view, shake: null };
}

/**
 * 보스 하나. 목업은 보스를 잡몹과 같은 배열에 담으므로 첫 번째 보스 행만 꺼낸다 —
 * 15화면 어디에도 보스가 둘인 프레임이 없다.
 *
 * `phase`는 HUD가 들고 있는 값을 쓴다. 목업의 보스 행 자체에는 페이즈 칸이 없다.
 * `phaseTelegraphElapsedSec`는 언제나 null이다 — 전환 예고는 06 §5.8의 신규 표시라 목업에 없다.
 */
function bossOf(frame: MockupFrame): FrameBoss | null {
  for (const row of frame.enemies) {
    const bossId = BOSS_ID_BY_MOCKUP_TYPE[row.enemyType];
    if (bossId === undefined) {
      continue;
    }
    const shape: BossSpriteId = BOSSES[bossId].shape;
    const widthU = BOSS_SILHOUETTE_WIDTH_U[bossId];
    const colors = enemyHeaderColors(row.charge, row.flash);
    return {
      bossId,
      shape,
      xU: row.xU,
      yU: row.yU,
      silhouette: {
        widthU,
        heightU: bossSilhouetteHeightU(shape, widthU),
        hot: colors.hot,
        body: colors.body,
        seam: colors.seam,
        charging: row.charge > 0,
      },
      phase: {
        index: Math.max(0, (frame.hud.boss?.phase ?? 1) - 1),
        count: Math.max(1, frame.hud.boss?.phaseThresholds.length ?? 0),
      },
      hpByPart: row.parts.map((p) => p.hp),
      phaseTelegraphElapsedSec: null,
    };
  }
  return null;
}

/**
 * 목업 `tele`는 방향과 길이를 안 싣는다 — `dash` 예고선을 `x` 하나로만 그렸기 때문이다
 * (engine.js:1050-1062). 둘 다 0으로 두고, 그 사실이 리포트의 차이로 드러나게 둔다.
 */
function telegraphsOf(frame: MockupFrame): readonly TelegraphView[] {
  return frame.telegraphs.map((g) => ({
    kind: TELEGRAPH_KIND[g.kind],
    ageSec: g.ageSec,
    durationSec: g.durationSec,
    xU: g.xU,
    yU: g.yU,
    radiusU: g.radiusU,
    widthU: g.widthU,
    angleRad: 0,
    lengthU: 0,
  }));
}

/**
 * 목업 `p.inv`(engine.js:867)는 패리 무적과 피격 무적을 한 칸에 담는다. 게임은 §5.9대로 둘을
 * 갈랐으므로 어느 쪽인지 길이로 가른다 — 패리 무적은 0.14초가 상한이다.
 */
function playerOf(frame: MockupFrame): FrameView['player'] {
  const invuln = frame.player.invulnRemainingSec;
  const fromParry = invuln > 0 && invuln <= PARRY.invulnSec;
  return {
    xU: frame.player.xU,
    yU: frame.player.yU,
    parryRadiusU: PARRY.radiusU,
    parryActive: { remainSec: frame.player.parryActiveRemainingSec, totalSec: PARRY.activeSec },
    cooldown: { remainSec: frame.player.cooldownRemainingSec, totalSec: PARRY.cooldownSec },
    parryInvuln: { remainSec: fromParry ? invuln : 0, totalSec: PARRY.invulnSec },
    hitInvuln: { remainSec: fromParry ? 0 : invuln, totalSec: PLAYER.hitInvulnSec },
  };
}

function stageIdOf(value: number): StageId {
  return (value >= 1 && value <= 5 ? value : 1) as StageId;
}

/**
 * 목업 HUD에 없는 두 칸은 §5.1·§5.2의 신규 표시다(06 §1.10). 둘 다 꺼진 상태로 넣는다 —
 * 켜면 목업에 없는 그림이 생겨 대조가 그 차이부터 보고한다.
 */
function hudOf(frame: MockupFrame): FrameView['hud'] {
  const boss = frame.hud.boss;
  return {
    life: frame.hud.life,
    maxLife: frame.hud.maxLife,
    score: frame.hud.score,
    stage: stageIdOf(frame.hud.stage),
    progress: frame.hud.progress,
    wave: frame.hud.wave ?? '',
    boss: boss === null ? null : {
      name: boss.name,
      phase: boss.phase,
      hpRatio: boss.hpRatio,
      phaseThresholds: boss.phaseThresholds,
    },
    combo: frame.hud.combo > 0
      ? { count: frame.hud.combo, multiplier: 1, remainSec: 0, holdSec: 1 }
      : null,
    muted: false,
    cheated: false,
  };
}

export function toFrameView(frame: MockupFrame, backgroundId: BackgroundId, renderSeed: number): FrameView {
  const enemies: FrameEnemy[] = [];
  for (const row of frame.enemies) {
    const minion = minionOf(row, frame);
    if (minion !== null) {
      enemies.push(minion);
    }
  }
  return {
    backgroundId,
    backgroundTimeSec: frame.timeSec,
    renderSeed,
    paint: null,
    zones: frame.zones.map((z) => ({ xU: z.xU, yU: z.yU, radiusU: z.radiusU, ageSec: z.ageSec })),
    telegraphs: telegraphsOf(frame),
    enemies,
    boss: bossOf(frame),
    bullets: bulletBatchOf(frame),
    // 목업에는 P12 본체가 없다. 예고선만 있고 0.4초 관통 본체는 06 §5.4의 신규 설계다
    lance: null,
    player: playerOf(frame),
    hud: hudOf(frame),
    overlay: null,
  };
}

/**
 * 프레임을 넘겨 사는 다섯을 만든다. **버스에 붙되 아무 사건도 오지 않는다** — 주입은 상태만
 * 옮기고 sim은 돌지 않으므로 파티클·집중선·임팩트 프레임은 언제나 비어 있다. 목업의 파편과
 * 팝업은 대조에서 마스크로 빠지므로(09 §5.3) 그 자리가 비는 것이 옳다.
 *
 * `reducedMotion`을 카메라와 임팩트 층 양쪽에 넘긴다 — 12 §3이 그 플래그의 소비자를 그 둘로 적었다.
 */
export function createFrameDeps(realDtSec: number, reducedMotion: boolean, renderSeed: number): FrameDeps {
  const camera = createCamera({ bus, rng: deriveStream(renderSeed, 'render/camera') });
  const particles = createParticleLayer({ bus, rng: deriveStream(renderSeed, 'render/particles') });
  const impact = createImpactLayer({ bus, rng: deriveStream(renderSeed, 'render/impact') });
  camera.setReducedMotion(reducedMotion);
  impact.setReducedMotion(reducedMotion);
  return {
    camera,
    particles,
    impact,
    playerFx: createPlayerFx(),
    hudAnim: createHudAnim(),
    realDtSec,
  };
}

/** 06 §3.2 — 굽기는 `screens/play.ts`의 entering이 하는 일이라 하네스가 그 한 걸음을 대신한다 */
export function ensureBackgroundBaked(backgroundId: BackgroundId, renderSeed: number): void {
  if (!isStageBackgroundBaked(backgroundId, renderSeed)) {
    bakeStageBackground(backgroundId, renderSeed);
  }
}

export function disposeFrameDeps(deps: FrameDeps): void {
  deps.camera.dispose();
  deps.particles.dispose();
  deps.impact.dispose();
}
