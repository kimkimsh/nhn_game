/**
 * 한 프레임의 레이어 순서 — 06_렌더링과_게임필.md §2
 *
 * 이식: docs/sample_image/_shared/engine.js render (1934-1980) — **수정.**
 * 층 순서는 목업 그대로이고 바뀐 것은 둘이다. 흔들림 계산이 render/camera.ts로 나갔고(§4.2),
 * 목업에 없던 임팩트 프레임이 6층과 7층 사이에 들어왔다(12 §7.1).
 *
 * **순서를 아는 파일은 여기 하나다.** 다른 render 파일은 자기가 몇 층인지 모르고, 알 필요도
 * 없다. 순서가 두 곳에 살면 한쪽만 고친 사람이 가독성 계약을 깬다.
 *
 * **이 순서는 미학이 아니라 가독성 계약이다.** 층마다 왜 거기인지가 아래 각 호출에 붙어 있고,
 * 이유가 "예뻐서"인 층은 하나도 없다.
 *
 * ── 좌표계 ─────────────────────────────────────────────────────────────────────
 *
 * 들어올 때의 `ctx` 변환이 논리 단위(u) → 장치 픽셀 기준이어야 한다. 이 파일은
 * `pixelsPerUnit`을 인자로 받지 않고 `getTransform()`으로 그 기준을 읽는다 — 배율을 숫자로
 * 받으면 흔들림 변위가 걸린 뒤에도 하위 함수가 `setTransform(배율)`로 기준을 다시 세워 버려
 * 그 층만 흔들림 밖으로 빠져나간다. §2가 "흔들림이 1~9를 감싼다"고 못 박은 자리가 그것이다.
 *
 * ── 시간 ───────────────────────────────────────────────────────────────────────
 *
 * `realDtSec`은 연출 시간이다. sim의 FIXED_DT가 아니고, 히트스톱으로 sim이 멈춘 프레임에도
 * 파티클·집중선·HUD 감쇠·흔들림 감쇠는 계속 돈다.
 */

import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import type { BackgroundId, BossId, BossSpriteId } from '../config/ids';
import { vignette } from './backgrounds/primitives';
import { drawStageBackground } from './backgrounds/index';
import { drawBossPartGauges, drawBossPhaseTelegraph, drawBossSilhouette } from './boss';
import type { BossPhaseView, BossSilhouette } from './boss';
import { drawBullets, drawLance } from './bullet';
import type { BulletLayerBatch, LanceView } from './bullet';
import type { Camera } from './camera';
import { drawEnemy } from './enemy';
import type { EnemyView, HitstopShake } from './enemy';
import { drawHud } from './hud';
import type { HudAnim, HudView } from './hud';
import type { ImpactLayer } from './impact';
import type { ParticleLayer } from './particles';
import { advancePlayerFx, drawPlayer } from './player';
import type { PlayerFxState, PlayerView } from './player';
import { drawTelegraph } from './telegraph';
import type { TelegraphView } from './telegraph';
import { drawZone } from './zone';
import type { ZoneView } from './zone';

/**
 * 2층(씬 페인트)과 12층(오버레이)이 부르는 것. 스테이지 전용 소품·보스 등장 연출·일시정지
 * 딤·보유 카드 확인이 여기 들어온다. 그리는 내용은 `screens/`가 갖고 이 파일은 자리만 준다.
 */
export type ScenePaint = (ctx: CanvasRenderingContext2D, realDtSec: number) => void;

/** 잡몹 한 기. `shake`는 히트스톱이 안 걸린 프레임에서 null이다 */
export interface FrameEnemy {
  readonly view: EnemyView;
  readonly shake: HitstopShake | null;
}

