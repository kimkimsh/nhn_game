/**
 * 임팩트 프레임 · 집중선 · 화면 플래시 · 등급 팝업
 * (06_렌더링과_게임필.md §4.5 · §4.6 · §5.5 · §5.7, 12_통합_계약.md §7.1)
 *
 * 이식: docs/sample_image/_shared/engine.js 팝업 갱신 (1913-1916) · 팝업 그리기 (1958-1973).
 * 나머지 넷은 목업에 대응하는 그림이 없는 신규 표시다.
 *
 * **등급 팝업이 여기 있는 이유.** 08_화면과_UI.md §2.4가 배정했다 — HUD가 아니라 패리가 일어난
 * 월드 좌표에 뜨고, §5.7의 재패리 계단이 그 팝업 옆에만 그려지므로 둘이 갈리면 자리를 맞출
 * 방법이 없다. particles.ts가 갖는 팝업은 연쇄가 세는 `×N` 하나다.
 *
 * **레이어.** 임팩트 프레임만 자리가 계약이다 — **6층(탄환)과 7층(플레이어) 사이**(12 §7.1).
 * 최상단에 두면 §15.1이 상시 표시로 못 박은 10u 코어가 0.033초 사라지고, 히트스톱은 0.075초에
 * 끝나 sim이 이미 도는 그 사이에 S5 조총탄이 34u를 간다 — GREAT 밴드 전체(28u)보다 넓다. 여기
 * 두면 잔상 기제(고대비 전면 전환)는 그대로 얻고 코어·패리 원·쿨다운 링이 흰 화면 위에 청색으로
 * 남는다. 나머지 셋은 06 §2에 행이 없어 `render/frame.ts`가 자리를 정한다. **넷 다 흔들림 변위
 * 안쪽에서 그리므로** 전면 채움이 화면보다 넓다(OVERFILL_U). `prefers-reduced-motion`은 인자가
 * 아니라 setter로 받는다(12 §3) — OS 설정은 런 도중에도 바뀌고, 기본값이 「감소 요청 없음」이라
 * boot/platform-guard.ts가 없어도 막히지 않는다.
 */

import { IMPACT_FRAME, SHAKE, SPEED_LINES } from '../config/feel';
import { PALETTE } from '../config/palette';
import { PARRY_BANDS } from '../config/parry';
import { PLAYFIELD } from '../config/playfield';
import { FONTS } from '../config/ui';
import type { FeedbackBus, ParryGrade, PlayerHitCause, Unsubscribe } from '../core/bus';
import { clamp01, easeOutBack, easeOutCubic } from '../core/math';
import { createPool } from '../core/pool';
import type { Rng } from '../core/rng';

const FULL_TURN_RAD = Math.PI * 2;
const DEGREES_PER_HALF_TURN = 180;
/** 전면 채움의 여유 (u) — 흔들린 만큼 가장자리가 드러나면 안 된다. 회전 몫은 대각선 절반 × sin(최대각) */
const OVERFILL_U =
  SHAKE.maxOffsetU +
  (Math.hypot(PLAYFIELD.widthU, PLAYFIELD.heightU) / 2) *
    Math.sin((SHAKE.maxRotationDeg * Math.PI) / DEGREES_PER_HALF_TURN);
/** alphaLow 한 프레임의 길이 (초). §4.5의 「2프레임 → 1프레임」을 프레임 수로 세면 HR-06 위반이다 */
const IMPACT_LOW_SEC = IMPACT_FRAME.durationSec / 2;
/** 한 다발이 담는 선 수. 세 발동 조건 중 가장 큰 것에 맞춘다 */
const SPEED_LINE_MAX_COUNT = Math.max(
  SPEED_LINES.parryGreat.count, SPEED_LINES.chainStart.count, SPEED_LINES.bossPhase.count,
);
/** 동시 다발. §3.5의 「1~2」는 GREAT 40선과 직전 패리의 연쇄 60선이 겹치는 프레임이고 셋째가 보스 전환이다 */
const SPEED_LINE_BURST_CAPACITY = 3;
/**
 * 첫 처치 좌표를 기억해 두는 칸 수. **연쇄임이 확정되는 것은 두 번째 처치가 도착하는 순간이다** —
 * 첫 처치에 붙이면 단발 처치마다 60선이 떠서 §4.6이 신호의 전부라 적은 희소성이 사라진다.
 */
