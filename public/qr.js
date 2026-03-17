/**
 * ClipVault — Styled QR renderer
 * Ports the Python react-qrbtf "A2C" pill-line style to pure Canvas 2D.
 *
 * Features:
 *   • Pill-shaped runs (vertical + horizontal, diagonal orientation split)
 *   • Rounded-square finder patterns
 *   • Centre HashHexagon icon with bg flood-fill
 *   • HIGH error correction throughout
 *   • Seeded PRNG for deterministic output per URL
 *
 * Requires: qrcode-generator (window.qrcode)
 */
(function (global) {
  'use strict';

  // ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  // ── Zone helpers ──────────────────────────────────────────────────────────
  function inFinder(x, y, n) {
    const m = 8;
    return (x < m && y < m) ||
           (x >= n - m && y < m) ||
           (x < m && y >= n - m);
  }

  function inCentreZone(x, y, n, zoneMods) {
    const half = zoneMods / 2;
    const cx = n / 2, cy = n / 2;
    return Math.abs(x - cx + 0.5) < half && Math.abs(y - cy + 0.5) < half;
  }

  // ── Canvas helpers ────────────────────────────────────────────────────────
  function roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  function pill(ctx, x0, y0, x1, y1, cell, lw, color) {
    const r   = lw / 2;
    const cx0 = x0 * cell + cell / 2;
    const cy0 = y0 * cell + cell / 2;
    const cx1 = x1 * cell + cell / 2;
    const cy1 = y1 * cell + cell / 2;
    const left   = Math.min(cx0, cx1) - r;
    const top    = Math.min(cy0, cy1) - r;
    const w      = Math.abs(cx1 - cx0) + lw;
    const h      = Math.abs(cy1 - cy0) + lw;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, r);
    ctx.fill();
  }

  function dot(ctx, x, y, cell, lw, color) {
    const r  = lw / 2;
    const cx = x * cell + cell / 2;
    const cy = y * cell + cell / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Pill-run renderer (A2C style) ─────────────────────────────────────────
  function drawLoopLines(ctx, matrix, n, cell, color, rng, lineWFrac) {
    // Two availability grids: ava (global) + ava2 (per-direction consumed)
    const ava  = Array.from({length: n}, () => new Uint8Array(n).fill(1));
    const ava2 = Array.from({length: n}, () => new Uint8Array(n).fill(1));

    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        if (!matrix[y][x]) continue;

        // Diagonal split: same logic as the Python original
        const vertical = !!((+(x > y)) ^ +(x + y < n));

        const lw = cell * (lineWFrac + (rng() - 0.5) * 0.10);

        if (vertical) {
          // start of a new vertical run?
          if (y === 0 || !matrix[y - 1][x] || !ava2[x][y - 1]) {
            const maxRun = rng() < 0.5 ? 3 : 4;
            let run = 0;
            while (
              y + run < n &&
              matrix[y + run][x] &&
              ava2[x][y + run] &&
              run < maxRun
            ) run++;

            if (run >= 2) {
              for (let i = 0; i < run; i++) {
                ava2[x][y + i] = 0;
                ava[x][y + i]  = 0;
              }
              pill(ctx, x, y, x, y + run - 1, cell, lw, color);
            }
          }
        } else {
          // start of a new horizontal run?
          if (x === 0 || !matrix[y][x - 1] || !ava2[x - 1][y]) {
            const maxRun = rng() < 0.5 ? 3 : 4;
            let run = 0;
            while (
              x + run < n &&
              matrix[y][x + run] &&
              ava2[x + run][y] &&
              run < maxRun
            ) run++;

            if (run >= 2) {
              for (let i = 0; i < run; i++) {
                ava2[x + i][y] = 0;
                ava[x + i][y]  = 0;
              }
              pill(ctx, x, y, x + run - 1, y, cell, lw, color);
            }
          }
        }

        // isolated dot (still available after run logic)
        if (ava[x][y] && matrix[y][x]) {
          const lw2 = cell * (lineWFrac + (rng() - 0.5) * 0.10);
          dot(ctx, x, y, cell, lw2, color);
        }
      }
    }
  }

  // ── Finder pattern (rounded square) ──────────────────────────────────────
  function drawFinder(ctx, px, py, cell, fg, bg) {
    const s  = cell;
    // outer ring: nicely rounded corners ~30% of cell size
    const ro = s * 1.4;
    // inner dot: fully rounded (circle-ish)
    const ri = s * 1.0;

    // Outer filled square
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.roundRect(px, py, 7 * s, 7 * s, ro);
    ctx.fill();

    // White gap
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(px + s, py + s, 5 * s, 5 * s, ro * 0.5);
    ctx.fill();

    // Inner filled dot
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.roundRect(px + 2 * s, py + 2 * s, 3 * s, 3 * s, ri);
    ctx.fill();
  }

  // ── Centre icon: HashHexagon ──────────────────────────────────────────────
  // We draw it on an offscreen canvas scaled to iconPx, then:
  //   1. flood-fill the hex interior with bg on a copy
  //   2. composite onto main canvas
  function drawIcon(ctx, canvasSize, iconPx, fg, bg) {
    const off = document.createElement('canvas');
    off.width  = iconPx;
    off.height = iconPx;
    const oc = off.getContext('2d');

    const scale = iconPx / 24;
    oc.scale(scale, scale);
    oc.strokeStyle   = fg;
    oc.lineWidth     = 1.5;
    oc.lineCap       = 'round';
    oc.lineJoin      = 'round';

    // Draw the full icon path
    const fullPath = new Path2D(
      'M20.5 15.8V8.2a1.91 1.91 0 0 0-.944-1.645l-6.612-3.8a1.88 1.88 0 0 0-1.888 0' +
      'l-6.612 3.8A1.9 1.9 0 0 0 3.5 8.2v7.602a1.91 1.91 0 0 0 .944 1.644l6.612 3.8' +
      'a1.88 1.88 0 0 0 1.888 0l6.612-3.8A1.9 1.9 0 0 0 20.5 15.8' +
      'M10.905 8l-1.437 8m4.937-8-1.437 8m3.314-5.75H7.718m8.564 3.5H7.718'
    );

    // Just the hex outline for bg flood
    const hexPath = new Path2D(
      'M20.5 15.8V8.2a1.91 1.91 0 0 0-.944-1.645l-6.612-3.8a1.88 1.88 0 0 0-1.888 0' +
      'l-6.612 3.8A1.9 1.9 0 0 0 3.5 8.2v7.602a1.91 1.91 0 0 0 .944 1.644l6.612 3.8' +
      'a1.88 1.88 0 0 0 1.888 0l6.612-3.8A1.9 1.9 0 0 0 20.5 15.8Z'
    );

    // Fill hex interior with bg using a thick stroke + shadow blur trick
    oc.save();
    oc.shadowColor = bg;
    oc.shadowBlur  = 8;
    oc.strokeStyle = bg;
    oc.lineWidth   = 6;
    oc.stroke(hexPath);
    // Solid fill
    oc.fillStyle = bg;
    oc.fill(hexPath);
    oc.restore();

    // Draw the icon strokes in fg on top
    oc.strokeStyle = fg;
    oc.lineWidth   = 1.5;
    oc.stroke(fullPath);

    // Paste onto main canvas, centred
    const ix = Math.round((canvasSize - iconPx) / 2);
    const iy = Math.round((canvasSize - iconPx) / 2);
    ctx.drawImage(off, ix, iy);
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function render(url, canvas, opts) {
    opts = opts || {};
    const cell         = opts.cell         || 14;
    const quiet        = opts.quiet        || 4;
    const fg           = opts.fg           || '#111111';
    const bg           = opts.bg           || '#ffffff';
    const lineWFrac    = opts.lineWFrac    || 0.65;
    const iconFraction = opts.iconFraction || 0.22;

    if (!window.qrcode) {
      console.error('ClipVaultQR: qrcode-generator not loaded');
      return;
    }

    // Generate matrix
    const qr = window.qrcode(0, 'H');
    qr.addData(url);
    qr.make();

    const n         = qr.getModuleCount();
    const iconMods  = n * iconFraction;
    const zoneMods  = iconMods + 1.5;

    // Build filtered matrix (remove finder + centre zone)
    const matrix = Array.from({length: n}, (_, y) =>
      Array.from({length: n}, (_, x) => {
        if (!qr.isDark(y, x))              return 0;
        if (inFinder(x, y, n))             return 0;
        if (inCentreZone(x, y, n, zoneMods)) return 0;
        return 1;
      })
    );

    const pad  = quiet * cell;
    const size = n * cell + 2 * pad;

    canvas.width  = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // Seeded RNG (deterministic per URL)
    const rng = mulberry32(hashStr(url));

    // Data pill-runs
    ctx.save();
    ctx.translate(pad, pad);
    drawLoopLines(ctx, matrix, n, cell, fg, rng, lineWFrac);
    ctx.restore();

    // Finder patterns (on top of data, like original)
    const fp = [
      [pad,              pad],
      [pad + (n - 7) * cell, pad],
      [pad,              pad + (n - 7) * cell],
    ];
    for (const [px, py] of fp) {
      drawFinder(ctx, px, py, cell, fg, bg);
    }

    // Centre icon
    const iconPx = Math.round(n * cell * iconFraction);
    drawIcon(ctx, size, iconPx, fg, bg);
  }

  global.ClipVaultQR = { render };

})(window);
