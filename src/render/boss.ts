/**
 * 보스 실루엣 4종 — 목업 engine.js `drawEnemy`의 보스 case 이식 (06_렌더링과_게임필.md §1.6)
 *
 * 목업의 case 하나가 여기 함수 하나에 대응한다. 좌표는 개체 로컬 프레임이다 —
 * `ctx.translate(보스 x, 보스 y)`는 부르는 쪽이 이미 걸어 둔 상태여야 한다(engine.js:401).
 *
 * **공통 헤더는 여기 없다.** 글로우 상한·접지 그림자·`hot`/`body`/`seam` 계산(engine.js:397-435)은
 * `render/enemy.ts`가 갖는다(06 §1.6). 이 파일은 그 결과를 `BossSilhouette`으로 받아 실루엣만
 * 그린다. 헤더를 여기서 다시 계산하면 잡몹과 보스의 글로우 규칙이 두 벌이 된다.
 *
 * **이 함수들은 ctx 상태를 되돌리지 않는다.** 목업 case가 앞 도형이 남긴 fillStyle·strokeStyle·
 * lineWidth 위에서 이어 그리고 그 누수가 결과물의 일부다 — warship 선체의 stroke(engine.js:746)는
 * 헤더가 정한 `hot`과 선폭을 쓴다(render/enemy-parts.ts 머리말과 같은 계약).
 *
 * 실루엣 좌표의 계수(0.72 · 0.34 · 0.085 …)는 목업 그대로 두고 이름을 주지 않는다. 아트 경로의 제어점
 * 이라 이름이 뜻을 늘리지 못하고 원본과의 줄 단위 대조만 끊는다(03_파일_구조.md §2.3). 규칙을 나르는
 * 값 — 실루엣 폭 표, 마스트 깃발 수, 예고 맥동 — 만 이름을 갖는다.
 */

import { BOSSES } from '../config/bosses';
import type { BossId, BossSpriteId } from '../config/ids';
import { PALETTE } from '../config/palette';
import type { BossDef } from '../config/types';
import { tiledRoof } from './backgrounds/primitives';
import { drawPartHpGauge, jingasa, lamellae, spokedWheel, visor } from './enemy-parts';
import { hexA, poly } from './primitives';
import type { PolyPoint } from './primitives';

/** 목업은 원을 6.284로 닫는다(engine.js:684 등). 2π로 적어도 같은 원이 나온다 */
const FULL_TURN_RAD = Math.PI * 2;
/** 좌우 대칭 부품의 부호. 목업의 `[-1, 1].forEach` 그대로다 */
const MIRROR = [-1, 1] as const;

/**
 * 보스 구조물 전용 색 — 여기가 임시 거처다. `config/palette.ts`는 "색 하나에 규칙 하나"를 계약으로
 * 걸었는데(03 §7) 아래 일곱은 게임 규칙을 나르지 않는 구조물 색이라 그 계약에 들어갈 자리가 없다.
 * `render/backgrounds/primitives.ts`가 같은 사정을 같은 방식으로 처리했다 — `config/`에 구조물 색
 * 목록이 생기면 그리로 옮겨 간다. export하지 않는 것이 그 준비다.
 *
 * 값은 승인된 목업 그대로다. 근사한 PALETTE 토큰으로 바꾸지 않는다 — 실루엣의 내부 면이라 바탕과
 * 같은 색으로 읽혀야 할 이유가 없고, 바꾸면 승인된 아트가 그만큼 달라진다.
 */
const COMMANDER_CURTAIN = '#121722'; // 진막 천 (engine.js:673)
const COMMANDER_TORSO = '#171d29'; // 대장 본인의 몸통 (engine.js:689)
const WARSHIP_HULL = '#0e121b'; // 아타케부네 선체 (engine.js:745)
const WARSHIP_TOWER = '#161c28'; // 갑판 위 누각 (engine.js:769)
const WARSHIP_ROOF = '#1b2230'; // 누각 기와 지붕 (engine.js:776)
const ARTILLERY_TUBE = '#1a1f2b'; // 대통 포신 (engine.js:798)
const ARTILLERY_BORE = '#3a1218'; // 식지 않은 포구. 예비동작 중에는 jeokHot이다 (engine.js:810)