const CHAIN_FIRST_KILL_SLOTS = 8;

/**
 * §5.5 피격 플래시(색은 원인이 정한다 — 적 탄환 적 / 반사탄 황)와 등급 팝업(engine.js:1805 ·
 * 1959-1973). **config/feel.ts에 플래시 칸이, config/ui.ts에 팝업 블록이 생기면 옮긴다** —
 * 연출 강도와 좌표의 단일 소스가 그 둘이다(08 §9 · 12 §3).
 */
const FLASH_ALPHA = 0.22;
const FLASH_SEC = 0.1;
const POPUP_OFFSET_Y_U = -158;
const POPUP_LIFE_SEC = 0.85;
const POPUP_RISE_U = 46;
const POPUP_PX_BASE = 40;
const POPUP_PX_GROW = 12;
const POPUP_SUB_PX = 22;
const POPUP_SUB_OFFSET_Y_U = 30;
/** alpha = 남은 수명 비율 × 이 값. 1을 넘겨야 앞쪽이 불투명하게 유지된다 (engine.js:1961) */
const POPUP_FADE_GAIN = 1.6;

/** §5.4 빈 패리. 목업 그대로다 (engine.js:1808) — 수명만 등급 팝업보다 짧다 */
const WHIFF_LIFE_SEC = 0.55;
const WHIFF_TEXT = '헛침';
const WHIFF_SUB = '무적 없음';

/**
 * §4.7 · §4.8 등장 연출 — 목업에 없던 것이다(목업 팝업은 글자가 52px → 40px로 줄 뿐 등장
 * 순간이 없다). 원점은 팝업 하단이고, 베이스라인이 y=0이라 원점이 그대로 하단이다.
 */
const POPUP_ENTER_SEC = 0.15;
const POPUP_ENTER_SCALE_X = 1.12;
const POPUP_ENTER_SCALE_Y = 0.9;

/**
 * §5.7 재패리 등급 상승 계단. 문서가 고정한 것은 칸 높이 14u/단 · 방향 화살표 · 색(상승 황 /
 * 하락 회) · 지속 0.85초 넷이다. 폭·간격·팝업으로부터의 거리는 어느 문서도 정하지 않아 여기서
 * 고른다 — 기준은 등급 팝업 글자(40~52px)와 나란히 놓았을 때 서로를 안 가리는 것이다.
 */
const LADDER_STEP_U = 14;
const LADDER_BAR_WIDTH_U = 22;
const LADDER_BAR_GAP_U = 26;
const LADDER_OFFSET_X_U = 120;
const LADDER_ARROW_HALF_U = 9;
const LADDER_ARROW_LENGTH_U = 22;
const LADDER_MUL_PX = 20;
const LADDER_MUL_OFFSET_Y_U = 26;

/** §5.3 등급색. 결과 화면의 등급 막대도 같은 셋을 쓴다(08 §5.4) */
const GRADE_COLOR: Record<ParryGrade, string> = { GREAT: PALETTE.hwang, GOOD: PALETTE.cheong, NOT_BAD: PALETTE.baek };
/** 화면에 찍히는 이름. 밑줄은 식별자 표기라 목업(engine.js:35)은 빈칸으로 적었다 */
const GRADE_TEXT: Record<ParryGrade, string> = { GREAT: 'GREAT', GOOD: 'GOOD', NOT_BAD: 'NOT BAD' };
/** §5.7 계단 수 — NOT BAD 1단 / GOOD 2단 / GREAT 3단. 밴드 배열이 좁은 것부터라 뒤집는다 */
const GRADE_RANK: Record<ParryGrade, number> = { GREAT: PARRY_BANDS.length, GOOD: PARRY_BANDS.length - 1, NOT_BAD: PARRY_BANDS.length - 2 };
/** §7.2 실효 데미지 배수. 계단 아래 `×1.0 → ×3.5`가 이 표에서 나온다 */
const GRADE_DAMAGE_MUL: Record<ParryGrade, number> =
  { GREAT: PARRY_BANDS[0].damageMul, GOOD: PARRY_BANDS[1].damageMul, NOT_BAD: PARRY_BANDS[2].damageMul };

