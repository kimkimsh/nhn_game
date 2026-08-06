/* Title screen. The fight running above the logotype is the real loop —
   same enemies, same tells, same reflection maths — frozen on one frame. */
(function () {
  var C = HW.C, PF = HW.PF;

  /* The grade rings are the game's one rule turned into a mark. */
  function mark(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = HW.hexA(C.baek, 0.3);
    ctx.beginPath(); ctx.arc(0, 0, 130, 0, 6.284); ctx.stroke();
    ctx.strokeStyle = HW.hexA(C.cheong, 0.75);
    ctx.beginPath(); ctx.arc(0, 0, 89, 0, 6.284); ctx.stroke();
    ctx.strokeStyle = C.hwang;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(0, 0, 52, 0, 6.284); ctx.stroke();
    HW.glow(ctx, 0, 0, 110, C.hwang, 0.26);
    ctx.strokeStyle = C.baek;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-152, 84); ctx.lineTo(152, -84); ctx.stroke();
    ctx.fillStyle = C.baek;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 6.284); ctx.fill();
    ctx.restore();
  }

  HW.still({
    title: '타이틀 화면',
    stage: 'busanjin', at: 5.05, playerX: 540, playerY: 540,
    setup: function (s) {
      s.enemies = [
        { type: 'E-A', x: 250, y: 180, hp: 30, maxhp: 30 },
        { type: 'E-A', x: 540, y: 130, hp: 30, maxhp: 30 },
        { type: 'E-A', x: 830, y: 180, hp: 30, maxhp: 30 },
        { type: 'E-B', x: 370, y: 300, hp: 36, maxhp: 36 },
        { type: 'E-B', x: 710, y: 300, hp: 36, maxhp: 36 }
      ];
      s.enemies.forEach(function (e, i) { e._next = 0.4 + i * 0.62; });
    },
    tick: function (s, t) {
      s.player.x = 540 + Math.sin(t * 0.72) * 190;
      s.player.y = 545 + Math.cos(t * 0.51) * 55;
      s.enemies.forEach(function (e) {
        if (e.dead) return;
        HW.serve(s, e, t, {
          period: e.type === 'E-A' ? 2.2 : 2.6, tell: 0.95,
          fire: function (st, en) {
            var a = HW.aimAt(en.x, en.y, st.player.x, st.player.y);
            if (en.type === 'E-B') {
              for (var k = -1; k <= 1; k++) HW.spawn(st, 'P1', en.x, en.y, a + k * 0.244);
            } else {
              HW.spawn(st, 'P2', en.x, en.y, a);
            }
          }
        });
      });
      HW.autoParry(s, 34);
    },
    overlay: function (ctx) {
      ctx.save();
      var sc = ctx.createLinearGradient(0, 0, 0, PF.H);
      sc.addColorStop(0, 'rgba(6,7,10,0.05)');
      sc.addColorStop(0.31, 'rgba(6,7,10,0.18)');
      sc.addColorStop(0.39, 'rgba(6,7,10,0.88)');
      sc.addColorStop(1, 'rgba(6,7,10,0.94)');
      ctx.fillStyle = sc;
      ctx.fillRect(0, 0, PF.W, PF.H);

      ctx.strokeStyle = HW.hexA(C.baek, 0.16);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(70, 700); ctx.lineTo(PF.W - 70, 700); ctx.stroke();

      mark(ctx, 540, 880);

      ctx.textAlign = 'center';
      ctx.fillStyle = C.baek;
      ctx.font = '700 210px "Gowun Batang", "Nanum Myeongjo", serif';
      ctx.fillText('환도', 540, 1180);
      ctx.font = '400 56px "Gowun Batang", "Nanum Myeongjo", serif';
      ctx.fillStyle = C.hwang;
      ctx.fillText('還 刀', 540, 1258);

      ctx.strokeStyle = HW.hexA(C.baek, 0.2);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(320, 1312); ctx.lineTo(760, 1312); ctx.stroke();

      ctx.font = '500 40px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillStyle = C.baek;
      ctx.fillText('나에게는 무기가 없다.', 540, 1382);
      ctx.fillStyle = C.hwang;
      ctx.fillText('적이 쏜 것만이 내 칼이다.', 540, 1440);

      ctx.strokeStyle = HW.hexA(C.cheong, 0.6);
      ctx.lineWidth = 2;
      ctx.strokeRect(310, 1548, 460, 74);
      ctx.fillStyle = C.cheong;
      ctx.font = '600 40px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('SPACE — 베러 나간다', 540, 1595);

      ctx.font = '400 29px "IBM Plex Sans KR", system-ui, sans-serif';
      ctx.fillStyle = C.baekMute;
      ctx.fillText('이동  WASD · 방향키        패리  SPACE · J · 좌클릭', 540, 1712);
      ctx.fillStyle = C.baekFaint;
      ctx.fillText('음소거  M          치트 모드  Shift + F9', 540, 1762);

      ctx.font = '400 25px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('NAN 2026 · 사전 과제', 40, PF.H - 38);
      ctx.textAlign = 'right';
      ctx.fillText('5 STAGES · 약 7분 30초', PF.W - 40, PF.H - 38);
      ctx.restore();
    }
  });
})();
