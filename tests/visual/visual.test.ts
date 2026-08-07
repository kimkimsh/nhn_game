/**
 * 시각 회귀 하네스의 실행 지점 — 09 §5.
 *
 * 두 종류가 한 파일에 있다.
 *
 * ① **대조기 단위 테스트.** 브라우저 없이 언제나 돈다. 대조기가 틀렸는지는 브라우저를 띄우기
 *    전에 알아야 한다 — 대조기가 조용히 0을 돌려주면 하네스 전체가 "차이 없음"을 찍는다.
 * ② **하네스 실행.** 브라우저 드라이버가 없으면 통째로 건너뛴다. 드라이버는 `devDependencies`
 *    에만 있고(09 §5.2), 하네스는 잘라내기 2순위라 없는 것이 정상 상태 중 하나다.
 *
 * **②는 픽셀에 대해 통과/실패를 판정하지 않는다.** 09 §5.4가 최종 판정을 사람에게 맡겼으므로
 * 여기서 단언하는 것은 "6장에 대해 리포트가 나왔는가" 하나뿐이다. 그것이 P4 게이트다.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { comparePixels, countDiffInRect, rasterizeMasks, type MaskRect } from './compare';
import { loadChromium, runVisualHarness } from './harness';
import { staticMasks, VISUAL_TARGETS } from './targets';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'tests', 'visual', 'out');

/** 단위 테스트용 축소 캔버스 (px). 실제 프레임과 같은 코드를 쓰되 8백만 픽셀을 돌지 않는다 */
const TEST_WIDTH_PX = 8;
const TEST_HEIGHT_PX = 8;
const TEST_SCALE = 2;

function solid(widthPx: number, heightPx: number, rgba: readonly number[]): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = rgba[0] as number;
    buffer[i + 1] = rgba[1] as number;
    buffer[i + 2] = rgba[2] as number;
    buffer[i + 3] = rgba[3] as number;
  }
  return buffer;
}

function baseInput(expected: Uint8ClampedArray, actual: Uint8ClampedArray, masks: readonly MaskRect[]) {
  return {
    expected,
    actual,
    widthPx: TEST_WIDTH_PX,
    heightPx: TEST_HEIGHT_PX,
    scale: TEST_SCALE,
    masks,
    channelDelta: 0,
    cellU: 2,
  };
}

