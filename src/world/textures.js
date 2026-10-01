import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../core/rng.js';

// All surface textures are painted at runtime on canvases. Every texture tiles horizontally,
// so anything drawn near an edge is also drawn wrapped around to the other side.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Draw fn at x and at x +/- width (and z +/- height when wrapY) so blobs tile seamlessly.
function wrapped(w, h, wrapY, x, y, fn) {
  const ys = wrapY ? [y - h, y, y + h] : [y];
  for (const dx of [-w, 0, w]) for (const yy of ys) fn(x + dx, yy);
}

// Per-pixel luminance noise, applied in place.
function addNoise(g, w, h, amount, rng) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
}

function stain(g, x, y, r, [cr, cg, cb], alpha) {
  // Water stain: soft body with a faint tide line near the edge.
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * 0.3})`);
  grad.addColorStop(0.75, `rgba(${cr},${cg},${cb},${alpha * 0.4})`);
  grad.addColorStop(0.9, `rgba(${cr - 20},${cg - 20},${cb - 10},${alpha * 0.55})`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function wallpaper(rng) {
  const T = CONFIG.textures.wallpaper;
  const [w, h] = T.px;
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = T.base;
  g.fillRect(0, 0, w, h);

  // Faint vertical stripes: a lighter band and a thin darker pinline per repeat.
  const band = Math.floor(T.stripeEvery * 0.45);
  for (let x = 0; x < w; x += T.stripeEvery) {
    g.fillStyle = T.stripeLight;
    g.fillRect(x, 0, band, h);
    g.fillStyle = T.stripeDark;
    g.fillRect(x + band, 0, 1, h);
  }
  addNoise(g, w, h, T.noise, rng);

  // Water stains, mostly in the upper wall (leaks come from the ceiling), with drip streaks.
  for (let i = 0; i < T.stains; i++) {
    const x = rng() * w;
    const y = rng() * h * 0.55;
    const r = 18 + rng() * 60;
    const a = 0.08 + rng() * 0.12;
    // Several overlapping, offset blobs so a stain has an irregular outline, not a circle.
    const blobs = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < blobs; k++) {
      const bx = x + (rng() - 0.5) * r;
      const by = y + (rng() - 0.3) * r * 0.8;
      const br = r * (0.35 + rng() * 0.5);
      wrapped(w, h, false, bx, by, (px, py) => stain(g, px, py, br, T.stainColor, a));
    }
    const drips = Math.floor(rng() * 4);
    for (let k = 0; k < drips; k++) {
      const dx = x + (rng() - 0.5) * r;
      const len = 30 + rng() * 140;
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, `rgba(${T.stainColor.join(',')},${a * 0.8})`);
      grad.addColorStop(1, `rgba(${T.stainColor.join(',')},0)`);
      g.fillStyle = grad;
      wrapped(w, h, false, dx, y, (px) => g.fillRect(px, y, 1 + rng() * 2, len));
    }
  }

  // Grime creeping up from the floor, a shadow under the ceiling, and a baseboard.
  const grime = g.createLinearGradient(0, h * 0.75, 0, h);
  grime.addColorStop(0, 'rgba(70,55,20,0)');
  grime.addColorStop(1, 'rgba(70,55,20,0.28)');
  g.fillStyle = grime;
  g.fillRect(0, h * 0.75, w, h * 0.25);
  const top = g.createLinearGradient(0, 0, 0, h * 0.12);
  top.addColorStop(0, 'rgba(60,50,20,0.18)');
  top.addColorStop(1, 'rgba(60,50,20,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, w, h * 0.12);
  const bb = Math.round(h * 0.035);
  g.fillStyle = T.baseboard;
  g.fillRect(0, h - bb, w, bb);
  g.fillStyle = 'rgba(255,240,200,0.12)';
  g.fillRect(0, h - bb, w, 1);
  return c;
}

function carpet(rng) {
  const T = CONFIG.textures.carpet;
  const s = T.px;
  const [c, g] = makeCanvas(s, s);
  const [r, gr, b] = T.base;
  g.fillStyle = `rgb(${r},${gr},${b})`;
  g.fillRect(0, 0, s, s);

  // Damp blotches: large soft dark patches, wrapped on both axes.
  for (let i = 0; i < T.blotches; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const rad = 30 + rng() * 110;
    const a = 0.08 + rng() * 0.14;
    wrapped(s, s, true, x, y, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, rad);
      grad.addColorStop(0, `rgba(60,50,25,${a})`);
      grad.addColorStop(1, 'rgba(60,50,25,0)');
      g.fillStyle = grad;
      g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
  addNoise(g, s, s, T.noise, rng);
  return c;
}

function ceilingTiles(rng) {
  const T = CONFIG.textures.ceiling;
  const s = T.px;
  const [c, g] = makeCanvas(s, s);
  const [r, gr, b] = T.base;
  g.fillStyle = `rgb(${r},${gr},${b})`;
  g.fillRect(0, 0, s, s);

  // Acoustic tile pits.
  g.fillStyle = 'rgba(90,85,65,0.35)';
  for (let i = 0; i < T.speckles; i++) g.fillRect(rng() * s, rng() * s, 1 + rng(), 1 + rng());

  const tile = s / T.tiles;
  // A few tiles with brown leak stains, and one replaced tile that doesn't quite match.
  for (let i = 0; i < T.stainedTiles; i++) {
    const tx = Math.floor(rng() * T.tiles) * tile;
    const ty = Math.floor(rng() * T.tiles) * tile;
    g.save();
    g.beginPath();
    g.rect(tx, ty, tile, tile);
    g.clip();
    stain(g, tx + rng() * tile, ty + rng() * tile, tile * (0.3 + rng() * 0.4), [140, 110, 50], 0.35);
    g.restore();
  }
  g.fillStyle = 'rgba(255,250,225,0.12)';
  g.fillRect(Math.floor(rng() * T.tiles) * tile, Math.floor(rng() * T.tiles) * tile, tile, tile);
  addNoise(g, s, s, 8, rng);

  // T-bar grid, drawn last so it sits on top of stains.
  g.fillStyle = T.line;
  for (let i = 0; i < T.tiles; i++) {
    const p = Math.round(i * tile);
    g.fillRect(p, 0, 3, s);
    g.fillRect(0, p, s, 3);
  }
  return c;
}

function toTexture(canvas, anisotropy) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export function createTextures(maxAnisotropy) {
  const rng = mulberry32(CONFIG.textures.seed);
  return {
    wallpaper: toTexture(wallpaper(rng), maxAnisotropy),
    carpet: toTexture(carpet(rng), maxAnisotropy),
    ceiling: toTexture(ceilingTiles(rng), maxAnisotropy),
  };
}
