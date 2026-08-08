/**
 * 헤드리스 계측 — 09_검증_전략.md §4.3의 리포트가 요구하는 숫자를 sim에서 읽어 모은다.
 *
 * 둘로 갈린다. **사건은 버스에서** 받고(패리·등급·재패리·피격·처치), **상태는 스텝 경계에서**
 * 읽는다(동시 존재 수의 최대치, 반사탄의 최후, 보스 HP 감소, HR-03 공백 구간).
 * 버스만으로는 「최대 몇 기까지 갔는가」가 안 나오고, 상태만으로는 「어느 등급이 몇 번인가」가
 * 안 나온다.
 *
 * ── sim에 아무것도 쓰지 않는다 ──────────────────────────────────────────────────
 *
 * 이 파일이 sim에 대해 하는 일은 구독과 읽기뿐이다. §18.1의 "전투 규칙 자체는 하나도 바뀌지
 * 않는다"가 계측에도 걸린다 — 계측이 상태를 건드리면 시뮬이 잰 것은 게임이 아니라 시뮬이다.
 *
 * ── 반사탄의 최후는 풀을 훑어야 나온다 ──────────────────────────────────────────
 *
 * R-03이 지목한 미측정 축(반사탄 명중률)에는 전용 사건이 없다. 잡몹 처치는 `enemyKilled`로
 * 오지만 보스 본체에 박힌 반사탄은 어떤 사건도 내지 않고, 수명으로 사라진 것과 화면 밖으로
 * 나간 것은 서로 구분되어야 한다. 그래서 스텝 전후로 반사탄 풀을 대조해 사라진 개체를
 * 「맞았다 / 수명 / 이탈 / 재패리」 넷으로 가른다.
 *
 * 슬롯은 재사용되므로 개체 참조만으로는 같은 반사탄인지 알 수 없다. `parriedSessionId`를 함께
 * 보는 것이 그 구분이고, 값이 바뀐 채로 살아 있으면 재패리다.
 *
 * ── HR-03 면제 표는 관측으로 만든다 ────────────────────────────────────────────
 *
 * 가드가 세는 면제 집계(`GuardState.report`)는 가드가 자기 규칙으로 매긴 판정이라, 여기가 그것을
 * 옮겨 적으면 가드의 오탐이 곧 리포트의 사실이 된다. 그래서 적 탄환 0인 구간을 세계에서 직접
 * 재고 관측 가능한 원인으로만 가른다 —
 * 소강(`wavePhase`)과 보스 격파 연출(`boss.mode`) 둘은 확정이고, 나머지는 가드가 ③
 * `allSourcesSuppressed`로 잡는 그 구간이라 `unattributed`로 적는다. 추정을 확정처럼 적지 않는다.
 */
import { ZONE } from '../config/feel';
import type { ParryGradeId, StageId } from '../config/ids';
import { PLAYFIELD } from '../config/playfield';
import type { FeedbackBus, PlayerHitCause, Unsubscribe } from '../core/bus';
import type { Projectile } from '../sim/bullets';
import type { World } from '../sim/world';
import { hasDueSpawn, wavePhase } from '../sim/waves';

/** 관측으로 가를 수 있는 HR-03 공백의 원인. 셋째는 가드의 ③ 면제와 같은 구간이지만 추정이다 */
export type EmptySpanCause = 'lull' | 'bossDefeat' | 'unattributed';

export interface EmptySpanTally {
  spans: number;
  simSec: number;
  worstSec: number;
}

export interface ParryMetrics {
  attempts: number;
  successes: number;
  empty: number;
  grades: Record<ParryGradeId, number>;
  reparries: number;
  reparryGrades: Record<ParryGradeId, number>;
  /** D-09 — 패리 하나가 동시에 반사한 발수의 합. 나누면 평균 동시 반사 발수다 */
  reflectedTotal: number;
  maxSimultaneous: number;
}

export interface ReflectMetrics {
  spawned: number;
  hitSomething: number;
  expiredByLifetime: number;
  leftField: number;
  reparried: number;
  hitPlayer: number;
  shieldBlocked: number;
  enemiesKilled: number;
  /** 보스 본체와 부위의 HP 감소 총합. 반사탄 말고는 보스 HP를 깎는 것이 없다(HR-01) */
  bossDamage: number;
}

export interface HitMetrics {
  total: number;
  byCause: Record<PlayerHitCause, number>;
}

export interface PeakMetrics {
  enemyBullets: number;
  reflects: number;
  enemies: number;
  zones: number;
  /** §3.2 잡몹 상한에 막혀 신규 스폰이 실제로 미뤄진 구간 수 */
  enemySpawnDeferrals: number;
}

