/**
 * 픽셀 대조 — 09 §5.2의 5번, §5.4의 2번.
 *
 * 순수 함수만 둔다. 캔버스도 DOM도 모르고 RGBA 바이트 배열 둘과 마스크 목록만 받는다.
 * 그래야 이 파일이 브라우저(하네스 페이지) 안에서도 돌고 vitest(node) 안에서도 그대로 돈다 —
 * 대조기가 틀렸는지는 브라우저 없이 확인할 수 있어야 한다.
 *
 * **이 파일은 합격을 선언하지 않는다.** 09 §5.4가 최종 판정을 사람에게 맡겼으므로 여기서
 * 나오는 것은 전부 "얼마나, 어디가" 다른가 하는 수치뿐이고, 그 수치를 임계값과 비교하는 자리는
 * 리포트를 읽는 사람이다.
 */

/** 마스크가 붙은 이유. 리포트에 그대로 찍히므로 종류가 곧 사람이 읽을 근거다 */
export type MaskKind =
  /** §5.4-1 폰트 대체로 흔들리는 텍스트 영역 */
  | 'text'
  /** §5.4-3 10_스펙_목업_불일치가 "목업이 틀렸다"로 판정한 자리 — 달라지는 것이 정상이다 */
  | 'ruling'
  /** 06 §5 신규 표시. 게임은 그리고 목업은 그린 적이 없다 */
  | 'new-element';

/** 마스킹 사각형. 좌표는 전부 논리 플레이필드 단위(u)다 — 캔버스 배율은 대조기가 곱한다 */
export interface MaskRect {
  readonly xU: number;
  readonly yU: number;
  readonly widthU: number;
  readonly heightU: number;
  readonly kind: MaskKind;
  /** 근거. 판정 ID('A11')나 문서 절('09 §5.4-1')로 시작한다 */
  readonly reason: string;
}

/** 차이가 몰린 자리를 좁혀 주는 격자 칸 하나 */
export interface DiffCell {
  readonly xU: number;
  readonly yU: number;
  readonly widthU: number;
  readonly heightU: number;
  readonly diffPixels: number;
  readonly maxChannelDelta: number;
}

export interface CompareInput {
  readonly expected: Uint8ClampedArray;
  readonly actual: Uint8ClampedArray;
  /** 픽셀 폭·높이. 논리 단위가 아니다 */
  readonly widthPx: number;
  readonly heightPx: number;
  /** 논리 단위 → 픽셀 배율. 목업 캔버스가 q=2로 잡혀 있으므로 보통 2다 */
  readonly scale: number;
  readonly masks: readonly MaskRect[];
  /** 이 값 이하의 채널 차는 같은 픽셀로 센다 (§5.4-2의 손잡이 ①) */
  readonly channelDelta: number;
  /** 차이 격자 한 칸의 한 변 (u) */
  readonly cellU: number;
}

export interface CompareResult {
  readonly widthPx: number;
  readonly heightPx: number;
  /** 마스크를 뺀 실제 비교 대상 픽셀 수 */
  readonly comparedPixels: number;
  readonly maskedPixels: number;
  /** channelDelta를 넘은 픽셀 수 */
  readonly diffPixels: number;
  /** diffPixels / comparedPixels. §5.4-2의 손잡이 ②가 비교할 값이다 */
  readonly diffRatio: number;
  /** 비교 대상 안에서 관측된 최대 채널 차. 손잡이 ①을 실측으로 정할 때 읽는 값이다 */
  readonly maxChannelDelta: number;
  /** 차이가 많은 순으로 자른 격자 칸. 비어 있으면 다른 픽셀이 없다 */
  readonly worstCells: readonly DiffCell[];
}

/** 리포트에 싣는 격자 칸 수. 넘으면 표가 화면을 넘어가고 좁혀 주는 구실을 못 한다 */
const WORST_CELL_LIMIT = 8;

/** RGBA 한 픽셀이 차지하는 바이트 수 */
const BYTES_PER_PIXEL = 4;