interface SpeedLineBurst {
  xU: number; yU: number; count: number; ageSec: number; durationSec: number;
  /** 발동마다 새로 뽑는다. 다발의 선 수가 최대치보다 적으면 앞쪽만 쓴다 */
  readonly angleRad: Float64Array; readonly widthU: Float64Array;
}

/** 어느 패리의 첫 처치가 어디였는지. 둘째가 오는 순간에만 읽힌다 */
interface FirstKill {
  parrySeq: number; xU: number; yU: number;
}

export interface ImpactLayerDeps {
  readonly bus: FeedbackBus;
  /** render 전용 스트림 (D-05). 집중선의 각도 지터와 선폭이 여기서 나온다 */
  readonly rng: Rng;
}

export interface ImpactLayer {
  /** 실시간 dt다. 히트스톱 중에도 집중선은 살아 있다 (§4.1 · §6.4) */
  update(realDtSec: number): void;
  /** **레이어 6.5** — 탄환 위, 플레이어 아래 (12 §7.1). 이 자리는 계약이다 */
  drawImpactFrame(ctx: CanvasRenderingContext2D): void;
  /** 파티클 위. 수렴점 안쪽이 비어야 시선이 그리로 간다 (§4.6) */
  drawSpeedLines(ctx: CanvasRenderingContext2D): void;
  /** §5.5 피격 원인이 색으로 읽힌다. 형태 축(280u 링·수렴 화살)은 render/player.ts가 그린다 */
  drawScreenFlash(ctx: CanvasRenderingContext2D): void;
  /** 레이어 9 — 등급 팝업과 재패리 계단. 월드 안의 무엇에도 가리면 안 된다 (§2) */
  drawPopups(ctx: CanvasRenderingContext2D): void;
  /** OS의 `prefers-reduced-motion`. 참이면 임팩트 프레임을 끈다 (§4.2) */
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

function isBurstDone(item: SpeedLineBurst): boolean {
  return item.ageSec >= item.durationSec;
}

export function createImpactLayer(deps: ImpactLayerDeps): ImpactLayer {
  const rng = deps.rng;
  const bursts = createPool<SpeedLineBurst>({
    capacity: SPEED_LINE_BURST_CAPACITY,
    create: () => ({
      xU: 0, yU: 0, count: 0, ageSec: 0, durationSec: 0,
      angleRad: new Float64Array(SPEED_LINE_MAX_COUNT),
      widthU: new Float64Array(SPEED_LINE_MAX_COUNT),
    }),
    reset: (item) => {
      item.ageSec = 0;
      item.count = 0;
    },
  });

  const firstKills: FirstKill[] = [];
  for (let i = 0; i < CHAIN_FIRST_KILL_SLOTS; i += 1) {
    firstKills.push({ parrySeq: -1, xU: 0, yU: 0 });
  }
  let firstKillCursor = 0;
  let nowSec = 0;
  let reducedMotion = false;
  /** impactStartSec이 음수면 예정된 임팩트 프레임이 없다 */
  let impactStartSec = -1;
  let lastImpactSec = Number.NEGATIVE_INFINITY;
  let flashColor: string = PALETTE.jeok;
  let flashAgeSec = FLASH_SEC;
  let popupText = '', popupSub = '', popupColor: string = PALETTE.baek;
  let popupXU = 0, popupYU = 0, popupLifeSec = 0, popupMaxSec = POPUP_LIFE_SEC;
  let ladderFrom: ParryGrade = 'NOT_BAD', ladderTo: ParryGrade = 'NOT_BAD', ladderLifeSec = 0;
  const subscriptions: Unsubscribe[] = [];

  function spawnSpeedLines(xU: number, yU: number, count: number, durationSec: number): void {
    const burst = bursts.acquireRecyclingOldest();
    burst.xU = xU;
    burst.yU = yU;
    burst.count = count;
    burst.durationSec = durationSec;
    for (let i = 0; i < count; i += 1) {
      // 파티클과 같은 균등 링 + 지터다 (§4.6). 순수 난수 각도는 뭉치고 빈틈을 남긴다
      burst.angleRad[i] = (FULL_TURN_RAD * i) / count + rng.float() * SPEED_LINES.angleJitterRad;
      burst.widthU[i] = SPEED_LINES.widthBaseU + rng.float() * SPEED_LINES.widthRandU;
    }
  }

  /** 한 번에 하나다. 쿨다운 0.24초에서 두 개가 뜨면 겹친다 (engine.js:1799) */
  function showPopup(xU: number, yU: number, text: string, sub: string, color: string, lifeSec: number): void {
    popupXU = xU;
    popupYU = yU + POPUP_OFFSET_Y_U;
    popupText = text;
    popupSub = sub;
    popupColor = color;
    popupLifeSec = lifeSec;
    popupMaxSec = lifeSec;
  }

  function onParry(event: { grade: ParryGrade; count: number; xU: number; yU: number }): void {
    // 여기 `×N`은 목업 그대로 이번에 쳐낸 **발사체** 수다. 처치 수를 세는 §6.2의 `×N`은 다른
    // 표시이고 particles.ts가 마지막 처치 위치에 그린다
    const sub = event.count > 1 ? `×${event.count}` : '';
    showPopup(event.xU, event.yU, GRADE_TEXT[event.grade], sub, GRADE_COLOR[event.grade], POPUP_LIFE_SEC);
    if (event.grade !== 'GREAT') {
      return;
    }
    spawnSpeedLines(event.xU, event.yU, SPEED_LINES.parryGreat.count, SPEED_LINES.parryGreat.durationSec);
    // 광과민성 방어선 (§4.5). GREAT는 초당 4.16회까지 가능하고 전면 백색이 그 속도로 깜빡이면
    // 신호가 아니라 위험이다. 간격을 못 지키면 이번 것을 버린다
    if (!reducedMotion && nowSec - lastImpactSec >= IMPACT_FRAME.minGapSec) {
      impactStartSec = nowSec + IMPACT_FRAME.delayAfterParrySec;
      lastImpactSec = nowSec;
    }
  }

  function onEnemyKilled(event: { parrySeq: number; chainIndex: number; xU: number; yU: number }): void {
    if (event.chainIndex === 0) {
      const slot = firstKills[firstKillCursor]!;
      slot.parrySeq = event.parrySeq;
      slot.xU = event.xU;
      slot.yU = event.yU;
      firstKillCursor = (firstKillCursor + 1) % CHAIN_FIRST_KILL_SLOTS;
      return;
    }
    if (event.chainIndex !== 1) {
      return;
    }
    for (let i = 0; i < firstKills.length; i += 1) {
      const slot = firstKills[i]!;
      if (slot.parrySeq === event.parrySeq) {
        spawnSpeedLines(slot.xU, slot.yU, SPEED_LINES.chainStart.count, SPEED_LINES.chainStart.durationSec);
        return;
      }
    }
  }

  subscriptions.push(deps.bus.on('parry', onParry));
  subscriptions.push(deps.bus.on('enemyKilled', onEnemyKilled));
  subscriptions.push(deps.bus.on('parryWhiff', (event) => {
    // 계단은 등급 팝업과 수명이 같아 어긋나지 않지만 헛침은 0.55초로 짧다. 안 지우면 쿨다운
    // 0.24초 뒤의 헛침 옆에 직전 재패리의 「×1.0 → ×3.5」가 다른 높이로 떠서, 아무것도 안 한
    // 패리에 데미지 상승 표시가 붙는다
    ladderLifeSec = 0;
    showPopup(event.xU, event.yU, WHIFF_TEXT, WHIFF_SUB, PALETTE.baekFaint, WHIFF_LIFE_SEC);
  }));
  subscriptions.push(deps.bus.on('reparry', (event) => {
    ladderFrom = event.prevGrade;
    ladderTo = event.grade;
    ladderLifeSec = POPUP_LIFE_SEC;
  }));
  subscriptions.push(deps.bus.on('bossPhase', (event) => {
    spawnSpeedLines(event.xU, event.yU, SPEED_LINES.bossPhase.count, SPEED_LINES.bossPhase.durationSec);
  }));
  // §5.5 반사탄에 맞은 것만 황이다 — 그때만 아무것도 안 지워졌기 때문이다
  subscriptions.push(deps.bus.on('playerHit', (event: { cause: PlayerHitCause }) => {
    flashColor = event.cause === 'reflectedBullet' ? PALETTE.hwang : PALETTE.jeok;
    flashAgeSec = 0;
  }));

  /** 전면 채움 한 번. 임팩트 프레임과 플래시가 같은 사각형을 쓴다 */
  function fillScreen(ctx: CanvasRenderingContext2D, color: string, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(-OVERFILL_U, -OVERFILL_U, PLAYFIELD.widthU + OVERFILL_U * 2, PLAYFIELD.heightU + OVERFILL_U * 2);
    ctx.restore();
  }

  /**
   * §5.7 계단 두 칸 — 왼쪽이 직전 등급, 오른쪽이 이번 등급이고 사이에 방향 화살표가 선다.
   * 등급 팝업이 살아 있을 때만 그린다: 자리가 「등급 팝업 우측」이라 팝업이 없으면 기준점이
   * 없다(수명이 같아 어긋나지 않는다). 하락 시 배수를 안 적는 것은 실패를 강조할 이유가 없어서다.
   */
  function drawLadder(ctx: CanvasRenderingContext2D): void {
    const rose = GRADE_RANK[ladderTo] > GRADE_RANK[ladderFrom];
    const remain = ladderLifeSec / POPUP_LIFE_SEC;
    ctx.save();
    ctx.globalAlpha = clamp01(remain * POPUP_FADE_GAIN);
    ctx.translate(popupXU + LADDER_OFFSET_X_U, popupYU - easeOutCubic(1 - remain) * POPUP_RISE_U);
    ctx.fillStyle = rose ? PALETTE.hwang : PALETTE.baekFaint;
    ctx.fillRect(0, -GRADE_RANK[ladderFrom] * LADDER_STEP_U, LADDER_BAR_WIDTH_U, GRADE_RANK[ladderFrom] * LADDER_STEP_U);
    ctx.fillRect(LADDER_BAR_GAP_U, -GRADE_RANK[ladderTo] * LADDER_STEP_U, LADDER_BAR_WIDTH_U, GRADE_RANK[ladderTo] * LADDER_STEP_U);

    const arrowXU = (LADDER_BAR_WIDTH_U + LADDER_BAR_GAP_U) / 2;
    const tipYU = rose ? -LADDER_ARROW_LENGTH_U : LADDER_ARROW_LENGTH_U;
    ctx.beginPath();
    ctx.moveTo(arrowXU, tipYU);
    ctx.lineTo(arrowXU - LADDER_ARROW_HALF_U, tipYU / 2);
    ctx.lineTo(arrowXU + LADDER_ARROW_HALF_U, tipYU / 2);
    ctx.closePath();
    ctx.fill();

    if (rose) {
      ctx.textAlign = 'center';
      ctx.font = `600 ${LADDER_MUL_PX}px ${FONTS.data}`;
      ctx.fillText(
        `×${GRADE_DAMAGE_MUL[ladderFrom].toFixed(1)} → ×${GRADE_DAMAGE_MUL[ladderTo].toFixed(1)}`,
        arrowXU,
        LADDER_MUL_OFFSET_Y_U,
      );
    }
    ctx.restore();
  }

  return {
    update(realDtSec: number): void {
      nowSec += realDtSec;
      const active = bursts.active;
      for (let i = 0; i < active.length; i += 1) {
        active[i]!.ageSec += realDtSec;
      }
      bursts.releaseWhere(isBurstDone);
      flashAgeSec = Math.min(flashAgeSec + realDtSec, FLASH_SEC);
      popupLifeSec = Math.max(popupLifeSec - realDtSec, 0);
      ladderLifeSec = Math.max(ladderLifeSec - realDtSec, 0);
    },

    drawImpactFrame(ctx: CanvasRenderingContext2D): void {
      if (reducedMotion || impactStartSec < 0 || nowSec < impactStartSec) {
        return;
      }
      const elapsedSec = nowSec - impactStartSec;
      if (elapsedSec < IMPACT_FRAME.durationSec) {
        fillScreen(ctx, PALETTE.baek, IMPACT_FRAME.alphaHigh);
      } else if (elapsedSec < IMPACT_FRAME.durationSec + IMPACT_LOW_SEC) {
        fillScreen(ctx, PALETTE.baek, IMPACT_FRAME.alphaLow);
      } else {
        impactStartSec = -1;
      }
    },

    drawSpeedLines(ctx: CanvasRenderingContext2D): void {
      const active = bursts.active;
      if (active.length === 0) {
        return;
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = PALETTE.baek;
      for (let i = 0; i < active.length; i += 1) {
        const burst = active[i]!;
        ctx.globalAlpha = SPEED_LINES.alpha * (1 - easeOutCubic(clamp01(burst.ageSec / burst.durationSec)));
        for (let line = 0; line < burst.count; line += 1) {
          const cos = Math.cos(burst.angleRad[line]!);
          const sin = Math.sin(burst.angleRad[line]!);
          ctx.lineWidth = burst.widthU[line]!;
          ctx.beginPath();
          ctx.moveTo(burst.xU + cos * SPEED_LINES.startRadiusU, burst.yU + sin * SPEED_LINES.startRadiusU);
          ctx.lineTo(burst.xU + cos * SPEED_LINES.endRadiusU, burst.yU + sin * SPEED_LINES.endRadiusU);
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    drawScreenFlash(ctx: CanvasRenderingContext2D): void {
      if (flashAgeSec >= FLASH_SEC) {
        return;
      }
      fillScreen(ctx, flashColor, FLASH_ALPHA * (1 - easeOutCubic(flashAgeSec / FLASH_SEC)));
    },

    /** 이식: engine.js 팝업 그리기 (1958-1973) — §4.7·§4.8의 등장 변형만 얹었다 */
    drawPopups(ctx: CanvasRenderingContext2D): void {
      if (popupLifeSec <= 0) {
        return;
      }
      const remain = popupLifeSec / popupMaxSec;
      const entered = easeOutBack(clamp01((popupMaxSec - popupLifeSec) / POPUP_ENTER_SEC));
      ctx.save();
      ctx.globalAlpha = clamp01(remain * POPUP_FADE_GAIN);
      ctx.translate(popupXU, popupYU - easeOutCubic(1 - remain) * POPUP_RISE_U);
      ctx.scale(
        POPUP_ENTER_SCALE_X + (1 - POPUP_ENTER_SCALE_X) * entered,
        POPUP_ENTER_SCALE_Y + (1 - POPUP_ENTER_SCALE_Y) * entered,
      );
      ctx.textAlign = 'center';
      ctx.fillStyle = popupColor;
      ctx.font = `700 ${POPUP_PX_BASE + remain * POPUP_PX_GROW}px ${FONTS.data}`;
      ctx.fillText(popupText, 0, 0);
      if (popupSub !== '') {
        ctx.font = `500 ${POPUP_SUB_PX}px ${FONTS.body}`;
        ctx.fillStyle = PALETTE.baekMute;
        ctx.fillText(popupSub, 0, POPUP_SUB_OFFSET_Y_U);
      }
      ctx.restore();
      if (ladderLifeSec > 0) {
        drawLadder(ctx);
      }
    },

    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },

    dispose(): void {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      subscriptions.length = 0;
    },
  };
}
