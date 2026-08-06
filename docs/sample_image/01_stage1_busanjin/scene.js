/* Stage 1, wave 2 — the teaching wave: two enemy types, two bullet types,
   low density, and the full HUD vocabulary on screen at once. */
(function () {
  HW.still({
    title: '스테이지 1 · 부산진 새벽',
    stage: 'busanjin', at: 4.25, playerX: 540, playerY: 1270,
    hud: { life: 3, maxLife: 3, score: 24850, combo: 17, stage: 1, wave: 'W2  0:19 / 0:27', progress: 0.31 },
    setup: function (s) {
      s.enemies = [
        { type: 'E-A', x: 150, y: 300, hp: 30, maxhp: 30 },
        { type: 'E-A', x: 360, y: 210, hp: 30, maxhp: 30 },
        { type: 'E-A', x: 720, y: 210, hp: 30, maxhp: 30 },
        { type: 'E-A', x: 930, y: 300, hp: 30, maxhp: 30 },
        { type: 'E-A', x: 540, y: 150, hp: 30, maxhp: 30 },
        { type: 'E-B', x: 250, y: 520, hp: 36, maxhp: 36 },
        { type: 'E-B', x: 540, y: 600, hp: 36, maxhp: 36 },
        { type: 'E-B', x: 830, y: 520, hp: 36, maxhp: 36 }
      ];
      s.enemies.forEach(function (e, i) { e._next = 0.2 + i * 0.34; });
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.85) * 250;
      s.player.y = 1270 + Math.cos(t * 0.62) * 130;
      s.enemies.forEach(function (e) {
        if (e.dead) { if (t - e.deadAt > 2.6) { e.dead = false; e.hp = e.maxhp; e._next = t + 0.8; } return; }
        HW.serve(s, e, t, {
          period: e.type === 'E-A' ? 2.2 : 2.6, tell: 0.95,
          fire: function (st, en) {
            /* HR-09: hold fire when the player is closer than speed × 0.45s */
            var type = en.type === 'E-A' ? 'P2' : 'P1';
            if (HW.len(st.player.x - en.x, st.player.y - en.y) < HW.BULLETS[type].v * 0.45) return;
            var a = HW.aimAt(en.x, en.y, st.player.x, st.player.y);
            if (en.type === 'E-B') {
              for (var k = -1; k <= 1; k++) HW.spawn(st, 'P1', en.x, en.y, a + k * 0.244);
            } else {
              HW.spawn(st, 'P2', en.x, en.y, a);
            }
          }
        });
      });
      HW.autoParry(s, 36);
    }
  });
})();
