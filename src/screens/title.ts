/**
 * 타이틀 — 스펙 §13.1 · §16.3, 08 §6. 그림은 `docs/sample_image/00_title/scene.js`.
 *
 * 구도는 목업 그대로다. 위쪽 3분의 1에서 전투가 돌고 아래 3분의 2를 로고타입과 조작 안내가
 * 차지하며, 그 둘을 세로 그라디언트 스크림이 잇는다.
 *
 * ── 좌표를 여기 두는 이유 ──────────────────────────────────────────────────────
 *
 * `config/ui.ts`가 명시적으로 비워 둔 자리다("타이틀 화면의 구도 값은 없다 … 한 번만 쓰이고
 * 서로 얽혀 있어 상수로 뽑으면 오히려 못 고치게 된다", 08 §9). 그래서 이 파일의 숫자는
 * config를 다시 적은 것이 아니라 **여기가 단일 소스인 값들**이다. 반대로 색·서체·등급 밴드·
 * 스테이지 표는 전부 import한다 — 그쪽은 임자가 따로 있다.
 *
 * ── 플레이어 y는 §3.1 밖이다 ───────────────────────────────────────────────────
 *
 * 어트랙트 루프가 그리는 플레이어는 `y ≈ 545`로 §3.1의 이동 가능 영역 `[620, 1830]` 바깥이다.
 * **sim은 정상이고 예외는 그리는 위치 하나뿐이다** — 근거와 계약은
 * `screens/title-attract.ts`의 `PLAYER_DRAW_OFFSET_YU` 주석에 있다(08 §6.5 · 10 A12 · 12 §8-7).
 * 여기서 클램프 버그를 의심하지 말 것.
 *
 * ── 흔들림 줄이기 토글은 없다 ──────────────────────────────────────────────────
 *
 * 목업 README(`00_title/README.md:7`)가 "흔들림 줄이기·음소거를 첫 화면에 노출"이라고 적었지만
 * ① 같은 폴더의 `scene.js`는 그것을 그리지 않고(`:103-104`가 그리는 것은 음소거 `M`과 치트
 * `Shift + F9`뿐이다) ② 스펙 §16 어디에도 그런 항목이 없다. §16.1~§16.4가 모든 화면의 모든
 * 키를 열거했고 §16.5가 리매핑을 금지했으므로 열거되지 않은 토글을 얹을 자리가 없다.
 * **README 한 줄이 앞서 나간 것이고, 스펙이 이긴다.** OS의 `prefers-reduced-motion`은
 * `boot/platform-guard.ts`가 읽어 그대로 반영하므로 요구 자체는 다른 경로로 충족된다.
 *
 * ── 첫 페인트가 곧 게임 화면이다 (08 §6.4) ────────────────────────────────────
 *
 * 검은 화면 → 페이드 인 같은 도입을 두지 않는다. D-03의 단일 파일 인라인 빌드에는 네트워크
 * 대기가 없어서 가릴 로딩 구간 자체가 없다. 어트랙트 녹화가 아직 없는 동안에도 위쪽은 S1
 * 배경이 실제로 돌아가는 화면이지 검은 사각형이 아니다.
 */

import { PARRY, PARRY_BANDS } from '../config/parry';
import { PALETTE } from '../config/palette';
import { PLAYFIELD } from '../config/playfield';
import { PROGRESSION } from '../config/progression';
import { STAGES } from '../config/stages';
import { BOSSES } from '../config/bosses';
import { FONTS } from '../config/ui';
import type { InputPress } from '../core/input';
import { deriveStream } from '../core/rng';
import {
  bakeStageBackground, drawStageBackground, isStageBackgroundBaked,
} from '../render/backgrounds/index';
import { glow, hexA } from '../render/primitives';
import { ATTRACT_SEED, ATTRACT_STAGE_ID, createAttractLoop, type AttractLoop } from './title-attract';
import type { Screen, ScreenHost } from './registry';

const CENTER_XU = PLAYFIELD.widthU / 2;
const SEED_RANGE = 0x1_0000_0000;
const SECONDS_PER_MINUTE = 60;

/** 08 §6.1 스크림 — 세로 그라디언트. 색은 `PALETTE.ink900`(`#06070a` = rgb(6,7,10))이다 */
const SCRIM_STOPS: readonly (readonly [number, number])[] = [
  [0, 0.05],
  [0.31, 0.18],
  [0.39, 0.88],
  [1, 0.94],
];

