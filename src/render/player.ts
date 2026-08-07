/**
 * 플레이어 — 갑주·패리 원·쿨다운 링·무적 링·10u 코어 (06_렌더링과_게임필.md §1.7 · 08_화면과_UI.md §2.4)
 *
 * 목업 drawPlayer(engine.js:844-1022) 하나가 이 파일의 drawPlayer 하나에 대응한다. 갑주·투구·
 * 환도·코어는 그대로이고, 06 §1.7이 "수정"으로 판정한 세 블록(패리 원·쿨다운 링·무적 링)과
 * 목업에 없던 피격 연출만 다르다. 그 넷은 각자 자기 함수에 근거를 달고 있다.
 *
 * 그리는 순서와 줄 묶음을 목업 그대로 둔다 — 겹치는 순서 자체가 승인된 그림이고, 줄이 갈리면
 * 원본과의 대조가 끊긴다. 실루엣 제어점(-26, 74, 0.42 …)에 이름을 주지 않는 것도 같은 이유다
 * (03 §2.3, enemy-parts.ts와 같은 규칙). 규칙을 나르는 값 — 반경·지속·겹 수 — 만 이름을 갖는다.
 *
 * 표시가 곧 판정이다. 패리 원은 실효 패리 반경, 코어는 10u, 소멸 링은 §4.2 2단계의 280u다.
 * 카드가 반경을 키우면 그림도 같이 커져야 §17이 유지되므로 config 기본값이 아니라 PlayerView가
 * 실어 온 실효값으로 그린다.
 *
 * **§3.1 이동 영역 클램프는 여기 없다.** 받은 좌표에 그릴 뿐이고 클램프는 sim/player.ts가 갖는다.
 * 타이틀 데모 플레이어는 y = 545 ± 55로 [620, 1830] 밖인데, 조작되지 않는 화면이라 목업 구도가
 * 이긴다(10 A12 · 12 §8-7). 버그가 아니라 승인된 예외이므로 여기에 클램프를 넣지 않는다.
 */

import { PALETTE } from '../config/palette';
import { PARRY, PARRY_BANDS } from '../config/parry';
import { PLAYER } from '../config/player';
import { UI } from '../config/ui';
import type { FeedbackEvent, ParryGrade, PlayerHitCause } from '../core/bus';
import { clamp01, easeOutCubic, lerp } from '../core/math';
import { glow, hexA, poly } from './primitives';

const HUD = UI.playerHud;

/** 목업은 원을 6.284로 닫는다(engine.js:853 등). 2π로 적어도 같은 원이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;
/** 쿨다운 링과 무적 원호가 12시에서 출발한다 (engine.js:862) */
const RING_START_RAD = -Math.PI / 2;

/** 패리 원 (engine.js:851-854). 08 §2.4가 이 식을 그대로 표로 옮겼다 */
const PARRY_RING_ALPHA_MAX = 0.85;
const PARRY_RING_ALPHA_DROP = 0.5;
const PARRY_RING_STROKE_U = 4;
const PARRY_RING_STROKE_GAIN_U = 5;
const PARRY_GLOW_SCALE = 1.7;
const PARRY_GLOW_ALPHA = 0.35;

/** 06 §5.6 해소 링. 활성 창과 같은 0.15초를 써서 두 그림이 같은 박자로 이어지게 한다 */
const RESOLVE_SEC = PARRY.activeSec;
/** 겹 사이 위상차. 세 겹이 한 겹처럼 겹치는 것을 막는다 */
const RESOLVE_RING_LAG = 0.16;
/** 빈 패리 링의 도달 배율. 패리 반경 밖으로 나가야 "여기 아무것도 없었다"가 읽힌다 [판단] */
const WHIFF_RING_SCALE_END = 1.5;

/**
 * 무적 링 (06 §5.9). 08 §2.4가 패리 무적을 `62 → 50` 수축으로 못 박았는데 UI.playerHud에는 시작
 * 반경 칸만 있다. 끝 반경이 쿨다운 링과 같은 50u인 것은 우연이 아니다 — 무적이 끝나는 순간 링이
 * 쿨다운 링 자리에 도착해 두 표시가 같은 자리에서 교대한다. 회전 26 u/s만 [판단]이고, 점선 주기
 * 16u에서 1.6회/초라 회전으로는 읽히되 명멸은 되지 않는다.
 */
