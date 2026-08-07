/**
 * 드라이버 쪽 — 09 §5.2의 절차를 순서대로 부른다.
 *
 * 브라우저 드라이버는 `devDependencies`에만 있고 `dist/`에 한 바이트도 안 들어간다(09 §5.2).
 * 그래서 여기서 `playwright`를 **변수 지정자로** 부른다 — 리터럴로 적으면 드라이버가 설치되지
 * 않은 곳에서 `npm run typecheck`이 이 파일에서 먼저 깨지고, 하네스를 잘라내는 것(11 §11
 * 잘라내기 2순위)이 곧 typecheck 복구 작업이 되어 버린다. 지금은 하네스만 조용히 건너뛴다.
 *
 * 외부 네트워크를 전부 막는 것도 의도다. 목업은 Google Fonts를 링크로 부르는데(09 §5.4-1),
 * 폰트가 도착하느냐 마느냐로 래스터가 달라진다. 언제나 시스템 폰트로 떨어지게 고정해야 같은
 * 조건이 재현된다.
 */

import { readFile } from 'node:fs/promises';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

import type { CapturePayload } from './in-page';
import { formatReport, type BakeReport, type FrameReport, type VisualReport } from './report';
import { VISUAL_TARGETS, type VisualTarget } from './targets';
import { TOLERANCE } from './tolerance';

/** 드라이버에서 실제로 쓰는 것만 적은 구조 타입. 패키지 타입에 기대지 않기 위해서다 */
interface PwRoute {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(): Promise<void>;
}
interface PwPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  evaluate<R, A>(pageFunction: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  on(event: string, handler: (payload: unknown) => void): void;
  route(pattern: string, handler: (route: PwRoute) => void): Promise<void>;
  setDefaultTimeout(ms: number): void;
}
interface PwBrowser {
  newPage(options?: { viewport: { width: number; height: number } }): Promise<PwPage>;
  close(): Promise<void>;
  version(): string;
}
interface PwChromium {
  launch(options?: { headless?: boolean }): Promise<PwBrowser>;
}

/** 페이지 한 장이 6장을 다 도는 데 걸리는 상한 (ms). 프레임당 33MB를 두 번 읽는다 */
const PAGE_TIMEOUT_MS = 120_000;

/** 하네스 페이지는 캔버스를 화면에 안 띄운다. 뷰포트는 오프스크린 작업에 영향이 없다 */
const HARNESS_VIEWPORT = { width: 800, height: 600 } as const;

/**
 * D-05 — render 전용 시드. 값 자체에 뜻은 없고 **고정되어 있다는 것**이 뜻이다.
 * 파티클 위상이 이 값에 걸리므로 실행마다 달라지면 대조가 매번 흔들린다.
 */
const RENDER_SEED = 20250808;

/**
 * 굽기 대조를 도는 배율 둘.
 *
 * 1×은 계약이다 — `render/backgrounds/index.ts`가 논리 해상도(1080×1920u)에 굽고 `drawImage`로
 * 그 크기 그대로 얹으므로 비트가 같아야 한다. 2×은 계약이 아니라 **측정**이다. 물리 픽셀 폭이
 * 1080을 넘는 화면에서 구운 한 장이 확대되는 것을 그 파일이 이미 대가로 적어 두었고(:141),
 * 얼마나 무뎌지는지는 아무 데도 적혀 있지 않다.
 */
const BAKE_SCALES = [1, 2] as const;

/** 하네스 페이지의 모듈이 창에 올라오기를 기다리는 상한 (ms) */
const ENTRY_READY_TIMEOUT_MS = 30_000;
/** 준비 확인 간격 (ms) */
const ENTRY_POLL_MS = 50;

export interface HarnessOptions {
  /** 저장소 루트 절대 경로 */
  readonly repoRoot: string;
  /** 산출 디렉터리 절대 경로 */
  readonly outDir: string;
  readonly targets?: readonly VisualTarget[];
}

export interface HarnessRun {
  readonly report: VisualReport;
  readonly reportMarkdownPath: string;
  readonly reportJsonPath: string;
}