/**
 * 실루엣 폭 (u) — engine.js:68-72의 `ENEMIES[…].w`
 *
 * **`config/bosses/*`에 없는 이유.** `BossDef.hitBox`는 판정 폭이고 이것은 그림 폭이라 값이 다르다.
 * 그림 폭은 render의 소유다 — `config/enemies.ts` 머리말이 잡몹에 대해 같은 말을 한다. **어긋나는
 * 자리는 어느 쪽도 오타가 아니다.** 판정 폭은 목업 실측이고 아래는 실루엣 배율의 기준이라, 부품이
 * 판정 밖으로 나가거나(B2) 판정이 실루엣을 덮는다(B1·B4).
 *
 * | 보스 | 그림 | 판정 | 왜 다른가 |
 * |---|---|---|---|
 * | B1 | 300 | 470 | 진막이 ±0.82w까지 퍼져 총폭 492u다(engine.js:674). 판정이 그 진막을 덮는다 |
 * | B2 | 300 | 240 | 몸통은 ±0.34w = 204u인데 이도류가 ±0.94w까지 뻗는다(:736). **칼은 판정에 없다** |
 * | B3 | 900 | 860 | 선체가 정확히 폭 900u다(:745). 판정이 40u 좁다 |
 * | B4 | 420 | 460 | 바퀴가 ±0.54w + 반경 0.14w까지 나간다(:792). 판정이 바퀴를 덮는다 |
 * | B5 | 980 | 900 | B3와 같은 shape이고 폭만 다르다. 판정이 80u 좁다 |
 */
export const BOSS_SILHOUETTE_WIDTH_U = {
  B1: 300, B2: 300, B3: 900, B4: 420, B5: 980,
} as const satisfies Record<BossId, number>;

/** engine.js:434. warship만 폭에서 유도하지 않는다 — 선체는 넓고 얕아서 폭에서 뽑으면 마스트가 갑판
 * 위 천 단위로 솟는다. warship이 잡몹 실루엣 목록(ids.ts `EnemySpriteId`)에 없어 이 분기는 보스에서만
 * 도달 가능하고, 그래서 이 규칙의 자리가 여기다 */
const WARSHIP_HEIGHT_U = 320;
const SILHOUETTE_HEIGHT_SCALE = 1.05;

export function bossSilhouetteHeightU(shape: BossSpriteId, widthU: number): number {
  return shape === 'warship' ? WARSHIP_HEIGHT_U : widthU * SILHOUETTE_HEIGHT_SCALE;
}

/**
 * 공통 헤더(engine.js:397-435)가 계산해 넘기는 값. 이 파일은 읽기만 한다. 필드는 순서대로 목업의
 * `def.w` · `h`(:434) · `hot`(:429) · `body`(:430) · `seam`(:431) · `e.charge > 0`(:425)이다.
 *
 * `charging`이 켜지면 본체 안의 무언가가 반드시 바뀐다 — §15.1이 발사 예비동작을 "본체의 상태
 * 변화**만으로**" 읽히게 하라고 요구한다(12 §7.5-정정). B1은 화승과 군배, B4는 포구가 그 자리다.
 */
export interface BossSilhouette {
  readonly widthU: number;
  readonly heightU: number;
  readonly hot: string;
  readonly body: string;
  readonly seam: string;
  readonly charging: boolean;
}