const PARRY_INVULN_END_RU = 50;
const HIT_INVULN_OUTER_RU = 70;
const HIT_INVULN_OUTER_STROKE_U = 1.8;
const HIT_INVULN_DASH_SPEED_U_PER_SEC = 26;

/**
 * 피격 소멸 링 — §4.2 2단계. 반경은 PLAYER.hitClearRadiusU 그대로이고 이 링이 곧 방금 지워진
 * 범위다. ease-out이라 가시 구간 대부분을 280u 근처에서 보낸다 — 확장 중의 작은 반경이 오래
 * 남으면 §17의 "표시 범위 = 판정 범위"가 그 시간만큼 거짓말이 된다. 지속·선폭·알파는 [판단].
 */
const DISPEL_RING_SEC = 0.25;
const DISPEL_RING_STROKE_U = 4;
const DISPEL_RING_ALPHA = 0.8;

/** 반사탄 자해 수렴 화살 (06 §5.5). 지속 0.20초만 그 문서의 값이고 나머지 기하는 [판단]이다 */
const ARROW_SEC = 0.2;
const ARROW_COUNT = 3;
const ARROW_SPREAD_RAD = 0.34;
const ARROW_START_RU = 150;
const ARROW_SHAFT_U = 46;
const ARROW_BARB_U = 14;
const ARROW_BARB_RAD = 0.5;
const ARROW_STROKE_U = 3.5;

/** 상모 세 가닥의 각도 (engine.js:967) */
const PLUME_ANGLES = [-0.42, 0, 0.42] as const;

/**
 * 갑주 안쪽의 검정. 목업은 `#0c1620`(상갑 894) · `#0d1720`(두정갑 911 · 투구 941) ·
 * `rgba(4,6,10,0.8)`(코어 원반 1013)을 직접 적었는데 render/에 색 리터럴을 둘 수 없어 토큰으로
 * 읽는다. 채널 차는 상갑 (6,0,-1) · 두정갑 (5,-1,-1) · 코어 (2,1,0)이고, 셋 다 청색 선 안쪽을
 * 바탕 계열 검정으로 눌러 형태만 남기는 자리라 계열이 맞는 토큰이다.
 */
const ARMOUR_DARK = PALETTE.ink700;
const CORE_SHADE_FILL = hexA(PALETTE.ink900, 0.8);

/** setLineDash는 mutable number[]만 받는다. 인자를 복사해 가므로 두 벌을 모듈에서 돌려 쓴다 */
const INVULN_DASH: number[] = [...HUD.invulnDashU];
const NO_DASH: number[] = [];

/**
 * 남은 시간과 총 길이 (초). 비율만 받으면 무적 원호가 "남은 시간"이 아니라 "남은 비율"이 되어,
 * 카드가 길이를 바꾼 빌드에서 같은 그림이 다른 뜻을 갖는다(§11.6).
 */
export interface FxTimer {
  readonly remainSec: number;
  readonly totalSec: number;
}

/**
 * render가 sim에서 읽는 값 전부. 프레임 층이 World에서 만들어 넘긴다 — 이 파일은 sim의 어떤
 * 객체도 잡고 있지 않으므로 상태를 바꿀 경로 자체가 없다(HR-06).
 */
export interface PlayerView {
  readonly xU: number;
  readonly yU: number;
  /** §5.1 실효 패리 반경 (u). 표시가 판정과 같아야 하므로 기본 70u가 아니다 */
  readonly parryRadiusU: number;
  /** §5.1 활성 창. remainSec이 0이면 창이 닫혀 있다 */
  readonly parryActive: FxTimer;
  /** §5.1 쿨다운. totalSec은 실효 쿨다운이고 링 알파가 그 값과 기본값의 비다 (08 §2.4) */
  readonly cooldown: FxTimer;
  /** §5.1 패리 무적 0.14초 */
  readonly parryInvuln: FxTimer;
  /** §4.2 피격 무적 1.5초 */
  readonly hitInvuln: FxTimer;
}

