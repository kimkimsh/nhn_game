/* The single frame the whole game is built around: six shells flipped inside
   one 0.15s window and already leaving as gold. Bullet placement is computed
   from §5.3's distance bands, so the GREAT on screen is a real GREAT. */
(function () {
  var C = HW.C;

  /* Put a bullet on a course that leaves it exactly `d` units from the player
     at time `T`, coming from `src`. §5.5 then sends it back the way it came,
     which is why the reflection fan points at the shooters. */
  function inbound(s, type, src, player, T, d, scale) {
    var v = HW.BULLETS[type].v * (scale || 1);
    var dx = src[0] - player[0], dy = src[1] - player[1];
    var m = HW.len(dx, dy);
    var ux = dx / m, uy = dy / m;
    var d0 = d + v * T;
    s.bullets.push({
      type: type, x: player[0] + ux * d0, y: player[1] + uy * d0,
      vx: -ux * v, vy: -uy * v,
      owner: 'enemy', spin: 0, reparry: 0, age: 0, grace: 0
    });
  }

  var P = [540, 1240];

  HW.still({
    title: '패리 성립 순간',
    stage: 'hansando', at: 2.32, playerX: P[0], playerY: P[1],
    hud: { life: 3, maxLife: 4, score: 358900, combo: 57, stage: 3, wave: 'W4  0:55 / 0:58', progress: 0.74 },
    setup: function (s) {
      s.enemies = [
        { type: 'E-E', x: 150, y: 330, hp: 126, maxhp: 126, _next: 99 },
        { type: 'E-E', x: 420, y: 250, hp: 126, maxhp: 126, _next: 99 },
        { type: 'E-E', x: 700, y: 250, hp: 126, maxhp: 126, _next: 99 },
        { type: 'E-E', x: 940, y: 330, hp: 126, maxhp: 126, _next: 99 },
        { type: 'E-G', x: 300, y: 620, hp: 108, maxhp: 108, _next: 99 },
        { type: 'E-G', x: 780, y: 620, hp: 108, maxhp: 108, _next: 99 },
        { type: 'E-A', x: 540, y: 470, hp: 54, maxhp: 54, _next: 99 }
      ];

      /* wave A is parried at t=1.15; its reflections kill the gunner and the
         left cannoneer before the frame is taken — that is where the debris is */
      inbound(s, 'P2', [540, 470], P, 1.15, 22, 1.16);
      inbound(s, 'P6', [150, 330], P, 1.15, 20, 1.16);

      /* wave B is the volley caught mid-flip here — all slow, heavy shells, so
         the whole fan is still on screen 0.09s after the swing */
      inbound(s, 'P6', [420, 250], P, 2.00, 18, 1.16);
      inbound(s, 'P6', [700, 250], P, 2.00, 22, 1.16);
      inbound(s, 'P6', [940, 330], P, 2.00, 26, 1.16);
      inbound(s, 'P4', [300, 620], P, 2.00, 24, 1.16);
      inbound(s, 'P4', [780, 620], P, 2.00, 20, 1.16);

      /* bystanders, so the frame reads as a fight and not as a diagram */
      for (var i = 0; i < 9; i++) {
        HW.spawn(s, 'P4', 300 + i * 60, 700 + Math.sin(i * 1.7) * 120, 1.05 + i * 0.14, 1.16);
      }
      for (var k = 0; k < 4; k++) {
        HW.spawn(s, 'P2', 180 + k * 240, 480, 1.35 + k * 0.16, 1.16);
      }
    },
    tick: function (s, t) {
      if (t >= 1.15 && !s.pA) { s.pA = 1; HW.parry(s); }
      if (t >= 2.00 && !s.pB) { s.pB = 1; HW.parry(s); }
    },
    overlay: function (ctx, s) {
      /* invulnerability exists only because the parry connected (§5.4) */
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = HW.hexA(C.baek, 0.45);
      ctx.font = '500 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('무적 0.14초', s.player.x, s.player.y + 122);
      ctx.restore();
    }
  });
})();