/** 몇 번째 페이즈인가. `warship`만 읽는다. `index`는 0부터, `count`는 `phases.length`(B3 3 · B5 4) */
export interface BossPhaseView {
  readonly index: number;
  readonly count: number;
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawEnemy `commander` case (664-703) — 그대로
 *
 * 진막 — 지휘소를 치는 장막. 세로 띠와 좌우 표기, 문장 원반. 이만큼 넓은 실루엣은 이것뿐이라
 * B1은 폭으로 먼저 읽힌다.
 */
export function drawCommander(ctx: CanvasRenderingContext2D, s: BossSilhouette): void {
  const w = s.widthU; // 목업의 `w`·`h`를 그대로 쓴다. 이름을 늘리면 아래 좌표식이 줄바꿈으로 흩어진다
  const h = s.heightU;
  ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.85); ctx.lineWidth = 5;
  for (const k of MIRROR) {
    ctx.beginPath(); ctx.moveTo(k * w * 0.72, h * 0.1); ctx.lineTo(k * w * 0.72, -h * 0.66); ctx.stroke();
    ctx.fillStyle = hexA(PALETTE.jeok, 0.5);
    ctx.fillRect(k * w * 0.72 - (k < 0 ? w * 0.22 : 0), -h * 0.66, w * 0.22, h * 0.3);
    ctx.fillStyle = hexA(PALETTE.jeokHot, 0.55);
    ctx.beginPath(); ctx.arc(k * w * 0.72 + (k < 0 ? -w * 0.11 : w * 0.11), -h * 0.51, w * 0.05, 0, FULL_TURN_RAD); ctx.fill();
  }
  ctx.fillStyle = COMMANDER_CURTAIN; ctx.strokeStyle = s.hot; ctx.lineWidth = 4;
  poly(ctx, [[-w * 0.82, -h * 0.06], [w * 0.82, -h * 0.06], [w * 0.74, h * 0.3], [-w * 0.74, h * 0.3]]); ctx.fill(); ctx.stroke();
  ctx.fillStyle = hexA(PALETTE.jeokDim, 0.5);
  for (let bd2 = -3; bd2 <= 3; bd2 += 2) { ctx.fillRect(bd2 * w * 0.2 - w * 0.05, -h * 0.06, w * 0.1, h * 0.36); }
  ctx.strokeStyle = hexA(PALETTE.jeok, 0.55); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-w * 0.8, h * 0.06); ctx.lineTo(w * 0.8, h * 0.06); ctx.stroke();
  // 화승 5개. 예비동작이 본체 안에서 읽히는 자리다 — 밝기가 아니라 「불이 붙었나」로 읽힌다
  ctx.fillStyle = s.charging ? hexA(PALETTE.jeokHot, 0.9) : hexA(PALETTE.jeokDim, 0.8);
  for (let g2 = -2; g2 <= 2; g2 += 1) { ctx.fillRect(g2 * w * 0.26 - w * 0.055, -h * 0.02, w * 0.11, h * 0.13); }
  /* 대장 본인. 진막 위로 솟아 있다 */
  ctx.fillStyle = COMMANDER_TORSO; ctx.strokeStyle = s.hot; ctx.lineWidth = 4;
  poly(ctx, [[-w * 0.12, -h * 0.06], [w * 0.12, -h * 0.06], [w * 0.15, -h * 0.42], [-w * 0.15, -h * 0.42]]); ctx.fill(); ctx.stroke();
  lamellae(ctx, w * 0.13, -h * 0.38, -h * 0.1, 3, s.seam);
  visor(ctx, w * 0.55, -h * 0.4, s.hot);
  jingasa(ctx, -h * 0.44, w * 0.32, w * 0.2, s.hot);
  /* 군배 — 일제사격을 부를 때 치켜드는 부채 */
  ctx.strokeStyle = PALETTE.baek; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(w * 0.14, -h * 0.28); ctx.lineTo(w * 0.34, -h * 0.44); ctx.stroke();
  ctx.fillStyle = hexA(PALETTE.baek, s.charging ? 0.85 : 0.5);
  poly(ctx, [[w * 0.34, -h * 0.44], [w * 0.52, -h * 0.6], [w * 0.6, -h * 0.44], [w * 0.42, -h * 0.34]]); ctx.fill();
}

/**
 * 이식: docs/sample_image/_shared/engine.js drawEnemy `samurai` case (705-741) — 그대로
 *
 * 오오요로이에 뿔 달린 투구. **위로 솟는 뾰족한 것은 게임 전체에서 이 실루엣뿐이다** — 잡몹 아홉과
 * 나머지 보스 셋은 전부 아래로 벌어지므로 뿔이 곧 B2의 식별자다. 이도류가 ±0.94w까지 뻗지만 판정
 * 폭은 240u다(위 표): **칼에 닿아도 맞지 않는 것이 규칙**이고, 칼을 줄이면 규칙이 그림에서 사라진다.
 */
