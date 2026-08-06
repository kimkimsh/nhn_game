/* Boss 5, phase 4 — 전탄 발사. Nothing new is introduced; every answer the
   previous four bosses taught is demanded inside the same second. */
(function () {
  HW.still({
    title: '보스 B5 · 왜 수군 총대장 기함',
    stage: 'noryang', at: 9.0, playerX: 540, playerY: 1330,
    hud: {
      life: 1, maxLife: 4, score: 1662300, combo: 88, stage: 5, wave: '보스전', progress: 1,
      boss: { name: 'B5 왜 수군 총대장 기함', hp: 0.18, phase: 4, phases: [0.75, 0.5, 0.25] }
    },
    setup: function (s) {
      s.enemies = [
        { type: 'B-FLAG', x: 540, y: 380, hp: 5100, maxhp: 5100, nobar: true, hitW: 900, hitH: 260 },
        { type: 'B-SAM', x: 540, y: 640, hp: 5100, maxhp: 5100, nobar: true, hitW: 220, hitH: 240 }
      ];
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 1.0) * 320;
      s.player.y = 1330 + Math.cos(t * 0.72) * 150;
      var ship = s.enemies[0], cap = s.enemies[1];
      cap.x = 540 + Math.sin(t * 0.6) * 180;

      /* 전탄 발사: ring 20 + volley 7 + cannon 4, all on the same frame */
      HW.serve(s, ship, t, {
        period: 3.2, tell: 0.5, offset: 0.4,
        fire: function (st, e) {
          for (var i = 0; i < 20; i++) HW.spawn(st, 'P4', cap.x, cap.y, i / 20 * 6.2832, 1.34);
          for (var k = 0; k < 7; k++) HW.spawn(st, 'P2', 150 + k * 130, e.y + 80,
            HW.aimAt(150 + k * 130, e.y + 80, st.player.x, st.player.y), 1.34);
          for (var c = 0; c < 4; c++) HW.spawn(st, 'P6', 220 + c * 210, e.y + 110,
            HW.aimAt(220 + c * 210, e.y + 110, st.player.x, st.player.y), 1.34);
        }
      });

      /* 화공 총공세 running underneath it */
      if (s.rainAt === undefined) { s.rainAt = 1.1; s.rainN = 0; }
      if (t >= s.rainAt) {
        HW.spawn(s, 'P8', 100 + ((s.rainN * 271) % 880), -40, Math.PI / 2 + Math.sin(s.rainN * 2) * 0.2, 1.34);
        s.rainN++;
        s.rainAt = t + (s.rainN % 15 ? 0.18 : 2.6);
      }
      if (s.arcAt === undefined) s.arcAt = 4.2;
      if (t >= s.arcAt) {
        s.arcAt = t + 4.5;
        [[-300, -120], [-40, 40], [280, -80], [90, 190], [-190, 210]].forEach(function (o, i) {
          s.tele.push({
            kind: 'circle',
            x: HW.clamp(s.player.x + o[0], 160, 920),
            y: HW.clamp(s.player.y + o[1], 900, 1740),
            r: 90, age: -i * 0.12, dur: 1.2,
            onFire: function (st, g) {
              if (st.zones.length >= 6) st.zones.shift();
              st.zones.push({ x: g.x, y: g.y, r: 90, age: 0, dur: 4.0 });
            }
          });
        });
      }

      /* 관통 대창 세로 3줄, 줄 사이 안전 지대 폭 200u 보장 */
      if (s.lanceAt === undefined) s.lanceAt = 8.6;
      if (t >= s.lanceAt && !s.lanced) {
        s.lanced = true;
        [200, 540, 880].forEach(function (x) {
          s.tele.push({ kind: 'lance', x: x, w: 40, age: 0, dur: 0.8 });
        });
      }
      HW.autoParry(s, 30);
    }
  });
})();
