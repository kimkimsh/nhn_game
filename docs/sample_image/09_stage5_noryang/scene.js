/* Stage 5, wave 5 — the only wave that actually reaches the 20-minion cap,
   with 관통 대창 cutting two vertical lanes through it. */
(function () {
  HW.still({
    title: '스테이지 5 · 노량 밤바다',
    stage: 'noryang', at: 3.25, playerX: 540, playerY: 1240,
    hud: { life: 2, maxLife: 4, score: 1084600, combo: 73, stage: 5, wave: 'W5  1:04 / 1:10', progress: 0.93 },
    setup: function (s) {
      s.enemies = [];
      [110, 290, 470, 650, 830, 1000].forEach(function (x, i) {
        s.enemies.push({ type: 'E-A', x: x, y: 200 + (i % 2) * 50, hp: 93, maxhp: 93, _next: 0.1 + i * 0.2 });
      });
      [200, 460, 720, 960].forEach(function (x, i) {
        s.enemies.push({ type: 'E-E', x: x, y: 380 + (i % 2) * 40, hp: 217, maxhp: 217, _next: 0.4 + i * 0.5 });
      });
      [300, 540, 780].forEach(function (x, i) {
        s.enemies.push({ type: 'E-G', x: x, y: 560, hp: 186, maxhp: 186, _next: 1.1 + i * 0.9 });
      });
      [160, 420, 700, 940].forEach(function (x, i) {
        s.enemies.push({ type: 'E-H', x: x, y: 700 + (i % 2) * 44, hp: 124, maxhp: 124, _next: 0.8 + i * 0.6 });
      });
      [-60, 1140, -60].forEach(function (x, i) {
        s.enemies.push({
          type: 'E-F', x: x, y: 860 + i * 90, hp: 62, maxhp: 62,
          vx: x < 0 ? 450 : -450, _next: 0.6 + i * 0.7
        });
      });
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.9) * 300;
      s.player.y = 1240 + Math.cos(t * 0.66) * 150;
      s.enemies.forEach(function (e) {
        if (e.dead) { if (t - e.deadAt > 2.4) { e.dead = false; e.hp = e.maxhp; e._next = t + 0.7; } return; }
        if (e.type === 'E-F' && (e.x > 1160 || e.x < -80)) e.vx = -e.vx;
        var plan = {
          'E-A': { period: 2.2, tell: 0.55, shot: 'P2' },
          'E-E': { period: 3.4, tell: 0.55, shot: 'P6' },
          'E-G': { period: 3.0, tell: 0.4, shot: 'ring' },
          'E-H': { period: 2.8, tell: 0.55, shot: 'P8' },
          'E-F': { period: 2.1, tell: 0.4, shot: 'P11' }
        }[e.type];
        HW.serve(s, e, t, {
          period: plan.period, tell: plan.tell,
          fire: function (st, en) {
            if (plan.shot === 'ring') {
              for (var i = 0; i < 10; i++) HW.spawn(st, 'P4', en.x, en.y, i / 10 * 6.2832, 1.34);
              return;
            }
            if (HW.len(st.player.x - en.x, st.player.y - en.y) < HW.BULLETS[plan.shot].v * 1.34 * 0.45) return;
            HW.spawn(st, plan.shot, en.x, en.y, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.34);
          }
        });
      });

      /* 관통 대창: two lanes, 0.8s warning, and a guaranteed 200u gap between */
      if (s.lanceAt === undefined) s.lanceAt = 2.9;
      if (t >= s.lanceAt && !s.lanced) {
        s.lanced = true;
        [300, 800].forEach(function (x) {
          s.tele.push({ kind: 'lance', x: x, w: 40, age: 0, dur: 0.8 });
        });
      }
      HW.autoParry(s, 30);
    }
  });
})();
