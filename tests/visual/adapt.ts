/**
 * 목업 상태 주입 어댑터 — 09 §5.2의 3번.
 *
 * **재시뮬레이션은 금지다.** 목업은 `dt = 1/60`으로 돌고(engine.js:2008) 게임은 D-04에 따라
 * `1/120`으로 돈다. 같은 시각까지 다시 돌리면 위치가 달라지고, 그 차이는 버그가 아니라 설계
 * 결정이다. 그래서 이 파일이 하는 일은 계산이 아니라 **옮겨 적기** 하나뿐이다 — `window.HWSTATE`가
 * 들고 있는 그 값 그대로를 게임 렌더러가 읽을 형태로 옮긴다. 어떤 필드도 다시 계산하지 않는다.
 *
 * 화면 흔들림 누산값(`trauma`)만 0으로 강제한다. 목업도 정지 프레임에서 같은 처리를 하고
 * (engine.js:2021) 그 값이 남아 있으면 프레임 전체가 밀린 채로 대조된다.
 */

/** engine.js `makeState`(1744-1751)가 만드는 상태의 형태. 함수 필드는 빼고 값만 적었다 */
export interface HwState {
  readonly t: number;
  readonly bullets: readonly HwBullet[];
  readonly enemies: readonly HwEnemy[];
  readonly zones: readonly HwZone[];
  readonly tele: readonly HwTelegraph[];
  readonly pops: readonly HwPopup[];
  readonly parts: readonly HwParticle[];
  readonly player: HwPlayer;
  readonly hitstop: number;
  readonly trauma: number;
  readonly kills: number;
  readonly scene: HwScene;
}

export interface HwBullet {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly owner: 'enemy' | 'reflect';
  readonly spin?: number;
  readonly reparry?: number;
  readonly age: number;
  readonly grace: number;
  readonly dmg?: number;
}

export interface HwEnemy {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxhp: number;
  readonly dead?: boolean;
  readonly flash?: number;
  readonly charge?: number;
  readonly shield?: number;
  readonly nobar?: boolean;
  readonly hitW?: number;
  readonly hitH?: number;
  readonly w?: number;
  readonly parts?: readonly HwEnemyPart[];
}

/** B3 포문처럼 개별 HP를 갖는 부위 (§15.1) */
export interface HwEnemyPart {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxhp: number;
}

export interface HwZone {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly age: number;
  readonly dur: number;
}

export interface HwTelegraph {
  readonly kind: 'circle' | 'lance' | 'dash';
  readonly x: number;
  readonly y?: number;
  readonly r?: number;
  readonly w?: number;
  readonly age: number;
  readonly dur: number;
}

export interface HwPopup {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly sub?: string;
  readonly color: string;
  readonly life: number;
  readonly max: number;
}

export interface HwParticle {
  readonly x: number;
  readonly y: number;
  readonly c: string;
  readonly life: number;
  readonly max: number;
}

export interface HwPlayer {
  readonly x: number;
  readonly y: number;
  readonly parryT: number;
  readonly cd: number;
  readonly inv: number;
}

export interface HwScene {
  readonly title: string;
  readonly stage: string;
  readonly at: number;
  readonly hud?: HwHud;
}

export interface HwHud {
  readonly life: number;
  readonly maxLife: number;
  readonly score: number;
  readonly combo: number;
  readonly stage: number;
  readonly wave?: string;
  readonly progress?: number;
  readonly boss?: {
    readonly name: string;
    readonly hp: number;
    readonly phase: number;
    readonly phases?: readonly number[];
  };
}

/**
 * 주입 payload. 목업의 한 프레임을 논리 단위(u)로 옮긴 것이며, 여기서부터는 목업 코드를
 * 모른다 — 게임 렌더러에 붙이는 일은 `renderer-binding.ts`가 혼자 한다.
 *
 * 필드 이름을 게임 쪽 규약(`xU` · `vxUPerSec`)으로 바꾼 것은 단위를 이름에 박아 두기 위해서다.
 * 목업의 `x`는 이미 논리 단위이므로 값은 그대로이고 이름만 바뀐다.
 */
export interface MockupFrame {
  /** 목업 런의 경과 시각 (초). 배경 애니메이션 위상이 이 값에 걸린다 */
  readonly timeSec: number;
  readonly stageKey: string;
  readonly title: string;
  readonly player: {
    readonly xU: number;
    readonly yU: number;
    readonly parryActiveRemainingSec: number;
    readonly cooldownRemainingSec: number;
    readonly invulnRemainingSec: number;
  };
  readonly bullets: readonly {
    readonly bulletType: string;
    readonly owner: 'enemy' | 'reflect';
    readonly xU: number;
    readonly yU: number;
    readonly vxUPerSec: number;
    readonly vyUPerSec: number;
    readonly spinRad: number;
    readonly reparryCount: number;
    readonly graceRemainingSec: number;
  }[];
  readonly enemies: readonly {
    readonly enemyType: string;
    readonly xU: number;
    readonly yU: number;
    readonly hp: number;
    readonly maxHp: number;
    readonly flash: number;
    readonly charge: number;
    readonly shieldCharges: number;
    readonly hideHpBar: boolean;
    readonly parts: readonly { readonly xU: number; readonly yU: number; readonly hp: number; readonly maxHp: number }[];
  }[];
  readonly zones: readonly { readonly xU: number; readonly yU: number; readonly radiusU: number; readonly ageSec: number; readonly durationSec: number }[];
  readonly telegraphs: readonly {
    readonly kind: 'circle' | 'lance' | 'dash';
    readonly xU: number;
    readonly yU: number;
    readonly radiusU: number;
    readonly widthU: number;
    readonly ageSec: number;
    readonly durationSec: number;
  }[];
  readonly popups: readonly {
    readonly xU: number;
    readonly yU: number;
    readonly text: string;
    readonly sub: string | null;
    readonly color: string;
    readonly lifeSec: number;
    readonly maxLifeSec: number;
  }[];
  readonly particles: readonly { readonly xU: number; readonly yU: number; readonly color: string; readonly lifeSec: number; readonly maxLifeSec: number }[];
  readonly hud: {
    readonly life: number;
    readonly maxLife: number;
    readonly score: number;
    readonly combo: number;
    readonly stage: number;
    readonly wave: string | null;
    readonly progress: number;
    readonly boss: {
      readonly name: string;
      readonly hpRatio: number;
      readonly phase: number;
      readonly phaseThresholds: readonly number[];
    } | null;
  };
  /**
   * 09 §5.2 — 정지 프레임에서 0으로 강제한다. 값을 버리지 않고 필드로 남기는 것은 목업이
   * 실제로 얼마를 들고 있었는지가 리포트에서 보여야 하기 때문이다.
   */
  readonly traumaAtCapture: number;
  readonly hitstopRemainingSec: number;
}