/**
 * 마스크 사각형들을 픽셀 단위 도장으로 편다.
 *
 * 사각형 목록을 픽셀마다 순회하면 8,294,400 × 마스크 수가 되므로 한 번만 펴서 들고 다닌다.
 * 시작은 내림, 끝은 올림이다 — 마스크는 넉넉해야 오탐을 막고, 좁으면 폰트 글리프의 가장자리
 * 한 줄이 그대로 차이로 남는다.
 */
export function rasterizeMasks(
  masks: readonly MaskRect[],
  widthPx: number,
  heightPx: number,
  scale: number,
): Uint8Array {
  const stamp = new Uint8Array(widthPx * heightPx);
  for (const mask of masks) {
    const x0 = Math.max(0, Math.floor(mask.xU * scale));
    const y0 = Math.max(0, Math.floor(mask.yU * scale));
    const x1 = Math.min(widthPx, Math.ceil((mask.xU + mask.widthU) * scale));
    const y1 = Math.min(heightPx, Math.ceil((mask.yU + mask.heightU) * scale));
    for (let y = y0; y < y1; y++) {
      stamp.fill(1, y * widthPx + x0, y * widthPx + x1);
    }
  }
  return stamp;
}

/**
 * 두 RGBA 버퍼를 대조한다. 알파도 채널로 센다 — 오프스크린 캔버스는 투명 픽셀을 가질 수 있고,
 * 배경이 안 그려진 프레임은 RGB가 0이라 알파를 빼면 검은 화면과 구분이 안 된다.
 */
export function comparePixels(input: CompareInput): CompareResult {
  const { expected, actual, widthPx, heightPx, scale, channelDelta, cellU } = input;
  const pixelCount = widthPx * heightPx;
  if (expected.length !== pixelCount * BYTES_PER_PIXEL || actual.length !== pixelCount * BYTES_PER_PIXEL) {
    throw new Error(
      `버퍼 길이가 ${widthPx}×${heightPx} RGBA와 다르다 — expected ${expected.length}, actual ${actual.length}`,
    );
  }

  const stamp = rasterizeMasks(input.masks, widthPx, heightPx, scale);
  const cellPx = Math.max(1, Math.round(cellU * scale));
  const cellCols = Math.ceil(widthPx / cellPx);
  const cellRows = Math.ceil(heightPx / cellPx);
  const cellDiff = new Int32Array(cellCols * cellRows);
  const cellMax = new Int32Array(cellCols * cellRows);

  let comparedPixels = 0;
  let maskedPixels = 0;
  let diffPixels = 0;
  let maxChannelDelta = 0;

  for (let y = 0; y < heightPx; y++) {
    const cellRow = Math.floor(y / cellPx) * cellCols;
    const rowBase = y * widthPx;
    for (let x = 0; x < widthPx; x++) {
      const p = rowBase + x;
      if (stamp[p] === 1) {
        maskedPixels++;
        continue;
      }
      comparedPixels++;
      const i = p * BYTES_PER_PIXEL;
      // 길이는 위에서 확인했다. 채널마다 `?? 0`을 두면 픽셀당 분기가 넷 늘고,
      // 이 루프는 프레임당 8,294,400회 돈다
      const dr = Math.abs((expected[i] as number) - (actual[i] as number));
      const dg = Math.abs((expected[i + 1] as number) - (actual[i + 1] as number));
      const db = Math.abs((expected[i + 2] as number) - (actual[i + 2] as number));
      const da = Math.abs((expected[i + 3] as number) - (actual[i + 3] as number));
      const worst = Math.max(dr, dg, db, da);
      if (worst > maxChannelDelta) {
        maxChannelDelta = worst;
      }
      if (worst <= channelDelta) {
        continue;
      }
      diffPixels++;
      const cell = cellRow + Math.floor(x / cellPx);
      cellDiff[cell] = (cellDiff[cell] as number) + 1;
      if (worst > (cellMax[cell] as number)) {
        cellMax[cell] = worst;
      }
    }
  }

  const cells: DiffCell[] = [];
  for (let index = 0; index < cellDiff.length; index++) {
    const count = cellDiff[index] as number;
    if (count === 0) {
      continue;
    }
    const col = index % cellCols;
    const row = Math.floor(index / cellCols);
    cells.push({
      xU: (col * cellPx) / scale,
      yU: (row * cellPx) / scale,
      widthU: cellPx / scale,
      heightU: cellPx / scale,
      diffPixels: count,
      maxChannelDelta: cellMax[index] as number,
    });
  }
  cells.sort((a, b) => b.diffPixels - a.diffPixels);

  return {
    widthPx,
    heightPx,
    comparedPixels,
    maskedPixels,
    diffPixels,
    diffRatio: comparedPixels === 0 ? 0 : diffPixels / comparedPixels,
    maxChannelDelta,
    worstCells: cells.slice(0, WORST_CELL_LIMIT),
  };
}

