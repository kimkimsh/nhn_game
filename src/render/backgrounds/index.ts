/**
 * 배경 표와 정적 레이어 굽기 — 06 §3.2 · 02 §5.3
 *
 * 두 가지를 갖는다. 어느 배경이 어느 함수들인지(`BACKGROUNDS`), 그리고 그 중 정적인 것을
 * 스테이지 진입 시 구워 두고 프레임에서는 `drawImage`로 끝내는 관리자다.
 *
 * **`BackgroundId`로 고른다. `StageId`가 아니다.** config/ids.ts:89-95가 그렇게 정했다 —
 * 배경 함수의 소유자가 스테이지 정의가 아니므로 이름으로 이어야 스테이지 순서를 바꿔도 매핑이
 * 안 깨진다. 부르는 쪽은 `STAGES[stageId].background`를 넘긴다.
 *
 * **`BG.void`(engine.js:1651-1654)는 이식하지 않았다.** 목업에서 그것은 스테이지 배경 함수가
 * 없을 때의 폴백인데 목업의 어느 화면도 쓰지 않았고, 실게임에는 언제나 현재 스테이지가 있다.
 * 카드 선택·결과·일시정지의 배경은 전투 프레임을 그리고 딤을 얹는 것으로 확정됐다(12 §1 C-02).
 * 그래서 폴백 칸이 없고, 표가 `BackgroundId` 다섯 칸을 전부 덮는다.
 */

import type { BackgroundId } from '../../config/ids';
import { PLAYFIELD } from '../../config/playfield';
import { drawBusanjinDynamic, drawBusanjinStatic } from './busanjin';
import { drawDongnaeseongDynamic, drawDongnaeseongStatic } from './dongnaeseong';
import { drawHaengjuDynamic, drawHaengjuStatic } from './haengju';
import {
  drawHansandoDynamicSpray, drawHansandoDynamicWaves,
  drawHansandoStaticDeck, drawHansandoStaticWater,
} from './hansando';
import { drawNoryangDynamic, drawNoryangStatic } from './noryang';

const PLAYFIELD_WIDTH_U = PLAYFIELD.widthU;
const PLAYFIELD_HEIGHT_U = PLAYFIELD.heightU;

/**
 * 시간에 안 걸리는 레이어. **오프스크린 굽기 안에서만 불린다.**
 *
 * `renderSeed`를 받는 것은 정적 레이어에 시드 잡음을 쓰는 배경(S4 별자리) 때문이고(D-05),
 * 난수가 없는 배경은 인자를 안 받아도 된다 — 인자가 적은 함수는 그대로 대입된다.
 */
export type BackgroundStaticDraw = (ctx: CanvasRenderingContext2D, renderSeed: number) => void;

/**
 * 시간에 걸리는 레이어. 매 프레임 구운 한 장 위에 그린다.
 *
 * `tSec`는 **스테이지 진입 기준** 경과 시간이고 연출이므로 realDt로 흐른다. 런 전체 누적을
 * 넘기면 `embers`의 상승 감기가 288초부터 깨진다(backgrounds/primitives.ts embers 주석).
 */
export type BackgroundDynamicDraw = (
  ctx: CanvasRenderingContext2D,
  tSec: number,
  renderSeed: number,
) => void;

/**
 * 배경 한 겹 — 구울 정적 하나와 그 **바로 위**에 오는 동적 하나.
 *
 * 겹이 배열인 이유는 한산도다. 거북선 갑판은 정적인데 청해파문보다 **위**여야 하고
 * (`hansando.ts` drawHansandoDynamicWaves 주석 — 파도가 갑판 위로 올라가면 배가 물 속에
 * 있는 그림이 된다), 그러면 정적 한 장 위에 동적 전부를 얹는 형태로는 그 순서를 못 만든다.
 * 그래서 겹마다 오프스크린을 하나씩 갖고 `정적₀ → 동적₀ → 정적₁ → 동적₁` 순으로 그린다.
 *
 * 대가는 S3만 오프스크린 두 장(16.6MB)이라는 것이다. 06 §3.2가 막은 것은 5스테이지를 전부
 * 상주시키는 41.5MB이고 여기는 현재 스테이지 것만 들고 있으므로 그 선 안이다. 프레임 비용은
 * `drawImage` 한 번(호출 +1)과 전면 합성 2.07M px인데, 실측 fill-rate 여유가 10.5배다(13 §4.1).
 */