/** `playwright`가 없으면 null. 설치 여부를 던지지 않고 값으로 돌려준다 */
export async function loadChromium(): Promise<PwChromium | null> {
  const specifier = 'playwright';
  try {
    const module = (await import(/* @vite-ignore */ specifier)) as { chromium?: PwChromium };
    return module.chromium ?? null;
  } catch {
    return null;
  }
}

async function writeDataUrl(filePath: string, dataUrl: string | null): Promise<string | null> {
  if (dataUrl === null) {
    return null;
  }
  const comma = dataUrl.indexOf(',');
  await writeFile(filePath, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  return filePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 하네스 페이지의 모듈 스크립트가 창에 API를 올릴 때까지 기다린다.
 *
 * `goto`의 `load`는 문서와 하위 리소스가 왔다는 뜻이지 vite가 변환해 준 모듈이 실행됐다는
 * 뜻이 아니다. 기다리지 않으면 첫 프레임만 "창에 없다"로 실패하고 나머지는 통과해서, 원인이
 * 프레임 순서에 있는 것처럼 보인다.
 */
async function waitForEntry(page: PwPage): Promise<void> {
  const deadline = Date.now() + ENTRY_READY_TIMEOUT_MS;
  for (;;) {
    const ready = await page.evaluate(() => window.__HW_VISUAL__ !== undefined, null);
    if (ready) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`하네스 모듈이 ${ENTRY_READY_TIMEOUT_MS}ms 안에 안 올라왔다`);
    }
    await sleep(ENTRY_POLL_MS);
  }
}

/**
 * 목업 페이지가 vite dev server에서 실제로 열리는지 먼저 확인한다.
 *
 * 열리지 않는 원인은 대개 경로 하나인데, 브라우저 안에서 실패하면 "HWSTATE가 없다"로만 보여
 * 원인이 한 겹 가려진다. 여기서 미리 걸러 리포트에 경로를 그대로 적는다.
 */
async function assertMockupExists(repoRoot: string, target: VisualTarget): Promise<void> {
  const indexPath = path.join(repoRoot, 'docs', 'sample_image', target.dir, 'index.html');
  await readFile(indexPath);
}

function toFrameReport(
  target: VisualTarget,
  url: string,
  payload: CapturePayload,
  artifacts: readonly string[],
  outDir: string,
): FrameReport {
  return {
    id: target.id,
    url,
    atSec: target.atSec,
    locks: target.locks,
    status: payload.status,
    detail: payload.detail,
    widthPx: payload.widthPx,
    heightPx: payload.heightPx,
    scale: payload.scale,
    nativeWidthPx: payload.nativeWidthPx,
    capture: payload.capture,
    masks:
      payload.maskCountByKind === null || payload.maskCoverageRatio === null
        ? null
        : { countByKind: payload.maskCountByKind, coverageRatio: payload.maskCoverageRatio },
    repeat: payload.repeat,
    repeatIgnoringParticles: payload.repeatIgnoringParticles,
    compare: payload.compare,
    cheatMarkDiffPixels: payload.cheatMarkDiffPixels,
    baselineBlockers: target.baselineBlockers,
    artifacts: artifacts.map((file) => path.relative(outDir, file)),
  };
}

/**
 * 09 §5.2의 여섯 단계를 한 번 돈다.
 *
 * 서버와 브라우저는 이 함수가 열고 이 함수가 닫는다. 바깥에 들고 나가면 vitest가 끝나도 포트가
 * 물려 있고, 그 상태로 다시 돌리면 두 번째 실행이 다른 포트에서 다른 캐시를 읽는다.
 */
