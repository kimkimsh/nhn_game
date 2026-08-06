/* Boss 1 — straight-line bullets only and no telegraph shape anywhere:
   the fight that teaches that a tell says WHEN, never WHERE. */
(function () {
  HW.still({
    title: '보스 B1 · 조총 방진 대장',
    stage: 'busanjin', at: 5.75, playerX: 540, playerY: 1290,
    hud: {
      life: 3, maxLife: 3, score: 61200, combo: 34, stage: 1, wave: '보스전', progress: 1,
      boss: { name: 'B1 조총 방진 대장', hp: 0.71, phase: 1, phases: [0.55] }
    },
    setup: function (s) {
      s.enemies = [{
        type: 'B-GUN', x: 540, y: 400, hp: 1450, maxhp: 1450, nobar: true,
        hitW: 470, hitH: 290
      }];
      s.line = [180, 360, 540, 720, 900];
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.9) * 280;
      s.player.y = 1290 + Math.cos(t * 0.7) * 110;
      var boss = s.enemies[0];
      HW.serve(s, boss, t, {
        period: 2.3, tell: 0.9, offset: 0.5,
        fire: function (st, e) {
          /* 일제사격: five muskets on the same frame, no aim line drawn */
          st.line.forEach(function (x) {
            HW.spawn(st, 'P2', x, e.y + 190, HW.aimAt(x, e.y + 190, st.player.x, st.player.y));
          });
        }
      });

      /* 엄폐 전진 fills the gap between volleys. HR-03 forbids an empty screen
         for more than 2.0s and the volley alone would leave one. */
      if (s.burst === undefined) { s.burst = 1.75; s.burstN = 0; }
      if (t >= s.burst) {
        HW.spawn(s, 'P2', boss.x + Math.sin(t * 1.6) * 260, boss.y + 60,
          HW.aimAt(boss.x, boss.y + 60, s.player.x, s.player.y));
        s.burstN++;
        s.burst = t + (s.burstN % 3 ? 0.35 : 1.5);
      }
      HW.autoParry(s, 34);
    },
    paint: function (ctx, s) {
      var boss = s.enemies[0];
      s.line.forEach(function (x) {
        HW.drawEnemy(ctx, { type: 'E-A', x: x, y: boss.y + 190, charge: boss.charge, flash: 0 });
      });
    }
  });
})();
