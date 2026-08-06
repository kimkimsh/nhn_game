/* Stage 4, wave 4 — the first threat parrying cannot answer. Fire zones stack
   up and the fight turns into space management. */
(function () {
  HW.still({
    title: '스테이지 4 · 행주산성 야전',
    stage: 'haengju', at: 3.0, playerX: 620, playerY: 1260,
    hud: { life: 2, maxLife: 4, score: 612400, combo: 38, stage: 4, wave: 'W4  0:54 / 1:00', progress: 0.79 },
    setup: function (s) {
      s.enemies = [
        { type: 'E-H', x: 170, y: 300, hp: 96, maxhp: 96, _next: 0.1 },
        { type: 'E-H', x: 420, y: 230, hp: 96, maxhp: 96, _next: 0.7 },
        { type: 'E-H', x: 660, y: 230, hp: 96, maxhp: 96, _next: 1.3 },
        { type: 'E-H', x: 910, y: 300, hp: 96, maxhp: 96, _next: 1.9 },
        { type: 'E-H', x: 540, y: 420, hp: 96, maxhp: 96, _next: 2.5 },
        { type: 'E-E', x: 250, y: 560, hp: 168, maxhp: 168, _next: 0.4 },
        { type: 'E-E', x: 540, y: 620, hp: 168, maxhp: 168, _next: 1.6 },
        { type: 'E-E', x: 830, y: 560, hp: 168, maxhp: 168, _next: 2.8 },
        { type: 'E-F', x: -60, y: 880, hp: 48, maxhp: 48, vx: 440, _next: 0.5 },
        { type: 'E-F', x: 1140, y: 1010, hp: 48, maxhp: 48, vx: -440, _next: 1.4 }
      ];
      /* 장판 상한 6개 — the oldest is removed when a seventh is created */
      [[250, 1560], [720, 1620], [430, 1180], [880, 1400]].forEach(function (p, i) {
        s.zones.push({ x: p[0], y: p[1], r: 90, age: i * 0.7, dur: 4.0 });
      });
    },
    tick: function (s, t) {
      s.player.x = 620 + Math.sin(t * 0.75) * 220;
      s.player.y = 1260 + Math.cos(t * 0.58) * 120;
      s.enemies.forEach(function (e) {
        if (e.dead) { if (t - e.deadAt > 3) { e.dead = false; e.hp = e.maxhp; e._next = t + 0.9; } return; }
        if (e.type === 'E-F' && (e.x > 1160 || e.x < -80)) e.vx = -e.vx;
        if (e.type === 'E-H') {
          HW.serve(s, e, t, {
            period: 2.8, tell: 0.65,
            fire: function (st, en) {
              var a = HW.aimAt(en.x, en.y, st.player.x, st.player.y);
              for (var k = -1; k <= 1; k += 2) HW.spawn(st, 'P8', en.x, en.y, a + k * 0.087, 1.24);
            }
          });
        }
        if (e.type === 'E-E') {
          HW.serve(s, e, t, {
            period: 3.4, tell: 0.65,
            fire: function (st, en) {
              HW.spawn(st, 'P6', en.x, en.y + 40, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.24);
            }
          });
        }
        if (e.type === 'E-F') {
          HW.serve(s, e, t, {
            period: 2.1, tell: 0.4,
            fire: function (st, en) {
              HW.spawn(st, 'P11', en.x, en.y, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.24);
            }
          });
        }
      });

      /* a fire arrow that lands leaves a zone behind it */
      for (var i = s.bullets.length - 1; i >= 0; i--) {
        var b = s.bullets[i];
        if (b.type === 'P8' && b.owner === 'enemy' && b.y > 1680) {
          if (s.zones.length >= 6) s.zones.shift();
          s.zones.push({ x: b.x, y: b.y, r: 90, age: 0, dur: 4.0 });
          s.bullets.splice(i, 1);
        }
      }
      HW.autoParry(s, 32);
    }
  });
})();