export interface BackgroundLayer {
  readonly drawStatic: BackgroundStaticDraw;
  readonly drawDynamic: BackgroundDynamicDraw;
}

/**
 * 배경 5종. 스테이지 파일이 내보낸 함수를 여기서 구조적으로 검사한다 — 모양이 어긋나면 그
 * 파일이 아니라 이 대입이 깨지므로, 스테이지 파일은 이 파일의 타입을 import하지 않아도 된다.
 */
export const BACKGROUNDS = {
  // §9.3 부산진 새벽
  busanjin: [{ drawStatic: drawBusanjinStatic, drawDynamic: drawBusanjinDynamic }],
  // §9.4 동래성 함락
  dongnaeseong: [{ drawStatic: drawDongnaeseongStatic, drawDynamic: drawDongnaeseongDynamic }],
  // §9.5 한산도 앞바다 — 갑판이 파문 위에 와야 해서 두 겹이다
  hansando: [
    { drawStatic: drawHansandoStaticWater, drawDynamic: drawHansandoDynamicWaves },
    { drawStatic: drawHansandoStaticDeck, drawDynamic: drawHansandoDynamicSpray },
  ],
  // §9.6 행주산성
  haengju: [{ drawStatic: drawHaengjuStatic, drawDynamic: drawHaengjuDynamic }],
  // §9.7 노량 최후의 밤
  noryang: [{ drawStatic: drawNoryangStatic, drawDynamic: drawNoryangDynamic }],
} as const satisfies Record<BackgroundId, readonly BackgroundLayer[]>;

/** 구운 정적 한 장과 그 위에 얹을 동적 하나. 둘이 갈리면 겹 순서가 틀어지므로 한 쌍으로 든다 */
interface BakedLayer {
  readonly image: CanvasImageSource;
  readonly drawDynamic: BackgroundDynamicDraw;
}

/**
 * 구워 둔 배경. **스테이지 하나 분량만 들고 있는다.**
 *
 * 한 장이 8.3MB(1080×1920×4)라 5스테이지를 전부 상주시키면 41.5MB다(06 §3.2). 그래서 캐시가
 * 아니라 슬롯 하나이고, 다음 스테이지를 구우면 앞의 것은 참조가 끊겨 회수된다.
 *
 * `renderSeed`까지 들고 있는 이유는 S4 별자리가 시드에서 나오기 때문이다 — 시드가 다른 런에서
 * 앞 런의 하늘을 그대로 쓰면 결정론이 그림에서만 깨진 채로 안 드러난다.
 */
interface BakedBackground {
  readonly backgroundId: BackgroundId;
  readonly renderSeed: number;
  readonly layers: readonly BakedLayer[];
}

let baked: BakedBackground | null = null;
let staleBakeReported = false;

/**
 * 정적 레이어를 굽는다. **`screens/play.ts`의 `entering` 상태에서 부른다**(12 §3.3) —
 * 스테이지명 1.2초 동안 sim이 멈춰 있는 그 구간이다.
 *
 * S2 기준 path op이 약 350개라 한 프레임 안에 끝나지만, 그 프레임이 전투 첫 프레임이 되면
 * 안 된다(06 §3.3). 부르는 것은 P6-1이고 이 파일은 부를 시점을 모른다.
 */
export function bakeStageBackground(backgroundId: BackgroundId, renderSeed: number): void {
  baked = bakeStaticLayers(backgroundId, renderSeed);
}

/** 스테이지를 떠날 때 부른다. 8.3MB를 다음 굽기까지 들고 있을 이유가 없다 */
export function disposeStageBackground(): void {
  baked = null;
}

