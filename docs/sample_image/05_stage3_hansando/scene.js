/* Stage 3, wave 4 — the slow-and-huge wave. 함포탄 is 300u/s with BRP 55, so
   one GREAT parry is a kill; the fight becomes about picking a target. */
(function () {
  HW.still({
    title: '스테이지 3 · 한산도 앞바다',
    stage: 'hansando', at: 7.0, playerX: 540, playerY: 1310,
    hud: { life: 3, maxLife: 4, score: 341700, combo: 52, stage: 3, wave: 'W4  0:52 / 0:58', progress: 0.71 },
    setup: function (s) {
      s.enemies = [
        { type: 'E-E', x: 180, y: 300, hp: 126, maxhp: 126, _next: 0.1 },
        { type: 'E-E', x: 430, y: 240, hp: 126, maxhp: 126, _next: 0.9 },
        { type: 'E-E', x: 680, y: 240, hp: 126, maxhp: 126, _next: 1.7 },
        { type: 'E-E', x: 920, y: 300, hp: 126, maxhp: 126, _next: 2.5 },
        { type: 'E-G', x: 300, y: 520, hp: 108, maxhp: 108, _next: 1.2 },
        { type: 'E-G', x: 540, y: 470, hp: 108, maxhp: 108, _next: 2.4 },
        { type: 'E-G', x: 780, y: 520, hp: 108, maxhp: 108, _next: 3.6 },
        { type: 'E-F', x: -60, y: 820, hp: 36, maxhp: 36, vx: 430, _next: 0.7 },
        { type: 'E-F', x: 1140, y: 980, hp: 36, maxhp: 36, vx: -430, _next: 1.9 }
      ];
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.7) * 300;
      s.player.y = 1310 + Math.cos(t * 0.5) * 150;
      s.enemies.forEach(function (e) {
        if (e.dead) { if (t - e.deadAt > 3) { e.dead = false; e.hp = e.maxhp; e._next = t + 0.9; } return; }
        if (e.type === 'E-F' && (e.x > 1160 || e.x < -80)) e.vx = -e.vx;
        if (e.type === 'E-E') {
          HW.serve(s, e, t, {
            period: 3.4, tell: 0.75,
            fire: function (st, en) {
              HW.spawn(st, 'P6', en.x, en.y + 40, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.16);
            }
          });
        }
        if (e.type === 'E-G') {
          /* 링 탄막 10발, 등간격 36° */
          HW.serve(s, e, t, {
            period: 3.0, tell: 0.4,
            fire: function (st, en) {
              for (var i = 0; i < 10; i++) HW.spawn(st, 'P4', en.x, en.y, i / 10 * 6.2832, 1.16);
            }
          });
        }
        if (e.type === 'E-F') {
          HW.serve(s, e, t, {
            period: 2.1, tell: 0.4,
            fire: function (st, en) {
              HW.spawn(st, 'P11', en.x, en.y, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.16);
            }
          });
        }
      });
      HW.autoParry(s, 30);
    }
  });
})();