describe('대조기', () => {
  it('같은 버퍼는 다른 픽셀이 0이다', () => {
    const image = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [10, 20, 30, 255]);
    const result = comparePixels(baseInput(image, image.slice(), []));
    expect(result.diffPixels).toBe(0);
    expect(result.diffRatio).toBe(0);
    expect(result.comparedPixels).toBe(TEST_WIDTH_PX * TEST_HEIGHT_PX);
  });

  it('전부 다른 버퍼를 0으로 보고하지 않는다', () => {
    const expected = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [0, 0, 0, 255]);
    const actual = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [255, 0, 0, 255]);
    const result = comparePixels(baseInput(expected, actual, []));
    expect(result.diffPixels).toBe(TEST_WIDTH_PX * TEST_HEIGHT_PX);
    expect(result.maxChannelDelta).toBe(255);
  });

  it('허용 오차 이하의 차는 같은 픽셀로 센다', () => {
    const expected = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [100, 100, 100, 255]);
    const actual = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [102, 100, 100, 255]);
    const result = comparePixels({ ...baseInput(expected, actual, []), channelDelta: 2 });
    expect(result.diffPixels).toBe(0);
    // 허용했다는 것과 못 봤다는 것은 다르다. 관측된 최대 채널차는 그대로 남아야
    // 09 §5.4의 실측으로 손잡이를 정할 수 있다
    expect(result.maxChannelDelta).toBe(2);
  });

  it('마스크가 덮은 자리는 비교 대상에서 빠진다', () => {
    const expected = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [0, 0, 0, 255]);
    const actual = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [255, 255, 255, 255]);
    const mask: MaskRect = {
      xU: 0,
      yU: 0,
      widthU: TEST_WIDTH_PX / TEST_SCALE,
      heightU: TEST_HEIGHT_PX / TEST_SCALE,
      kind: 'text',
      reason: '단위 테스트',
    };
    const result = comparePixels(baseInput(expected, actual, [mask]));
    expect(result.maskedPixels).toBe(TEST_WIDTH_PX * TEST_HEIGHT_PX);
    expect(result.diffPixels).toBe(0);
  });

  it('마스크를 논리 단위에서 픽셀로 펼 때 배율을 곱한다', () => {
    const mask: MaskRect = { xU: 1, yU: 1, widthU: 1, heightU: 1, kind: 'text', reason: '단위 테스트' };
    const stamp = rasterizeMasks([mask], TEST_WIDTH_PX, TEST_HEIGHT_PX, TEST_SCALE);
    // 1u 사각형이 배율 2에서 2×2 픽셀이 된다
    expect(stamp.reduce<number>((sum, v) => sum + v, 0)).toBe(4);
    expect(stamp[2 * TEST_WIDTH_PX + 2]).toBe(1);
    expect(stamp[1 * TEST_WIDTH_PX + 1]).toBe(0);
  });

  it('차이가 몰린 칸을 많은 순으로 돌려준다', () => {
    const expected = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [0, 0, 0, 255]);
    const actual = expected.slice();
    for (let x = 0; x < TEST_WIDTH_PX; x++) {
      actual[(0 * TEST_WIDTH_PX + x) * 4] = 255;
    }
    const result = comparePixels(baseInput(expected, actual, []));
    expect(result.worstCells.length).toBeGreaterThan(0);
    expect(result.worstCells[0]?.yU).toBe(0);
    expect(result.worstCells.reduce<number>((sum, cell) => sum + cell.diffPixels, 0)).toBe(
      TEST_WIDTH_PX,
    );
  });

  it('사각형 안의 차이는 마스크와 무관하게 센다 — §18.5 오염 띠가 가려지면 안 된다', () => {
    const expected = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [0, 0, 0, 255]);
    const actual = expected.slice();
    actual[(6 * TEST_WIDTH_PX + 3) * 4] = 255;
    const rect: MaskRect = { xU: 0, yU: 3, widthU: 4, heightU: 1, kind: 'ruling', reason: '단위 테스트' };
    const count = countDiffInRect(
      expected,
      actual,
      TEST_WIDTH_PX,
      TEST_HEIGHT_PX,
      TEST_SCALE,
      rect,
      0,
    );
    expect(count).toBe(1);
  });

  it('버퍼 길이가 캔버스 크기와 안 맞으면 던진다', () => {
    const image = solid(TEST_WIDTH_PX, TEST_HEIGHT_PX, [0, 0, 0, 255]);
    expect(() => comparePixels(baseInput(image, image.slice(0, 16), []))).toThrow();
  });
});

describe('마스크 목록', () => {
  it('모든 마스크가 근거를 달고 있다', () => {
    for (const mask of staticMasks()) {
      expect(mask.reason.length).toBeGreaterThan(0);
      expect(mask.widthU).toBeGreaterThan(0);
      expect(mask.heightU).toBeGreaterThan(0);
    }
  });

  it('09 §5.5의 필수 6장을 그대로 들고 있다', () => {
    expect(VISUAL_TARGETS.map((t) => t.id)).toEqual([
      '12_parry_moment',
      '01_stage1_busanjin',
      '07_stage4_haengju',
      '09_stage5_noryang',
      '08_boss4_daetong',
      '04_boss2_samurai',
    ]);
  });

  it('목업 폴더가 실제로 있다', () => {
    for (const target of VISUAL_TARGETS) {
      expect(existsSync(path.join(REPO_ROOT, 'docs', 'sample_image', target.dir, 'index.html'))).toBe(
        true,
      );
    }
  });
});

const driverInstalled = (await loadChromium()) !== null;

describe.skipIf(!driverInstalled)('하네스 실행', () => {
  it(
    '6장에 대해 차이 리포트를 만든다',
    { timeout: 300_000 },
    async () => {
      const run = await runVisualHarness({ repoRoot: REPO_ROOT, outDir: OUT_DIR });
      expect(run).not.toBeNull();
      const report = run?.report;
      expect(report?.frames).toHaveLength(VISUAL_TARGETS.length);
      for (const frame of report?.frames ?? []) {
        // 여기서 단언하는 것은 "캡처가 됐는가"뿐이다. 픽셀 판정은 09 §5.4대로 사람이 한다
        expect(frame.status, `${frame.id}: ${frame.detail}`).not.toBe('capture-failed');
        expect(frame.capture).not.toBeNull();
        expect(frame.repeat).not.toBeNull();
      }
      console.log(`시각 회귀 리포트: ${run?.reportMarkdownPath}`);
    },
  );
});
