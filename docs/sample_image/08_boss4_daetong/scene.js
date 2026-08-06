/* Boss 4, phase 1 — 착탄 예고 원 in the same frame as unmarked ring bullets.
   Circles mean move; everything without a circle means swing. */
(function () {
  HW.still({
    title: '보스 B4 · 대통 포병 대장',
    stage: 'haengju', at: 5.0, playerX: 470, playerY: 1290,
    hud: {
      life: 2, maxLife: 4, score: 731500, combo: 44, stage: 4, wave: '보스전', progress: 1,
      boss: { name: 'B4 대통 포병 대장', hp: 0.82, phase: 1, phases: [0.6, 0.3] }
    },
    setup: function (s) {
      s.enemies = [{ type: 'B-ART', x: 540, y: 340, hp: 3850, maxhp: 3850, nobar: true, hitW: 460, hitH: 240 }];
    },
    tick: function (s, t) {
      s.player.x = 470 + Math.sin(t * 0.85) * 250;
      s.player.y = 1290 + Math.cos(t * 0.62) * 140;
      var boss = s.enemies[0];

      /* 곡사 포격 — the arc shot cannot be parried in flight, so it announces
         its landing point 1.2s ahead and then throws a parryable ring. */
      if (s.arcAt === undefined) s.arcAt = 1.0;
      if (t >= s.arcAt) {
        s.arcAt = t + 2.6;
        [[-260, -60], [40, 90], [330, -30]].forEach(function (o, i) {
          s.tele.push({
            kind: 'circle', x: HW.clamp(s.player.x + o[0], 160, 920),
            y: HW.clamp(s.player.y + o[1], 900, 1740),
            r: 90, age: -i * 0.18, dur: 1.2,
            onFire: function (st, g) {
              if (st.zones.length >= 6) st.zones.shift();
              st.zones.push({ x: g.x, y: g.y, r: 90, age: 0, dur: 4.0 });
              for (var k = 0; k < 8; k++) HW.spawn(st, 'P4', g.x, g.y, k / 8 * 6.2832, 1.24);
            }
          });
        });
      }

      /* 불화살 비 — 12발 순차 낙하, 0.2초 간격 */
      if (s.rainAt === undefined) { s.rainAt = 1.4; s.rainN = 0; }
      if (t >= s.rainAt) {
        HW.spawn(s, 'P8', 120 + ((s.rainN * 317) % 840), -40, Math.PI / 2 + Math.sin(s.rainN) * 0.18, 1.24);
        s.rainN++;
        s.rainAt = t + (s.rainN % 12 ? 0.2 : 1.0);
      }

      HW.serve(s, boss, t, { period: 3.4, tell: 1.2, offset: 0.6, fire: function () { } });
      HW.autoParry(s, 32);
    }
  });
})();