/** 패리가 결판난 방식. 창이 열려 있는 동안에는 아직 이 값이 없다 */
interface ParryResolveFx {
  readonly ringCount: number;
  readonly isWhiff: boolean;
  ageSec: number;
}

interface HitFx {
  readonly cause: PlayerHitCause;
  /** 맞힌 발사체의 진행 방향(단위 벡터). 화살은 이 반대편에서 온다 */
  readonly dirX: number;
  readonly dirY: number;
  ageSec: number;
}

/**
 * 사건으로만 알 수 있는 것을 담는 render 전용 상태. sim에는 "패리가 성공으로 끝났다"나 "쿨다운이
 * 방금 완성됐다"가 남지 않는다 — 다음 스텝이면 지워지는 순간이기 때문이다. 전부 연출 시계라
 * realDt로 늙고, 이 안의 어떤 값도 판정으로 되돌아가지 않는다.
 */
export interface PlayerFxState {
  /** 무적 점선이 도는 기준 시각 (초, realDt 누적) */
  elapsedSec: number;
  parryResolve: ParryResolveFx | null;
  /** 쿨다운 링이 한 바퀴를 채운 뒤의 확장 경과 (초). null이면 확장 중이 아니다 */
  cooldownEndAgeSec: number | null;
  hit: HitFx | null;
}

export function createPlayerFx(): PlayerFxState {
  return { elapsedSec: 0, parryResolve: null, cooldownEndAgeSec: null, hit: null };
}

/**
 * 06 §5.6 · 12 §8-2의 겹 수. 밴드 배열이 좁은 것부터 나열되어 있으므로(§5.3) 뒤에서 센 순위가
 * 그대로 겹 수다 — GREAT 3, GOOD 2, NOT BAD 1. 표를 따로 두면 밴드가 늘 때 어긋난다.
 */
function ringCountFor(grade: ParryGrade): number {
  const index = PARRY_BANDS.findIndex((band) => band.id === grade);
  return index < 0 ? 1 : PARRY_BANDS.length - index;
}

/**
 * 프레임 층이 버스에서 받은 사건을 그대로 넘긴다. 관심 없는 kind는 조용히 지나간다 — 걸러야 할
 * 목록을 호출부가 알면 그 목록이 두 곳에 살게 된다.
 */
export function notifyPlayerFx(fx: PlayerFxState, event: FeedbackEvent): void {
  if (event.kind === 'parry') {
    fx.parryResolve = { ringCount: ringCountFor(event.grade), isWhiff: false, ageSec: 0 };
  } else if (event.kind === 'parryWhiff') {
    fx.parryResolve = { ringCount: 1, isWhiff: true, ageSec: 0 };
  } else if (event.kind === 'cooldownReady') {
    fx.cooldownEndAgeSec = 0;
  } else if (event.kind === 'playerHit') {
    fx.hit = { cause: event.cause, dirX: event.dirX, dirY: event.dirY, ageSec: 0 };
  }
}

/** 연출 시계를 realDt만큼 민다. 수명이 다한 것은 여기서 버린다 */
export function advancePlayerFx(fx: PlayerFxState, realDtSec: number): void {
  fx.elapsedSec += realDtSec;
  if (fx.parryResolve !== null) {
    fx.parryResolve.ageSec += realDtSec;
    if (fx.parryResolve.ageSec >= RESOLVE_SEC) fx.parryResolve = null;
  }
  if (fx.cooldownEndAgeSec !== null) {
    fx.cooldownEndAgeSec += realDtSec;
    if (fx.cooldownEndAgeSec >= HUD.cooldownRingEndSec) fx.cooldownEndAgeSec = null;
  }
  if (fx.hit !== null) {
    fx.hit.ageSec += realDtSec;
    if (fx.hit.ageSec >= Math.max(DISPEL_RING_SEC, ARROW_SEC)) fx.hit = null;
  }
}