/** 굽기가 끝났는지. `entering` 상태가 다음 상태로 넘어가도 되는지 판단하는 데 쓴다 */
export function isStageBackgroundBaked(backgroundId: BackgroundId, renderSeed: number): boolean {
  return matchesBake(baked, backgroundId, renderSeed);
}

/**
 * 레이어 1 — 구운 것과 동적인 것을 겹 순서대로(06 §2). `render/frame.ts`가 흔들림 변위 안에서
 * 부른다.
 *
 * **창 크기가 바뀌어도 다시 굽지 않는다.** 굽기가 논리 단위 고정 래스터(1080×1920u)라 DPR과
 * 무관하고, 되려 리사이즈마다 다시 구우면 350 path op + 8.3MB fill이 전투 프레임 한가운데로
 * 들어간다 — 06 §3.3이 막으려던 바로 그것이다. 02 §5.3의 "캔버스 크기가 바뀔 때만 다시
 * 굽는다"는 굽기를 화면 픽셀로 하는 설계를 전제한 문장이고, 이 구현은 그 전제를 안 쓴다.
 * 대신 물리 픽셀 폭이 1080을 넘는 화면에서는 이 한 장이 확대되어 문살 선이 무뎌진다.
 */
export function drawStageBackground(
  ctx: CanvasRenderingContext2D,
  backgroundId: BackgroundId,
  tSec: number,
  renderSeed: number,
): void {
  let current = baked;
  if (!matchesBake(current, backgroundId, renderSeed)) {
    reportStaleBake(backgroundId);
    current = bakeStaticLayers(backgroundId, renderSeed);
    baked = current;
  }
  for (const layer of current.layers) {
    ctx.drawImage(layer.image, 0, 0, PLAYFIELD_WIDTH_U, PLAYFIELD_HEIGHT_U);
    layer.drawDynamic(ctx, tSec, renderSeed);
  }
}

function bakeStaticLayers(backgroundId: BackgroundId, renderSeed: number): BakedBackground {
  const layers = BACKGROUNDS[backgroundId].map((layer): BakedLayer => {
    const { canvas, ctx } = createBackgroundOffscreen();
    layer.drawStatic(ctx, renderSeed);
    return { image: canvas, drawDynamic: layer.drawDynamic };
  });
  return { backgroundId, renderSeed, layers };
}

/** 타입 술어인 것은 `drawStageBackground`가 이 검사 하나로 non-null까지 좁히기 위해서다 */
function matchesBake(
  layer: BakedBackground | null,
  backgroundId: BackgroundId,
  renderSeed: number,
): layer is BakedBackground {
  return layer !== null && layer.backgroundId === backgroundId && layer.renderSeed === renderSeed;
}

/**
 * 안 구워진 배경을 프레임에서 요청하는 것은 배선 실수다 — dev에서는 던진다.
 *
 * 제출 빌드에서는 던지지 않고 그 자리에서 굽는다. 프레임 하나가 튀는 것이 예외 하나로 화면이
 * 멈추는 것보다 낫다는 판단이고, render/primitives.ts의 `getGlowSprite`가 목록 밖 색에
 * 쓰는 정책과 같다. 콘솔에는 한 번만 남긴다.
 */
function reportStaleBake(backgroundId: BackgroundId): void {
  if (import.meta.env.DEV) {
    throw new Error(
      `배경 정적 레이어가 안 구워졌다: ${backgroundId}. `
      + 'screens/play.ts의 entering 상태에서 bakeStageBackground를 부른다 (12 §3.3)',
    );
  }
  if (!staleBakeReported) {
    staleBakeReported = true;
    console.error('배경 굽기 없이 프레임이 그려졌다', backgroundId);
  }
}

interface Offscreen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

/** 논리 해상도 그대로 굽는다. 06 §3.2가 이 한 장을 8.3MB로 세어 예산에 넣었다 */
function createBackgroundOffscreen(): Offscreen {
  const canvas = document.createElement('canvas');
  canvas.width = PLAYFIELD_WIDTH_U;
  canvas.height = PLAYFIELD_HEIGHT_U;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('배경 오프스크린 2d 컨텍스트를 얻지 못했다');
  }
  return { canvas, ctx };
}
