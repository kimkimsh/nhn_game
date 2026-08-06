/* Boss 2, phase 2 — the charge carries a direction line (dodge it) and the
   crescent carries nothing (parry it). HR-05's whole pairing in one frame. */
(function () {
  HW.still({
    title: '보스 B2 · 왜장 사무라이 대장',
    stage: 'dongnae', at: 6.5, playerX: 540, playerY: 1310,
    hud: {
      life: 2, maxLife: 3, score: 196400, combo: 41, stage: 2, wave: '보스전', progress: 1,
      boss: { name: 'B2 왜장 사무라이 대장', hp: 0.47, phase: 2, phases: [0.65, 0.3] }
    },
    setup: function (s) {
      s.enemies = [{ type: 'B-SAM', x: 540, y: 380, hp: 2250, maxhp: 2250, nobar: true, hitW: 240, hitH: 300 }];
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.95) * 300;
      s.player.y = 1310 + Math.cos(t * 0.68) * 120;
      var boss = s.enemies[0];
      boss.x = 540 + Math.sin(t * 0.5) * 230;

      /* 참격파 강화: four crescents 0.4s apart, alternating sides. Backswing
         only — no arc is ever drawn ahead of the blade. */
      HW.serve(s, boss, t, {
        period: 3.4, tell: 0.7, offset: 0.2,
        fire: function (st) { st.slashAt = st.t; st.slashN = 0; }
      });
      if (s.slashAt !== undefined && s.slashN < 4 && t >= s.slashAt + s.slashN * 0.4) {
        var side = s.slashN % 2 ? -170 : 170;
        HW.spawn(s, 'P5', boss.x + side, boss.y + 90,
          HW.aimAt(boss.x + side, boss.y + 90, s.player.x, s.player.y), 1.08);
        s.slashN++;
      }

      /* 투척 수리검 5방향 확산, carried over from phase 1 */
      if (s.starAt === undefined) s.starAt = 1.5;
      if (t >= s.starAt) {
        s.starAt = t + 2.5;
        var a0 = HW.aimAt(boss.x, boss.y, s.player.x, s.player.y);
        for (var k = -2; k <= 2; k++) HW.spawn(s, 'P4', boss.x, boss.y + 60, a0 + k * 0.628, 1.08);
      }

      /* 돌진 베기: the body cannot be parried, so it gets a 1.0s direction
         line and a 160u-wide path everything outside of is safe (HR-04). */
      if (s.dashAt === undefined) s.dashAt = 5.6;
      if (t >= s.dashAt && !s.dashed) {
        s.dashed = true;
        s.tele.push({
          kind: 'dash', x: boss.x, y: boss.y,
          a: HW.aimAt(boss.x, boss.y, s.player.x, s.player.y),
          len: 1400, age: 0, dur: 1.0
        });
      }
      HW.autoParry(s, 40);
    }
  });
})();
