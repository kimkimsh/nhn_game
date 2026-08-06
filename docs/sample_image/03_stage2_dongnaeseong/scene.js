/* Stage 2, wave 4 — the shield wave. First enemy that makes the ANGLE of the
   reflection matter instead of only its timing. */
(function () {
  HW.still({
    title: '스테이지 2 · 동래성 성곽',
    stage: 'dongnae', at: 3.0, playerX: 380, playerY: 1240,
    hud: { life: 2, maxLife: 3, score: 148300, combo: 26, stage: 2, wave: 'W4  0:48 / 0:55', progress: 0.62 },
    setup: function (s) {
      s.enemies = [];
      [130, 300, 470, 640, 810, 980].forEach(function (x, i) {
        s.enemies.push({ type: 'E-A', x: x, y: 240 + (i % 2) * 46, hp: 40, maxhp: 40, _next: 0.2 + i * 0.32 });
      });
      [280, 560, 840].forEach(function (x, i) {
        s.enemies.push({ type: 'E-C', x: x, y: 640 + i * 40, hp: 121, maxhp: 121, shield: 1, vy: 26, _next: 99 });
      });
      s.enemies.push({ type: 'E-F', x: -60, y: 900, hp: 27, maxhp: 27, vx: 420, _next: 0.9 });
    },
    tick: function (s, t) {
      s.player.x = 420 + Math.sin(t * 0.8) * 260;
      s.player.y = 1240 + Math.cos(t * 0.55) * 160;
      s.enemies.forEach(function (e) {
        if (e.dead) {
          if (t - e.deadAt > 3) {
            e.dead = false; e.hp = e.maxhp; e._next = t + 0.7;
            if (e.type === 'E-C') { e.y = 560; e.shield = 1; }
          }
          return;
        }
        if (e.type === 'E-F' && e.x > 1140) { e.x = -60; e._next = t + 0.4; }
        if (e.type === 'E-A') {
          HW.serve(s, e, t, {
            period: 2.2, tell: 0.85,
            fire: function (st, en) {
              if (HW.len(st.player.x - en.x, st.player.y - en.y) < 760 * 1.08 * 0.45) return;
              HW.spawn(st, 'P2', en.x, en.y, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.08);
            }
          });
        }
        if (e.type === 'E-F') {
          HW.serve(s, e, t, {
            period: 1.9, tell: 0.4,
            fire: function (st, en) {
              HW.spawn(st, 'P11', en.x, en.y, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.08);
            }
          });
        }
      });
      HW.autoParry(s, 32);
    }
  });
})();