export function drawSamurai(ctx: CanvasRenderingContext2D, s: BossSilhouette): void {
  const w = s.widthU;
  const h = s.heightU;
  ctx.fillStyle = s.body; ctx.strokeStyle = s.hot; ctx.lineWidth = 4.5;
  poly(ctx, [[-w * 0.22, -h * 0.06], [w * 0.22, -h * 0.06], [w * 0.34, h * 0.44], [0, h * 0.62], [-w * 0.34, h * 0.44]]); ctx.fill(); ctx.stroke();
  /* 소데 — 줄로 엮은 큼직한 사각 어깨판 */
  for (const k of MIRROR) {
    ctx.fillStyle = hexA(PALETTE.jeok, 0.4);
    poly(ctx, [[k * w * 0.5, -h * 0.1], [k * w * 0.2, -h * 0.1], [k * w * 0.24, h * 0.24], [k * w * 0.54, h * 0.2]]);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.jeokHot, 0.45); ctx.lineWidth = 1.6;
    for (let sr = 1; sr <= 3; sr += 1) {
      const sy = -h * 0.1 + sr * h * 0.08;
      ctx.beginPath(); ctx.moveTo(k * w * 0.21, sy); ctx.lineTo(k * w * 0.52, sy - h * 0.008); ctx.stroke();
    }
  }
  lamellae(ctx, w * 0.24, h * 0.02, h * 0.42, 4, s.seam);
  ctx.fillStyle = s.hot;
  poly(ctx, [[-w * 0.26, -h * 0.06], [w * 0.26, -h * 0.06], [w * 0.11, -h * 0.3], [-w * 0.11, -h * 0.3]]); ctx.fill();
  poly(ctx, [[-w * 0.08, -h * 0.26], [-w * 0.46, -h * 0.7], [-w * 0.15, -h * 0.4]]); ctx.fill();
  poly(ctx, [[w * 0.08, -h * 0.26], [w * 0.46, -h * 0.7], [w * 0.15, -h * 0.4]]); ctx.fill();
  /* 마에다테 — 두 뿔 사이의 앞장식 */
  ctx.fillStyle = hexA(PALETTE.baek, 0.7);
  poly(ctx, [[0, -h * 0.32], [w * 0.05, -h * 0.46], [0, -h * 0.52], [-w * 0.05, -h * 0.46]]); ctx.fill();
  visor(ctx, w * 0.9, -h * 0.2, s.hot);
  /* 이도류 — 장도와 단도를 좌우로 벌려 든다 */
  ctx.strokeStyle = PALETTE.baek; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.16); ctx.lineTo(-w * 0.94, h * 0.46); ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.16); ctx.lineTo(w * 0.84, h * 0.5); ctx.stroke();
  ctx.strokeStyle = hexA(PALETTE.jeok, 0.8); ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.16); ctx.lineTo(-w * 0.4, h * 0.21); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.16); ctx.lineTo(w * 0.39, h * 0.22); ctx.stroke();
}

/** 마스트 3개(engine.js:780)와 누각 총안 5개(:774). 페이즈 표시가 이 두 수에 걸린다 */
const WARSHIP_MAST_COUNT = 3;
const WARSHIP_EMBRASURE_COUNT = 5;

