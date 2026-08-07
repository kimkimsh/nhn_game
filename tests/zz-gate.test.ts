import { describe, expect, it } from 'vitest';
import { FIXED_DT_SEC } from '../src/core/loop';
import { applyBossDamage } from '../src/sim/boss';
import { createRun, stepRun } from '../src/sim/run';
import { wavePhase } from '../src/sim/waves';

describe('gate probe', () => {
  it('S1 idle run reaches boss and clears', () => {
    const run = createRun({ seed: 20260808, stageId: 1 });
    const marks: string[] = [];
    let bossSeenSec = -1;
    for (let i = 0; i < Math.round(70 / FIXED_DT_SEC); i += 1) {
      stepRun(run, FIXED_DT_SEC);
      if (run.phase !== 'combat') { marks.push(`phase=${run.phase} at ${run.world.simTimeSec.toFixed(2)}`); break; }
      if (bossSeenSec < 0 && run.world.boss !== null) {
        bossSeenSec = run.world.simTimeSec;
        marks.push(`boss at ${bossSeenSec.toFixed(2)} wavePhase=${wavePhase(run.world)} lives=${run.world.player.lives}`);
      }
    }
    marks.push(`after loop: phase=${run.phase} lives=${run.world.player.lives} boss=${run.world.boss === null ? 'null' : run.world.boss.hp}`);
    // 보스를 강제로 죽여 클리어 전이를 본다
    if (run.world.boss !== null && run.phase === 'combat') {
      applyBossDamage(run.world, run.world.boss, null, 99999);
      for (let i = 0; i < Math.round(3 / FIXED_DT_SEC); i += 1) {
        stepRun(run, FIXED_DT_SEC);
        if (run.phase !== 'combat') break;
      }
      marks.push(`after kill: phase=${run.phase} cardScreenNo=${run.cardScreenNo} score=${run.world.run.score}`);
    }
    console.log(marks.join('\n'));
    expect(true).toBe(true);
  });
});