export interface FrameBoss {
  readonly bossId: BossId;
  readonly shape: BossSpriteId;
  readonly xU: number;
  readonly yU: number;
  readonly silhouette: BossSilhouette;
  readonly phase: BossPhaseView;
  /** `BOSSES[bossId].parts`와 같은 순서의 현재 HP. 부위가 없는 보스는 빈 배열이다 */
  readonly hpByPart: readonly number[];
  /**
   * 페이즈 전환 예고의 경과 시간 (초, realDt 누적). null이면 안 그린다 — **켜고 끄는 판단은
   * 호출부**다. 보스 HP가 다음 임계값 + 3%에 닿는 순간부터가 그 구간이다(06 §5.8).
   */
  readonly phaseTelegraphElapsedSec: number | null;
}

export interface FrameView {
  readonly backgroundId: BackgroundId;
  /** **스테이지 진입 기준** realDt 누적 (초). 런 전체 누적을 넣으면 배경의 상승 애니메이션이 화면 밖으로 나간다 */
  readonly backgroundTimeSec: number;
  /** render 전용 시드 (D-05). 배경의 절차 생성이 이 값에 걸린다 */
  readonly renderSeed: number;
  readonly paint: ScenePaint | null;
  readonly zones: readonly ZoneView[];
  readonly telegraphs: readonly TelegraphView[];
  readonly enemies: readonly FrameEnemy[];
  readonly boss: FrameBoss | null;
  readonly bullets: BulletLayerBatch;
  readonly lance: LanceView | null;
  readonly player: PlayerView;
  readonly hud: HudView;
  readonly overlay: ScenePaint | null;
}

/**
 * 프레임을 넘겨 살아 있는 render 쪽 상태와 이번 프레임의 연출 시간.
 *
 * `view`와 갈라 둔 것은 수명이 다르기 때문이다 — `view`는 이 프레임 한 장을 서술하고 매 프레임
 * 새로 만들어지지만, 여기 있는 다섯은 런 하나를 함께 사는 객체다. 이 파일이 그 다섯을 **소유하지
 * 않고 전진만 시킨다**: 만드는 것도 버리는 것도 `screens/`다.
 */
export interface FrameDeps {
  readonly camera: Camera;
  readonly particles: ParticleLayer;
  readonly impact: ImpactLayer;
  readonly playerFx: PlayerFxState;
  readonly hudAnim: HudAnim;
  /** 이 프레임의 연출 시간 (초). 정지 프레임 대조에서는 0이다 */
  readonly realDtSec: number;
}

/**
 * 연출 상태를 한 걸음 전진시킨다. **그리기보다 먼저 전부 끝낸다** — 층 사이에 끼워 넣으면
 * 앞쪽 층은 새 시각, 뒤쪽 층은 이전 시각으로 그려져 같은 사건이 한 프레임에 두 시각으로 남는다.
 *
 * HUD만 여기 없는 것은 `drawHud`가 `realDtSec`을 직접 받아 자기 anim을 안에서 전진시키기
 * 때문이다. 두 번 전진시키면 점수 카운트업이 두 배 빨라진다.
 */
function advanceFrameFx(deps: FrameDeps): void {
  deps.camera.update(deps.realDtSec);
  deps.particles.update(deps.realDtSec);
  deps.impact.update(deps.realDtSec);
  advancePlayerFx(deps.playerFx, deps.realDtSec);
}

/**
 * 보스는 개체 로컬 프레임에서 그린다. 부위 게이지만 월드 좌표라 `restore` 뒤로 나간다 —
 * 게이지 좌표가 이미 보스 중심 + `offsetU`이므로 로컬 안에서 부르면 오프셋이 두 번 걸린다.
 */
function drawBossLayer(ctx: CanvasRenderingContext2D, boss: FrameBoss): void {
  ctx.save();
  ctx.translate(boss.xU, boss.yU);
  drawBossSilhouette(ctx, boss.shape, boss.silhouette, boss.phase);
  if (boss.phaseTelegraphElapsedSec !== null) {
    drawBossPhaseTelegraph(ctx, boss.shape, boss.silhouette, boss.phaseTelegraphElapsedSec);
  }
  ctx.restore();
  drawBossPartGauges(ctx, boss.bossId, boss.xU, boss.yU, boss.hpByPart);
}

