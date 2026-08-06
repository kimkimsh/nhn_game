/* Pause. Every timer, bullet and cooldown stops, so the frame underneath is
   the live battlefield held still rather than a separate menu screen. */
(function () {
  var C = HW.C, PF = HW.PF;

  var HELD = [
    ['N01', '검격 연마 ×2', '반사탄 데미지 +30%', '#d8d2c4'],
    ['N02', '발놀림 ×1', '이동 속도 +12%', '#d8d2c4'],
    ['R04', '되받아치기', 'GREAT 반사탄 데미지 ×1.5', '#3b82f6']
  ];

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  HW.still({
    title: '일시정지',
    stage: 'haengju', at: 6.1, playerX: 600, playerY: 1360,
    hud: { life: 2, maxLife: 4, score: 598200, combo: 31, stage: 4, wave: 'W4  0:51 / 1:00', progress: 0.76 },
    setup: function (s) {
      s.enemies = [
        { type: 'E-H', x: 200, y: 280, hp: 96, maxhp: 96, _next: 0.1 },
        { type: 'E-H', x: 470, y: 220, hp: 96, maxhp: 96, _next: 0.8 },
        { type: 'E-H', x: 740, y: 250, hp: 96, maxhp: 96, _next: 1.5 },
        { type: 'E-E', x: 330, y: 520, hp: 168, maxhp: 168, _next: 0.4 },
        { type: 'E-E', x: 760, y: 560, hp: 168, maxhp: 168, _next: 1.8 }
      ];
      [[300, 1560], [780, 1500]].forEach(function (p, i) {
        s.zones.push({ x: p[0], y: p[1], r: 90, age: i * 0.6, dur: 4.0 });
      });
    },
    tick: function (s, t) {
      s.player.x = 600 + Math.sin(t * 0.7) * 180;
      s.player.y = 1280 + Math.cos(t * 0.5) * 110;
      s.enemies.forEach(function (e) {
        HW.serve(s, e, t, {
          period: e.type === 'E-H' ? 2.8 : 3.4, tell: 0.65,
          fire: function (st, en) {
            var a = HW.aimAt(en.x, en.y, st.player.x, st.player.y);
            if (en.type === 'E-H') {
              for (var k = -1; k <= 1; k += 2) HW.spawn(st, 'P8', en.x, en.y, a + k * 0.087, 1.24);
            } else {
              HW.spawn(st, 'P6', en.x, en.y + 40, a, 1.24);
            }
          }
        });
      });
      HW.autoParry(s, 32);
    },
    overlay: function (ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(5,6,10,0.78)';
      ctx.fillRect(0, 0, PF.W, PF.H);

      ctx.textAlign = 'center';
      ctx.fillStyle = C.cheong;
      ctx.font = '500 28px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('STAGE 4 · 행주산성 야전 · W4', 540, 620);
      ctx.fillStyle = C.baek;
      ctx.font = '700 96px "Gowun Batang", "Nanum Myeongjo", serif';
      ctx.fillText('멈춤', 540, 736);
      ctx.fillStyle = C.baekFaint;
      ctx.font = '400 26px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillText('모든 타이머 · 탄환 · 쿨다운이 정지했다', 540, 790);

      /* the build is the only thing a player cannot see while fighting */
      ctx.textAlign = 'left';
      ctx.fillStyle = C.baekFaint;
      ctx.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('보유 카드  3', 120, 880);
      ctx.strokeStyle = HW.hexA(C.baek, 0.14);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(120, 904); ctx.lineTo(PF.W - 120, 904); ctx.stroke();

      HELD.forEach(function (h, i) {
        var y = 936 + i * 92;
        ctx.fillStyle = h[3];
        ctx.fillRect(120, y + 6, 4, 52);
        ctx.fillStyle = C.baekFaint;
        ctx.font = '500 22px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(h[0], 146, y + 28);
        ctx.fillStyle = C.baek;
        ctx.font = '600 32px "IBM Plex Sans KR", system-ui, sans-serif';
        ctx.fillText(h[1], 146, y + 62);
        ctx.textAlign = 'right';
        ctx.fillStyle = C.baekMute;
        ctx.font = '400 26px "IBM Plex Sans KR", system-ui, sans-serif';
        ctx.fillText(h[2], PF.W - 120, y + 56);
        ctx.textAlign = 'left';
      });

      /* menu, spec §16.3 — 상하 이동 + Enter, and 런 포기 needs a confirm step */
      ctx.textAlign = 'center';
      ctx.strokeStyle = C.hwang; ctx.lineWidth = 2.5;
      rrect(ctx, 300, 1290, 480, 92, 6); ctx.stroke();
      HW.glow(ctx, 540, 1336, 240, C.hwang, 0.09);
      ctx.fillStyle = C.hwang;
      ctx.font = '600 36px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('계속하기', 540, 1348);

      ctx.strokeStyle = HW.hexA(C.baek, 0.28); ctx.lineWidth = 2;
      rrect(ctx, 300, 1400, 480, 78, 6); ctx.stroke();
      ctx.fillStyle = C.baekMute;
      ctx.font = '500 30px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('음소거   M   ●', 540, 1448);

      ctx.strokeStyle = HW.hexA(C.baek, 0.28); ctx.lineWidth = 2;
      rrect(ctx, 300, 1496, 480, 78, 6); ctx.stroke();
      ctx.fillStyle = C.baekMute;
      ctx.fillText('런 포기', 540, 1544);

      ctx.fillStyle = C.baekFaint;
      ctx.font = '400 26px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillText('↑ ↓  항목 이동      Enter  실행      Esc  즉시 계속', 540, 1636);
      ctx.fillText('포기하면 카드 3장이 전부 사라진다. 중간 저장은 없다.', 540, 1686);
      ctx.restore();
    }
  });
})();