/**
 * 사각형 하나 안에서만 다른 픽셀을 센다. 마스크를 걷고 본다.
 *
 * §18.5 치트 오염 띠처럼 **가리면 안 되는 자리**를 위해 있다. 전체 대조에서 그 띠를 빼 두고
 * 여기서 따로 세면, 오염된 기준선이 "차이 없음"으로 통과하는 길이 막힌다.
 */
export function countDiffInRect(
  expected: Uint8ClampedArray,
  actual: Uint8ClampedArray,
  widthPx: number,
  heightPx: number,
  scale: number,
  rect: MaskRect,
  channelDelta: number,
): number {
  const x0 = Math.max(0, Math.floor(rect.xU * scale));
  const y0 = Math.max(0, Math.floor(rect.yU * scale));
  const x1 = Math.min(widthPx, Math.ceil((rect.xU + rect.widthU) * scale));
  const y1 = Math.min(heightPx, Math.ceil((rect.yU + rect.heightU) * scale));
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * widthPx + x) * BYTES_PER_PIXEL;
      const worst = Math.max(
        Math.abs((expected[i] as number) - (actual[i] as number)),
        Math.abs((expected[i + 1] as number) - (actual[i + 1] as number)),
        Math.abs((expected[i + 2] as number) - (actual[i + 2] as number)),
        Math.abs((expected[i + 3] as number) - (actual[i + 3] as number)),
      );
      if (worst > channelDelta) {
        count++;
      }
    }
  }
  return count;
}

/**
 * 사람이 볼 차이 그림을 만든다. 목업을 어둡게 깔고 다른 픽셀만 자홍으로 칠한다.
 *
 * 어둡게 깔린 목업을 남기는 이유는 좌표만으로는 "탄환 하나가 밀렸다"와 "HUD가 통째로 빠졌다"가
 * 같은 숫자로 보이기 때문이다. 마스크된 자리는 원본 밝기의 절반으로 남겨 마스크가 어디를 덮었는지도
 * 같이 보이게 한다.
 */
export function buildDiffImage(input: CompareInput): Uint8ClampedArray {
  const { expected, actual, widthPx, heightPx, scale, channelDelta } = input;
  const stamp = rasterizeMasks(input.masks, widthPx, heightPx, scale);
  const out = new Uint8ClampedArray(widthPx * heightPx * BYTES_PER_PIXEL);
  for (let p = 0; p < widthPx * heightPx; p++) {
    const i = p * BYTES_PER_PIXEL;
    const masked = stamp[p] === 1;
    const dim = masked ? 0.5 : 0.22;
    out[i] = (expected[i] as number) * dim;
    out[i + 1] = (expected[i + 1] as number) * dim;
    out[i + 2] = (expected[i + 2] as number) * dim;
    out[i + 3] = 255;
    if (masked) {
      continue;
    }
    const worst = Math.max(
      Math.abs((expected[i] as number) - (actual[i] as number)),
      Math.abs((expected[i + 1] as number) - (actual[i + 1] as number)),
      Math.abs((expected[i + 2] as number) - (actual[i + 2] as number)),
      Math.abs((expected[i + 3] as number) - (actual[i + 3] as number)),
    );
    if (worst > channelDelta) {
      out[i] = 255;
      out[i + 1] = 40;
      out[i + 2] = 200;
    }
  }
  return out;
}