/**
 * 이식: docs/sample_image/_shared/engine.js drawEnemy `warship` case (743-789) — **수정**
 *
 * 아타케부네: 낮은 선체 위에 상자형 누각, 아래로 노, 위로 지붕. B3와 B5가 같은 실루엣을 쓰고 폭만
 * 900u / 980u로 다르다(engine.js:69·71).
 *
 * **수정한 것은 페이즈 표시 둘뿐이다**(06 §1.6). 폭 8% 차이로는 B3의 3페이즈와 B5의 4페이즈를
 * 구분할 수 없는데 §10.4·§10.6의 페이즈는 각각 다른 패턴군을 뜻한다. HUD 보스 바가 눈금으로 같은
 * 정보를 갖지만 전투 중 플레이어는 HUD를 안 본다 — 06 §5.8이 예고 맥동을 두 곳에 동시에 둔 이유다.
 *
 * **규칙 둘. 지우면 페이즈가 다시 안 보이게 된다:**
 * - **깃발 수 = 남은 페이즈 수** (마스트 3개가 상한). 넘어갈 때마다 오른쪽 깃발부터 내려가고
 *   마스트는 그대로 서 있어서 「내려갔다」가 빈 마스트로 읽힌다.
 * - **불 켜진 총안 수 = 현재 페이즈 번호.** 왼쪽부터 채워진다.
 *
 * 방향이 반대라서 둘을 함께 둔다 — 깃발은 줄고 총안은 는다. 한 축만 두면 B5의 페이즈 1과 2가
 * 마스트 3개 상한에 걸려 같은 그림이 된다. 총안 발광은 `charging`과 축이 다르다: 예비동작은 밝기가
 * 오르내리는 신호이고 이것은 **몇 개가 켜졌나**라 세는 신호이므로, 같은 색이어도 서로를 안 지운다.
 */
export function drawWarship(ctx: CanvasRenderingContext2D, s: BossSilhouette, phase: BossPhaseView): void {
  const w = s.widthU;
  const h = s.heightU;
  const flagsFlown = Math.max(phase.count - phase.index, 0);
  const embrasuresLit = phase.index + 1;
  ctx.fillStyle = WARSHIP_HULL;
  poly(ctx, [[-w / 2, -h * 0.18], [w / 2, -h * 0.18], [w * 0.4, h * 0.34], [-w * 0.4, h * 0.34]]); ctx.fill(); ctx.stroke();
  // 목업의 `hexA('#05070c', 0.8)`(764)를 ink900으로 읽는다. 채널 차 (1,0,2)이고, 선체에 그은 판재
  // 그늘이라 바탕 검정과 같은 토큰이 맞다 — render/enemy-parts.ts가 같은 리터럴을 같게 처리했다
  ctx.strokeStyle = hexA(PALETTE.ink900, 0.8); ctx.lineWidth = 2;
  for (let pl = 0; pl < 3; pl += 1) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.48 + pl * 4, -h * 0.06 + pl * h * 0.12); ctx.lineTo(w * 0.48 - pl * 4, -h * 0.06 + pl * h * 0.12);
    ctx.stroke();
  }
  ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.6); ctx.lineWidth = 3;
  for (let oar = -7; oar <= 7; oar += 1) {
    ctx.beginPath(); ctx.moveTo(oar * w * 0.06, h * 0.3); ctx.lineTo(oar * w * 0.06 + 14, h * 0.56); ctx.stroke();
  }
  /* 뱃전을 따라 늘어선 방패. 문장 원반이 하나 걸러 하나씩 진하다 */
  for (let shd = -8; shd <= 8; shd += 1) {
    ctx.fillStyle = hexA(PALETTE.jeok, shd % 2 ? 0.3 : 0.14);
    ctx.fillRect(shd * w * 0.055 - w * 0.021, -h * 0.27, w * 0.042, h * 0.1);
  }
  ctx.fillStyle = WARSHIP_TOWER; ctx.fillRect(-w * 0.28, -h * 0.62, w * 0.56, h * 0.44);
  ctx.strokeStyle = s.hot; ctx.lineWidth = 4; ctx.strokeRect(-w * 0.28, -h * 0.62, w * 0.56, h * 0.44);
  ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.6); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-w * 0.28, -h * 0.4); ctx.lineTo(w * 0.28, -h * 0.4); ctx.stroke();
  for (let win = 0; win < WARSHIP_EMBRASURE_COUNT; win += 1) {
    const slot = win - 2; // 목업의 `for (win = -2; win <= 2)` 자리. 왼쪽부터 세려고 0 기준으로 돌린다
    ctx.fillStyle = win < embrasuresLit ? hexA(PALETTE.jeokHot, 0.55) : hexA(PALETTE.jeok, 0.22);
    ctx.fillRect(slot * w * 0.1 - w * 0.025, -h * 0.56, w * 0.05, h * 0.13);
  }
  tiledRoof(ctx, 0, -h * 0.62, w * 0.72, h * 0.26, WARSHIP_ROOF, hexA(PALETTE.jeok, 0.5));
  ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.8); ctx.lineWidth = 3;
  for (let i = 0; i < WARSHIP_MAST_COUNT; i += 1) {
    const mast = i - 1; // 목업의 `for (mast = -1; mast <= 1)`
    ctx.beginPath(); ctx.moveTo(mast * w * 0.34, -h * 0.18); ctx.lineTo(mast * w * 0.34, -h * 0.78); ctx.stroke();
    if (i >= flagsFlown) {
      continue; // 내려간 깃발. 마스트만 남는다
    }
    ctx.fillStyle = hexA(PALETTE.jeok, 0.45);
    ctx.fillRect(mast * w * 0.34, -h * 0.78, w * 0.075, h * 0.18);
    ctx.fillStyle = hexA(PALETTE.jeokHot, 0.4);
    ctx.beginPath(); ctx.arc(mast * w * 0.34 + w * 0.037, -h * 0.69, w * 0.018, 0, FULL_TURN_RAD); ctx.fill();
  }
}