/**
 * 프레임을 지운다. 목업에는 없던 한 줄이다 — 목업은 정지 화면 한 장이라 흔들림이 언제나 0이었고
 * 배경이 화면을 정확히 덮었다. 실게임에서는 최대 26u 변위 + 회전이 걸리므로 배경 사각형이
 * 화면 가장자리를 덮지 못하고, 지우지 않으면 그 띠에 **이전 프레임의 잔상**이 남아 명멸한다.
 *
 * 흔들림 **밖**에서 지운다. 안에서 지우면 지우는 사각형도 같이 밀려 문제가 그대로 남는다.
 */
function clearFrame(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.ink900;
  ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
}

/**
 * 이식: engine.js render (1934-1980). 아래 호출 순서가 06 §2의 12층 계약 그 자체다.
 *
 * 들어올 때의 변환을 나갈 때 그대로 돌려준다 — 이 함수를 두 번 부르면(대조 하네스가 그렇게
 * 한다) 두 번째가 첫 번째의 잔여 변환 위에 쌓이면 안 된다.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  view: FrameView,
  deps: FrameDeps,
): void {
  advanceFrameFx(deps);

  const base = ctx.getTransform();
  clearFrame(ctx);

  /* ── 흔들림이 1~9층을 감싼다 ────────────────────────────────────────────────
     배경까지 덮어야 **카메라가 흔들린 것**으로 읽힌다. 배경을 빼면 물체만 미끄러지는
     그림이 되고, 그건 연출이 아니라 glitch로 읽힌다. */
  deps.camera.begin(ctx);

  // 1. 배경 — 아래에 아무것도 없다. 정적 레이어는 구운 한 장, 동적 레이어만 매 프레임이다
  drawStageBackground(ctx, view.backgroundId, view.backgroundTimeSec, view.renderSeed);

  // 2. 씬 페인트 — 배경의 일부이지만 상태에 따라 바뀌므로 굽기에서 빠진 것들
  view.paint?.(ctx, deps.realDtSec);

  /* 3. 장판 — 바닥 표시다. 위의 어떤 것도 가리면 안 되고, 자신은 배경 위에 있어야 경계가
        보인다. alpha 0.55로 채우므로 이 위에 오는 것은 전부 이 반투명을 통과해 보인다 */
  for (const zone of view.zones) {
    drawZone(ctx, zone);
  }

  /* 4. 예고 — 장판 **위**여야 한다. alpha 0.55 장판 아래에 깔리면 §15.1이 요구한 "배경과
        명확히 구분되는 색"이 무너진다. P12 예고선은 화면 전체 높이를 가로지르므로 장판과
        겹치는 구간이 반드시 생긴다 */
  for (const telegraph of view.telegraphs) {
    drawTelegraph(ctx, telegraph);
  }

  /* 5. 적 — 예고 **위**여야 한다. 적 본체의 상태 변화가 §17의 "발사 예비동작" 신호 그
        자체인데, P12 예고선이 화면을 세로로 관통하며 적 위를 지나가면 그 신호가 점선에 덮인다.
        보스를 먼저 그리는 것은 B1의 부하 조총병 5기가 진막 앞에 서야 하기 때문이다 —
        폭 300u 실루엣 뒤로 들어가면 그 5기의 예비동작이 통째로 사라진다 */
  if (view.boss !== null) {
    drawBossLayer(ctx, view.boss);
  }
  for (const enemy of view.enemies) {
    drawEnemy(ctx, enemy.view, enemy.shake);
  }

  /* 6. 탄환 — 적 **위**여야 한다. 잡몹 폭은 44~96u, 보스는 300~980u인데 P2 조총탄은 6u다.
        탄이 적 뒤에서 나오면 비행 초반 0.1초가 사라지고, HR-05가 조준선을 금지했으므로 그
        0.1초를 보충할 수단이 게임에 없다. 층 안은 글로우 패스 → 본체 패스 둘로 갈리지만
        그건 층 **내부** 재배열이라 이 계약 밖이다 */
  drawBullets(ctx, view.bullets);
  if (view.lance !== null) {
    drawLance(ctx, view.lance);
  }

  /* 6.5 임팩트 프레임 — **탄환 위, 플레이어 아래**(12 §7.1). 최상단에 두면 §15.1이 상시
        표시로 못 박은 10u 코어가 0.033초 사라지는데, 그 사이 히트스톱은 이미 끝나 sim이 돌고
        S5 조총탄은 34u를 간다 — GREAT 밴드 전체(28u)보다 넓다. 여기 두면 잔상 기제는
        고대비 전면 전환이 만드는 것이라 그대로 얻고, 코어·패리 원·쿨다운 링이 흰 화면 위에
        청색으로 남아 판독 기준이 유지된다 */
  deps.impact.drawImpactFrame(ctx);

  /* 7. 플레이어 — **탄환 위여야 한다. 10u 코어가 절대 가려지면 안 된다.** §5.3이 대형 탄환의
        GREAT를 "이미 겹친 상태"로 정의했다 — P5(34u)·P7(30u)·P6(26u)는 GREAT 밴드 d ≤ 28u
        안에서 탄 몸통이 코어를 덮는다. 탄환이 위면 가장 정확히 읽어야 하는 순간에 정확히
        코어가 사라진다 */
  drawPlayer(ctx, view.player, deps.playerFx);

  /* 8. 파티클 — 플레이어 **위**. 처치 파편은 수명 0.5~0.9초의 6u 사각형이라 코어를 지속적으로
        가리지 못한다. 반대로 아래에 두면 90u 실루엣이 파편을 삼켜 §17의 "적 처치 — 반사탄이
        유효했다는 사실이 확인되어야 한다"가 깨진다 */
  deps.particles.drawParticles(ctx);

  /* 9. 팝업 — 등급 텍스트와 ×N은 장식이 아니라 §15.1이 요구한 판정 정보다. 월드 안의 어떤
        것에도 가려지면 안 된다. 집중선이 파티클 위인 것은 수렴점 안쪽이 비어야 시선이 그리로
        가기 때문이다(§4.6) */
  deps.impact.drawSpeedLines(ctx);
  deps.particles.drawKillCounts(ctx);
  deps.impact.drawPopups(ctx);

  deps.camera.end(ctx);

  /* 9.5 피격 플래시 — 화면 좌표계 효과라 흔들림 **밖**이다. 안에 두면 전면 채움이 26u 밀려
        가장자리에 안 물든 띠가 생기고, 그 띠가 §5.5의 "원인이 색으로 읽힌다"를 깎는다 */
  deps.impact.drawScreenFlash(ctx);

  /* 10. 비네트 — **흔들림 밖, HUD 앞.** 두 이유가 각각 독립적이다. ① 흔들림 안이면 화면 좌표계
        효과인 비네트가 같이 움직여 프레임 가장자리에 안 어두워진 26u 띠가 매 프레임 명멸한다.
        ② HUD 앞이어야 한다 — 비네트는 모서리에서 alpha 0.55 검정이고 라이프 pip·점수·콤보가
        전부 모서리라, 뒤에 두면 §15.1이 "즉시 셀 수 있는 형태"를 요구한 표시들만 골라 어두워진다 */
  vignette(ctx);

  /* 11. HUD — **흔들리지 않는다.** 고정된 HUD가 판독 기준이 되고, §7의 촬영 요건이 HUD를 장르
        판별 단축키로 쓰므로 흔들려 뭉개지면 안 된다 */
  drawHud(ctx, view.hud, deps.hudAnim, deps.realDtSec);

  // 12. 오버레이 — 보유 카드 확인(Tab)·일시정지·치트 메뉴. HUD보다도 위다
  view.overlay?.(ctx, deps.realDtSec);

  ctx.setTransform(base);
}
