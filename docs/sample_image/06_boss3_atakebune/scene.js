/* Boss 3 — a hull with four destructible ports, each carrying its own HP bar.
   Which port dies first is a decision the other bosses never ask for. */
(function () {
  var C = HW.C;

  HW.still({
    title: '보스 B3 · 아타케부네 기함',
    stage: 'hansando', at: 3.0, playerX: 540, playerY: 1330,
    hud: {
      life: 3, maxLife: 4, score: 402900, combo: 61, stage: 3, wave: '보스전', progress: 1,
      boss: { name: 'B3 아타케부네 기함', hp: 0.63, phase: 1, phases: [0.6, 0.35] }
    },
    setup: function (s) {
      s.enemies = [
        { type: 'B-SHIP', x: 540, y: 330, hp: 2000, maxhp: 2000, nobar: true, hitW: 860, hitH: 250 },
        { type: 'E-I', x: 190, y: 430, hp: 300, maxhp: 300, _next: 0.2 },
        { type: 'E-I', x: 400, y: 450, hp: 168, maxhp: 300, _next: 0.2 },
        { type: 'E-I', x: 680, y: 450, hp: 300, maxhp: 300, _next: 0.2 },
        { type: 'E-I', x: 890, y: 430, hp: 62, maxhp: 300, _next: 0.2 }
      ];
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.8) * 320;
      s.player.y = 1260 + Math.cos(t * 0.6) * 130;

      /* 좌현 일제포격: every surviving port fires one 함포탄 on the same frame */
      s.enemies.forEach(function (e) {
        if (e.type !== 'E-I' || e.dead) return;
        HW.serve(s, e, t, {
          period: 4.0, tell: 0.75,
          fire: function (st, en) {
            HW.spawn(st, 'P6', en.x, en.y + 50, HW.aimAt(en.x, en.y, st.player.x, st.player.y), 1.16);
          }
        });
      });

      /* 갑판 조총 사격: 8발 산발, 0.15초 간격. Keeps the screen from emptying
         between salvoes, which HR-03 does not allow. */
      if (s.deck === undefined) { s.deck = 0.5; s.deckN = 0; }
      if (t >= s.deck) {
        var dx = 240 + (s.deckN % 8) * 90;
        HW.spawn(s, 'P2', dx, 250, HW.aimAt(dx, 250, s.player.x, s.player.y), 1.16);
        s.deckN++;
        s.deck = t + (s.deckN % 8 ? 0.15 : 0.9);
      }
      HW.autoParry(s, 30);
    },
    overlay: function (ctx, s) {
      /* per-port gauges, spec §15.1 파괴 가능 부위 */
      s.enemies.forEach(function (e) {
        if (e.type !== 'E-I') return;
        var w = 130, x = e.x - w / 2, y = e.y - 96;
        ctx.fillStyle = HW.hexA(C.baek, 0.14);
        ctx.fillRect(x, y, w, 9);
        ctx.fillStyle = e.dead ? C.baekFaint : C.jeok;
        ctx.fillRect(x, y, w * Math.max(e.hp, 0) / e.maxhp, 9);
        HW.label(ctx, e.x, y - 18, e.dead ? '파괴' : Math.max(e.hp, 0) + ' / 300',
          e.dead ? C.baekFaint : C.baekMute, 21, 'center');
      });
    }
  });
})();