/** 화차 포신 3문(engine.js:797)과 포신 테 2줄(:804) */
const ARTILLERY_BAND_FRACS = [0.06, 0.18] as const;

/**
 * 이식: docs/sample_image/_shared/engine.js drawEnemy `artillery` case (791-826) — 그대로
 *
 * 화차 — 바퀴 달린 포가. 포신 셋, 화약통, 깃발. 판정 폭 460u를 만드는 부품이 바퀴다(위 표).
 */
export function drawArtillery(ctx: CanvasRenderingContext2D, s: BossSilhouette): void {
  const w = s.widthU;
  const h = s.heightU;
  spokedWheel(ctx, -w * 0.54, h * 0.26, w * 0.14, hexA(PALETTE.jeokDim, 0.95));
  spokedWheel(ctx, w * 0.54, h * 0.26, w * 0.14, hexA(PALETTE.jeokDim, 0.95));
  ctx.fillStyle = s.body; ctx.strokeStyle = s.hot; ctx.lineWidth = 4;
  poly(ctx, [[-w * 0.52, -h * 0.14], [w * 0.52, -h * 0.14], [w * 0.42, h * 0.28], [-w * 0.42, h * 0.28]]); ctx.fill(); ctx.stroke();
  for (let k = -1; k <= 1; k += 1) {
    ctx.fillStyle = ARTILLERY_TUBE; ctx.fillRect(k * w * 0.28 - w * 0.11, -h * 0.12, w * 0.22, h * 0.3);
    ctx.strokeStyle = s.hot; ctx.lineWidth = 4; ctx.strokeRect(k * w * 0.28 - w * 0.11, -h * 0.12, w * 0.22, h * 0.3);
    ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.9); ctx.lineWidth = 2.2;
    for (const f of ARTILLERY_BAND_FRACS) {
      ctx.beginPath();
      ctx.moveTo(k * w * 0.28 - w * 0.11, -h * 0.12 + h * f); ctx.lineTo(k * w * 0.28 + w * 0.11, -h * 0.12 + h * f);
      ctx.stroke();
    }
    // 포구 셋이 함께 달아오르는 것이 B4의 발사 예비동작이다 (§15.1 「본체의 상태 변화만으로」)
    ctx.fillStyle = s.charging ? hexA(PALETTE.jeokHot, 0.55) : ARTILLERY_BORE;
    ctx.beginPath(); ctx.arc(k * w * 0.28, h * 0.14, w * 0.085, 0, FULL_TURN_RAD); ctx.fill();
  }
  /* 포가에 동여맨 화약통 */
  ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.85); ctx.lineWidth = 2.4;
  for (const k of MIRROR) {
    ctx.beginPath(); ctx.ellipse(k * w * 0.44, h * 0.06, w * 0.06, w * 0.09, 0, 0, FULL_TURN_RAD); ctx.stroke();
  }
  ctx.strokeStyle = hexA(PALETTE.jeokDim, 0.85); ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -h * 0.14); ctx.lineTo(0, -h * 0.66); ctx.stroke();
  ctx.fillStyle = hexA(PALETTE.jeok, 0.5); ctx.fillRect(0, -h * 0.66, w * 0.2, h * 0.26);
  ctx.fillStyle = hexA(PALETTE.jeokHot, 0.5);
  ctx.beginPath(); ctx.arc(w * 0.1, -h * 0.53, w * 0.04, 0, FULL_TURN_RAD); ctx.fill();
}