/** 08 §6.1 구분선 둘 — 위는 전투와 로고 판을 가르고, 아래는 제목과 규칙을 가른다 */
const UPPER_RULE = { xU: 70, toXU: PLAYFIELD.widthU - 70, yU: 700, alpha: 0.16 };
const LOWER_RULE = { xU: 320, toXU: 760, yU: 1312, alpha: 0.2 };
const RULE_WIDTH_U = 1.5;

/**
 * 08 §6.3 마크는 장식이 아니라 §5.3의 등급 밴드를 그린 것이다.
 *
 * 목업의 세 반경 130 / 89 / 52는 패리 밴드 70 / 48 / 28에 정확히 비례한다
 * (`89/130 = 0.685` vs `48/70 = 0.686`, `52/130 = 0.400` vs `28/70 = 0.400`).
 * **그래서 반경을 리터럴로 적지 않고 밴드에서 만든다** — 「보기 좋게」 조정하는 순간 마크가
 * 규칙을 그린 것이 아니게 되고, 밴드를 고친 사람은 이 그림이 거짓말이 된 것을 못 본다.
 * 배율만 여기 있고 그 값이 목업의 바깥 반경 130을 만든다.
 */
const MARK = {
  centerXU: CENTER_XU,
  centerYU: 880,
  scale: 130 / PARRY.radiusU,
  outerWidthU: 2.5,
  midWidthU: 2.5,
  innerWidthU: 3.5,
  glowRU: 110,
  glowAlpha: 0.26,
  outerAlpha: 0.3,
  midAlpha: 0.75,
  bladeFromXU: -152,
  bladeFromYU: 84,
  bladeToXU: 152,
  bladeToYU: -84,
  bladeWidthU: 5,
  hubRU: 9,
};

/** 08 §6.1 로고타입 · 규칙 두 줄 */
const TITLE_TEXT = { text: '환도', baselineYU: 1180, px: 210, weight: 700 };
const HANJA_TEXT = { text: '還 刀', baselineYU: 1258, px: 56, weight: 400 };
const RULE_LINES: readonly { readonly text: string; readonly baselineYU: number; readonly color: string }[] = [
  { text: '나에게는 무기가 없다.', baselineYU: 1382, color: PALETTE.baek },
  { text: '적이 쏜 것만이 내 칼이다.', baselineYU: 1440, color: PALETTE.hwang },
];
const RULE_LINE_PX = 40;
const RULE_LINE_WEIGHT = 500;

/**
 * 08 §6.1 시작 상자. 문구가 `SPACE` 하나만 말하는 것은 의도된 설계다 —
 * "시작 키가 곧 패리 키"(`00_title/README.md:6`). 시작 버튼을 게임의 동사로 대체한다.
 * 다만 §16.3의 `Enter`와 클릭도 반드시 동작하므로 아래 조작 안내 줄이 셋을 전부 적는다.
 * 상자 하나가 유일한 안내가 되면 안 된다.
 */
const START_BOX = { xU: 310, yU: 1548, widthU: 460, heightU: 74, strokeU: 2, strokeAlpha: 0.6 };
const START_TEXT = { text: 'SPACE — 베러 나간다', baselineYU: 1595, px: 40, weight: 600 };

/** 08 §6.1 조작 안내 두 줄. §16.3의 타이틀 행 세 개가 전부 여기 있다 */
const HINT_PX = 29;
const HINT_WEIGHT = 400;
const HINTS: readonly { readonly text: string; readonly baselineYU: number; readonly color: string }[] = [
  { text: '시작  Enter · SPACE · 클릭        이동  WASD · 방향키        패리  SPACE · J · 좌클릭', baselineYU: 1712, color: PALETTE.baekMute },
  { text: '음소거  M          치트 모드  Shift + F9', baselineYU: 1762, color: PALETTE.baekFaint },
];

/** 08 §6.1 하단 두 줄. y는 목업의 `PF.H - 38`이다 */
const FOOTER = { baselineYU: PLAYFIELD.heightU - 38, px: 25, weight: 400, marginXU: 40 };
const FOOTER_LEFT_TEXT = 'NAN 2026 · 사전 과제';

/**
 * 08 §6.1 하단 우측. 「약 7분 30초」는 §9.2의 총 목표 플레이 타임이고 **하드코딩하지 않는다.**
 *
 * 스테이지마다 (마지막 웨이브 종료 + 소강 + 보스 목표 격파)가 그 스테이지의 목표 길이이고,
 * 다섯을 더하면 스펙 §9.2의 450초가 그대로 나온다. 웨이브를 하나 늘리면 이 줄이 따라 움직인다.
 */
function totalTargetSec(): number {
  let total = 0;
  for (const stage of Object.values(STAGES)) {
    const lastWave = stage.waves[stage.waves.length - 1];
    total += (lastWave?.endSec ?? 0) + stage.lullSec + BOSSES[stage.bossId].targetKillSec;
  }
  return total;
}