/** 이식: engine.js drawPlayer 849-855 — 활성 중의 패리 원. 식은 그대로다 */
function parryWindowRing(ctx: CanvasRenderingContext2D, view: PlayerView): void {
  const k = 1 - view.parryActive.remainSec / view.parryActive.totalSec;
  const rU = view.parryRadiusU * lerp(HUD.parryRingScaleMin, HUD.parryRingScaleMax, k);
  ctx.strokeStyle = hexA(PALETTE.cheong, PARRY_RING_ALPHA_MAX - k * PARRY_RING_ALPHA_DROP);
  ctx.lineWidth = PARRY_RING_STROKE_U + (1 - k) * PARRY_RING_STROKE_GAIN_U;
  ctx.beginPath(); ctx.arc(0, 0, rU, 0, FULL_TURN_RAD); ctx.stroke();
  glow(ctx, 0, 0, view.parryRadiusU * PARRY_GLOW_SCALE, PALETTE.cheong, PARRY_GLOW_ALPHA * (1 - k));
}

/**
 * 신규 — 06 §5.6. 목업은 성공과 빈 패리를 한 갈래로 그렸다. §17이 요구한 것은 "무적이 붙지
 * 않았다는 사실이 그 자리에서 읽히는 것"인데 무적 링이 **안 나타나는 것**은 부재라서 읽히지
 * 않는다. 같은 도형을 반대로 움직여 부재를 사건으로 바꾼다 — 오해하면 §5.4의 억제 구조가 통째로
 * 전달되지 않는다. 빈 패리가 점선인 것은 무적 링도 점선이라(engine.js:870) 같은 어휘로 "여기
 * 무적이 있었어야 했다"를 말하는 것이고, 겹 수가 등급이며(12 §8-2), 수축이 코어에서 끝나는 것은
 * 성립한 패리가 무엇을 지켰는지가 그 도착점이기 때문이다.
 */
function parryResolveRings(
  ctx: CanvasRenderingContext2D,
  view: PlayerView,
  resolve: ParryResolveFx,
): void {
  const k = clamp01(resolve.ageSec / RESOLVE_SEC);
  const startRU = view.parryRadiusU * HUD.parryRingScaleMax;
  const endRU = resolve.isWhiff ? view.parryRadiusU * WHIFF_RING_SCALE_END : HUD.coreOuterRU;
  const span = 1 - (resolve.ringCount - 1) * RESOLVE_RING_LAG;
  ctx.lineWidth = PARRY_RING_STROKE_U;
  ctx.setLineDash(resolve.isWhiff ? INVULN_DASH : NO_DASH);
  for (let i = 0; i < resolve.ringCount; i += 1) {
    const p = clamp01((k - i * RESOLVE_RING_LAG) / span);
    ctx.strokeStyle = hexA(PALETTE.cheong, PARRY_RING_ALPHA_MAX * (1 - p));
    ctx.beginPath(); ctx.arc(0, 0, lerp(startRU, endRU, easeOutCubic(p)), 0, FULL_TURN_RAD); ctx.stroke();
  }
  ctx.setLineDash(NO_DASH);
}

/**
 * 이식: engine.js drawPlayer 858-864 — 반경 50u·선폭 3.5의 기하는 그대로. 둘이 붙었다.
 * ① 알파가 실효 쿨다운에 비례한다(08 §2.4). R10 빌드는 최소 간격 0.12초까지 내려가 초당 8.33회가
 *    되고 그 속도로 채워지는 링은 스트로브다. 기하가 아니라 알파를 줄이는 것은 §15.1의 표시
 *    요구가 남아 있기 때문이다.
 * ② 링이 완성되는 순간 50u → 56u로 0.08초 ease-out 확장 후 소멸한다(12 §8-1). 1프레임 밝기
 *    상승은 기본 쿨다운의 초당 4.16회에서 신호가 아니라 스트로브가 된다.
 */