export interface MetricsData {
  readonly parry: ParryMetrics;
  readonly reflect: ReflectMetrics;
  readonly hits: HitMetrics;
  readonly peaks: PeakMetrics;
  /**
   * 스테이지별 도달치. 09 §4.4가 `peaks.enemies`를 §14.1의 10 / 12 / 10 / 18 / 20과 대조하라고
   * 했는데 그 표가 스테이지마다 다른 값이라, 런 전체의 최대치 하나로는 어느 칸과도 못 맞춘다.
   * 동시 적 탄환 상한도 스테이지마다 다르므로(difficulty.ts) 같은 이유로 여기서 갈린다.
   */
  readonly peaksByStage: Map<StageId, PeakMetrics>;
  readonly emptySpans: Record<EmptySpanCause, EmptySpanTally>;
  /**
   * 봇이 실제로 밟은 y 구간 (u). 09 §4.2가 S-04 때문에 봇의 y를 묶었고 그 대가를 리포트 머리에
   * 찍으라고 했는데, 정책값을 그대로 옮겨 적으면 「봇이 그렇게 하기로 되어 있다」밖에 안 된다.
   * 실측 구간이어야 플레이어 영역의 얼마를 안 밟고 나온 숫자인지가 관측으로 남는다.
   */
  readonly playerYU: { minU: number; maxU: number };
  /** §3.2 초당 히트스톱 누적의 최대치 (s) */
  maxHitstopPerSecSec: number;
  simSec: number;
}

export interface Metrics {
  readonly data: MetricsData;
  /** `stepRun` 직전 */
  beforeStep(world: World): void;
  /** `stepRun` 직후 */
  afterStep(world: World, dtSec: number): void;
  detach(): void;
}

interface ReflectSnapshot {
  readonly sessionId: number;
  readonly xU: number;
  readonly yU: number;
  readonly vxUPerSec: number;
  readonly vyUPerSec: number;
  readonly lifeRemainingSec: number;
  /** 슬롯 재사용과 재패리를 가르는 값. 재패리는 나이가 이어지고 재사용은 0부터 다시 센다 */
  readonly ageSec: number;
}

function zeroGrades(): Record<ParryGradeId, number> {
  return { GREAT: 0, GOOD: 0, NOT_BAD: 0 };
}

function emptySpan(): EmptySpanTally {
  return { spans: 0, simSec: 0, worstSec: 0 };
}

function zeroPeaks(): PeakMetrics {
  return { enemyBullets: 0, reflects: 0, enemies: 0, zones: 0, enemySpawnDeferrals: 0 };
}

function createData(): MetricsData {
  return {
    parry: {
      attempts: 0, successes: 0, empty: 0, grades: zeroGrades(),
      reparries: 0, reparryGrades: zeroGrades(),
      reflectedTotal: 0, maxSimultaneous: 0,
    },
    reflect: {
      spawned: 0, hitSomething: 0, expiredByLifetime: 0, leftField: 0, reparried: 0,
      hitPlayer: 0, shieldBlocked: 0, enemiesKilled: 0, bossDamage: 0,
    },
    hits: {
      total: 0,
      byCause: { enemyBullet: 0, reflectedBullet: 0, body: 0, zone: 0 },
    },
    peaks: zeroPeaks(),
    peaksByStage: new Map<StageId, PeakMetrics>(),
    emptySpans: { lull: emptySpan(), bossDefeat: emptySpan(), unattributed: emptySpan() },
    playerYU: { minU: Number.POSITIVE_INFINITY, maxU: Number.NEGATIVE_INFINITY },
    maxHitstopPerSecSec: 0,
    simSec: 0,
  };
}

/** 발사체가 이번 스텝에 소멸 경계를 넘었는가. bullets.ts가 쓰는 것과 같은 여유 폭이다 */
function isOutsideField(xU: number, yU: number): boolean {
  const margin = PLAYFIELD.despawnMarginU;
  return (
    xU < -margin || xU > PLAYFIELD.widthU + margin ||
    yU < -margin || yU > PLAYFIELD.heightU + margin
  );
}

/** 보스 본체 + 파괴 가능 부위의 남은 HP 총합. 부위가 없는 보스는 본체 하나다 */
function bossTotalHp(world: World): number | null {
  const boss = world.boss;
  if (boss === null) {
    return null;
  }
  let total = boss.hp;
  for (const part of boss.parts) {
    total += part.hp;
  }
  return total;
}