/**
 * 실루엣 하나를 그린다. 부르는 쪽은 공통 헤더를 이미 돌린 상태다.
 * `BossSpriteId`가 4종이라 기본 갈래를 두지 않는다 — union이 늘면 컴파일이 먼저 깨진다.
 */
export function drawBossSilhouette(
  ctx: CanvasRenderingContext2D,
  shape: BossSpriteId,
  silhouette: BossSilhouette,
  phase: BossPhaseView,
): void {
  switch (shape) {
    case 'commander': drawCommander(ctx, silhouette); break;
    case 'samurai': drawSamurai(ctx, silhouette); break;
    case 'warship': drawWarship(ctx, silhouette, phase); break;
    case 'artillery': drawArtillery(ctx, silhouette); break;
  }
}

/**
 * 신규: B3 포문 4기의 개별 게이지 — 스펙 §15.1 · 10_스펙_목업_불일치.md A22
 *
 * **셰이크 변환 안쪽에서 부른다.** 목업은 이것을 `scene.overlay`에서 그려 셰이크 밖에 뒀는데
 * (06_boss3_atakebune/scene.js:47-60), 셰이크 `translate`는 engine.js:1936에서 시작해 :1975에서
 * 끝나고 overlay는 그 뒤다. 포문 본체는 :1947이라 셰이크 안이다 — 최대 진폭 26u에서 폭 130u
 * 게이지가 자기 포문에서 26u까지 떨어져 나간다. **HUD가 셰이크 밖인 것은 의도된 것이고 옳다**
 * (고정된 HUD가 판독 기준이 된다) — 구분 기준은 "화면에 붙었나, 월드 오브젝트에 붙었나"다.
 *
 * 좌표는 월드다. 보스 중심에 `config/bosses/*`의 `offsetU`를 더하므로 실루엣 함수들과 다른 프레임에서
 * 부른다 — 개체 로컬 변환 안에서 부르면 오프셋이 두 번 걸린다. `hpByPart`는 `BOSSES[bossId].parts`와 **같은 순서**의 현재 HP다. sim이 부위를 config 순서로 들고
 * 있다는 계약이고, 어긋나면 왼쪽 포문의 게이지가 오른쪽 포문 위에 뜬다. 부위가 없는 보스
 * (B1·B2·B4·B5)는 아무것도 그리지 않는다.
 */
export function drawBossPartGauges(
  ctx: CanvasRenderingContext2D,
  bossId: BossId,
  bossXU: number,
  bossYU: number,
  hpByPart: readonly number[],
): void {
  // `as const satisfies BossDef`가 다섯을 서로 다른 리터럴 타입으로 좁혀 놔서 union에는 parts가
  // 없다. BossDef로 넓혀 읽어야 `parts?`가 선언된 그대로의 선택적 필드로 돌아온다
  const def: BossDef = BOSSES[bossId];
  if (def.parts === undefined) {
    return;
  }
  let i = 0;
  for (const part of def.parts) {
    drawPartHpGauge(ctx, bossXU + part.offsetU.xU, bossYU + part.offsetU.yU, hpByPart[i] ?? 0, part.hp);
    i += 1;
  }
}

/**
 * 06 §5.8. HUD 보스 바의 다음 눈금이 **같은 주기**로 폭 3u ↔ 9u로 맥동한다(render/hud.ts) —
 * 두 값이 갈리면 화면 위쪽과 보스 본체가 다른 박자로 뛰어 하나의 사건으로 안 읽힌다.
 */