function cooldownRing(ctx: CanvasRenderingContext2D, view: PlayerView, fx: PlayerFxState): void {
  const alpha = HUD.cooldownRingAlphaBase * clamp01(view.cooldown.totalSec / HUD.cooldownRingRefSec);
  ctx.lineWidth = HUD.cooldownRingStrokeU;
  if (view.cooldown.remainSec > 0) {
    const sweep = FULL_TURN_RAD * (1 - view.cooldown.remainSec / view.cooldown.totalSec);
    ctx.strokeStyle = hexA(PALETTE.cheongDim, alpha);
    ctx.beginPath(); ctx.arc(0, 0, HUD.cooldownRingRU, RING_START_RAD, RING_START_RAD + sweep); ctx.stroke();
    return;
  }
  if (fx.cooldownEndAgeSec === null) return;
  const k = easeOutCubic(clamp01(fx.cooldownEndAgeSec / HUD.cooldownRingEndSec));
  ctx.strokeStyle = hexA(PALETTE.cheongDim, alpha * (1 - k));
  ctx.beginPath();
  ctx.arc(0, 0, lerp(HUD.cooldownRingRU, HUD.cooldownRingEndRU, k), 0, FULL_TURN_RAD);
  ctx.stroke();
}

/**
 * 이식: engine.js drawPlayer 867-873 — 한 갈래를 둘로 갈랐다 (06 §5.9).
 *
 * 목업은 `p.inv > 0` 하나로 패리 무적 0.14초와 피격 무적 1.5초를 같은 그림으로 그린다. 길이가
 * 10배 넘게 다르므로 같은 그림이면 짧은 쪽은 깜빡임, 긴 쪽은 지속 상태로 보인다.
 *   패리 무적  1겹, 62u → 50u 단조 수축. 0.14초는 8프레임이고 8프레임에 한 바퀴 도는 점선은
 *              프레임당 45°를 건너뛰어 회전이 아니라 명멸로 보인다 (12 §8-4).
 *   피격 무적  2겹(62u · 70u)이 반대로 돌고 바깥 원호 길이가 남은 시간이다. §17이 무적 **종료
 *              시점의 예측 가능성**을 요구하므로 남은 시간이 표시에 실린다.
 * 둘이 동시에 살아 있으면 잔여가 긴 쪽만 그린다 — 실제 보호 시간이 그쪽이고 겹치면 4겹이 되어
 * 코어 판독이 나빠진다. 알파 식은 목업 868줄 그대로이고, HUD.invulnBlinkHz가 0이라 sin 항이 0이
 * 되어 12 §8-4가 요구한 고정 알파 0.5와 같아진다.
 */
function invulnRings(ctx: CanvasRenderingContext2D, view: PlayerView, fx: PlayerFxState): void {
  const isHitInvuln = view.hitInvuln.remainSec >= view.parryInvuln.remainSec;
  const timer = isHitInvuln ? view.hitInvuln : view.parryInvuln;
  if (timer.remainSec <= 0) return;
  const remainRatio = clamp01(timer.remainSec / timer.totalSec);
  ctx.strokeStyle = hexA(PALETTE.baek, 0.5 + Math.sin(fx.elapsedSec * HUD.invulnBlinkHz) * 0.25);
  ctx.lineWidth = HUD.invulnRingStrokeU;
  ctx.setLineDash(INVULN_DASH);
  if (!isHitInvuln) {
    const rU = lerp(PARRY_INVULN_END_RU, HUD.invulnRingRU, remainRatio);
    ctx.beginPath(); ctx.arc(0, 0, rU, 0, FULL_TURN_RAD); ctx.stroke();
    ctx.setLineDash(NO_DASH);
    return;
  }
  const spinU = fx.elapsedSec * HIT_INVULN_DASH_SPEED_U_PER_SEC;
  ctx.lineDashOffset = spinU;
  ctx.beginPath(); ctx.arc(0, 0, HUD.invulnRingRU, 0, FULL_TURN_RAD); ctx.stroke();
  ctx.lineDashOffset = -spinU;
  ctx.lineWidth = HIT_INVULN_OUTER_STROKE_U;
  ctx.beginPath(); ctx.arc(0, 0, HIT_INVULN_OUTER_RU, 0, FULL_TURN_RAD); ctx.stroke();
  ctx.lineDashOffset = 0;
  ctx.setLineDash(NO_DASH);
  // 원호 길이가 남은 시간이다. 반시계라 12시에서 되감기듯 줄어든다
  const arcEnd = RING_START_RAD - FULL_TURN_RAD * remainRatio;
  ctx.beginPath(); ctx.arc(0, 0, HIT_INVULN_OUTER_RU, RING_START_RAD, arcEnd, true); ctx.stroke();
}