export async function runVisualHarness(options: HarnessOptions): Promise<HarnessRun | null> {
  const chromium = await loadChromium();
  if (chromium === null) {
    return null;
  }
  const targets = options.targets ?? VISUAL_TARGETS;
  await rm(options.outDir, { recursive: true, force: true });
  await mkdir(options.outDir, { recursive: true });

  let server: ViteDevServer | null = null;
  let browser: PwBrowser | null = null;
  try {
    // 프로젝트 vite.config.ts는 단일 파일 빌드용 base와 플러그인을 갖고 있다. 대조는 dev
    // 서버의 TS 변환과 정적 서빙만 쓰므로 기본 설정으로 띄워 그 둘을 섞지 않는다
    server = await createServer({
      configFile: false,
      root: options.repoRoot,
      server: { port: 0 },
      logLevel: 'error',
    });
    await server.listen();
    const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
    if (base === undefined) {
      throw new Error('vite dev server 주소를 못 얻었다');
    }

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: HARNESS_VIEWPORT });
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(String(error));
    });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const local = url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:');
      void (local ? route.continue() : route.abort());
    });
    await page.goto(`${base}/tests/visual/harness.html`, { waitUntil: 'load' });
    await waitForEntry(page);

    const frames: FrameReport[] = [];
    for (const target of targets) {
      await assertMockupExists(options.repoRoot, target);
      const url = `${base}/docs/sample_image/${target.dir}/index.html?at=${target.atSec}`;
      const payload = await page.evaluate(
        (args: {
          targetId: string;
          mockupUrl: string;
          backgroundKey: string;
          renderSeed: number;
        }) => window.__HW_VISUAL__?.captureTarget(args),
        {
          targetId: target.id,
          mockupUrl: url,
          backgroundKey: target.backgroundKey,
          renderSeed: RENDER_SEED,
        },
      );
      if (payload === undefined) {
        throw new Error('하네스 페이지의 captureTarget이 창에 없다');
      }
      const capture = payload;
      const artifacts: string[] = [];
      const written = await Promise.all([
        writeDataUrl(path.join(options.outDir, `${target.id}.mockup.png`), capture.mockupPngDataUrl),
        writeDataUrl(path.join(options.outDir, `${target.id}.game.png`), capture.gamePngDataUrl),
        writeDataUrl(path.join(options.outDir, `${target.id}.diff.png`), capture.diffPngDataUrl),
      ]);
      for (const file of written) {
        if (file !== null) {
          artifacts.push(file);
        }
      }
      if (capture.frame !== null) {
        const statePath = path.join(options.outDir, `${target.id}.state.json`);
        await writeFile(statePath, `${JSON.stringify(capture.frame, null, 2)}\n`);
        artifacts.push(statePath);
      }
      frames.push(toFrameReport(target, url, capture, artifacts, options.outDir));
    }

    const bakes: BakeReport[] = [];
    const seenStages = new Set<string>();
    for (const target of targets) {
      if (seenStages.has(target.backgroundKey)) {
        continue;
      }
      seenStages.add(target.backgroundKey);
      for (const bakeScale of BAKE_SCALES) {
        const bake = await page.evaluate(
          (args: { stageKey: string; timeSec: number; scale: number; renderSeed: number }) =>
            window.__HW_VISUAL__?.runBakeCheck(
              args.stageKey,
              args.timeSec,
              args.scale,
              args.renderSeed,
            ),
          {
            stageKey: target.backgroundKey,
            timeSec: target.atSec,
            scale: bakeScale,
            renderSeed: RENDER_SEED,
          },
        );
        if (bake === undefined) {
          throw new Error('하네스 페이지의 runBakeCheck이 창에 없다');
        }
        bakes.push({
          stageKey: bake.stageKey,
          scale: bake.scale,
          status: bake.status,
          detail: bake.detail,
          compare: bake.compare,
        });
        if (bake.status === 'not-implemented') {
          break;
        }
      }
    }

    if (pageErrors.length > 0) {
      await writeFile(
        path.join(options.outDir, 'page-errors.txt'),
        `${pageErrors.join('\n')}\n`,
      );
    }

    const report: VisualReport = {
      generatedAt: new Date().toISOString(),
      driver: `playwright chromium ${browser.version()}`,
      tolerance: TOLERANCE,
      frames,
      bakes,
    };
    const reportMarkdownPath = path.join(options.outDir, 'report.md');
    const reportJsonPath = path.join(options.outDir, 'report.json');
    await writeFile(reportMarkdownPath, formatReport(report));
    await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    return { report, reportMarkdownPath, reportJsonPath };
  } finally {
    await browser?.close();
    await server?.close();
  }
}
