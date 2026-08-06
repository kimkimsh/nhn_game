/* Run result. Every line here is one of the measurements §14.3's tuning rules
   need, which is why 자해 라이프 and 등급별 횟수 get their own rows. */
(function () {
  var C = HW.C, PF = HW.PF;

  var GRADES = [
    ['GREAT', 152, '#f5b324'],
    ['GOOD', 386, '#35b7e0'],
    ['NOT BAD', 214, '#ede6d8']
  ];

  var ROWS = [
    ['도달 스테이지', '5 · 클리어'],
    ['최대 콤보', '88  (×3.0 상한 도달)'],
    ['패리 성공률', '71%   752 / 1,059'],
    ['재패리', '24회'],
    ['반사탄 자해로 잃은 라이프', '2'],
    ['리롤 사용', '1 / 1  (S3 클리어 시)']
  ];

  var CARDS = [
    ['N01', '검격 연마 ×3', '#d8d2c4'],
    ['R04', '되받아치기', '#3b82f6'],
    ['E05', '영점 패리', '#a855f7'],
    ['N02', '발놀림', '#d8d2c4']
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
    title: '결과 화면',
    stage: 'noryang', at: 2.4, playerX: 540, playerY: 1500,
    setup: function (s) {
      s.enemies = [];
      for (var i = 0; i < 24; i++) {
        s.parts.push({
          x: 200 + (i * 137) % 700, y: 300 + (i * 211) % 400,
          vx: Math.cos(i) * 90, vy: Math.sin(i) * 60,
          life: 0.9, max: 0.9, c: i % 3 ? C.hwang : C.baek
        });
      }
    },
    overlay: function (ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(4,5,9,0.9)';
      ctx.fillRect(0, 0, PF.W, PF.H);

      ctx.textAlign = 'center';
      ctx.fillStyle = C.hwang;
      ctx.font = '500 30px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('노량 · 최종 결전 종료', 540, 190);
      ctx.fillStyle = C.baek;
      ctx.font = '700 92px "Gowun Batang", "Nanum Myeongjo", serif';
      ctx.fillText('돌려주었다', 540, 300);

      /* the score is the hero: it is what a run is compared by */
      ctx.fillStyle = C.baekFaint;
      ctx.font = '500 26px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('TOTAL SCORE', 540, 400);
      ctx.fillStyle = C.baek;
      ctx.font = '600 128px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('1,662,300', 540, 512);
      HW.glow(ctx, 540, 480, 420, C.hwang, 0.09);

      ctx.strokeStyle = HW.hexA(C.baek, 0.14);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(90, 588); ctx.lineTo(PF.W - 90, 588); ctx.stroke();

      /* grade breakdown as one stacked bar: the shape of the run at a glance */
      ctx.textAlign = 'left';
      ctx.fillStyle = C.baekFaint;
      ctx.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('패리 등급 분포', 90, 650);
      var total = GRADES.reduce(function (a, g) { return a + g[1]; }, 0);
      var x = 90, bw = PF.W - 180;
      GRADES.forEach(function (g) {
        var seg = bw * g[1] / total;
        ctx.fillStyle = g[2];
        ctx.fillRect(x, 674, seg - 3, 26);
        x += seg;
      });
      x = 90;
      GRADES.forEach(function (g) {
        var seg = bw * g[1] / total;
        ctx.fillStyle = g[2];
        ctx.font = '600 25px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(g[0], x, 740);
        ctx.fillStyle = C.baekMute;
        ctx.font = '400 25px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(String(g[1]), x, 776);
        x += seg;
      });

      ROWS.forEach(function (r, i) {
        var y = 856 + i * 62;
        ctx.fillStyle = C.baekFaint;
        ctx.font = '400 28px "IBM Plex Sans KR", system-ui, sans-serif';
        ctx.fillText(r[0], 90, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = C.baek;
        ctx.font = '500 28px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(r[1], PF.W - 90, y);
        ctx.textAlign = 'left';
        ctx.strokeStyle = HW.hexA(C.baek, 0.07);
        ctx.beginPath(); ctx.moveTo(90, y + 20); ctx.lineTo(PF.W - 90, y + 20); ctx.stroke();
      });

      ctx.fillStyle = C.baekFaint;
      ctx.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('획득 카드', 90, 1300);
      var cx = 90;
      CARDS.forEach(function (c) {
        ctx.font = '400 25px "IBM Plex Sans KR", system-ui, sans-serif';
        var label = c[0] + '  ' + c[1];
        var tw = ctx.measureText(label).width + 34;
        ctx.strokeStyle = HW.hexA(c[2], 0.55);
        ctx.lineWidth = 1.8;
        rrect(ctx, cx, 1330, tw, 52, 4); ctx.stroke();
        ctx.fillStyle = c[2];
        ctx.fillText(label, cx + 17, 1363);
        cx += tw + 14;
      });

      /* run integrity: a clean run says so, so the cheat flag is never implied */
      ctx.fillStyle = C.cheong;
      ctx.font = '500 25px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('치트 모드 미사용 — 기록 대상 런', 90, 1462);

      ctx.textAlign = 'center';
      ctx.strokeStyle = C.hwang; ctx.lineWidth = 2.5;
      rrect(ctx, 150, 1560, 360, 92, 6); ctx.stroke();
      ctx.fillStyle = C.hwang;
      ctx.font = '600 36px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('R  다시 한 판', 330, 1618);

      ctx.strokeStyle = HW.hexA(C.baek, 0.35); ctx.lineWidth = 2;
      rrect(ctx, 570, 1560, 360, 92, 6); ctx.stroke();
      ctx.fillStyle = C.baekMute;
      ctx.fillText('ESC  타이틀로', 750, 1618);

      ctx.fillStyle = C.baekFaint;
      ctx.font = '400 26px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillText('재시작하면 카드는 전부 사라지고 스테이지 1부터 시작한다.', 540, 1740);
      ctx.restore();
    }
  });
})();