/**
 * 신규 — 06 §5.5. 목업에 없다. 피격의 **원인**이 그림으로 갈리지 않으면 T-06이 실측하려는 반사탄
 * 자해 비율을 플레이어 자신이 인지하지 못한다.
 *
 * **소멸 링은 원인과 무관하게 그린다.** 06 §5.5는 반사탄 피격에 링이 없다고 적었지만, 스펙 §4.2
 * 2단계는 원인을 가리지 않고 반경 280u의 적 탄환을 지우고 sim/collision.ts:156-160이 그대로 그렇게
 * 한다. 링은 방금 지워진 범위이므로 실제로 지워진 프레임에 링을 빼면 §17의 "표시 = 판정"이 반대
 * 방향으로 깨진다. **스펙이 기획안을 이긴다.** 구분은 화살이 진다 — 자기 반사탄에 맞았을 때만 그
 * 탄이 온 방향에서 코어로 3개가 수렴한다. 링은 밖으로, 화살은 안으로. 색이 아니라 운동이 축이다.
 */
function hitRings(ctx: CanvasRenderingContext2D, hit: HitFx): void {
  const ringK = clamp01(hit.ageSec / DISPEL_RING_SEC);
  if (ringK < 1) {
    const rU = lerp(HUD.coreOuterRU, PLAYER.hitClearRadiusU, easeOutCubic(ringK));
    ctx.strokeStyle = hexA(PALETTE.jeok, DISPEL_RING_ALPHA * (1 - ringK));
    ctx.lineWidth = DISPEL_RING_STROKE_U;
    ctx.beginPath(); ctx.arc(0, 0, rU, 0, FULL_TURN_RAD); ctx.stroke();
  }
  const arrowK = clamp01(hit.ageSec / ARROW_SEC);
  if (hit.cause !== 'reflectedBullet' || arrowK >= 1) return;
  // 발사체가 가던 방향의 반대편이 그 탄이 온 곳이다
  const fromRad = Math.atan2(-hit.dirY, -hit.dirX);
  const tipRU = lerp(ARROW_START_RU, HUD.coreOuterRU, easeOutCubic(arrowK));
  // 화살 끝은 둥글어야 수렴이 읽힌다. 갑주 이음선은 각진 끝이 승인된 그림이라 되돌린다
  const priorLineCap = ctx.lineCap;
  ctx.strokeStyle = hexA(PALETTE.hwang, 1 - arrowK);
  ctx.lineWidth = ARROW_STROKE_U;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < ARROW_COUNT; i += 1) {
    const angle = fromRad + (i - (ARROW_COUNT - 1) / 2) * ARROW_SPREAD_RAD;
    const tipX = Math.cos(angle) * tipRU;
    const tipY = Math.sin(angle) * tipRU;
    const tailRU = tipRU + ARROW_SHAFT_U;
    ctx.moveTo(Math.cos(angle) * tailRU, Math.sin(angle) * tailRU);
    ctx.lineTo(tipX, tipY);
    for (let side = -1; side <= 1; side += 2) {
      const barb = angle + side * ARROW_BARB_RAD;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(barb) * ARROW_BARB_U, tipY + Math.sin(barb) * ARROW_BARB_U);
    }
  }
  ctx.stroke();
  ctx.lineCap = priorLineCap;
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawPlayer (844-1022)
 *
 * 플레이어는 청과 백으로만 그린다. 화면의 다른 색은 전부 규칙이 임자이므로(§17), 이 검객은 색이
 * 아니라 형태로 세부를 얻는다 — 두정갑 리벳, 전립 챙, 환도 그 자체.
 *
 * 드로우 콜은 갑주·투구·환도·코어에서 51회다(06 §3.5). 위의 다섯 표시는 전부 조건부이고 동시에
 * 최대로 켜져도 링 6 + 화살 1 + 글로우 2를 넘지 않는다.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  view: PlayerView,
  fx: PlayerFxState,
): void {
  ctx.save();
  ctx.translate(view.xU, view.yU);

  // 패리 원은 언제나 한 겹이다. 결판이 나면 창 그림이 물러나고 해소 그림이 그 자리를 잇는다 —
  // 확장하는 창 원과 수축하는 성공 링이 겹치면 §5.6이 만든 방향 대비가 그 프레임에 사라진다
  if (fx.parryResolve !== null) parryResolveRings(ctx, view, fx.parryResolve);
  else if (view.parryActive.remainSec > 0) parryWindowRing(ctx, view);
  cooldownRing(ctx, view, fx);
  invulnRings(ctx, view, fx);
  if (fx.hit !== null) hitRings(ctx, fx.hit);

  glow(ctx, 0, 0, 92, PALETTE.cheong, 0.26);

  /* 전포 — 뒤로 끌리는 전투 외투. 가장 먼저 가장 넓게 그리는 이것이 작은 형상을 실루엣
     크기에서 장수로 바꾼다 */
  ctx.fillStyle = hexA(PALETTE.cheongDim, 0.34);
  ctx.beginPath();
  ctx.moveTo(-26, -22);
  ctx.quadraticCurveTo(-52, 16, -44, 74);
  ctx.quadraticCurveTo(-22, 56, 0, 60);
  ctx.quadraticCurveTo(24, 56, 46, 80);
  ctx.quadraticCurveTo(52, 16, 26, -22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hexA(PALETTE.cheong, 0.35);
  ctx.lineWidth = 2;
  ctx.stroke();

  /* 상갑 — 허리띠에서 늘어지는 갑주 치마 */
  ctx.fillStyle = ARMOUR_DARK;
  ctx.strokeStyle = PALETTE.cheong;
  ctx.lineWidth = 3;
  poly(ctx, [[-20, 14], [20, 14], [26, 52], [-26, 52]]);
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = hexA(PALETTE.cheong, 0.5);
  ctx.lineWidth = 2;
  for (let k = -1; k <= 1; k += 1) {
    ctx.beginPath(); ctx.moveTo(k * 13, 14); ctx.lineTo(k * 16, 52); ctx.stroke();
  }

  /* 두정갑 — 좁은 가슴. 몸통을 어깨선 안쪽에 확실히 두는 것이 이 형상을 뚱뚱한 타원으로
     읽히지 않게 한다 */
  ctx.fillStyle = ARMOUR_DARK;
  ctx.strokeStyle = PALETTE.cheong;
  ctx.lineWidth = 3.6;
  poly(ctx, [[-17, -34], [17, -34], [20, 4], [16, 20], [-16, 20], [-20, 4]]);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = hexA(PALETTE.cheong, 0.8);
  for (let row = 0; row < 3; row += 1) {
    for (let col = -1; col <= 1; col += 1) {
      ctx.beginPath(); ctx.arc(col * 11, -26 + row * 9, 2.2, 0, FULL_TURN_RAD); ctx.fill();
    }
  }
  ctx.strokeStyle = PALETTE.baek;
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(-19, 12); ctx.lineTo(19, 12); ctx.stroke();

  /* 견갑 — 위로 바깥으로 젖힌 어깨판. 이 형상에서 가장 넓은 단단한 모서리다 */
  ctx.fillStyle = PALETTE.cheong;
  poly(ctx, [[-16, -32], [-44, -26], [-41, -4], [-15, -8]]); ctx.fill();
  poly(ctx, [[16, -32], [44, -26], [41, -4], [15, -8]]); ctx.fill();
  ctx.strokeStyle = hexA(PALETTE.baek, 0.45);
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-41, -19); ctx.lineTo(-18, -24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(41, -19); ctx.lineTo(18, -24); ctx.stroke();

  /* 목가리개 — 투구 아래의 사슬 드림. 목의 빈 곳을 메운다 */
  ctx.fillStyle = hexA(PALETTE.cheongDim, 0.42);
  poly(ctx, [[-23, -41], [23, -41], [17, -25], [-17, -25]]);
  ctx.fill();

  /* 투구 — 챙이 아니라 원뿔이다. 넓고 평평한 모자가 이 형상을 버섯으로 읽히게 하던 것이고,
     장수로 읽히게 하는 것은 높이다 */
  ctx.fillStyle = ARMOUR_DARK;
  ctx.strokeStyle = PALETTE.cheong;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-19, -43);
  ctx.quadraticCurveTo(-17, -68, 0, -88);
  ctx.quadraticCurveTo(17, -68, 19, -43);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  /* 챙 — 작게, 앞쪽에만 */
  ctx.strokeStyle = PALETTE.cheong;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-26, -43);
  ctx.quadraticCurveTo(0, -52, 26, -43);
  ctx.stroke();

  /* 간주와 상모 — 정수리 대롱, 그 고리, 그리고 위로 뻗은 술 */
  ctx.strokeStyle = PALETTE.cheong;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(0, -104); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -92, 4.5, 0, FULL_TURN_RAD); ctx.stroke();
  ctx.strokeStyle = PALETTE.baek;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const a of PLUME_ANGLES) {
    ctx.beginPath();
    ctx.moveTo(0, -104);
    ctx.quadraticCurveTo(Math.sin(a) * 13, -117, Math.sin(a) * 21, -127);
    ctx.stroke();
  }

  /* 환도 — 패리 창 동안 휘두르고 그 밖에는 낮게 내린다. 술은 이 형상에서 혼자 움직이는 유일한
     부분이다. lerp의 진행이 활성 시간에 묶여 있어 패리 창과 그림이 저절로 동기화된다 */
  const swingRad = view.parryActive.remainSec > 0
    ? lerp(-2.6, 0.55, 1 - view.parryActive.remainSec / view.parryActive.totalSec)
    : -1.0;
  ctx.save();
  ctx.rotate(swingRad);
  ctx.strokeStyle = hexA(PALETTE.cheong, 0.9);
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(20, 0); ctx.stroke();
  ctx.strokeStyle = PALETTE.baek;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(80, 0); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hexA(PALETTE.cheong, 0.8);
  ctx.beginPath();
  ctx.moveTo(8, 2);
  ctx.quadraticCurveTo(-6, 16, -14, 26);
  ctx.stroke();
  if (view.parryActive.remainSec > 0) {
    glow(ctx, 54, 0, 34, PALETTE.baek, 0.6);
    ctx.strokeStyle = hexA(PALETTE.baek, 0.4);
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(0, 0, 78, -0.5, 0.28); ctx.stroke();
  }
  ctx.restore();

  /* 10u 코어 — §15.1의 상시 표시. 어두운 원반이 플레이어 자신의 글로우 위에서 점을 또렷하게
     유지한다. 겉링 + 리벳 + 원반 + 백색 10u의 3중 구조가 §15.1의 상시 표시와 §7의 400px 축소
     판독을 동시에 만족시키는 유일한 형태다(06 §1.7). 코어를 놓치는 것은 이 게임이 감당할 수
     없는 유일한 판독 실패다 */
  ctx.strokeStyle = hexA(PALETTE.cheong, 0.9);
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.arc(0, 0, HUD.coreOuterRU, 0, FULL_TURN_RAD); ctx.stroke();
  ctx.fillStyle = hexA(PALETTE.cheong, 0.9);
  for (let rv = 0; rv < 4; rv += 1) {
    const ra = (rv / 4) * FULL_TURN_RAD + 0.785;
    const rivetX = Math.cos(ra) * HUD.coreOuterRU;
    const rivetY = Math.sin(ra) * HUD.coreOuterRU;
    ctx.beginPath(); ctx.arc(rivetX, rivetY, 2.2, 0, FULL_TURN_RAD); ctx.fill();
  }
  ctx.fillStyle = CORE_SHADE_FILL;
  ctx.beginPath(); ctx.arc(0, 0, HUD.coreShadeRU, 0, FULL_TURN_RAD); ctx.fill();
  ctx.fillStyle = PALETTE.baek;
  ctx.beginPath(); ctx.arc(0, 0, HUD.coreRU, 0, FULL_TURN_RAD); ctx.fill();
  ctx.strokeStyle = hexA(PALETTE.cheong, 0.95);
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(0, 0, HUD.coreShadeRU, 0, FULL_TURN_RAD); ctx.stroke();
  glow(ctx, 0, 0, HUD.coreGlowRU, PALETTE.baek, 0.7);
  ctx.restore();
}
