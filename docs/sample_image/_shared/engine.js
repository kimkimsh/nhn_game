/* Hwando mockup engine — classic script, no modules, runs from file://
 *
 * Draws the 1080u x 1920u playfield described in docs/spec/기능_명세서.md.
 * The parry, the reflection formula and the grade bands are the real ones from
 * §5, so a scene is written as a spawn schedule rather than as hand-placed art:
 * bullets that get parried here bounce exactly where the spec says they bounce.
 *
 * Coordinates are always playfield units (u). The context is pre-scaled.
 */

var HW = (function () {
  'use strict';

  /* ── 1. constants ─────────────────────────────────────────────── */

  var PF = { W: 1080, H: 1920 };

  var C = {
    ink900: '#06070a', ink800: '#0b0d13', ink700: '#12161f',
    ink600: '#1a202c', ink500: '#262e3d',
    jeok: '#e23c2e', jeokHot: '#ffd9d2', jeokDim: '#8e241a',
    hwang: '#f5b324', hwangHot: '#fff3d0',
    cheong: '#35b7e0', cheongDim: '#17607a',
    baek: '#ede6d8', baekMute: '#9aa3b2', baekFaint: '#5d6675',
    takjeok: '#7a2b1e'
  };

  /* parry, spec §5.1 / §5.3 */
  var PARRY = {
    R: 70, ACTIVE: 0.15, COOLDOWN: 0.24, INVULN: 0.14,
    BANDS: [
      { name: 'GREAT', max: 28, dmg: 3.5, spd: 2.6, stop: 0.075, score: 400, color: '#f5b324' },
      { name: 'GOOD', max: 48, dmg: 2.0, spd: 1.8, stop: 0.05, score: 150, color: '#35b7e0' },
      { name: 'NOT BAD', max: 70, dmg: 1.0, spd: 1.3, stop: 0.02, score: 50, color: '#ede6d8' }
    ]
  };

  /* bullets, spec §6.1 — r in u, v in u/s, brp = reflect base power */
  var BULLETS = {
    P1: { name: '화살', r: 8, v: 520, parry: true, brp: 10, shape: 'shard' },
    P2: { name: '조총탄', r: 6, v: 760, parry: true, brp: 14, shape: 'dot' },
    P3: { name: '편전', r: 5, v: 880, parry: true, brp: 12, shape: 'needle' },
    P4: { name: '수리검', r: 10, v: 600, parry: true, brp: 12, shape: 'star' },
    P5: { name: '참격파', r: 34, v: 420, parry: true, brp: 30, shape: 'crescent' },
    P6: { name: '함포탄', r: 26, v: 300, parry: true, brp: 55, shape: 'orb' },
    P7: { name: '대통 폭탄', r: 30, v: 260, parry: true, brp: 70, shape: 'bomb' },
    P8: { name: '불화살', r: 9, v: 480, parry: true, brp: 12, shape: 'fireshard' },
    P9: { name: '화염 장판', r: 90, v: 0, parry: false, brp: 0, shape: 'zone' },
    P10: { name: '신기전', r: 6, v: 620, parry: true, brp: 11, shape: 'dart' },
    P11: { name: '유도탄', r: 9, v: 380, parry: true, brp: 16, shape: 'seeker' },
    P12: { name: '관통 대창', r: 20, v: 0, parry: false, brp: 0, shape: 'lance' }
  };

  /* enemies, spec §8.1 */
  var ENEMIES = {
    'E-A': { name: '조총병', hp: 30, w: 54, shape: 'gunner' },
    'E-B': { name: '궁병', hp: 36, w: 52, shape: 'archer' },
    'E-C': { name: '방패병', hp: 90, w: 70, shape: 'shield' },
    'E-D': { name: '돌격병', hp: 40, w: 50, shape: 'charger' },
    'E-E': { name: '화포병', hp: 70, w: 76, shape: 'cannoneer' },
    'E-F': { name: '척후', hp: 20, w: 44, shape: 'scout' },
    'E-G': { name: '신관', hp: 60, w: 62, shape: 'priest' },
    'E-H': { name: '화전병', hp: 40, w: 54, shape: 'firearcher' },
    'E-I': { name: '함포문', hp: 200, w: 96, shape: 'port' },
    /* boss bodies — one HP pool each, drawn from the same code path so a
       reflected bullet lands on them exactly as it lands on a minion */
    'B-GUN': { name: '조총 방진 대장', hp: 1450, w: 300, shape: 'commander' },
    'B-SAM': { name: '왜장 사무라이 대장', hp: 2250, w: 300, shape: 'samurai' },
    'B-SHIP': { name: '아타케부네 기함', hp: 2000, w: 900, shape: 'warship' },
    'B-ART': { name: '대통 포병 대장', hp: 3850, w: 420, shape: 'artillery' },
    'B-FLAG': { name: '왜 수군 총대장 기함', hp: 5100, w: 980, shape: 'warship' }
  };

  /* ── 2. maths ─────────────────────────────────────────────────── */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function len(x, y) { return Math.sqrt(x * x + y * y); }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6d2b79f5;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── 3. canvas primitives ─────────────────────────────────────── */

  var glowCache = {};

  function glowSprite(color, r) {
    var key = color + '|' + r;
    if (glowCache[key]) return glowCache[key];
    var s = document.createElement('canvas');
    var d = Math.ceil(r * 2);
    s.width = s.height = d;
    var g = s.getContext('2d');
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, hexA(color, 0.42));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, d, d);
    glowCache[key] = s;
    return s;
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* Additive glow — the cheap stand-in for a bloom pass (Geometry Wars route). */
  function glow(ctx, x, y, r, color, alpha) {
    var s = glowSprite(color, 128);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  var hatchPat = null;
  function hatch(ctx) {
    if (!hatchPat) {
      var s = document.createElement('canvas');
      s.width = s.height = 14;
      var g = s.getContext('2d');
      g.strokeStyle = 'rgba(237,230,216,0.5)';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(-4, 18); g.lineTo(18, -4);
      g.moveTo(3, 25); g.lineTo(25, 3);
      g.stroke();
      hatchPat = ctx.createPattern(s, 'repeat');
    }
    return hatchPat;
  }

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function label(ctx, x, y, text, color, size, align) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = '600 ' + size + 'px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* ── 4. bullets ───────────────────────────────────────────────── */

  /* owner === 'reflect' paints the gold core with a vermilion rim: the bullet
     is now the player's damage source but stays lethal to the player (HR-07). */
  function bulletPaint(b) {
    return b.owner === 'reflect'
      ? { body: C.hwang, hot: C.hwangHot, glow: C.hwang, rim: C.jeok }
      : { body: C.jeok, hot: C.jeokHot, glow: C.jeok, rim: null };
  }

  function drawBullet(ctx, b) {
    var def = BULLETS[b.type];
    var p = bulletPaint(b);
    var ang = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);

    /* Small bullets need a halo to carry them (P2 is 6u across); large ones do
       not, and an halo scaled straight off the radius erases their shape. */
    glow(ctx, 0, 0, def.r * 1.6 + 26, p.glow, b.owner === 'reflect' ? 0.6 : 0.42);

    if (b.owner === 'reflect') {
      /* motion streak, so a reflected shot reads as faster than the original */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexA(C.hwang, 0.35);
      ctx.lineWidth = def.r * 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-Math.cos(ang) * def.r * 3, -Math.sin(ang) * def.r * 3);
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = p.body;
    ctx.strokeStyle = p.body;

    var r = def.r;
    switch (def.shape) {
      case 'dot':
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.284); ctx.fill();
        ctx.fillStyle = p.hot;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, 6.284); ctx.fill();
        break;
      case 'shard':
      case 'fireshard':
        poly(ctx, [[0, -r * 2.1], [r, r * 0.6], [0, r * 1.5], [-r, r * 0.6]]);
        ctx.fill();
        ctx.fillStyle = p.hot;
        poly(ctx, [[0, -r * 1.5], [r * 0.4, 0], [0, r * 0.7], [-r * 0.4, 0]]);
        ctx.fill();
        if (def.shape === 'fireshard') {
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = C.hwang;
          poly(ctx, [[0, r * 1.4], [r * 0.7, r * 3.2], [0, r * 2.4], [-r * 0.7, r * 3.2]]);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      case 'needle':
        poly(ctx, [[0, -r * 3.4], [r * 0.9, r * 1.2], [-r * 0.9, r * 1.2]]);
        ctx.fill();
        break;
      case 'dart':
        poly(ctx, [[0, -r * 2.6], [r * 0.8, r * 1.1], [0, r * 0.4], [-r * 0.8, r * 1.1]]);
        ctx.fill();
        break;
      case 'star':
        ctx.rotate(b.spin || 0);
        ctx.beginPath();
        for (var i = 0; i < 8; i++) {
          var a = (i / 8) * 6.2832;
          var rr = i % 2 ? r * 0.42 : r * 1.5;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        break;
      case 'crescent':
        ctx.lineWidth = r * 0.66;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, r * 1.1, r * 1.9, Math.PI * 1.18, Math.PI * 1.82);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = p.hot;
        ctx.lineWidth = r * 0.22;
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      case 'orb':
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.284); ctx.fill();
        ctx.strokeStyle = p.hot; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, 6.284); ctx.stroke();
        break;
      case 'bomb':
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.284); ctx.fill();
        ctx.strokeStyle = C.hwang; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.5, -r * 1.7); ctx.stroke();
        glow(ctx, r * 0.5, -r * 1.7, 22, C.hwang, 0.9);
        break;
      case 'seeker':
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.284); ctx.fill();
        ctx.strokeStyle = hexA(p.body, 0.45); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, r * 3.4, r * 3.6, -Math.PI * 0.78, -Math.PI * 0.22); ctx.stroke();
        break;
    }

    if (p.rim) {
      ctx.strokeStyle = p.rim;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, 6.284);
      ctx.stroke();
    }
    ctx.restore();

    if (b.reparry) {
      /* §17 only asks that the count be readable — the cap is gone (§7.4) */
      label(ctx, b.x + def.r + 10, b.y - def.r - 8, '재' + b.reparry, C.hwang, 21);
    }
  }

  /* Unparryable hazards never share a silhouette with a bullet: angular outline
     plus diagonal hatching, so §17's "not colour alone" holds. */
  function drawZone(ctx, z) {
    var pulse = 0.82 + Math.sin(z.age * 6) * 0.18;
    ctx.save();
    ctx.translate(z.x, z.y);
    var pts = [];
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * 6.2832 - 1.2;
      var rr = z.r * (0.86 + ((i * 37) % 11) / 40);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    poly(ctx, pts);
    ctx.fillStyle = hexA(C.takjeok, 0.55 * pulse);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = hatch(ctx);
    ctx.fillRect(-z.r, -z.r, z.r * 2, z.r * 2);
    ctx.restore();
    ctx.strokeStyle = C.jeok;
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 9]);
    poly(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    glow(ctx, z.x, z.y, z.r * 1.4, C.takjeok, 0.5);
  }

  /* ── 5. enemies ───────────────────────────────────────────────── */

  /* Every foot soldier shares three cues — the jingasa brim, the dark 胴, and
     the slitted visor — so the whole invading army reads as one force. What
     separates the archetypes is the equipment hanging off that body. */
  function jingasa(ctx, y, span, drop, hot) {
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.moveTo(-span, y);
    ctx.quadraticCurveTo(-span * 0.42, y - drop * 1.35, 0, y - drop);
    ctx.quadraticCurveTo(span * 0.42, y - drop * 1.35, span, y);
    ctx.quadraticCurveTo(0, y + drop * 0.42, -span, y);
    ctx.closePath();
    ctx.fill();
    /* the brim's underside, so the hat has a thickness */
    ctx.fillStyle = 'rgba(5,7,12,0.55)';
    ctx.beginPath();
    ctx.moveTo(-span, y);
    ctx.quadraticCurveTo(0, y + drop * 0.42, span, y);
    ctx.quadraticCurveTo(0, y + drop * 0.68, -span, y);
    ctx.closePath();
    ctx.fill();
  }

  /* faceless, but not blank: a mask plate with two slits. Superhot's rule —
     give the enemy a definition and it stops being a generic body. */
  function visor(ctx, w, y, hot) {
    ctx.fillStyle = '#05070c';
    ctx.fillRect(-w * 0.23, y, w * 0.46, w * 0.15);
    ctx.fillStyle = hot;
    ctx.fillRect(-w * 0.18, y + w * 0.05, w * 0.1, w * 0.05);
    ctx.fillRect(w * 0.08, y + w * 0.05, w * 0.1, w * 0.05);
  }

  /* 찰갑 — the horizontal lacing rows that make a torso read as armour */
  function lamellae(ctx, w, y0, y1, rows, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    for (var i = 1; i <= rows; i++) {
      var y = lerp(y0, y1, i / (rows + 1));
      ctx.beginPath();
      ctx.moveTo(-w, y); ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  /* 사시모노 — the back banner, with the clan disc on it */
  function sashimono(ctx, w, h, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.36, -h * 0.1); ctx.lineTo(w * 0.36, -h * 0.78);
    ctx.stroke();
    ctx.fillStyle = hexA(C.jeokDim, 0.55);
    ctx.fillRect(w * 0.36, -h * 0.78, w * 0.32, h * 0.36);
    ctx.strokeStyle = hexA(C.jeok, 0.7);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(w * 0.36, -h * 0.78, w * 0.32, h * 0.36);
    ctx.fillStyle = hexA(C.jeok, 0.85);
    ctx.beginPath();
    ctx.arc(w * 0.52, -h * 0.6, w * 0.075, 0, 6.284);
    ctx.fill();
  }

  function spokedWheel(ctx, x, y, r, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.284); ctx.stroke();
    ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      var a = i / 4 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, 6.284); ctx.fill();
  }

  function drawEnemy(ctx, e) {
    var def = ENEMIES[e.type];
    var w = def.w;
    ctx.save();
    ctx.translate(e.x, e.y);

    /* Glow radius is capped: a boss body is 300–980u wide and an uncapped
       halo would wash the whole upper half of the plate red. */
    var gr = Math.min(w * 1.2, 130);
    if (e.charge > 0) {
      /* The tell has to stay legible as a SHAPE. A big halo reads as light,
         not as "this one is about to shoot", and it swallows the silhouette. */
      var c = clamp(e.charge, 0, 1);
      glow(ctx, 0, 0, gr * (0.55 + c * 0.3), C.jeokHot, 0.12 + c * 0.2);
    } else {
      glow(ctx, 0, 0, gr * 0.8, C.jeok, 0.16);
    }
    if (e.flash > 0) glow(ctx, 0, 0, gr * 1.4, C.hwangHot, e.flash * 0.8);

    /* contact shadow — lifts a flat shape off the field. Minions only: at
       boss width the same ellipse becomes a 700u blot on the water. */
    if (w <= 110) {
      ctx.fillStyle = 'rgba(3,4,8,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, w * 0.62, w * 0.42, w * 0.13, 0, 0, 6.284);
      ctx.fill();
    }

    var hot = e.charge > 0 ? C.jeokHot : C.jeok;
    var body = e.flash > 0 ? C.hwangHot : (e.charge > 0 ? '#2a1a22' : '#141a24');
    var seam = hexA(C.jeokDim, 0.85);
    ctx.lineWidth = e.charge > 0 ? 5 : 3.4;
    ctx.strokeStyle = hot;
    ctx.fillStyle = body;

    /* a hull is wide and shallow; scaling its height off the width would put
       the masts a thousand units above the deck */
    var h = def.shape === 'warship' ? 320 : w * 1.05;

    switch (def.shape) {
      case 'gunner':
        sashimono(ctx, w, h, hexA(C.jeok, 0.6));
        poly(ctx, [[-w * 0.28, -h * 0.14], [w * 0.28, -h * 0.14], [w * 0.34, h * 0.46], [0, h * 0.62], [-w * 0.34, h * 0.46]]);
        ctx.fill(); ctx.stroke();
        lamellae(ctx, w * 0.29, h * 0.02, h * 0.44, 3, seam);
        /* waist cord */
        ctx.strokeStyle = hexA(C.jeok, 0.9); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.2); ctx.lineTo(w * 0.3, h * 0.2); ctx.stroke();
        /* the matchlock, with the lit match cord glowing while it charges */
        ctx.strokeStyle = hot; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-w * 0.16, h * 0.1); ctx.lineTo(w * 0.08, h * 1.08); ctx.stroke();
        ctx.strokeStyle = hexA(C.jeokDim, 0.9); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-w * 0.2, h * 0.02); ctx.lineTo(-w * 0.06, h * 0.24); ctx.stroke();
        ctx.fillStyle = hot;
        ctx.beginPath(); ctx.arc(w * 0.08, h * 1.08, w * 0.07, 0, 6.284); ctx.fill();
        if (e.charge > 0) glow(ctx, -w * 0.16, h * 0.06, 22, C.hwang, 0.7);
        visor(ctx, w, -h * 0.13, hot);
        jingasa(ctx, -h * 0.16, w * 0.56, w * 0.28, hot);
        break;

      case 'archer':
      case 'firearcher':
        /* quiver first, so the fletchings sit behind the shoulder */
        ctx.strokeStyle = hexA(C.jeokDim, 0.9); ctx.lineWidth = 3;
        for (var q = -1; q <= 1; q++) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.34, -h * 0.1);
          ctx.lineTo(-w * 0.46 + q * w * 0.06, -h * 0.5);
          ctx.stroke();
        }
        poly(ctx, [[0, h * 0.66], [w * 0.34, -h * 0.14], [-w * 0.34, -h * 0.14]]);
        ctx.fill(); ctx.stroke();
        lamellae(ctx, w * 0.22, h * 0.04, h * 0.5, 3, seam);
        /* a deep recurve bow, drawn wider than the body it belongs to */
        ctx.strokeStyle = hot; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.arc(0, h * 0.42, w * 0.58, -Math.PI * 0.46, Math.PI * 0.46); ctx.stroke();
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, h * 0.42, w * 0.72, -Math.PI * 0.2, Math.PI * 0.2); ctx.stroke();
        ctx.strokeStyle = hexA(C.baek, 0.4); ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(-Math.PI * 0.46) * w * 0.58, h * 0.42 + Math.sin(-Math.PI * 0.46) * w * 0.58);
        ctx.lineTo(w * 0.3, h * 0.42);
        ctx.lineTo(Math.cos(Math.PI * 0.46) * w * 0.58, h * 0.42 + Math.sin(Math.PI * 0.46) * w * 0.58);
        ctx.stroke();
        if (def.shape === 'firearcher') {
          glow(ctx, w * 0.34, h * 0.42, 40, C.hwang, 0.9);
          ctx.fillStyle = C.hwang;
          ctx.beginPath(); ctx.arc(w * 0.34, h * 0.42, 6, 0, 6.284); ctx.fill();
          /* the brazier it lights arrows from */
          ctx.strokeStyle = hexA(C.hwang, 0.5); ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(-w * 0.44, h * 0.58, w * 0.14, Math.PI, 0); ctx.stroke();
          glow(ctx, -w * 0.44, h * 0.54, 26, C.hwang, 0.55);
        }
        visor(ctx, w, -h * 0.11, hot);
        jingasa(ctx, -h * 0.14, w * 0.5, w * 0.26, hot);
        break;

      case 'shield':
        poly(ctx, [[-w * 0.26, -h * 0.12], [w * 0.26, -h * 0.12], [w * 0.26, h * 0.46], [-w * 0.26, h * 0.46]]);
        ctx.fill(); ctx.stroke();
        visor(ctx, w, -h * 0.1, hot);
        jingasa(ctx, -h * 0.13, w * 0.46, w * 0.24, hot);
        /* 다케타바 — a bundled bamboo pavise. Its slats and binding cords are
           the tell that this face is solid; when it breaks, they go. */
        if (e.shield > 0) {
          ctx.fillStyle = '#1d2430';
          ctx.fillRect(-w * 0.66, h * 0.06, w * 1.32, h * 0.42);
          ctx.strokeStyle = C.baek; ctx.lineWidth = 4;
          ctx.strokeRect(-w * 0.66, h * 0.06, w * 1.32, h * 0.42);
          ctx.strokeStyle = hexA(C.baek, 0.8); ctx.lineWidth = 3;
          for (var sl = 1; sl < 8; sl++) {
            ctx.beginPath();
            ctx.moveTo(-w * 0.66 + sl * w * 0.165, h * 0.06);
            ctx.lineTo(-w * 0.66 + sl * w * 0.165, h * 0.48);
            ctx.stroke();
          }
          ctx.strokeStyle = hexA(C.jeok, 0.65); ctx.lineWidth = 2.4;
          [0.18, 0.36].forEach(function (f) {
            ctx.beginPath();
            ctx.moveTo(-w * 0.66, h * (0.06 + f)); ctx.lineTo(w * 0.66, h * (0.06 + f));
            ctx.stroke();
          });
        } else {
          ctx.strokeStyle = hexA(C.baek, 0.24); ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-w * 0.66, h * 0.06); ctx.lineTo(-w * 0.28, h * 0.06);
          ctx.moveTo(w * 0.28, h * 0.06); ctx.lineTo(w * 0.66, h * 0.06);
          ctx.moveTo(-w * 0.66, h * 0.06); ctx.lineTo(-w * 0.66, h * 0.28);
          ctx.moveTo(w * 0.66, h * 0.06); ctx.lineTo(w * 0.66, h * 0.28);
          ctx.stroke();
          ctx.strokeStyle = hexA(C.baek, 0.16); ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(-w * 0.5, h * 0.3); ctx.lineTo(-w * 0.34, h * 0.48);
          ctx.moveTo(w * 0.46, h * 0.32); ctx.lineTo(w * 0.6, h * 0.5);
          ctx.stroke();
        }
        break;

      case 'charger':
        /* 야리 — the spear leads, with the red tassel at the collar */
        ctx.strokeStyle = hot; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -h * 0.2); ctx.lineTo(0, h * 1.15); ctx.stroke();
        ctx.fillStyle = hot;
        poly(ctx, [[0, h * 1.42], [w * 0.13, h * 1.0], [-w * 0.13, h * 1.0]]);
        ctx.fill();
        ctx.strokeStyle = hexA(C.jeokDim, 0.95); ctx.lineWidth = 3;
        for (var ts = -1; ts <= 1; ts++) {
          ctx.beginPath();
          ctx.moveTo(0, h * 0.98);
          ctx.quadraticCurveTo(ts * w * 0.14, h * 0.86, ts * w * 0.2, h * 0.72);
          ctx.stroke();
        }
        ctx.fillStyle = body; ctx.strokeStyle = hot; ctx.lineWidth = 3.4;
        poly(ctx, [[0, h * 0.72], [w * 0.46, -h * 0.06], [w * 0.2, -h * 0.2], [-w * 0.2, -h * 0.2], [-w * 0.46, -h * 0.06]]);
        ctx.fill(); ctx.stroke();
        lamellae(ctx, w * 0.3, h * 0.06, h * 0.5, 2, seam);
        visor(ctx, w, -h * 0.18, hot);
        jingasa(ctx, -h * 0.2, w * 0.44, w * 0.22, hot);
        break;

      case 'cannoneer':
        /* the only minion drawn as equipment: a wheeled carriage, banded
           barrel, powder keg and fuse */
        spokedWheel(ctx, -w * 0.5, h * 0.1, w * 0.19, hexA(C.jeokDim, 0.95));
        spokedWheel(ctx, w * 0.5, h * 0.1, w * 0.19, hexA(C.jeokDim, 0.95));
        ctx.fillStyle = body;
        poly(ctx, [[-w * 0.48, -h * 0.38], [w * 0.48, -h * 0.38], [w * 0.4, h * 0.3], [-w * 0.4, h * 0.3]]);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = seam; ctx.lineWidth = 2.4;
        for (var bn = 0; bn < 3; bn++) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.46 + bn * 2, -h * 0.24 + bn * h * 0.16);
          ctx.lineTo(w * 0.46 - bn * 2, -h * 0.24 + bn * h * 0.16);
          ctx.stroke();
        }
        ctx.fillStyle = '#3a1218';
        ctx.beginPath(); ctx.arc(0, h * 0.16, w * 0.2, 0, 6.284); ctx.fill();
        ctx.strokeStyle = hot; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, h * 0.2, w * 0.25, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, h * 0.2, w * 0.34, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
        /* fuse, lit while the tell runs */
        ctx.strokeStyle = e.charge > 0 ? C.hwang : hexA(C.jeokDim, 0.8);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-w * 0.3, -h * 0.34);
        ctx.quadraticCurveTo(-w * 0.42, -h * 0.5, -w * 0.3, -h * 0.6);
        ctx.stroke();
        if (e.charge > 0) glow(ctx, -w * 0.3, -h * 0.6, 24, C.hwang, 0.8);
        break;

      case 'scout':
        /* thin, hooded, and the only minion with a trailing scarf */
        ctx.strokeStyle = hexA(C.jeok, 0.5); ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.3);
        ctx.quadraticCurveTo(-w * 0.9, -h * 0.55, -w * 1.5, -h * 0.05);
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = hexA(C.jeok, 0.28);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.24);
        ctx.quadraticCurveTo(-w * 0.85, -h * 0.3, -w * 1.35, h * 0.2);
        ctx.stroke();
        ctx.fillStyle = body; ctx.strokeStyle = hot; ctx.lineWidth = 3.4;
        poly(ctx, [[0, -h * 0.62], [w * 0.3, 0], [0, h * 0.74], [-w * 0.3, 0]]);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = seam; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-w * 0.22, h * 0.06); ctx.lineTo(w * 0.22, h * 0.06); ctx.stroke();
        visor(ctx, w, -h * 0.32, hot);
        jingasa(ctx, -h * 0.34, w * 0.4, w * 0.18, hot);
        break;

      case 'priest':
        /* 승병 — the prayer-bead ring every ring pattern in the game comes from,
           plus the ringed staff that rattles it */
        ctx.strokeStyle = hexA(C.jeokDim, 0.9); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(w * 0.5, -h * 0.5); ctx.lineTo(w * 0.5, h * 0.6); ctx.stroke();
        ctx.lineWidth = 2.4;
        for (var rg = -1; rg <= 1; rg++) {
          ctx.beginPath();
          ctx.arc(w * 0.5 + rg * w * 0.09, -h * 0.52, w * 0.06, 0, 6.284);
          ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0, h * 0.04, w * 0.4, 0, 6.284); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = seam; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, h * 0.04, w * 0.26, 0, 6.284); ctx.stroke();
        ctx.fillStyle = hot;
        for (var bd = 0; bd < 12; bd++) {
          var a2 = bd / 12 * 6.2832;
          ctx.beginPath();
          ctx.arc(Math.cos(a2) * w * 0.74, h * 0.04 + Math.sin(a2) * w * 0.74, w * 0.062, 0, 6.284);
          ctx.fill();
        }
        ctx.strokeStyle = hexA(C.jeokDim, 0.5); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, h * 0.04, w * 0.74, 0, 6.284); ctx.stroke();
        visor(ctx, w, -h * 0.22, hot);
        jingasa(ctx, -h * 0.3, w * 0.58, w * 0.26, hot);
        break;

      case 'port':
        /* a gun port cut into planking, shutter swung up, barrel run out */
        ctx.fillStyle = '#0e131c';
        poly(ctx, [[-w / 2, -h * 0.28], [w / 2, -h * 0.28], [w / 2, h * 0.34], [-w / 2, h * 0.34]]);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = hexA('#05070c', 0.85); ctx.lineWidth = 2;
        for (var pk = 0; pk < 3; pk++) {
          ctx.beginPath();
          ctx.moveTo(-w / 2, -h * 0.14 + pk * h * 0.16); ctx.lineTo(w / 2, -h * 0.14 + pk * h * 0.16);
          ctx.stroke();
        }
        ctx.fillStyle = hexA(C.jeok, 0.22);
        ctx.fillRect(-w * 0.44, -h * 0.52, w * 0.88, h * 0.22);
        ctx.strokeStyle = hexA(C.jeok, 0.5); ctx.lineWidth = 2;
        ctx.strokeRect(-w * 0.44, -h * 0.52, w * 0.88, h * 0.22);
        ctx.fillStyle = '#3a1218';
        ctx.beginPath(); ctx.arc(0, h * 0.08, w * 0.19, 0, 6.284); ctx.fill();
        ctx.strokeStyle = hot; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, h * 0.08, w * 0.24, 0, 6.284); ctx.stroke();
        ctx.strokeStyle = hexA(C.jeokDim, 0.9); ctx.lineWidth = 2.4;
        [-1, 1].forEach(function (k) {
          ctx.beginPath();
          ctx.moveTo(k * w * 0.24, h * 0.08); ctx.lineTo(k * w * 0.46, h * 0.3);
          ctx.stroke();
        });
        break;

      case 'commander':
        /* 진막 — the field curtain a command post is pitched behind. Vertical
           bands, twin standards, the clan disc. Nothing else is this wide. */
        ctx.strokeStyle = hexA(C.jeokDim, 0.85); ctx.lineWidth = 5;
        [-1, 1].forEach(function (k) {
          ctx.beginPath();
          ctx.moveTo(k * w * 0.72, h * 0.1); ctx.lineTo(k * w * 0.72, -h * 0.66);
          ctx.stroke();
          ctx.fillStyle = hexA(C.jeok, 0.5);
          ctx.fillRect(k * w * 0.72 - (k < 0 ? w * 0.22 : 0), -h * 0.66, w * 0.22, h * 0.3);
          ctx.fillStyle = hexA(C.jeokHot, 0.55);
          ctx.beginPath();
          ctx.arc(k * w * 0.72 + (k < 0 ? -w * 0.11 : w * 0.11), -h * 0.51, w * 0.05, 0, 6.284);
          ctx.fill();
        });
        ctx.fillStyle = '#121722';
        ctx.strokeStyle = hot;
        ctx.lineWidth = 4;
        poly(ctx, [[-w * 0.82, -h * 0.06], [w * 0.82, -h * 0.06], [w * 0.74, h * 0.3], [-w * 0.74, h * 0.3]]);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = hexA(C.jeokDim, 0.5);
        for (var bd2 = -3; bd2 <= 3; bd2 += 2) ctx.fillRect(bd2 * w * 0.2 - w * 0.05, -h * 0.06, w * 0.1, h * 0.36);
        ctx.strokeStyle = hexA(C.jeok, 0.55); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-w * 0.8, h * 0.06); ctx.lineTo(w * 0.8, h * 0.06); ctx.stroke();
        ctx.fillStyle = e.charge > 0 ? hexA(C.jeokHot, 0.9) : hexA(C.jeokDim, 0.8);
        for (var g2 = -2; g2 <= 2; g2++) ctx.fillRect(g2 * w * 0.26 - w * 0.055, -h * 0.02, w * 0.11, h * 0.13);
        /* the commander himself, raised above the curtain */
        ctx.fillStyle = '#171d29'; ctx.strokeStyle = hot; ctx.lineWidth = 4;
        poly(ctx, [[-w * 0.12, -h * 0.06], [w * 0.12, -h * 0.06], [w * 0.15, -h * 0.42], [-w * 0.15, -h * 0.42]]);
        ctx.fill(); ctx.stroke();
        lamellae(ctx, w * 0.13, -h * 0.38, -h * 0.1, 3, seam);
        visor(ctx, w * 0.55, -h * 0.4, hot);
        jingasa(ctx, -h * 0.44, w * 0.32, w * 0.2, hot);
        /* 군배 — the war fan, raised when the volley is called */
        ctx.strokeStyle = C.baek; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(w * 0.14, -h * 0.28); ctx.lineTo(w * 0.34, -h * 0.44); ctx.stroke();
        ctx.fillStyle = hexA(C.baek, e.charge > 0 ? 0.85 : 0.5);
        poly(ctx, [[w * 0.34, -h * 0.44], [w * 0.52, -h * 0.6], [w * 0.6, -h * 0.44], [w * 0.42, -h * 0.34]]);
        ctx.fill();
        break;

      case 'samurai':
        /* 오오요로이 with a horned kabuto — the only upward spikes in the game */
        ctx.fillStyle = body; ctx.strokeStyle = hot; ctx.lineWidth = 4.5;
        poly(ctx, [[-w * 0.22, -h * 0.06], [w * 0.22, -h * 0.06], [w * 0.34, h * 0.44], [0, h * 0.62], [-w * 0.34, h * 0.44]]);
        ctx.fill(); ctx.stroke();
        /* 소데 — the big square shoulder plates, laced in rows */
        [-1, 1].forEach(function (k) {
          ctx.fillStyle = hexA(C.jeok, 0.4);
          poly(ctx, [[k * w * 0.5, -h * 0.1], [k * w * 0.2, -h * 0.1], [k * w * 0.24, h * 0.24], [k * w * 0.54, h * 0.2]]);
          ctx.fill();
          ctx.strokeStyle = hexA(C.jeokHot, 0.45); ctx.lineWidth = 1.6;
          for (var sr = 1; sr <= 3; sr++) {
            var sy = -h * 0.1 + sr * h * 0.08;
            ctx.beginPath();
            ctx.moveTo(k * w * 0.21, sy); ctx.lineTo(k * w * 0.52, sy - h * 0.008);
            ctx.stroke();
          }
        });
        lamellae(ctx, w * 0.24, h * 0.02, h * 0.42, 4, seam);
        ctx.fillStyle = hot;
        poly(ctx, [[-w * 0.26, -h * 0.06], [w * 0.26, -h * 0.06], [w * 0.11, -h * 0.3], [-w * 0.11, -h * 0.3]]); ctx.fill();
        poly(ctx, [[-w * 0.08, -h * 0.26], [-w * 0.46, -h * 0.7], [-w * 0.15, -h * 0.4]]); ctx.fill();
        poly(ctx, [[w * 0.08, -h * 0.26], [w * 0.46, -h * 0.7], [w * 0.15, -h * 0.4]]); ctx.fill();
        /* 마에다테 — the crest between the horns */
        ctx.fillStyle = hexA(C.baek, 0.7);
        poly(ctx, [[0, -h * 0.32], [w * 0.05, -h * 0.46], [0, -h * 0.52], [-w * 0.05, -h * 0.46]]);
        ctx.fill();
        visor(ctx, w * 0.9, -h * 0.2, hot);
        /* 이도류 — long and short, held out to both sides */
        ctx.strokeStyle = C.baek; ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.16); ctx.lineTo(-w * 0.94, h * 0.46); ctx.stroke();
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.16); ctx.lineTo(w * 0.84, h * 0.5); ctx.stroke();
        ctx.strokeStyle = hexA(C.jeok, 0.8); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.16); ctx.lineTo(-w * 0.4, h * 0.21); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.16); ctx.lineTo(w * 0.39, h * 0.22); ctx.stroke();
        break;

      case 'warship':
        /* 아타케부네: a boxed tower on a low hull, oars below, roof on top */
        ctx.fillStyle = '#0e121b';
        poly(ctx, [[-w / 2, -h * 0.18], [w / 2, -h * 0.18], [w * 0.4, h * 0.34], [-w * 0.4, h * 0.34]]);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = hexA('#05070c', 0.8); ctx.lineWidth = 2;
        for (var pl = 0; pl < 3; pl++) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.48 + pl * 4, -h * 0.06 + pl * h * 0.12);
          ctx.lineTo(w * 0.48 - pl * 4, -h * 0.06 + pl * h * 0.12);
          ctx.stroke();
        }
        ctx.strokeStyle = hexA(C.jeokDim, 0.6); ctx.lineWidth = 3;
        for (var oar = -7; oar <= 7; oar++) {
          ctx.beginPath();
          ctx.moveTo(oar * w * 0.06, h * 0.3); ctx.lineTo(oar * w * 0.06 + 14, h * 0.56);
          ctx.stroke();
        }
        /* shield line along the gunwale, alternating clan discs */
        for (var shd = -8; shd <= 8; shd++) {
          ctx.fillStyle = hexA(C.jeok, shd % 2 ? 0.3 : 0.14);
          ctx.fillRect(shd * w * 0.055 - w * 0.021, -h * 0.27, w * 0.042, h * 0.1);
        }
        ctx.fillStyle = '#161c28';
        ctx.fillRect(-w * 0.28, -h * 0.62, w * 0.56, h * 0.44);
        ctx.strokeStyle = hot; ctx.lineWidth = 4;
        ctx.strokeRect(-w * 0.28, -h * 0.62, w * 0.56, h * 0.44);
        ctx.strokeStyle = hexA(C.jeokDim, 0.6); ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-w * 0.28, -h * 0.4); ctx.lineTo(w * 0.28, -h * 0.4);
        ctx.stroke();
        ctx.fillStyle = hexA(C.jeok, 0.22);
        for (var win = -2; win <= 2; win++) ctx.fillRect(win * w * 0.1 - w * 0.025, -h * 0.56, w * 0.05, h * 0.13);
        tiledRoof(ctx, 0, -h * 0.62, w * 0.72, h * 0.26, '#1b2230', hexA(C.jeok, 0.5));
        ctx.strokeStyle = hexA(C.jeokDim, 0.8); ctx.lineWidth = 3;
        for (var mast = -1; mast <= 1; mast++) {
          ctx.beginPath();
          ctx.moveTo(mast * w * 0.34, -h * 0.18); ctx.lineTo(mast * w * 0.34, -h * 0.78);
          ctx.stroke();
          ctx.fillStyle = hexA(C.jeok, 0.45);
          ctx.fillRect(mast * w * 0.34, -h * 0.78, w * 0.075, h * 0.18);
          ctx.fillStyle = hexA(C.jeokHot, 0.4);
          ctx.beginPath();
          ctx.arc(mast * w * 0.34 + w * 0.037, -h * 0.69, w * 0.018, 0, 6.284);
          ctx.fill();
        }
        break;

      case 'artillery':
        /* 화차 — a wheeled rack of tubes: three bores, powder kegs, banner */
        spokedWheel(ctx, -w * 0.54, h * 0.26, w * 0.14, hexA(C.jeokDim, 0.95));
        spokedWheel(ctx, w * 0.54, h * 0.26, w * 0.14, hexA(C.jeokDim, 0.95));
        ctx.fillStyle = body; ctx.strokeStyle = hot; ctx.lineWidth = 4;
        poly(ctx, [[-w * 0.52, -h * 0.14], [w * 0.52, -h * 0.14], [w * 0.42, h * 0.28], [-w * 0.42, h * 0.28]]);
        ctx.fill(); ctx.stroke();
        [-1, 0, 1].forEach(function (k) {
          ctx.fillStyle = '#1a1f2b';
          ctx.fillRect(k * w * 0.28 - w * 0.11, -h * 0.12, w * 0.22, h * 0.3);
          ctx.strokeStyle = hot; ctx.lineWidth = 4;
          ctx.strokeRect(k * w * 0.28 - w * 0.11, -h * 0.12, w * 0.22, h * 0.3);
          ctx.strokeStyle = hexA(C.jeokDim, 0.9); ctx.lineWidth = 2.2;
          [0.06, 0.18].forEach(function (f) {
            ctx.beginPath();
            ctx.moveTo(k * w * 0.28 - w * 0.11, -h * 0.12 + h * f);
            ctx.lineTo(k * w * 0.28 + w * 0.11, -h * 0.12 + h * f);
            ctx.stroke();
          });
          ctx.fillStyle = e.charge > 0 ? hexA(C.jeokHot, 0.55) : '#3a1218';
          ctx.beginPath(); ctx.arc(k * w * 0.28, h * 0.14, w * 0.085, 0, 6.284); ctx.fill();
        });
        /* powder kegs lashed to the bed */
        ctx.strokeStyle = hexA(C.jeokDim, 0.85); ctx.lineWidth = 2.4;
        [-1, 1].forEach(function (k) {
          ctx.beginPath();
          ctx.ellipse(k * w * 0.44, h * 0.06, w * 0.06, w * 0.09, 0, 0, 6.284);
          ctx.stroke();
        });
        ctx.strokeStyle = hexA(C.jeokDim, 0.85); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.14); ctx.lineTo(0, -h * 0.66); ctx.stroke();
        ctx.fillStyle = hexA(C.jeok, 0.5);
        ctx.fillRect(0, -h * 0.66, w * 0.2, h * 0.26);
        ctx.fillStyle = hexA(C.jeokHot, 0.5);
        ctx.beginPath(); ctx.arc(w * 0.1, -h * 0.53, w * 0.04, 0, 6.284); ctx.fill();
        break;
    }
    ctx.restore();

    if (!e.nobar && e.maxhp && e.hp < e.maxhp) {
      var bw = def.w * 1.2;
      ctx.fillStyle = hexA(C.baek, 0.16);
      ctx.fillRect(e.x - bw / 2, e.y - def.w * 0.9, bw, 5);
      ctx.fillStyle = C.jeok;
      ctx.fillRect(e.x - bw / 2, e.y - def.w * 0.9, bw * (e.hp / e.maxhp), 5);
    }
  }

  /* ── 6. player ────────────────────────────────────────────────── */

  /* The player is drawn in 청 and 백 only. Every other colour on the field is
     already spoken for by a rule (§17), so the swordsman gets detail through
     shape — 두정갑 rivets, 전립 brim, the 환도 itself — and never through hue. */
  function drawPlayer(ctx, p, t) {
    ctx.save();
    ctx.translate(p.x, p.y);

    /* parry circle — visible only while the 0.15s window is open */
    if (p.parryT > 0) {
      var k = 1 - p.parryT / PARRY.ACTIVE;
      ctx.strokeStyle = hexA(C.cheong, 0.85 - k * 0.5);
      ctx.lineWidth = 4 + (1 - k) * 5;
      ctx.beginPath(); ctx.arc(0, 0, PARRY.R * (0.86 + k * 0.2), 0, 6.284); ctx.stroke();
      glow(ctx, 0, 0, PARRY.R * 1.7, C.cheong, 0.35 * (1 - k));
    }

    /* cooldown ring, spec §15.1 — thin enough not to become visual noise */
    if (p.cd > 0) {
      ctx.strokeStyle = hexA(C.cheongDim, 0.9);
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, 50, -Math.PI / 2, -Math.PI / 2 + 6.2832 * (1 - p.cd / PARRY.COOLDOWN));
      ctx.stroke();
    }

    /* invulnerability, only ever granted by a parry that actually connected */
    if (p.inv > 0) {
      ctx.strokeStyle = hexA(C.baek, 0.5 + Math.sin(t * 40) * 0.25);
      ctx.lineWidth = 2.5;
      ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.arc(0, 0, 62, 0, 6.284); ctx.stroke();
      ctx.setLineDash([]);
    }

    glow(ctx, 0, 0, 92, C.cheong, 0.26);

    /* 전포 — the war coat trailing behind. Drawn first and widest, it is what
       turns a small figure into a commander at silhouette size. */
    ctx.fillStyle = hexA(C.cheongDim, 0.34);
    ctx.beginPath();
    ctx.moveTo(-26, -22);
    ctx.quadraticCurveTo(-52, 16, -44, 74);
    ctx.quadraticCurveTo(-22, 56, 0, 60);
    ctx.quadraticCurveTo(24, 56, 46, 80);
    ctx.quadraticCurveTo(52, 16, 26, -22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexA(C.cheong, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 상갑 — the armoured skirt hanging from the belt */
    ctx.fillStyle = '#0c1620';
    ctx.strokeStyle = C.cheong;
    ctx.lineWidth = 3;
    poly(ctx, [[-20, 14], [20, 14], [26, 52], [-26, 52]]);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = hexA(C.cheong, 0.5);
    ctx.lineWidth = 2;
    [-1, 0, 1].forEach(function (k) {
      ctx.beginPath();
      ctx.moveTo(k * 13, 14); ctx.lineTo(k * 16, 52);
      ctx.stroke();
    });

    /* 두정갑 — narrow chest. Keeping the torso well inside the shoulder line is
       what stops the figure reading as a fat oval. */
    ctx.fillStyle = '#0d1720';
    ctx.strokeStyle = C.cheong;
    ctx.lineWidth = 3.6;
    poly(ctx, [[-17, -34], [17, -34], [20, 4], [16, 20], [-16, 20], [-20, 4]]);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = hexA(C.cheong, 0.8);
    for (var row = 0; row < 3; row++) {
      for (var col = -1; col <= 1; col++) {
        ctx.beginPath();
        ctx.arc(col * 11, -26 + row * 9, 2.2, 0, 6.284);
        ctx.fill();
      }
    }
    ctx.strokeStyle = C.baek;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-19, 12); ctx.lineTo(19, 12); ctx.stroke();

    /* 견갑 — pauldrons, tilted up and out. The widest hard edge on the figure. */
    ctx.fillStyle = C.cheong;
    poly(ctx, [[-16, -32], [-44, -26], [-41, -4], [-15, -8]]); ctx.fill();
    poly(ctx, [[16, -32], [44, -26], [41, -4], [15, -8]]); ctx.fill();
    ctx.strokeStyle = hexA(C.baek, 0.45);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-41, -19); ctx.lineTo(-18, -24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(41, -19); ctx.lineTo(18, -24); ctx.stroke();

    /* 목가리개 — the mail drape under the helmet, filling the neck gap */
    ctx.fillStyle = hexA(C.cheongDim, 0.42);
    poly(ctx, [[-23, -41], [23, -41], [17, -25], [-17, -25]]);
    ctx.fill();

    /* 투구 — a cone, not a brim. The wide flat hat was the thing making this
       read as a mushroom; the height is what makes it read as a general. */
    ctx.fillStyle = '#0d1720';
    ctx.strokeStyle = C.cheong;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-19, -43);
    ctx.quadraticCurveTo(-17, -68, 0, -88);
    ctx.quadraticCurveTo(17, -68, 19, -43);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    /* 챙 — small, and only at the front */
    ctx.strokeStyle = C.cheong;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-26, -43);
    ctx.quadraticCurveTo(0, -52, 26, -43);
    ctx.stroke();

    /* 간주와 상모 — the finial stem, its ring, and the plume above it */
    ctx.strokeStyle = C.cheong;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(0, -104); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -92, 4.5, 0, 6.284); ctx.stroke();
    ctx.strokeStyle = C.baek;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    [-0.42, 0, 0.42].forEach(function (a) {
      ctx.beginPath();
      ctx.moveTo(0, -104);
      ctx.quadraticCurveTo(Math.sin(a) * 13, -117, Math.sin(a) * 21, -127);
      ctx.stroke();
    });


    /* 환도 — swings through the parry window, rests low otherwise. The tassel
       is the one piece of the figure that moves on its own. */
    var sw = p.parryT > 0 ? lerp(-2.6, 0.55, 1 - p.parryT / PARRY.ACTIVE) : -1.0;
    ctx.save();
    ctx.rotate(sw);
    ctx.strokeStyle = hexA(C.cheong, 0.9);
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(20, 0); ctx.stroke();
    ctx.strokeStyle = C.baek;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(80, 0); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hexA(C.cheong, 0.8);
    ctx.beginPath();
    ctx.moveTo(8, 2);
    ctx.quadraticCurveTo(-6, 16, -14, 26);
    ctx.stroke();
    if (p.parryT > 0) {
      glow(ctx, 54, 0, 34, C.baek, 0.6);
      ctx.strokeStyle = hexA(C.baek, 0.4);
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(0, 0, 78, -0.5, 0.28);
      ctx.stroke();
    }
    ctx.restore();

    /* hit core — 10u, always on screen (§15.1). The dark disc under it keeps
       the point crisp against the player's own glow; losing sight of the core
       is the one readability failure this game cannot afford. */
    ctx.strokeStyle = hexA(C.cheong, 0.9);
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, 6.284); ctx.stroke();
    ctx.fillStyle = hexA(C.cheong, 0.9);
    for (var rv = 0; rv < 4; rv++) {
      var ra = rv / 4 * 6.2832 + 0.785;
      ctx.beginPath(); ctx.arc(Math.cos(ra) * 19, Math.sin(ra) * 19, 2.2, 0, 6.284); ctx.fill();
    }
    ctx.fillStyle = 'rgba(4,6,10,0.8)';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, 6.284); ctx.fill();
    ctx.fillStyle = C.baek;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, 6.284); ctx.fill();
    ctx.strokeStyle = hexA(C.cheong, 0.95);
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, 6.284); ctx.stroke();
    glow(ctx, 0, 0, 22, C.baek, 0.7);
    ctx.restore();
  }

  /* ── 7. telegraphs (only the three shapes HR-05 allows) ───────── */

  function drawTelegraph(ctx, g) {
    var k = clamp(g.age / g.dur, 0, 1);
    var col = k > 0.82 ? C.jeok : C.baek;
    ctx.save();
    ctx.strokeStyle = hexA(col, 0.45 + k * 0.5);
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -g.age * 40;

    if (g.kind === 'circle') {
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 6.284); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexA(col, 0.10 + k * 0.14);
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * k, 0, 6.284); ctx.fill();
    } else if (g.kind === 'lance') {
      ctx.strokeRect(g.x - g.w / 2, -60, g.w, PF.H + 120);
      ctx.setLineDash([]);
      ctx.save();
      ctx.beginPath(); ctx.rect(g.x - g.w / 2, -60, g.w, PF.H + 120); ctx.clip();
      ctx.globalAlpha = 0.10 + k * 0.10;
      ctx.fillStyle = hatch(ctx);
      ctx.fillRect(g.x - g.w / 2, -60, g.w, PF.H + 120);
      ctx.restore();
    } else if (g.kind === 'dash') {
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g.x + Math.cos(g.a) * g.len, g.y + Math.sin(g.a) * g.len);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexA(col, 0.8);
      var ex = g.x + Math.cos(g.a) * g.len, ey = g.y + Math.sin(g.a) * g.len;
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(g.a);
      poly(ctx, [[0, 0], [-34, -17], [-34, 17]]); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ── 8. backgrounds ───────────────────────────────────────────── */

  /* 창호 문살 — the lattice a Joseon window frame is built from. It does what
     a plain grid does (gives the field a readable ground plane) without
     reading as graph paper. */
  function lattice(ctx, alpha, step) {
    ctx.save();
    ctx.strokeStyle = hexA(C.cheong, alpha);
    ctx.lineWidth = 1;
    var x, y;
    for (x = 0; x <= PF.W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PF.H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 15, 0); ctx.lineTo(x + 15, PF.H); ctx.stroke();
    }
    for (y = 0; y <= PF.H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PF.W, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y + 15); ctx.lineTo(PF.W, y + 15); ctx.stroke();
    }
    ctx.restore();
  }

  /* 청해파문 — the stacked scallop the sea is drawn with on Joseon textiles.
     Replaces the sine lines a generic ocean would use. */
  function seigaiha(ctx, y0, rows, step, color, alpha, phase) {
    ctx.save();
    ctx.strokeStyle = hexA(color, alpha);
    ctx.lineWidth = 2;
    for (var row = 0; row < rows; row++) {
      var y = y0 + row * step * 0.44;
      var off = (row % 2) * step / 2 + Math.sin(phase + row * 0.4) * 10;
      for (var x = -step; x <= PF.W + step; x += step) {
        for (var k = 1; k <= 3; k++) {
          ctx.beginPath();
          ctx.arc(x + off, y, step * 0.2 * k, Math.PI, 0);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /* ink-wash ridge line — two sine terms, so the skyline reads as brushed */
  function ridge(ctx, baseY, amp, k, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(0, baseY + amp * 3);
    for (var x = 0; x <= PF.W; x += 16) {
      ctx.lineTo(x, baseY
        - Math.abs(Math.sin(x / 300 + k)) * amp
        - Math.abs(Math.sin(x / 97 + k * 2.3)) * amp * 0.3);
    }
    ctx.lineTo(PF.W, baseY + amp * 3);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  /* 구름무늬 — the ruyi cloud head. Three lobes over a trailing line. */
  function cloud(ctx, cx, cy, s, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, s * 0.09);
    ctx.beginPath();
    ctx.arc(cx - s * 0.78, cy + s * 0.06, s * 0.36, Math.PI * 0.92, Math.PI * 2.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.14, s * 0.5, Math.PI * 0.86, Math.PI * 2.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 0.8, cy + s * 0.04, s * 0.34, Math.PI * 0.86, Math.PI * 2.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 1.22, cy + s * 0.3);
    ctx.lineTo(cx + s * 1.2, cy + s * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  /* 기와 지붕 — the swooping eave. Single strongest silhouette cue available. */
  function tiledRoof(ctx, cx, y, w, h, fill, trim) {
    var hw = w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - hw - w * 0.07, y - h * 0.16);
    ctx.quadraticCurveTo(cx - hw * 0.5, y - h * 0.12, cx, y - h);
    ctx.quadraticCurveTo(cx + hw * 0.5, y - h * 0.12, cx + hw + w * 0.07, y - h * 0.16);
    ctx.lineTo(cx + hw * 0.84, y);
    ctx.lineTo(cx - hw * 0.84, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (trim) { ctx.strokeStyle = trim; ctx.lineWidth = 3; ctx.stroke(); }
  }

  /* invading fleet: hull plus a sail carrying the rising-sun disc, so an enemy
     ship is never mistaken for one of ours at silhouette size */
  function wakoShip(ctx, cx, y, w, glowAmt) {
    var h = w * 0.24;
    ctx.fillStyle = '#0d111a';
    poly(ctx, [[cx - w / 2, y], [cx + w / 2, y], [cx + w * 0.38, y + h], [cx - w * 0.38, y + h]]);
    ctx.fill();
    ctx.strokeStyle = hexA(C.jeok, 0.22);
    ctx.lineWidth = 2;
    ctx.stroke();
    var sw = w * 0.44, sh = w * 0.42;
    ctx.fillStyle = '#141a25';
    ctx.fillRect(cx - sw / 2, y - sh, sw, sh);
    ctx.strokeStyle = hexA(C.jeok, 0.35);
    ctx.strokeRect(cx - sw / 2, y - sh, sw, sh);
    ctx.fillStyle = hexA(C.jeok, 0.62);
    ctx.beginPath(); ctx.arc(cx, y - sh * 0.5, sw * 0.2, 0, 6.284); ctx.fill();
    ctx.strokeStyle = hexA(C.baek, 0.14);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, y - sh); ctx.lineTo(cx, y - sh * 1.3); ctx.stroke();
    if (glowAmt) glow(ctx, cx, y, w * 0.7, '#e2531f', glowAmt);
  }

  /* per-block tone variation, so a stone wall is masonry and not a brick fill */
  function stoneWall(ctx, y0, y1, course, seed) {
    var r = rng(seed);
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#232936');
    g.addColorStop(1, '#12161f');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, PF.W, y1 - y0);
    var row = 0;
    for (var y = y0; y < y1; y += course, row++) {
      for (var c = -1; c < 11; c++) {
        var x = c * 110 + (row % 2) * 55;
        ctx.fillStyle = 'rgba(255,255,255,' + (r() * 0.022).toFixed(3) + ')';
        ctx.fillRect(x + 2, y + 2, 106, course - 4);
      }
      ctx.strokeStyle = 'rgba(4,6,10,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PF.W, y); ctx.stroke();
      for (var c2 = -1; c2 < 11; c2++) {
        var x2 = c2 * 110 + (row % 2) * 55;
        ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2, y + course); ctx.stroke();
      }
    }
  }

  /* 기와 — the tile courses that run down a roof face */
  function roofTiles(ctx, cx, y, w, h, col) {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    for (var i = -6; i <= 6; i++) {
      var f = i / 6;
      ctx.beginPath();
      ctx.moveTo(cx + f * w * 0.06, y - h * 0.86);
      ctx.quadraticCurveTo(cx + f * w * 0.3, y - h * 0.4, cx + f * w * 0.52, y - h * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 단청 — the banded beam painting under a Korean eave */
  function dancheong(ctx, x0, x1, y, h) {
    var bands = ['#2e6b5e', '#8e241a', '#c8bda6', '#2e6b5e'];
    var n = 14;
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = hexA(bands[i % bands.length], 0.32);
      var w = (x1 - x0) / n;
      ctx.fillRect(x0 + i * w, y, w - 1, h);
    }
  }

  /* drifting motes. Vlambeer's permanence, applied to air rather than debris. */
  function embers(ctx, t, n, color, alpha, seed, rise) {
    var r = rng(seed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < n; i++) {
      var bx = r() * PF.W;
      var by = r() * PF.H;
      var sp = 20 + r() * 60;
      var y = rise ? (by - t * sp + PF.H * 3) % PF.H : (by + t * sp) % PF.H;
      var x = bx + Math.sin(t * 0.6 + i) * 22;
      ctx.fillStyle = hexA(color, alpha * (0.35 + r() * 0.65));
      ctx.beginPath();
      ctx.arc(x, y, 1.1 + r() * 1.5, 0, 6.284);
      ctx.fill();
    }
    ctx.restore();
  }

  /* breaking crests, drawn as short bright arcs on top of the wave pattern */
  function foam(ctx, y0, rows, step, t, alpha) {
    ctx.save();
    ctx.strokeStyle = hexA(C.baek, alpha);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (var row = 0; row < rows; row++) {
      var y = y0 + row * step;
      for (var x = -60; x < PF.W + 60; x += 190) {
        var ox = x + Math.sin(t * 0.7 + row * 1.3) * 40 + (row % 2) * 95;
        ctx.beginPath();
        ctx.arc(ox, y, 34, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function vgrad(ctx, stops) {
    var g = ctx.createLinearGradient(0, 0, 0, PF.H);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PF.W, PF.H);
  }

  var BG = {
    /* 부산진 새벽 — the sun is still under the horizon and the fleet is already
       ashore. Warm band at the top, ink everywhere else. */
    busanjin: function (ctx, t) {
      var g = ctx.createLinearGradient(0, 0, 0, PF.H);
      g.addColorStop(0, '#43220f');
      g.addColorStop(0.11, '#1d1210');
      g.addColorStop(0.26, '#0b0a12');
      g.addColorStop(1, '#050609');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PF.W, PF.H);

      glow(ctx, 540, 190, 470, '#e2762e', 0.13);
      ctx.fillStyle = hexA('#f0873a', 0.09);
      ctx.beginPath(); ctx.arc(540, 232, 220, 0, 6.284); ctx.fill();

      ridge(ctx, 300, 130, 1.1, '#120d13');
      ridge(ctx, 250, 90, 3.4, '#0d0a10');

      for (var i = 0; i < 4; i++) {
        cloud(ctx, 180 + i * 300, 130 + (i % 2) * 70, 60, '#e2762e', 0.10);
      }
      /* haze only over the water; below the pier the field must stay ink */
      for (var f = 0; f < 4; f++) {
        var y = 300 + f * 90, off = Math.sin(t * 0.2 + f) * 70;
        ctx.fillStyle = hexA('#e2762e', 0.026 - f * 0.006);
        ctx.fillRect(-200 + off, y, PF.W + 400, 52);
      }
      lattice(ctx, 0.028, 180);

      /* second rank of ships sits further out and darker */
      wakoShip(ctx, 300, 214, 130);
      wakoShip(ctx, 700, 206, 120);
      wakoShip(ctx, 150, 268, 210);
      wakoShip(ctx, 470, 232, 250);
      wakoShip(ctx, 820, 276, 200);
      wakoShip(ctx, 1010, 236, 170);

      /* the low sun catches the water under each hull */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      [150, 470, 820, 1010].forEach(function (x, k) {
        ctx.fillStyle = hexA('#e2762e', 0.05);
        for (var r2 = 0; r2 < 5; r2++) {
          var wdt = (110 - r2 * 14) * (1 - k * 0.06);
          ctx.fillRect(x - wdt / 2 + Math.sin(t * 0.9 + r2) * 7, 300 + r2 * 22, wdt, 4);
        }
      });
      ctx.restore();

      /* smoke columns off the beach */
      ctx.save();
      [230, 610, 900].forEach(function (x, k) {
        ctx.fillStyle = hexA('#1a1620', 0.5);
        ctx.beginPath();
        ctx.moveTo(x, 320);
        for (var s2 = 0; s2 < 5; s2++) {
          ctx.quadraticCurveTo(x + Math.sin(s2 * 1.7 + k) * 40, 320 - s2 * 46,
            x + Math.sin(s2 * 1.9 + k) * 26, 300 - s2 * 52);
        }
        ctx.lineTo(x + 40, 320);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();

      /* pilings of the landing pier */
      ctx.fillStyle = '#0a0c13';
      for (var p = 0; p < 7; p++) {
        ctx.fillRect(70 + p * 160, 400, 16, 90 + (p % 3) * 40);
        ctx.fillStyle = hexA('#e2762e', 0.05);
        ctx.fillRect(70 + p * 160, 400, 4, 90 + (p % 3) * 40);
        ctx.fillStyle = '#0a0c13';
      }
      /* the warm band has to die out gradually or the shoreline reads as a
         hard horizontal cut across the middle of the field */
      var fade = ctx.createLinearGradient(0, 330, 0, 760);
      fade.addColorStop(0, 'rgba(5,6,9,0)');
      fade.addColorStop(1, 'rgba(5,6,9,0.92)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 330, PF.W, 430);
      embers(ctx, t, 30, '#8a4a1c', 0.30, 21, true);
    },

    /* 동래성 성곽 — grey stone, crenellations, and a gate tower whose eave is
       the one shape that says Joseon at a glance. */
    dongnae: function (ctx, t) {
      vgrad(ctx, [[0, '#252a35'], [0.22, '#161a26'], [0.6, '#0a0c14'], [1, '#05060b']]);
      ridge(ctx, 190, 110, 2.2, '#1a1f28');

      stoneWall(ctx, 150, 450, 50, 9);

      /* 여장 — the parapet, with the loophole each archer shoots through */
      ctx.fillStyle = '#272e3c';
      for (var m = 0; m < 10; m++) ctx.fillRect(m * 110 + 12, 450, 84, 58);
      ctx.fillStyle = '#05070c';
      for (var sq = 0; sq < 10; sq++) ctx.fillRect(sq * 110 + 44, 470, 20, 28);
      ctx.strokeStyle = hexA('#3d4759', 0.6);
      ctx.lineWidth = 2;
      for (var sq2 = 0; sq2 < 10; sq2++) ctx.strokeRect(sq2 * 110 + 12, 450, 84, 58);
      ctx.strokeStyle = 'rgba(4,6,10,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 450); ctx.lineTo(PF.W, 450); ctx.stroke();

      /* 문루 — the gate tower, drawn over the wall so its eaves clear the top */
      ctx.fillStyle = '#0d1119';
      ctx.fillRect(360, 132, 360, 100);
      ctx.strokeStyle = hexA('#2e6b5e', 0.4);
      ctx.lineWidth = 3;
      for (var b = 0; b < 5; b++) {
        ctx.beginPath();
        ctx.moveTo(392 + b * 74, 140); ctx.lineTo(392 + b * 74, 226);
        ctx.stroke();
      }
      dancheong(ctx, 360, 720, 216, 16);
      tiledRoof(ctx, 540, 138, 470, 116, '#1f2531', hexA('#2e6b5e', 0.55));
      roofTiles(ctx, 540, 138, 470, 116, 'rgba(6,8,13,0.5)');
      dancheong(ctx, 330, 750, 128, 12);
      tiledRoof(ctx, 540, 246, 400, 78, '#191e29', hexA('#8e241a', 0.45));
      roofTiles(ctx, 540, 246, 400, 78, 'rgba(6,8,13,0.45)');
      /* shadow the upper eave casts on the lower roof */
      ctx.fillStyle = 'rgba(3,4,8,0.35)';
      ctx.fillRect(340, 232, 400, 18);

      /* 홍예문 — the arched gate under the tower, with iron studs */
      ctx.fillStyle = '#05070c';
      ctx.beginPath();
      ctx.moveTo(470, 450);
      ctx.lineTo(470, 330);
      ctx.arc(540, 330, 70, Math.PI, 0);
      ctx.lineTo(610, 450);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexA('#2e6b5e', 0.3);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = hexA('#3d4759', 0.5);
      for (var st = 0; st < 4; st++) {
        for (var sc = 0; sc < 3; sc++) {
          ctx.beginPath();
          ctx.arc(496 + sc * 44, 360 + st * 24, 3, 0, 6.284);
          ctx.fill();
        }
      }

      /* siege ladders leaning against the face */
      ctx.strokeStyle = '#2a1d14';
      ctx.lineWidth = 9;
      [170, 760, 960].forEach(function (x) {
        ctx.beginPath(); ctx.moveTo(x - 50, 700); ctx.lineTo(x, 474); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 26, 700); ctx.lineTo(x + 70, 474); ctx.stroke();
        ctx.lineWidth = 4;
        for (var k = 0; k < 6; k++) {
          var fr = k / 6;
          ctx.beginPath();
          ctx.moveTo(lerp(x - 50, x, fr), lerp(700, 474, fr));
          ctx.lineTo(lerp(x + 26, x + 70, fr), lerp(700, 474, fr));
          ctx.stroke();
        }
        ctx.lineWidth = 9;
      });

      /* spent arrows stuck in the masonry, and scorch where fire arrows hit */
      var ar = rng(9);
      ctx.strokeStyle = hexA('#5a4634', 0.65);
      ctx.lineWidth = 2;
      for (var a3 = 0; a3 < 22; a3++) {
        var ax = ar() * PF.W, ay = 180 + ar() * 250, aa = -0.9 - ar() * 0.6;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.cos(aa) * 26, ay + Math.sin(aa) * 26);
        ctx.stroke();
      }
      for (var sc2 = 0; sc2 < 7; sc2++) {
        glow(ctx, ar() * PF.W, 200 + ar() * 220, 60, '#000000', 0.25);
      }
      ctx.fillStyle = 'rgba(3,4,8,0.45)';
      ctx.fillRect(0, 508, PF.W, 60);
      lattice(ctx, 0.03, 180);
      embers(ctx, t, 18, '#8fa4c4', 0.16, 33, false);
    },

    /* 한산도 앞바다 — 청해파문 sea, the crane-wing arc of the enemy line, and
       the turtle ship's spiked back along the bottom edge. */
    hansando: function (ctx, t) {
      vgrad(ctx, [[0, '#0d3047'], [0.16, '#0a2033'], [0.44, '#061021'], [0.78, '#040a14'], [1, '#03070e']]);
      glow(ctx, 540, 100, 520, '#2f7fa8', 0.10);

      /* distant islands, then the near headland */
      ctx.fillStyle = '#081726';
      [[130, 60], [420, 44], [780, 70], [1010, 40]].forEach(function (p) {
        ctx.beginPath();
        ctx.moveTo(p[0] - 130, 190);
        ctx.quadraticCurveTo(p[0], 190 - p[1] * 2, p[0] + 130, 190);
        ctx.closePath();
        ctx.fill();
      });
      ridge(ctx, 200, 60, 5.1, '#06121e');

      seigaiha(ctx, 300, 9, 150, C.cheong, 0.07, t * 0.5);
      seigaiha(ctx, 980, 7, 210, C.cheong, 0.05, -t * 0.4);
      foam(ctx, 420, 3, 300, t, 0.06);

      /* 학익진 — the arc the Korean line closed around the enemy at Hansan */
      for (var s = 0; s < 7; s++) {
        var k = (s - 3) / 3;
        wakoShip(ctx, 540 + k * 440, 168 + k * k * 120, 170 - Math.abs(k) * 30);
      }
      lattice(ctx, 0.026, 180);

      /* the deck the player fights from: planking, 개판 spikes, and the
         dragon head at the prow */
      ctx.fillStyle = '#0a0e16';
      ctx.fillRect(0, PF.H - 150, PF.W, 150);
      ctx.strokeStyle = 'rgba(4,6,10,0.9)';
      ctx.lineWidth = 2;
      for (var pk = 0; pk < 9; pk++) {
        ctx.beginPath();
        ctx.moveTo(pk * 122, PF.H - 150); ctx.lineTo(pk * 122, PF.H);
        ctx.stroke();
      }
      ctx.strokeStyle = hexA(C.cheong, 0.16);
      ctx.beginPath(); ctx.moveTo(0, PF.H - 150); ctx.lineTo(PF.W, PF.H - 150); ctx.stroke();
      ctx.fillStyle = '#1a222e';
      for (var d = 0; d < 18; d++) {
        var sx = 20 + d * 60;
        poly(ctx, [[sx, PF.H - 150], [sx + 20, PF.H - 190], [sx + 40, PF.H - 150]]);
        ctx.fill();
        ctx.fillStyle = hexA(C.cheong, 0.22);
        poly(ctx, [[sx + 16, PF.H - 156], [sx + 20, PF.H - 190], [sx + 24, PF.H - 156]]);
        ctx.fill();
        ctx.fillStyle = '#1a222e';
      }
      /* gun ports along the deck edge */
      ctx.fillStyle = '#05070c';
      for (var q = 0; q < 8; q++) ctx.fillRect(40 + q * 130, PF.H - 96, 96, 14);
      ctx.strokeStyle = hexA(C.cheong, 0.2);
      ctx.lineWidth = 2;
      for (var q2 = 0; q2 < 8; q2++) ctx.strokeRect(40 + q2 * 130, PF.H - 96, 96, 14);
      embers(ctx, t, 18, '#3d7f96', 0.16, 45, true);
    },

    /* 행주산성 야전 — moon behind cloud, palisade, torch line. The only warm
       light on the plate comes from fire. */
    haengju: function (ctx, t) {
      vgrad(ctx, [[0, '#0d0c16'], [0.45, '#08070f'], [1, '#0c0709']]);

      var sr = rng(5);
      ctx.fillStyle = hexA(C.baek, 0.35);
      for (var st = 0; st < 60; st++) {
        var sx2 = sr() * PF.W, sy2 = sr() * 420;
        ctx.globalAlpha = 0.1 + sr() * 0.3;
        ctx.fillRect(sx2, sy2, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;

      glow(ctx, 810, 210, 300, '#9fb6d8', 0.14);
      ctx.fillStyle = hexA('#c3d2e8', 0.13);
      ctx.beginPath(); ctx.arc(810, 210, 96, 0, 6.284); ctx.fill();
      ctx.strokeStyle = hexA('#c3d2e8', 0.07);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(810, 210, 150, 0, 6.284); ctx.stroke();
      cloud(ctx, 760, 246, 96, '#9fb6d8', 0.18);
      cloud(ctx, 300, 170, 74, '#9fb6d8', 0.10);

      ridge(ctx, 470, 190, 0.6, '#090a11');
      ridge(ctx, 380, 130, 2.9, '#06070d');
      /* the mountain fortress wall along the ridge line */
      ctx.fillStyle = '#0b0d13';
      ctx.fillRect(0, 452, PF.W, 62);
      ctx.fillStyle = '#0f121a';
      for (var cr = 0; cr < 14; cr++) ctx.fillRect(cr * 78 + 8, 434, 54, 22);
      ctx.fillStyle = 'rgba(3,4,8,0.6)';
      ctx.fillRect(0, 514, PF.W, 40);
      lattice(ctx, 0.022, 180);

      /* 목책 — the palisade the defenders held */
      ctx.fillStyle = '#0c0908';
      for (var p = 0; p < 24; p++) {
        var px = p * 47 + 8;
        poly(ctx, [[px, 604], [px + 26, 604], [px + 26, 514], [px + 13, 492], [px, 514]]);
        ctx.fill();
      }
      ctx.strokeStyle = '#150f0d';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, 558); ctx.lineTo(PF.W, 558); ctx.stroke();
      /* the slope falls away into ink below the palisade */
      var hg = ctx.createLinearGradient(0, 590, 0, 760);
      hg.addColorStop(0, 'rgba(6,7,13,0)');
      hg.addColorStop(1, 'rgba(6,7,13,0.9)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 590, PF.W, 170);

      /* smoke rolling off the slope, lit from underneath by the torches */
      ctx.save();
      [200, 560, 900].forEach(function (x, k) {
        ctx.fillStyle = hexA('#120e11', 0.6);
        ctx.beginPath();
        ctx.moveTo(x - 60, 600);
        for (var s3 = 0; s3 < 5; s3++) {
          ctx.quadraticCurveTo(x + Math.sin(s3 * 1.6 + k) * 70, 600 - s3 * 60,
            x + Math.sin(s3 * 2.1 + k) * 40, 570 - s3 * 66);
        }
        ctx.lineTo(x + 70, 600);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();

      [110, 330, 600, 850, 1010].forEach(function (x, i) {
        var fl = 0.62 + Math.sin(t * 7 + i * 2) * 0.2;
        glow(ctx, x, 470 + (i % 2) * 40, 130, '#e8811f', 0.32 * fl);
        ctx.fillStyle = hexA('#f7b13a', fl);
        ctx.beginPath();
        ctx.ellipse(x, 470 + (i % 2) * 40, 7, 13, 0, 0, 6.284);
        ctx.fill();
        ctx.strokeStyle = '#1a1210'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x, 482 + (i % 2) * 40); ctx.lineTo(x, 560); ctx.stroke();
      });
      embers(ctx, t, 40, '#8a4a1c', 0.34, 12, true);
    },

    /* 노량 밤바다 — storm, rain, and a fleet already on fire. */
    noryang: function (ctx, t) {
      var g = ctx.createLinearGradient(0, 0, 0, PF.H);
      g.addColorStop(0, '#1a070c');
      g.addColorStop(0.3, '#0a0710');
      g.addColorStop(1, '#03040a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PF.W, PF.H);

      /* a single sheet-lightning flash held on this frame */
      glow(ctx, 240, 60, 620, '#9fb6d8', 0.10);
      ctx.strokeStyle = hexA('#c3d2e8', 0.4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(196, -10);
      ctx.lineTo(232, 92); ctx.lineTo(198, 106); ctx.lineTo(246, 210);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(232, 92); ctx.lineTo(288, 150);
      ctx.stroke();

      ridge(ctx, 190, 80, 4.2, '#0a0710');
      seigaiha(ctx, 560, 8, 240, '#7a2b1e', 0.07, t * 0.9);
      seigaiha(ctx, 1240, 6, 300, '#7a2b1e', 0.05, -t * 0.7);
      foam(ctx, 700, 4, 320, t, 0.07);

      [140, 420, 700, 970].forEach(function (x, i) {
        wakoShip(ctx, x, 214 + (i % 2) * 34, 190 - (i % 2) * 30, 0.5 + Math.sin(t * 4.4 + i * 1.7) * 0.16);
        /* wreckage on the water under each burning hull */
        ctx.fillStyle = hexA('#1a0d0c', 0.8);
        ctx.fillRect(x - 70 + (i * 23) % 40, 300 + (i % 3) * 40, 90, 8);
      });
      for (var c = 0; c < 3; c++) cloud(ctx, 220 + c * 380, 120 + (c % 2) * 46, 78, '#e2531f', 0.10);

      lattice(ctx, 0.022, 180);
      embers(ctx, t, 46, '#8c2f1a', 0.4, 77, true);

      ctx.strokeStyle = hexA(C.baek, 0.055);
      ctx.lineWidth = 2;
      for (var i2 = 0; i2 < 40; i2++) {
        var x2 = ((i2 * 137 + t * 340) % (PF.W + 340)) - 170;
        ctx.beginPath(); ctx.moveTo(x2, -20); ctx.lineTo(x2 - 52, PF.H + 20); ctx.stroke();
      }
      ctx.strokeStyle = hexA(C.baek, 0.03);
      ctx.lineWidth = 4;
      for (var i3 = 0; i3 < 14; i3++) {
        var x3 = ((i3 * 311 + t * 620) % (PF.W + 340)) - 170;
        ctx.beginPath(); ctx.moveTo(x3, -20); ctx.lineTo(x3 - 74, PF.H + 20); ctx.stroke();
      }
    },

    void: function (ctx) {
      vgrad(ctx, [[0, '#0a0c14'], [1, '#05060b']]);
      lattice(ctx, 0.04, 180);
    }
  };

  /* corner darkening. Threes used vignette to make a flat board feel warm;
     here it keeps the eye on the middle of a very tall field. */
  function vignette(ctx) {
    var g = ctx.createRadialGradient(PF.W / 2, PF.H * 0.52, PF.H * 0.24, PF.W / 2, PF.H * 0.52, PF.H * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PF.W, PF.H);
  }

  /* ── 9. HUD (spec §15.1) ──────────────────────────────────────── */

  function drawHud(ctx, h, t) {
    if (!h) return;
    ctx.save();

    /* life pips — max slots stay visible as empty boxes */
    var max = h.maxLife || 3;
    for (var i = 0; i < max; i++) {
      var x = 40 + i * 46, y = 54;
      ctx.strokeStyle = hexA(C.baek, 0.4); ctx.lineWidth = 2.5;
      poly(ctx, [[x, y - 15], [x + 15, y], [x, y + 15], [x - 15, y]]);
      ctx.stroke();
      if (i < h.life) { ctx.fillStyle = C.cheong; ctx.fill(); glow(ctx, x, y, 30, C.cheong, 0.5); }
    }

    /* score */
    ctx.textAlign = 'right';
    ctx.fillStyle = C.baek;
    ctx.font = '600 44px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(String(h.score).replace(/\B(?=(\d{3})+(?!\d))/g, ','), PF.W - 36, 66);
    ctx.font = '500 20px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.baekFaint;
    ctx.fillText('SCORE', PF.W - 36, 24);

    /* stage / wave progress */
    ctx.textAlign = 'center';
    ctx.fillStyle = C.baekMute;
    ctx.font = '500 21px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText('STAGE ' + h.stage + (h.wave ? ' · ' + h.wave : ''), PF.W / 2, 30);
    ctx.fillStyle = hexA(C.baek, 0.14);
    ctx.fillRect(PF.W / 2 - 170, 48, 340, 6);
    ctx.fillStyle = C.cheong;
    ctx.fillRect(PF.W / 2 - 170, 48, 340 * (h.progress || 0), 6);

    /* boss bar with phase notches */
    if (h.boss) {
      var bx = 70, bw = PF.W - 140, by = 96;
      ctx.fillStyle = hexA(C.baek, 0.12);
      ctx.fillRect(bx, by, bw, 16);
      ctx.fillStyle = C.jeok;
      ctx.fillRect(bx, by, bw * h.boss.hp, 16);
      glow(ctx, bx + bw * h.boss.hp, by + 8, 46, C.jeok, 0.6);
      ctx.strokeStyle = C.ink900; ctx.lineWidth = 3;
      (h.boss.phases || []).forEach(function (p) {
        ctx.beginPath(); ctx.moveTo(bx + bw * p, by - 4); ctx.lineTo(bx + bw * p, by + 20); ctx.stroke();
      });
      ctx.textAlign = 'left';
      ctx.fillStyle = C.baekMute;
      ctx.font = '500 20px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(h.boss.name + '  ·  PHASE ' + h.boss.phase, bx, by - 14);
    }

    /* combo + decay gauge, bottom-left */
    if (h.combo) {
      var cy = PF.H - 56;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.hwang;
      ctx.font = '700 50px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(h.combo, 40, cy);
      ctx.font = '600 24px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = C.baek;
      ctx.fillText('×' + (1 + Math.floor(h.combo / 10) * 0.1).toFixed(1), 40 + ctx.measureText(String(h.combo)).width + 62, cy - 4);
      ctx.fillStyle = C.baekFaint;
      ctx.font = '500 18px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('COMBO', 40, cy - 42);
      var g = clamp(1 - ((t % 3) / 3), 0, 1);
      ctx.fillStyle = hexA(C.baek, 0.14);
      ctx.fillRect(40, cy + 16, 190, 5);
      ctx.fillStyle = g < 0.25 ? C.jeok : C.hwang;
      ctx.fillRect(40, cy + 16, 190 * g, 5);
    }
    ctx.restore();
  }

  /* ── 10. simulation ───────────────────────────────────────────── */

  function makeState(scene) {
    return {
      t: 0, evt: 0, rnd: rng(scene.seed || 7),
      bullets: [], enemies: [], zones: [], tele: [], pops: [], parts: [],
      player: { x: scene.playerX || 540, y: scene.playerY || 1420, parryT: 0, cd: 0, inv: 0 },
      hitstop: 0, trauma: 0, scene: scene, kills: 0
    };
  }

  function spawn(s, type, x, y, ang, speedScale) {
    var def = BULLETS[type];
    var v = def.v * (speedScale || 1);
    s.bullets.push({
      type: type, x: x, y: y,
      vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
      owner: 'enemy', spin: 0, reparry: 0, age: 0, grace: 0
    });
  }

  function aimAt(x, y, tx, ty) { return Math.atan2(ty - y, tx - x); }

  /* Spec §5.2 C1–C5 and §5.5 verbatim: only approaching projectiles flip, and
     the mirror is the vector from the player to the bullet. */
  function parry(s) {
    if (s.player.cd > 0) return;
    s.player.parryT = PARRY.ACTIVE;
    s.player.cd = PARRY.COOLDOWN;
    var p = s.player, best = null, hits = 0;

    for (var i = 0; i < s.bullets.length; i++) {
      var b = s.bullets[i];
      if (!BULLETS[b.type].parry) continue;
      if (b.grace > 0) continue;
      var dx = b.x - p.x, dy = b.y - p.y, d = len(dx, dy);
      if (d > PARRY.R) continue;
      var nx = dx / d, ny = dy / d;
      var dot = b.vx * nx + b.vy * ny;
      if (dot >= 0) continue;

      var band = PARRY.BANDS.filter(function (g) { return d <= g.max; })[0];
      b.vx = b.vx - 2 * dot * nx;
      b.vy = b.vy - 2 * dot * ny;
      var sp = len(b.vx, b.vy) * band.spd;
      var m = len(b.vx, b.vy);
      b.vx = (b.vx / m) * Math.min(sp, 2400);
      b.vy = (b.vy / m) * Math.min(sp, 2400);
      if (b.owner === 'reflect') b.reparry++;
      b.owner = 'reflect';
      b.grace = 0.15;
      /* no re-parry bonus: the grade is re-judged from scratch each time (§7.2) */
      b.dmg = BULLETS[b.type].brp * band.dmg;
      hits++;
      if (!best || band.max < best.max) best = band;
    }

    /* one popup at a time: at a 0.24s cooldown two of them would overlap */
    s.pops.length = 0;
    if (hits) {
      s.player.inv = PARRY.INVULN;
      s.hitstop = best.stop;
      s.trauma = Math.min(1, s.trauma + 0.28 + best.dmg * 0.06);
      s.pops.push({ x: p.x, y: p.y - 158, text: best.name, sub: hits > 1 ? '×' + hits : '', color: best.color, life: 0.85, max: 0.85 });
    } else {
      /* empty parry: no invulnerability at all — the whole restraint (§5.4) */
      s.pops.push({ x: p.x, y: p.y - 158, text: '헛침', sub: '무적 없음', color: C.baekFaint, life: 0.55, max: 0.55 });
    }
  }

  /* One enemy's fire cycle: tell first, shot after. opts = {period, tell, fire}.
     The tell length is the stage's 발사 예비동작 value from §14.1. */
  function serve(s, e, t, opts) {
    if (e._next === undefined) e._next = opts.offset || 0;
    if (!e._armed && t >= e._next) {
      e.charge = 1;
      e.chargeDur = opts.tell;
      e._armed = true;
      e._fireAt = t + opts.tell;
    }
    if (e._armed && t >= e._fireAt) {
      opts.fire(s, e);
      e._armed = false;
      e._next = t + opts.period;
    }
  }

  /* Drives the demo player. Fires the moment the nearest approaching bullet
     crosses targetD, so the grade the mockup shows is the grade the distance
     rule in §5.3 actually produces — no hand-placed "GREAT" labels. */
  function autoParry(s, targetD) {
    if (s.player.cd > 0) return;
    var want = targetD === undefined ? 38 : targetD;
    for (var i = 0; i < s.bullets.length; i++) {
      var b = s.bullets[i];
      if (!BULLETS[b.type].parry || b.grace > 0) continue;
      var dx = b.x - s.player.x, dy = b.y - s.player.y, d = len(dx, dy);
      if (d > want) continue;
      if (b.vx * (dx / d) + b.vy * (dy / d) >= 0) continue;
      parry(s);
      return;
    }
  }

  function step(s, dt) {
    var i, b, e;
    s.player.parryT = Math.max(0, s.player.parryT - dt);
    s.player.cd = Math.max(0, s.player.cd - dt);
    s.player.inv = Math.max(0, s.player.inv - dt);
    s.trauma = Math.max(0, s.trauma - dt * 0.5);

    for (i = s.bullets.length - 1; i >= 0; i--) {
      b = s.bullets[i];
      b.age += dt; b.grace = Math.max(0, b.grace - dt); b.spin = (b.spin || 0) + dt * 9;
      if (b.type === 'P11' && b.owner === 'enemy' && b.age < 1.2) {
        var want = aimAt(b.x, b.y, s.player.x, s.player.y);
        var cur = Math.atan2(b.vy, b.vx);
        var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        var turn = clamp(diff, -2.094 * dt, 2.094 * dt);
        var spd = len(b.vx, b.vy);
        b.vx = Math.cos(cur + turn) * spd; b.vy = Math.sin(cur + turn) * spd;
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -150 || b.x > PF.W + 150 || b.y < -150 || b.y > PF.H + 150 || b.age > 6) {
        s.bullets.splice(i, 1); continue;
      }
      if (b.owner !== 'reflect') continue;
      for (var j = 0; j < s.enemies.length; j++) {
        e = s.enemies[j];
        if (e.dead) continue;
        var hit = e.hitW
          ? (Math.abs(b.x - e.x) < e.hitW / 2 && Math.abs(b.y - e.y) < e.hitH / 2)
          : len(b.x - e.x, b.y - e.y) < ENEMIES[e.type].w * 0.6;
        if (!hit) continue;
        /* §7.3 — the shield eats one reflected shot arriving at its front face,
           then breaks. Coming in from the flank ignores it entirely, which is
           what makes "turn the mirror" the correct answer rather than a trick. */
        if (e.shield > 0 && b.vy < 0 && Math.abs(b.vy) > Math.abs(b.vx)) {
          e.shield--;
          e.flash = 0.2;
          s.pops.push({ x: e.x, y: e.y - 70, text: '무효', sub: '정면', color: C.baek, life: 0.7, max: 0.7 });
          s.bullets.splice(i, 1);
          break;
        }
        e.hp -= b.dmg || 20;
        e.flash = 0.22;
        s.trauma = Math.min(1, s.trauma + 0.2);
        if (e.hp <= 0) { e.dead = true; e.deadAt = s.t; s.kills++; burst(s, e.x, e.y); }
        s.bullets.splice(i, 1);
        break;
      }
    }

    for (i = s.enemies.length - 1; i >= 0; i--) {
      e = s.enemies[i];
      e.flash = Math.max(0, (e.flash || 0) - dt * 4);
      e.charge = Math.max(0, (e.charge || 0) - dt / (e.chargeDur || 0.9));
      if (e.vx) e.x += e.vx * dt;
      if (e.vy) e.y += e.vy * dt;
    }

    for (i = s.zones.length - 1; i >= 0; i--) {
      s.zones[i].age += dt;
      if (s.zones[i].age > s.zones[i].dur) s.zones.splice(i, 1);
    }
    for (i = s.tele.length - 1; i >= 0; i--) {
      s.tele[i].age += dt;
      if (s.tele[i].age > s.tele[i].dur) {
        if (s.tele[i].onFire) s.tele[i].onFire(s, s.tele[i]);
        s.tele.splice(i, 1);
      }
    }
    for (i = s.pops.length - 1; i >= 0; i--) {
      s.pops[i].life -= dt;
      if (s.pops[i].life <= 0) s.pops.splice(i, 1);
    }
    for (i = s.parts.length - 1; i >= 0; i--) {
      var pt = s.parts[i];
      pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 260 * dt;
      if (pt.life <= 0) s.parts.splice(i, 1);
    }
  }

  function burst(s, x, y) {
    for (var i = 0; i < 14; i++) {
      var a = Math.random() * 6.2832, v = 120 + Math.random() * 320;
      s.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, c: i % 3 ? C.hwang : C.baek });
    }
  }

  /* ── 11. render ───────────────────────────────────────────────── */

  function render(ctx, s, scene) {
    var shake = s.trauma * s.trauma;
    ctx.save();
    ctx.translate(
      Math.sin(s.t * 41.3) * 26 * shake,
      Math.cos(s.t * 37.7) * 26 * shake
    );

    (BG[scene.stage] || BG.void)(ctx, s.t);
    if (scene.paint) scene.paint(ctx, s, s.t);

    s.zones.forEach(function (z) { drawZone(ctx, z); });
    s.tele.forEach(function (g) { drawTelegraph(ctx, g); });
    s.enemies.forEach(function (e) { if (!e.dead) drawEnemy(ctx, e); });
    s.bullets.forEach(function (b) { drawBullet(ctx, b); });
    drawPlayer(ctx, s.player, s.t);

    s.parts.forEach(function (p) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      ctx.globalAlpha = 1;
    });

    s.pops.forEach(function (p) {
      var k = 1 - p.life / p.max;
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1);
      ctx.translate(p.x, p.y - easeOut(k) * 46);
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.font = '700 ' + (40 + (1 - k) * 12) + 'px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(p.text, 0, 0);
      if (p.sub) {
        ctx.font = '500 22px "IBM Plex Sans KR", system-ui, sans-serif';
        ctx.fillStyle = C.baekMute;
        ctx.fillText(p.sub, 0, 30);
      }
      ctx.restore();
    });

    ctx.restore();

    vignette(ctx);
    drawHud(ctx, scene.hud, s.t);
    if (scene.overlay) scene.overlay(ctx, s, s.t);
  }

  /* ── 12. single-frame render ──────────────────────────────────── */

  /* The scene is stepped forward deterministically at a fixed 1/60 s and then
     drawn once. Nothing animates: the page is one in-game frame, not a demo. */
  function still(cfg) {
    document.title = cfg.title;
    var app = document.getElementById('app');

    var back = document.createElement('a');
    back.className = 'back';
    back.href = '../index.html';
    back.textContent = '← 전체 화면 목록';
    app.appendChild(back);

    var canvas = document.createElement('canvas');
    canvas.className = 'screen';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', cfg.title + ' — 인게임 화면 1프레임');
    var q = 2;
    canvas.width = PF.W * q;
    canvas.height = PF.H * q;
    app.appendChild(canvas);

    var s = makeState(cfg);
    if (cfg.setup) cfg.setup(s);

    var dt = 1 / 60;
    /* ?at=<seconds> re-renders the same deterministic run at another instant,
       which is how the published frame was chosen. */
    var override = parseFloat((location.search.match(/[?&]at=([\d.]+)/) || [])[1]);
    var frames = Math.round((isNaN(override) ? (cfg.at || 4) : override) / dt);
    for (var i = 0; i < frames; i++) {
      var prev = s.t;
      s.t = (i + 1) * dt;
      if (cfg.tick) cfg.tick(s, s.t, dt);
      (cfg.events || []).forEach(function (ev) {
        if (prev < ev.t && s.t >= ev.t) ev.fn(s);
      });
      step(s, dt);
    }
    /* trauma would displace the whole frame; on a still it reads as a mistake */
    s.trauma = 0;

    var ctx = canvas.getContext('2d');
    function draw() {
      ctx.setTransform(q, 0, 0, q, 0, 0);
      ctx.clearRect(0, 0, PF.W, PF.H);
      render(ctx, s, cfg);
    }
    draw();
    /* the HUD is typeset in webfonts; a one-shot canvas would bake the
       fallback metrics if it drew before they arrived */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    window.HWSTATE = s;
    return s;
  }

  return {
    PF: PF, C: C, PARRY: PARRY, BULLETS: BULLETS, ENEMIES: ENEMIES, BG: BG,
    still: still, parry: parry, autoParry: autoParry,
    serve: serve, spawn: spawn, aimAt: aimAt,
    glow: glow, hexA: hexA, poly: poly, label: label, hatch: hatch,
    drawBullet: drawBullet, drawEnemy: drawEnemy, drawZone: drawZone,
    clamp: clamp, lerp: lerp, easeOut: easeOut, len: len, rng: rng, burst: burst
  };
})();