/** 「약 7분 30초」. 초가 0이면 분만 적는다 — 「7분 0초」는 사람이 안 쓰는 말이다 */
function targetPlayTimeText(totalSec: number): string {
  const minutes = Math.floor(totalSec / SECONDS_PER_MINUTE);
  const seconds = Math.round(totalSec % SECONDS_PER_MINUTE);
  return seconds === 0 ? `약 ${minutes}분` : `약 ${minutes}분 ${seconds}초`;
}

function setFont(ctx: CanvasRenderingContext2D, weight: number, sizePx: number, family: string): void {
  ctx.font = `${weight} ${sizePx}px ${family}`;
}

function drawRule(ctx: CanvasRenderingContext2D, rule: typeof UPPER_RULE): void {
  ctx.strokeStyle = hexA(PALETTE.baek, rule.alpha);
  ctx.lineWidth = RULE_WIDTH_U;
  ctx.beginPath();
  ctx.moveTo(rule.xU, rule.yU);
  ctx.lineTo(rule.toXU, rule.yU);
  ctx.stroke();
}

/** 08 §6.1 스크림. 위쪽 전투가 비치고 아래쪽 로고 판은 사실상 불투명해진다 */
function drawScrim(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, PLAYFIELD.heightU);
  for (const [offset, alpha] of SCRIM_STOPS) {
    gradient.addColorStop(offset, hexA(PALETTE.ink900, alpha));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PLAYFIELD.widthU, PLAYFIELD.heightU);
}

/** 등급 밴드 반경 (u) → 마크 반경 (u). NOT BAD의 밴드는 열려 있어 패리 반경 자체가 그 끝이다 */
function markRadiusU(bandMaxDistU: number | null): number {
  return (bandMaxDistU ?? PARRY.radiusU) * MARK.scale;
}

/** 08 §6.3. 세 원이 GREAT · GOOD · NOT BAD이고 대각선 한 획이 환도다 */
function drawMark(ctx: CanvasRenderingContext2D): void {
  const bands = PARRY_BANDS;
  ctx.save();
  ctx.translate(MARK.centerXU, MARK.centerYU);

  ctx.lineWidth = MARK.outerWidthU;
  ctx.strokeStyle = hexA(PALETTE.baek, MARK.outerAlpha);
  strokeCircle(ctx, markRadiusU(bands[2].maxDistU));

  ctx.lineWidth = MARK.midWidthU;
  ctx.strokeStyle = hexA(PALETTE.cheong, MARK.midAlpha);
  strokeCircle(ctx, markRadiusU(bands[1].maxDistU));

  ctx.lineWidth = MARK.innerWidthU;
  ctx.strokeStyle = PALETTE.hwang;
  strokeCircle(ctx, markRadiusU(bands[0].maxDistU));

  glow(ctx, 0, 0, MARK.glowRU, PALETTE.hwang, MARK.glowAlpha);

  ctx.strokeStyle = PALETTE.baek;
  ctx.lineWidth = MARK.bladeWidthU;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(MARK.bladeFromXU, MARK.bladeFromYU);
  ctx.lineTo(MARK.bladeToXU, MARK.bladeToYU);
  ctx.stroke();

  ctx.fillStyle = PALETTE.baek;
  ctx.beginPath();
  ctx.arc(0, 0, MARK.hubRU, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function strokeCircle(ctx: CanvasRenderingContext2D, radiusU: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radiusU, 0, Math.PI * 2);
  ctx.stroke();
}

/** 스크림 위 전부 — 로고타입 · 규칙 · 시작 상자 · 조작 안내 · 하단 */
function drawPlate(ctx: CanvasRenderingContext2D, footerRightText: string): void {
  drawRule(ctx, UPPER_RULE);
  drawMark(ctx);

  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.baek;
  setFont(ctx, TITLE_TEXT.weight, TITLE_TEXT.px, FONTS.display);
  ctx.fillText(TITLE_TEXT.text, CENTER_XU, TITLE_TEXT.baselineYU);
  ctx.fillStyle = PALETTE.hwang;
  setFont(ctx, HANJA_TEXT.weight, HANJA_TEXT.px, FONTS.display);
  ctx.fillText(HANJA_TEXT.text, CENTER_XU, HANJA_TEXT.baselineYU);

  drawRule(ctx, LOWER_RULE);

  setFont(ctx, RULE_LINE_WEIGHT, RULE_LINE_PX, FONTS.body);
  for (const line of RULE_LINES) {
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, CENTER_XU, line.baselineYU);
  }

  ctx.strokeStyle = hexA(PALETTE.cheong, START_BOX.strokeAlpha);
  ctx.lineWidth = START_BOX.strokeU;
  ctx.strokeRect(START_BOX.xU, START_BOX.yU, START_BOX.widthU, START_BOX.heightU);
  ctx.fillStyle = PALETTE.cheong;
  setFont(ctx, START_TEXT.weight, START_TEXT.px, FONTS.data);
  ctx.fillText(START_TEXT.text, CENTER_XU, START_TEXT.baselineYU);

  setFont(ctx, HINT_WEIGHT, HINT_PX, FONTS.body);
  for (const hint of HINTS) {
    ctx.fillStyle = hint.color;
    ctx.fillText(hint.text, CENTER_XU, hint.baselineYU);
  }

  ctx.fillStyle = PALETTE.baekFaint;
  setFont(ctx, FOOTER.weight, FOOTER.px, FONTS.data);
  ctx.textAlign = 'left';
  ctx.fillText(FOOTER_LEFT_TEXT, FOOTER.marginXU, FOOTER.baselineYU);
  ctx.textAlign = 'right';
  ctx.fillText(footerRightText, PLAYFIELD.widthU - FOOTER.marginXU, FOOTER.baselineYU);
}

