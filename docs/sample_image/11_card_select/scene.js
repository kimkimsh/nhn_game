/* Card select, first of four. Shown over the frozen battlefield so the run
   never visually restarts; the numbers are exact and stacking shows before→after. */
(function () {
  var C = HW.C, PF = HW.PF;

  var RARITY = {
    노말: '#d8d2c4', 레어: '#3b82f6', 에픽: '#a855f7'
  };

  var CARDS = [
    {
      id: 'N01', rarity: '노말', name: '검격 연마',
      effect: ['반사탄 데미지 +15%'],
      delta: ['보유 +15%', '→', '+30%'],
      stack: '중첩  1 / 3'
    },
    {
      id: 'R04', rarity: '레어', name: '되받아치기',
      effect: ['GREAT 패리로 만든', '반사탄의 데미지 ×1.5'],
      delta: ['GREAT 배수 3.5', '→', '5.25'],
      stack: '중첩  0 / 1'
    },
    {
      id: 'E05', rarity: '에픽', name: '영점 패리',
      effect: ['GREAT 밴드 상한 +10u', 'GREAT 데미지 배수', '3.5 → 5.0'],
      delta: ['GREAT 28u', '→', '38u'],
      stack: '중첩  0 / 1'
    }
  ];

  var HELD = ['N02 발놀림 ×1', 'N01 검격 연마 ×1'];

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function card(ctx, c, x, y, w, h, picked) {
    var col = RARITY[c.rarity];
    ctx.save();
    if (picked) {
      HW.glow(ctx, x + w / 2, y + h / 2, 380, col, 0.16);
      ctx.translate(0, -18);
    }
    ctx.fillStyle = picked ? '#151a24' : '#0e1119';
    rrect(ctx, x, y, w, h, 8); ctx.fill();
    ctx.strokeStyle = picked ? col : HW.hexA(col, 0.4);
    ctx.lineWidth = picked ? 5 : 2.5;
    rrect(ctx, x, y, w, h, 8); ctx.stroke();

    /* rarity band across the top — the only place rarity colour is used */
    ctx.fillStyle = col;
    rrect(ctx, x, y, w, 10, 4); ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = col;
    ctx.font = '600 24px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(c.rarity.toUpperCase() === c.rarity ? c.rarity : c.rarity, x + 26, y + 62);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.baekFaint;
    ctx.fillText(c.id, x + w - 26, y + 62);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.baek;
    ctx.font = '700 52px "Gowun Batang", "Nanum Myeongjo", serif';
    ctx.fillText(c.name, x + 26, y + 140);

    ctx.strokeStyle = HW.hexA(C.baek, 0.14);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 26, y + 176); ctx.lineTo(x + w - 26, y + 176); ctx.stroke();

    ctx.font = '400 27px "IBM Plex Sans KR", system-ui, sans-serif';
    ctx.fillStyle = C.baekMute;
    c.effect.forEach(function (line, i) { ctx.fillText(line, x + 26, y + 224 + i * 38); });

    /* before → after, so a stacked card never hides what it actually adds */
    var by = y + h - 168;
    ctx.fillStyle = '#0a0d14';
    rrect(ctx, x + 22, by, w - 44, 74, 5); ctx.fill();
    ctx.strokeStyle = HW.hexA(col, 0.3); ctx.lineWidth = 1.5;
    rrect(ctx, x + 22, by, w - 44, 74, 5); ctx.stroke();
    ctx.font = '500 26px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.baekFaint;
    ctx.fillText(c.delta[0], x + 40, by + 44);
    var wA = ctx.measureText(c.delta[0]).width;
    ctx.fillStyle = C.baekMute;
    ctx.fillText(c.delta[1], x + 52 + wA, by + 44);
    var wB = ctx.measureText(c.delta[1]).width;
    ctx.fillStyle = C.hwang;
    ctx.font = '600 26px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(c.delta[2], x + 66 + wA + wB, by + 44);

    ctx.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.baekFaint;
    ctx.fillText(c.stack, x + 26, y + h - 40);
    ctx.restore();
  }

  HW.still({
    title: '카드 선택',
    stage: 'busanjin', at: 3.2, playerX: 540, playerY: 1500,
    setup: function (s) {
      s.enemies = [
        { type: 'E-A', x: 250, y: 220, hp: 30, maxhp: 30, _next: 0.2 },
        { type: 'E-A', x: 800, y: 260, hp: 30, maxhp: 30, _next: 0.9 },
        { type: 'E-B', x: 540, y: 380, hp: 36, maxhp: 36, _next: 1.5 }
      ];
    },
    tick: function (s, t) {
      s.enemies.forEach(function (e) {
        HW.serve(s, e, t, {
          period: 2.4, tell: 0.95,
          fire: function (st, en) { HW.spawn(st, 'P2', en.x, en.y, HW.aimAt(en.x, en.y, 540, 1500)); }
        });
      });
    },
    overlay: function (ctx) {
      ctx.save();
      /* the field stays visible under the dim: the run has not restarted */
      ctx.fillStyle = 'rgba(5,6,10,0.86)';
      ctx.fillRect(0, 0, PF.W, PF.H);

      ctx.textAlign = 'center';
      ctx.fillStyle = C.cheong;
      ctx.font = '500 30px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('STAGE 1  CLEAR', 540, 168);
      ctx.fillStyle = C.baek;
      ctx.font = '700 74px "Gowun Batang", "Nanum Myeongjo", serif';
      ctx.fillText('한 장을 고른다', 540, 262);
      ctx.fillStyle = C.baekFaint;
      ctx.font = '400 27px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillText('건너뛸 수 없다 · 남은 선택 기회 4회 중 1회차', 540, 312);

      var w = 320, gap = 30, x0 = (PF.W - (w * 3 + gap * 2)) / 2;
      CARDS.forEach(function (c, i) {
        card(ctx, c, x0 + i * (w + gap), 380, w, 800, i === 1);
      });

      /* held cards stay on screen at all times, spec §15.2 */
      ctx.textAlign = 'left';
      ctx.fillStyle = C.baekFaint;
      ctx.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('보유 카드', 80, 1320);
      ctx.strokeStyle = HW.hexA(C.baek, 0.12);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(80, 1344); ctx.lineTo(PF.W - 80, 1344); ctx.stroke();
      var cx = 80;
      HELD.forEach(function (h) {
        ctx.font = '400 25px "IBM Plex Sans KR", system-ui, sans-serif';
        var tw = ctx.measureText(h).width + 34;
        ctx.strokeStyle = HW.hexA(C.baek, 0.2);
        rrect(ctx, cx, 1372, tw, 50, 4); ctx.stroke();
        ctx.fillStyle = C.baekMute;
        ctx.fillText(h, cx + 17, 1404);
        cx += tw + 14;
      });

      /* explicit confirm step — spec §15.2 오조작 방지 */
      ctx.textAlign = 'center';
      ctx.strokeStyle = C.hwang;
      ctx.lineWidth = 2.5;
      rrect(ctx, 120, 1500, 400, 88, 6); ctx.stroke();
      HW.glow(ctx, 320, 1544, 210, C.hwang, 0.1);
      ctx.fillStyle = C.hwang;
      ctx.font = '600 36px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('ENTER  확정', 320, 1556);

      /* 리롤 — one per run (§11.1). The remaining count has to be visible
         at all times or the player cannot decide whether to spend it here. */
      ctx.strokeStyle = HW.hexA(C.baek, 0.4);
      ctx.lineWidth = 2;
      rrect(ctx, 560, 1500, 400, 88, 6); ctx.stroke();
      ctx.fillStyle = C.baek;
      ctx.font = '600 36px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('R  다시 뽑기', 760, 1546);
      ctx.fillStyle = C.baekFaint;
      ctx.font = '400 22px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillText('런당 1회 · 남음 1', 760, 1576);

      ctx.fillStyle = C.baekFaint;
      ctx.font = '400 26px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillText('← →  카드 이동          Tab  보유 카드          클릭으로도 선택', 540, 1670);
      ctx.font = '400 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('등급 추첨 1회차 — 노말 70 / 레어 27 / 에픽 3', 540, 1730);
      ctx.fillText('다시 뽑으면 등급부터 다시 추첨한다', 540, 1780);
      ctx.restore();
    }
  });
})();
