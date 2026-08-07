/**
 * 점수와 콤보 — 스펙 §12, 05_시스템_설계.md §11. 05 §1의 14번을 갖는다.
 *
 * ── 배수를 자르는 자리가 여기 하나다 ────────────────────────────────────────────
 *
 * 목업 HUD(engine.js:1729)에는 상한 클램프가 없다. 표시 최대값이 콤보 88이라 드러나지
 * 않았을 뿐이고 콤보가 더 오르면 스펙을 넘는다(10 A10). 자르는 것은 여기이고 HUD·결과 화면은
 * 이미 잘린 값을 읽는다 — 소비자 쪽에서 같은 식을 다시 쓰면 상한이 두 곳에 살게 된다.
 *
 * ── 만료를 확정하는 자리도 여기 하나다 ──────────────────────────────────────────
 *
 * 05 §1의 1번이 sim 시간을 밀고 14번(settleCombo)에서만 만료와 경고가 확정된다. 두 곳에서
 * 보면 같은 스텝에 만료와 갱신이 둘 다 일어나 콤보가 조용히 끊긴다.
 *
 * ── 게이지의 기준점은 마지막 패리 시각이다 ──────────────────────────────────────
 *
 * 목업(engine.js:1733)은 벽시계 톱니파였고 마지막 패리 시각을 읽지 않았다(10 A11). 잔여
 * 시간을 실효 comboHoldSec으로 나누는 것이 그 식과 같은 값이며, 분모가 상수가 아니라
 * 스냅샷 값이라는 것이 요점이다 — N11이 유지 시간을 늘리면 게이지와 경고가 함께 따라온다.
 *
 * ── 배수가 곱해지는 점수와 아닌 점수 ────────────────────────────────────────────
 *
 * 스펙 §12.1은 "패리 점수와 처치 점수 모두에"라고만 적었다. 그래서 addScore(패리·처치)와
 * addFlatScore(페이즈 전환·클리어 보너스)가 갈려 있다. 부르는 쪽이 배수를 곱하게 두면
 * 어느 점수가 어느 쪽인지가 호출부마다 흩어진다.
 */
import { COMBO, COMBO_WARN_SEC, SCORING } from '../config/scoring';
import { clamp, clamp01 } from '../core/math';
import type { EffectiveParryBand, World } from './world';

/** §12.2 배수. 상한 클램프가 빠지면 높은 콤보에서만 스펙을 넘어 테스트도 화면도 조용하다 */
export function comboMul(combo: number): number {
  return clamp(1 + Math.floor(combo / COMBO.multStep) * COMBO.multPerStep, 1, COMBO.multMax);
}

/** §12.1 패리 점수와 처치 점수. 배수는 언제나 여기서 곱한다 */
export function addScore(world: World, basePoints: number): void {
  world.run.score += Math.floor(basePoints * comboMul(world.run.combo));
}

/** §12.1 보스 페이즈 전환과 스테이지 클리어 보너스. 패리도 처치도 아니라 배수가 붙지 않는다 */
export function addFlatScore(world: World, points: number): void {
  world.run.score += Math.floor(points);
}

/**
 * §12.1 등급 점수. 재패리는 등급 점수의 일정 비율이고 그 비율의 소유자는 config/scoring.ts다 —
 * 유도되는 값이라 재패리 점수 자체를 어디에도 적지 않는다.
 */
export function awardParry(world: World, band: EffectiveParryBand, isReparry: boolean): void {
  addScore(world, band.score * (isReparry ? SCORING.reparryRatio : 1));
}

/** §12.1 보스 격파. 처치이므로 배수가 걸린다 */
export function awardBossKill(world: World): void {
  addScore(world, SCORING.bossKill);
}

/** §12.1 보스 페이즈 전환 */
export function awardBossPhaseChange(world: World): void {
  addFlatScore(world, SCORING.bossPhaseChange);
}

/**
 * §12.1 스테이지 클리어 보너스 = 남은 라이프 × 계수. 스테이지 5 클리어에도 걸린다(08 §1.4 T-06).
 * 더한 점수를 돌려주는 것은 결과 화면이 보너스를 따로 적기 때문이다.
 */
export function awardStageClearBonus(world: World, livesRemaining: number): number {
  const bonus = Math.max(0, livesRemaining) * SCORING.stageClearPerLife;
  addFlatScore(world, bonus);
  return bonus;
}

/**
 * §12.2 콤보는 패리로 처리한 발사체 개수만큼 오른다. 다중 패리는 개수만큼, 재패리도 일반
 * 패리와 같게 센다. 유지 시간은 오를 때마다 처음부터 다시 시작한다.
 */
export function addCombo(world: World, count: number): void {
  const run = world.run;
  run.combo += count;
  run.comboUntilSec = world.simTimeSec + world.stats.comboHoldSec;
  run.comboWarned = false;
}

/** §12.2 유지 시간 경과와 플레이어 피격(반사탄 자해 포함), 그리고 스테이지 시작이 부른다 */
export function resetCombo(world: World): void {
  world.run.combo = 0;
  world.run.comboWarned = false;
}

/** §12.2 남은 유지 시간. 콤보가 없으면 0이다 */
export function comboRemainSec(world: World): number {
  if (world.run.combo === 0) {
    return 0;
  }
  return Math.max(0, world.run.comboUntilSec - world.simTimeSec);
}

/**
 * §15.1 유지 시간이 줄어드는 게이지 (1 → 0).
 *
 * 분모가 스냅샷의 실효값이라 카드로 유지 시간이 늘어난 직후 한 스텝 동안은 1을 넘을 수 있다.
 * 그 자리를 clamp01이 덮는다 — 이미 진행 중인 콤보의 만료 시각을 소급해 늘리는 것은
 * "마지막 패리 성공 후"라는 §12.2의 기준을 바꾸는 일이라 하지 않는다.
 */
export function comboGauge01(world: World): number {
  if (world.run.combo === 0) {
    return 0;
  }
  return clamp01(comboRemainSec(world) / world.stats.comboHoldSec);
}

/** §12.2 경고 구간. render의 적색 전환과 audio의 경고음이 이 하나를 같이 읽는다 */
export function isComboWarning(world: World): boolean {
  return world.run.combo > 0 && comboRemainSec(world) <= COMBO_WARN_SEC;
}

/**
 * 05 §1의 14번. 만료와 경고가 확정되는 유일한 자리다.
 *
 * 경고를 콤보 한 벌에 한 번만 내는 것은 매 스텝 emit하면 신호가 아니라 잡음이 되기 때문이고,
 * addCombo가 표시를 내리므로 유지 시간이 갱신되면 다음 진입에서 다시 울린다.
 */
export function settleCombo(world: World): void {
  const run = world.run;
  if (run.combo === 0) {
    return;
  }
  if (comboRemainSec(world) <= 0) {
    resetCombo(world);
    return;
  }
  if (isComboWarning(world) && !run.comboWarned) {
    run.comboWarned = true;
    world.bus.emit({ kind: 'comboWarn' });
  }
}