export function createMetrics(bus: FeedbackBus): Metrics {
  const data = createData();
  const before = new Map<Projectile, ReflectSnapshot>();
  const current = new Map<Projectile, Projectile>();
  let previousBossHp: number | null = null;
  let spanCause: EmptySpanCause | null = null;
  let spanSec = 0;
  /** 이 스테이지가 적 탄환을 한 번이라도 낸 뒤인가. sim/step.ts의 StepGuards.armed와 같은 뜻이다 */
  let armed = false;
  /** 스테이지가 바뀌면 월드가 통째로 갈린다. 진입 공백을 스테이지마다 다시 건너뛰어야 한다 */
  let armedWorld: World | null = null;
  /** 직전 스텝이 지연 구간이었는가. 한 구간을 스텝 수만큼 세지 않기 위한 값이다 */
  let deferralPending = false;


  const offs: Unsubscribe[] = [
    bus.on('parry', (event) => {
      data.parry.attempts += 1;
      data.parry.successes += 1;
      data.parry.reflectedTotal += event.count;
      data.parry.maxSimultaneous = Math.max(data.parry.maxSimultaneous, event.count);
    }),
    bus.on('parryWhiff', () => {
      data.parry.attempts += 1;
      data.parry.empty += 1;
    }),
    // 발사 수는 사건이 아니라 풀에서 센다. 분열(R01·E01)·파편(R08)·교체(E02)가 만드는 반사탄은
    // 사건을 내지 않으므로, 사건으로 세면 그 카드를 든 판에서 분모만 작아져 명중률이 1을 넘는다
    bus.on('reflectLaunched', (event) => void (data.parry.grades[event.grade] += 1)),
    bus.on('reparry', (event) => {
      data.parry.reparries += 1;
      data.parry.reparryGrades[event.grade] += 1;
    }),
    bus.on('shieldBlocked', () => void (data.reflect.shieldBlocked += 1)),
    bus.on('enemyKilled', () => void (data.reflect.enemiesKilled += 1)),
    bus.on('playerHit', (event) => {
      data.hits.total += 1;
      data.hits.byCause[event.cause] += 1;
      if (event.cause === 'reflectedBullet') {
        data.reflect.hitPlayer += 1;
      }
    }),
  ];

  /**
   * 사라진 반사탄 하나를 넷 중 하나로 가른다. 스텝 전 상태로 판정하는 것은 소멸한 개체의
   * 현재 값이 이미 다음 주인의 것이거나 반납된 뒤의 값이기 때문이다.
   */
  function classifyGone(snapshot: ReflectSnapshot, dtSec: number): void {
    const reflect = data.reflect;
    if (snapshot.lifeRemainingSec - dtSec <= 0) {
      reflect.expiredByLifetime += 1;
      return;
    }
    const xU = snapshot.xU + snapshot.vxUPerSec * dtSec;
    const yU = snapshot.yU + snapshot.vyUPerSec * dtSec;
    if (isOutsideField(xU, yU)) {
      reflect.leftField += 1;
      return;
    }
    reflect.hitSomething += 1;
  }

  function trackReflectFates(world: World, dtSec: number): void {
    current.clear();
    for (const shot of world.reflectBullets.active) {
      current.set(shot, shot);
      const snapshot = before.get(shot);
      // 나이가 스텝 전보다 어리면 그 슬롯은 재사용된 것이고, 지금 들어 있는 것은 새 반사탄이다
      if (snapshot === undefined || shot.ageSec < snapshot.ageSec) {
        data.reflect.spawned += 1;
      }
    }
    for (const [shot, snapshot] of before) {
      const now = current.get(shot);
      if (now !== undefined && now.parriedSessionId === snapshot.sessionId) {
        continue;
      }
      // **같은 객체가 곧 같은 발사체는 아니다.** 반사탄 풀은 상한에 닿으면 가장 오래된 슬롯을
      // 회수해 새 반사탄에 내주므로, ID만 보면 그 교체가 재패리로 계수되고 원래 탄의 최후는
      // 아무 통에도 안 들어간다 — hitRate가 그 위에 서 있다. 나이가 이어졌는지가 유일한 증거다
      if (now !== undefined && now.ageSec >= snapshot.ageSec) {
        data.reflect.reparried += 1;
        continue;
      }
      classifyGone(snapshot, dtSec);
    }
  }

  function trackEmptySpan(world: World, dtSec: number): void {
    if (armedWorld !== world) {
      armedWorld = world;
      armed = false;
      spanCause = null;
      spanSec = 0;
    }
    if (world.enemyBullets.activeCount > 0) {
      armed = true;
      spanCause = null;
      spanSec = 0;
      return;
    }
    // 첫 탄이 나오기 전의 공백은 편성이 아니라 진입에 걸리는 시간 자체다. sim/step.ts의 가드가
    // 재는 시작점을 첫 탄으로 잡았으므로 여기도 같아야 두 표가 같은 것을 센다
    if (!armed) {
      return;
    }
    const cause: EmptySpanCause =
      world.boss?.mode === 'defeated' ? 'bossDefeat'
        : wavePhase(world) === 'lull' ? 'lull'
          : 'unattributed';
    const tally = data.emptySpans[cause];
    if (spanCause !== cause) {
      tally.spans += 1;
      spanSec = 0;
    }
    spanCause = cause;
    spanSec += dtSec;
    tally.simSec += dtSec;
    tally.worstSec = Math.max(tally.worstSec, spanSec);
  }

  /**
   * §9.7이 "신규 스폰이 지연되는 상황이 의도적으로 발생하는 유일한 구간"이라고 부른 그것.
   *
   * 상한에 닿은 것만으로는 지연이 아니다 — 아직 시각이 안 된 예약이 남아 있어도 같은 그림이
   * 나온다. 지연은 **나왔어야 하는 예약이 상한에 막혀 있는 것**이고, `hasDueSpawn`이 그 「나왔어야
   * 하는」을 판정한다. 세는 값은 스텝 수가 아니라 그런 구간의 수다.
   *
   * 상한이 풀리는 것을 기다려 사후 확인하지 않는다. 밀집 구간은 플레이어가 죽는 자리이기도 해서
   * 상한이 풀리기 전에 런이 끝나고, 그러면 실제로 일어난 지연이 한 건도 안 세어진다.
   */
  function trackSpawnDeferrals(world: World, stagePeaks: PeakMetrics): void {
    const full = world.enemies.activeCount >= PLAYFIELD.maxEnemies;
    const deferred = full && hasDueSpawn(world);
    if (deferred && !deferralPending) {
      data.peaks.enemySpawnDeferrals += 1;
      stagePeaks.enemySpawnDeferrals += 1;
    }
    deferralPending = deferred;
  }

  function peaksOfStage(stageId: StageId): PeakMetrics {
    let peaks = data.peaksByStage.get(stageId);
    if (peaks === undefined) {
      peaks = zeroPeaks();
      data.peaksByStage.set(stageId, peaks);
    }
    return peaks;
  }

  return {
    data,

    beforeStep(world: World): void {
      before.clear();
      for (const shot of world.reflectBullets.active) {
        before.set(shot, {
          sessionId: shot.parriedSessionId,
          xU: shot.xU,
          yU: shot.yU,
          vxUPerSec: shot.vxUPerSec,
          vyUPerSec: shot.vyUPerSec,
          lifeRemainingSec: shot.lifeRemainingSec,
          ageSec: shot.ageSec,
        });
      }
      previousBossHp = bossTotalHp(world);
    },

    afterStep(world: World, dtSec: number): void {
      data.simSec = world.simTimeSec;
      trackReflectFates(world, dtSec);

      const bossHp = bossTotalHp(world);
      if (previousBossHp !== null && bossHp !== null && bossHp < previousBossHp) {
        data.reflect.bossDamage += previousBossHp - bossHp;
      }

      const stagePeaks = peaksOfStage(world.stageId);
      for (const peaks of [data.peaks, stagePeaks]) {
        peaks.enemyBullets = Math.max(peaks.enemyBullets, world.enemyBullets.activeCount);
        peaks.reflects = Math.max(peaks.reflects, world.reflectBullets.activeCount);
        peaks.enemies = Math.max(peaks.enemies, world.enemies.activeCount);
        peaks.zones = Math.max(peaks.zones, world.zones.activeCount);
      }
      trackSpawnDeferrals(world, stagePeaks);
      trackEmptySpan(world, dtSec);

      const playerYU = data.playerYU;
      playerYU.minU = Math.min(playerYU.minU, world.player.yU);
      playerYU.maxU = Math.max(playerYU.maxU, world.player.yU);

      const usedSec = world.clock.budgetUsedSec(world.simTimeSec);
      data.maxHitstopPerSecSec = Math.max(data.maxHitstopPerSecSec, usedSec);
    },

    detach(): void {
      for (const off of offs) {
        off();
      }
      before.clear();
      current.clear();
    },
  };
}

/** §9.6 · §11.5 장판 동시 상한. 리포트가 판정에 쓰는 자리와 계측이 같은 소스를 봐야 한다 */
export const ZONE_CAP = ZONE.maxConcurrent;