/** 목업이 값을 안 넣은 칸의 대체값. 목업 `drawEnemy`·`step`이 쓰는 `|| 0`과 같은 규약이다 */
function orZero(value: number | undefined): number {
  return value ?? 0;
}

/**
 * `window.HWSTATE`를 주입 payload로 옮긴다.
 *
 * `dead` 표시가 붙은 적은 여기서 뺀다 — 목업 `render`(engine.js:1947)가 `if (!e.dead)`로
 * 거르므로 그리지 않는 적을 넘기면 게임 쪽에만 시체가 생긴다.
 */
export function adaptMockupState(state: HwState): MockupFrame {
  const hud = state.scene.hud;
  return {
    timeSec: state.t,
    stageKey: state.scene.stage,
    title: state.scene.title,
    player: {
      xU: state.player.x,
      yU: state.player.y,
      parryActiveRemainingSec: state.player.parryT,
      cooldownRemainingSec: state.player.cd,
      invulnRemainingSec: state.player.inv,
    },
    bullets: state.bullets.map((b) => ({
      bulletType: b.type,
      owner: b.owner,
      xU: b.x,
      yU: b.y,
      vxUPerSec: b.vx,
      vyUPerSec: b.vy,
      spinRad: orZero(b.spin),
      reparryCount: orZero(b.reparry),
      graceRemainingSec: b.grace,
    })),
    enemies: state.enemies
      .filter((e) => e.dead !== true)
      .map((e) => ({
        enemyType: e.type,
        xU: e.x,
        yU: e.y,
        hp: e.hp,
        maxHp: e.maxhp,
        flash: orZero(e.flash),
        charge: orZero(e.charge),
        shieldCharges: orZero(e.shield),
        hideHpBar: e.nobar === true,
        parts: (e.parts ?? []).map((p) => ({ xU: p.x, yU: p.y, hp: p.hp, maxHp: p.maxhp })),
      })),
    zones: state.zones.map((z) => ({
      xU: z.x,
      yU: z.y,
      radiusU: z.r,
      ageSec: z.age,
      durationSec: z.dur,
    })),
    telegraphs: state.tele.map((g) => ({
      kind: g.kind,
      xU: g.x,
      yU: orZero(g.y),
      radiusU: orZero(g.r),
      widthU: orZero(g.w),
      ageSec: g.age,
      durationSec: g.dur,
    })),
    popups: state.pops.map((p) => ({
      xU: p.x,
      yU: p.y,
      text: p.text,
      sub: p.sub ?? null,
      color: p.color,
      lifeSec: p.life,
      maxLifeSec: p.max,
    })),
    particles: state.parts.map((p) => ({
      xU: p.x,
      yU: p.y,
      color: p.c,
      lifeSec: p.life,
      maxLifeSec: p.max,
    })),
    hud: {
      life: hud?.life ?? 0,
      maxLife: hud?.maxLife ?? 0,
      score: hud?.score ?? 0,
      combo: hud?.combo ?? 0,
      stage: hud?.stage ?? 0,
      wave: hud?.wave ?? null,
      progress: hud?.progress ?? 0,
      boss:
        hud?.boss === undefined
          ? null
          : {
              name: hud.boss.name,
              hpRatio: hud.boss.hp,
              phase: hud.boss.phase,
              phaseThresholds: hud.boss.phases ?? [],
            },
    },
    traumaAtCapture: state.trauma,
    hitstopRemainingSec: state.hitstop,
  };
}

/**
 * 목업 탄환 반경 표(engine.js:39-52의 `r`)를 읽는다. 재패리 라벨 마스크가 이 값을 쓴다.
 *
 * `config/bullets.ts`가 아니라 목업 쪽 값을 읽는 이유는, 마스크가 덮어야 하는 것이 **목업이
 * 그린 글자**이기 때문이다. 게임이 반경을 바꾸면 그건 대조로 잡혀야 할 차이이지 마스크가
 * 따라가야 할 값이 아니다.
 */
export function reparryLabelAnchors(
  state: HwState,
  bulletRadiusU: (type: string) => number,
): readonly { xU: number; yU: number; radiusU: number }[] {
  return state.bullets
    .filter((b) => orZero(b.reparry) > 0)
    .map((b) => ({ xU: b.x, yU: b.y, radiusU: bulletRadiusU(b.type) }));
}