/**
 * 녹화가 없는 동안의 위쪽 3분의 1 — 08 §6.4가 금지한 검은 화면을 피하는 자리.
 *
 * 어트랙트와 같은 스테이지의 배경만 실제로 돌린다. 굽기 슬롯은 전투가 자기 스테이지로 갈아
 * 가므로(`play.ts`의 `enterStage`) 매 프레임 슬롯이 아직 내 것인지 확인하고 아니면 다시
 * 굽는다 — 그대로 그리면 `render/backgrounds/index.ts`가 개발 빌드에서 던진다.
 *
 * **경과 시간을 감지 않는다.** S1의 불티는 `render/backgrounds/primitives.ts`의 상승 모드
 * 감기 식이 화면 세 장분 여유만 두고 있어 `t > 288초`부터 화면 위로 사라진다. 타이틀은 그보다
 * 오래 떠 있을 수 있지만, 감아 주면 같은 `tSec`을 쓰는 연무 띠와 물반사가 그 순간 통째로
 * 튄다 — 눈에 안 띄는 티끌이 사라지는 쪽이 화면 폭 띠가 뛰는 쪽보다 싸다. 옳은 고침은
 * 그 파일이 입자마다 위상을 감는 것이고 여기서는 손댈 수 없다.
 */
function drawStaticBackdrop(ctx: CanvasRenderingContext2D, renderSeed: number, elapsedSec: number): void {
  const background = STAGES[ATTRACT_STAGE_ID].background;
  if (!isStageBackgroundBaked(background, renderSeed)) {
    bakeStageBackground(background, renderSeed);
  }
  drawStageBackground(ctx, background, elapsedSec, renderSeed);
}

/** `screens/registry.ts`가 이 이름으로 잡는다 */
export function createTitleScreen(host: ScreenHost): Screen {
  // 어트랙트와 정적 배경이 같은 시드를 쓴다. 녹화가 들어와도 하늘이 안 바뀐다
  const renderSeed = deriveStream(ATTRACT_SEED, 'render').int(0, SEED_RANGE);
  const attract: AttractLoop | null = createAttractLoop();
  const footerRightText = `${PROGRESSION.stageCount} STAGES · ${targetPlayTimeText(totalTargetSec())}`;
  let elapsedSec = 0;

  return {
    paint(ctx: CanvasRenderingContext2D, realDtSec: number): void {
      elapsedSec += realDtSec;
      if (attract === null) {
        drawStaticBackdrop(ctx, renderSeed, elapsedSec);
      } else {
        attract.draw(ctx, realDtSec);
      }
      ctx.save();
      ctx.textBaseline = 'alphabetic';
      drawScrim(ctx);
      drawPlate(ctx, footerRightText);
      ctx.restore();
    },

    update(presses: readonly InputPress[], realDtSec: number): void {
      attract?.advance(realDtSec);
      for (const press of presses) {
        // §16.3 시작은 Enter · Space · 클릭이다. 셋 다 core/input.ts에서 confirm으로 온다.
        // parry(J)는 시작이 아니다 — 스펙이 타이틀 행에 그 키를 적지 않았다
        if (press.action === 'confirm') {
          host.request({ kind: 'startRun' });
          return;
        }
      }
    },

    dispose(): void {
      attract?.dispose();
    },
  };
}