const PHASE_TELEGRAPH_PERIOD_SEC = 1.6;
const PHASE_TELEGRAPH_ALPHA_MAX = 0.6;
const PHASE_TELEGRAPH_STROKE_U = 5;

/**
 * 목업 case가 이미 `hot`으로 긋는 본체 다각형 그대로다. 같은 경로를 다시 그어야 「본체 외곽선」이
 * 되고, 히트박스 사각형을 그으면 그건 판정 상자지 본체가 아니다.
 */
function bossOutline(shape: BossSpriteId, w: number, h: number): readonly PolyPoint[] {
  switch (shape) {
    case 'commander': // engine.js:674 진막
      return [[-w * 0.82, -h * 0.06], [w * 0.82, -h * 0.06], [w * 0.74, h * 0.3], [-w * 0.74, h * 0.3]];
    case 'samurai': // engine.js:707 몸통. 칼과 뿔은 뺀다 — 판정도 그것들을 뺐다
      return [[-w * 0.22, -h * 0.06], [w * 0.22, -h * 0.06], [w * 0.34, h * 0.44], [0, h * 0.62], [-w * 0.34, h * 0.44]];
    case 'warship': // engine.js:745 선체
      return [[-w / 2, -h * 0.18], [w / 2, -h * 0.18], [w * 0.4, h * 0.34], [-w * 0.4, h * 0.34]];
    case 'artillery': // engine.js:795 포가
      return [[-w * 0.52, -h * 0.14], [w * 0.52, -h * 0.14], [w * 0.42, h * 0.28], [-w * 0.42, h * 0.28]];
  }
}

/**
 * 신규: 보스 페이즈 전환 예고 — 스펙 §17 · 06 §5.8
 *
 * §17이 "패턴이 바뀐다는 사실을 **사전에** 알린다"고 적었다. 바뀐 뒤 알리는 것은 요건 미달이다.
 * 눈금(어디서 바뀌는가)은 HUD 보스 바가 갖고, 이 함수는 예고(곧 바뀐다)만 만든다. 본체 외곽선이
 * `jeok` 선폭 5로 alpha 0.0 ↔ 0.6을 오간다. **켜고 끄는 구간은 이 함수가 모른다** — 보스 HP가 다음
 * 임계값 + 3%에 닿는 순간부터 부르는 것은 호출부다.
 *
 * **탄막에 묻히면 안 되는 자리다.** 전환 연출 1.2초(BOSS_COMMON.phaseTransitionSec) 동안 보스는
 * 무적이고 신규 발사가 멈추지만 기존 탄환은 유지되므로(HR-03) 화면이 비지 않는다. 외곽선을 고른
 * 이유가 그것이다 — 탄환은 원과 호뿐이라 실루엣 윤곽과 겹칠 도형이 없고, 글로우가 포화돼도 선은
 * 형태로 남는다(12 §7.5-정정의 「명암」 축과 같은 원리).
 *
 * 개체 로컬 프레임, 셰이크 안쪽 — 실루엣 함수들과 같은 프레임이다. `elapsedSec`는 realDt 누적이다
 * (연출이므로 sim의 FIXED_DT가 아니다).
 */
export function drawBossPhaseTelegraph(
  ctx: CanvasRenderingContext2D,
  shape: BossSpriteId,
  silhouette: BossSilhouette,
  elapsedSec: number,
): void {
  // cos가 0에서 1이므로 (1 − cos)/2는 0에서 시작한다. 예고가 켜지는 첫 프레임이 번쩍이지 않는다
  const pulse = (1 - Math.cos((elapsedSec / PHASE_TELEGRAPH_PERIOD_SEC) * FULL_TURN_RAD)) / 2;
  ctx.strokeStyle = hexA(PALETTE.jeok, pulse * PHASE_TELEGRAPH_ALPHA_MAX);
  ctx.lineWidth = PHASE_TELEGRAPH_STROKE_U;
  poly(ctx, bossOutline(shape, silhouette.widthU, silhouette.heightU));
  ctx.stroke();
}
