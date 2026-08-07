/**
 * 차이 리포트 — P4 게이트가 요구하는 산출물 그 자체다.
 *
 * 09 §5.4가 "하네스의 역할은 어디가 달라졌는지 좁혀 주는 것이지 합격을 선언하는 것이 아니다"라고
 * 못 박았으므로, 이 리포트에는 통과/실패 칸이 없다. 있는 것은 상태(무엇까지 됐는가)와 수치,
 * 그리고 **기준선을 아직 고정하면 안 되는 이유**뿐이다.
 */

import type { CompareResult, MaskKind } from './compare';
import type { BaselineBlocker } from './targets';
import type { ToleranceKnobs } from './tolerance';

/** 한 프레임이 어디까지 갔는가. 전부 정상 경로이고 실패를 뜻하는 것은 `capture-failed` 하나다 */
export type FrameStatus =
  /** 목업과 게임을 둘 다 그려서 대조했다 */
  | 'compared'
  /** 목업은 잡았는데 `render/frame.ts`가 아직 없다 (renderer-binding.ts의 표를 보라) */
  | 'renderer-missing'
  /** 목업 페이지를 못 열었거나 HWSTATE가 없다. 이것만이 고장이다 */
  | 'capture-failed';

/** 목업이 그 프레임에 실제로 들고 있던 것. 대조 수치가 무엇에 대한 것인지 알려 준다 */
export interface CaptureSummary {
  readonly bullets: number;
  readonly reflectBullets: number;
  readonly enemies: number;
  readonly zones: number;
  readonly telegraphs: number;
  readonly popups: number;
  readonly particles: number;
  readonly hudPresent: boolean;
  /** 09 §5.6 — S1·S2는 3칸, S3부터 4칸. 4칸이면 R06을 획득한 런이다 */
  readonly maxLife: number;
  /** 정지 프레임에서 0으로 강제하기 **전에** 목업이 들고 있던 값 */
  readonly traumaAtCapture: number;
  readonly hitstopRemainingSec: number;
}

export interface MaskSummary {
  readonly countByKind: Readonly<Record<MaskKind, number>>;
  /** 마스크가 덮은 픽셀 비율 (0~1). 이 값이 크면 대조가 남긴 것이 별로 없다는 뜻이다 */
  readonly coverageRatio: number;
}

export interface FrameReport {
  readonly id: string;
  readonly url: string;
  readonly atSec: number;
  readonly locks: string;
  readonly status: FrameStatus;
  readonly detail: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
  /** 목업 캔버스의 원래 가로 픽셀. 대조는 논리 해상도로 줄여서 돈다 (09 §5.2의 4번) */
  readonly nativeWidthPx: number;
  readonly capture: CaptureSummary | null;
  readonly masks: MaskSummary | null;
  /** 같은 목업 프레임을 두 번 띄워 대조한 결과. 0이 아니면 결정론이 깨진 것이다 */
  readonly repeat: CompareResult | null;
  /**
   * 처치 파편만 가리고 다시 잰 재현성.
   *
   * 두 수가 갈리면 결정론이 깨진 층이 파편 하나라는 뜻이고, 그 원인은 이미 이름이 있다 —
   * 목업 `burst`의 `Math.random()`(engine.js:1927-1928, D-05 위반).
   */
  readonly repeatIgnoringParticles: CompareResult | null;
  /** 목업 대 게임. `status`가 `compared`일 때만 있다 */
  readonly compare: CompareResult | null;
  /**
   * §18.5 치트 오염 표시 자리의 차이 픽셀 수. 마스크를 걷고 따로 센다 —
   * 09 §5.6이 이 띠가 박힌 기준선을 실격 사유로 지목했다
   */
  readonly cheatMarkDiffPixels: number | null;
  readonly baselineBlockers: readonly BaselineBlocker[];
  /** 산출된 파일들의 상대 경로 */
  readonly artifacts: readonly string[];
}

/** 06 §3.2 정적 배경 굽기 검증 한 건 */
export interface BakeReport {
  readonly stageKey: string;
  /** 대조 배율. 굽기는 논리 해상도 고정이라 배율 1에서만 비트 일치가 요구된다 */
  readonly scale: number;
  readonly status: 'verified' | 'not-implemented';
  readonly detail: string;
  /** 구운 레이어를 얹은 프레임과 매 프레임 직접 그린 프레임의 대조 */
  readonly compare: CompareResult | null;
}

export interface VisualReport {
  readonly generatedAt: string;
  readonly driver: string;
  readonly tolerance: ToleranceKnobs;
  readonly frames: readonly FrameReport[];
  readonly bakes: readonly BakeReport[];
}

function ratio(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

function compareCells(result: CompareResult): string {
  if (result.worstCells.length === 0) {
    return '—';
  }
  return result.worstCells
    .map((cell) => `(${cell.xU},${cell.yU}) ${cell.diffPixels}px/Δ${cell.maxChannelDelta}`)
    .join(' · ');
}

/**
 * 사람이 읽는 표를 만든다. 09 §5.4의 최종 판정자가 이 글을 읽는 그 사람이다.
 *
 * 요약을 맨 위에 두는 이유는 프레임이 여섯이라 표만으로는 "그래서 지금 뭘 봐야 하나"가 안 보이기
 * 때문이다.
 */
export function formatReport(report: VisualReport): string {
  const lines: string[] = [];
  lines.push('# 시각 회귀 차이 리포트');
  lines.push('');
  lines.push(`- 생성: ${report.generatedAt}`);
  lines.push(`- 드라이버: ${report.driver}`);
  lines.push(
    `- 손잡이: 채널당 허용 오차 ${report.tolerance.channelDelta} · 허용 픽셀 비율 ${ratio(report.tolerance.maxDiffRatio)}` +
      (report.tolerance.measuredAt === null
        ? ' — **잠정값이다.** 09 §5.4대로 첫 초록불에서 실측해 고정한다'
        : ` — 실측 ${report.tolerance.measuredAt}`),
  );
  lines.push('');
  lines.push(
    '**판정은 사람이 한다** (09 §5.4). 이 문서는 어디가 달라졌는지 좁혀 줄 뿐이고 합격을 선언하지 않는다.',
  );
  lines.push('');

  lines.push('## 1. 프레임 6장');
  lines.push('');
  lines.push(
    '| 화면 | at | 상태 | 재현성 diff | 파편 제외 | 목업↔게임 diff | 최대 채널차 | 마스크 덮개 |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const frame of report.frames) {
    const repeat = frame.repeat === null ? '—' : `${frame.repeat.diffPixels}px`;
    const repeatClean =
      frame.repeatIgnoringParticles === null ? '—' : `${frame.repeatIgnoringParticles.diffPixels}px`;
    const compare =
      frame.compare === null ? '—' : `${frame.compare.diffPixels}px (${ratio(frame.compare.diffRatio)})`;
    const worst = frame.compare === null ? '—' : String(frame.compare.maxChannelDelta);
    const coverage = frame.masks === null ? '—' : ratio(frame.masks.coverageRatio);
    lines.push(
      `| \`${frame.id}\` | ${frame.atSec} | ${frame.status} | ${repeat} | ${repeatClean} | ${compare} | ${worst} | ${coverage} |`,
    );
  }
  lines.push('');

  lines.push('## 2. 프레임별 상세');
  for (const frame of report.frames) {
    lines.push('');
    lines.push(`### \`${frame.id}\``);
    lines.push('');
    lines.push(`- 잠그는 것: ${frame.locks}`);
    lines.push(`- URL: ${frame.url}`);
    lines.push(
      `- 대조 캔버스: ${frame.widthPx}×${frame.heightPx} px (배율 ${frame.scale}). 목업 원본은 가로 ${frame.nativeWidthPx} px이고 여기로 줄여서 잰다`,
    );
    lines.push(`- 상태: **${frame.status}** — ${frame.detail}`);
    if (frame.capture !== null) {
      const c = frame.capture;
      lines.push(
        `- 목업이 들고 있던 것: 탄환 ${c.bullets}(반사 ${c.reflectBullets}) · 적 ${c.enemies} · 장판 ${c.zones} · 예고 ${c.telegraphs} · 팝업 ${c.popups} · 파티클 ${c.particles} · HUD ${c.hudPresent ? '있음' : '없음'} · maxLife ${c.maxLife}`,
      );
      lines.push(
        `- 정지 프레임 처리 전 trauma ${c.traumaAtCapture.toFixed(4)} · 히트스톱 잔여 ${c.hitstopRemainingSec.toFixed(4)}초`,
      );
    }
    if (frame.masks !== null) {
      const byKind = frame.masks.countByKind;
      lines.push(
        `- 마스크: 텍스트 ${byKind.text} · 판정 ${byKind.ruling} · 신규 표시 ${byKind['new-element']} → 화면의 ${ratio(frame.masks.coverageRatio)}`,
      );
    }
    if (frame.repeat !== null) {
      lines.push(
        `- 재현성(같은 목업 두 번): 다른 픽셀 ${frame.repeat.diffPixels} · 최대 채널차 ${frame.repeat.maxChannelDelta}` +
          (frame.repeat.diffPixels === 0
            ? ' — 목업이 이 환경에서 비트 단위로 결정론적이다'
            : ' — **결정론이 깨졌다.** 이 상태에서 잡은 기준선은 아무것도 잠그지 못한다'),
      );
    }
    if (frame.repeatIgnoringParticles !== null && frame.repeat !== null) {
      const cleaned = frame.repeatIgnoringParticles;
      lines.push(
        `- 처치 파편을 뺀 재현성: 다른 픽셀 ${cleaned.diffPixels}` +
          (cleaned.diffPixels === 0 && frame.repeat.diffPixels > 0
            ? ' — 흔들린 층은 파편 하나다 (engine.js:1927-1928의 Math.random(), D-05)'
            : ''),
      );
    }
    if (frame.compare !== null) {
      lines.push(
        `- 목업↔게임: 비교 ${frame.compare.comparedPixels}px 중 ${frame.compare.diffPixels}px (${ratio(frame.compare.diffRatio)}) · 최대 채널차 ${frame.compare.maxChannelDelta}`,
      );
      lines.push(`- 차이가 몰린 칸(u): ${compareCells(frame.compare)}`);
    }
    if (frame.cheatMarkDiffPixels !== null) {
      lines.push(
        `- §18.5 치트 오염 띠 자리: ${frame.cheatMarkDiffPixels}px` +
          (frame.cheatMarkDiffPixels === 0
            ? ' — 양쪽 다 깨끗하다'
            : ' — **어느 한쪽이 오염된 런이다.** 09 §5.6이 실격 사유로 지목한 화면이다'),
      );
    }
    if (frame.baselineBlockers.length > 0) {
      lines.push('- 09 §5.4-3 — 이 프레임은 아직 기준선을 고정하면 안 된다:');
      for (const blocker of frame.baselineBlockers) {
        lines.push(`  - **${blocker.ruling}** ${blocker.why}`);
      }
    } else {
      lines.push('- 09 §5.4-3 — 기준선 고정을 막는 판정 없음');
    }
    if (frame.artifacts.length > 0) {
      lines.push(`- 산출: ${frame.artifacts.map((a) => `\`${a}\``).join(' · ')}`);
    }
  }
  lines.push('');

  lines.push('## 3. 정적 배경 굽기 (06 §3.2)');
  lines.push('');
  lines.push('구운 레이어를 얹은 프레임과 매 프레임 직접 그린 프레임이 같은 픽셀이어야 한다.');
  lines.push('');
  lines.push('| 배경 | 배율 | 상태 | 다른 픽셀 | 비고 |');
  lines.push('|---|---|---|---|---|');
  for (const bake of report.bakes) {
    const diff = bake.compare === null ? '—' : `${bake.compare.diffPixels}px`;
    lines.push(
      `| \`${bake.stageKey}\` | ${bake.scale}× | ${bake.status} | ${diff} | ${bake.detail} |`,
    );
  }
  lines.push('');
  for (const bake of report.bakes) {
    if (bake.compare === null || bake.compare.diffPixels === 0) {
      continue;
    }
    lines.push(`- \`${bake.stageKey}\` ${bake.scale}× 차이가 몰린 칸(u): ${compareCells(bake.compare)}`);
  }
  lines.push('');
  lines.push(
    '**배율 1×에서만 비트 일치가 계약이다.** 굽기는 논리 해상도(1080×1920u) 고정 래스터라 2×에서는 '
      + '구운 한 장이 확대되고, 그 대가는 `render/backgrounds/index.ts:141`이 이미 적어 두었다. '
      + '2× 행은 결함이 아니라 **물리 픽셀 폭이 1080을 넘는 화면에서 배경이 얼마나 무뎌지는가**를 '
      + '재 둔 것이고, §1의 프레임 대조가 1×에서 도는 이유이기도 하다.',
  );
  lines.push('');
  return lines.join('\n');
}
