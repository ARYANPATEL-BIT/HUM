import { CONFIG } from '../config.js';
import { generateChunk } from '../world/chunkGen.js';

// Run recap: the player's and the entity's positions every recap.interval seconds of play, then a
// top-down map on the end screen. Samples are flat number arrays [x0, z0, x1, z1, …] in world meters
// (scene position + floating-origin offset), so a rebase doesn't break the path. The entity array stays
// index-aligned with the player's: NaN, NaN while it isn't out. Walls are regenerated from the seed for
// every chunk the player stood in at a sample.

const COL = { bg: '#14110a', wall: '#7a6838', player: '#e8dca0', entity: '#ff5a3c', task: '#00ff88', chalk: '#f4f1e6', text: '#d8cf9a' };
const PAD = 24;
const LEGEND = 44;

export class Recap {
  constructor(chunks) {
    this.chunks = chunks;
    this.player = [];
    this.entity = [];
    this.tasks = []; // { type, x, z } in world meters, where each task was finished
    this.acc = CONFIG.recap.interval; // so the first frame records the start
  }

  wx(x) { return x + this.chunks.originCX * this.chunks.size; }
  wz(z) { return z + this.chunks.originCZ * this.chunks.size; }

  update(dt, playerPos, entity) {
    this.acc += dt;
    if (this.acc < CONFIG.recap.interval) return;
    this.acc -= CONFIG.recap.interval;
    this.sample(playerPos, entity);
  }

  sample(playerPos, entity) {
    this.player.push(this.wx(playerPos.x), this.wz(playerPos.z));
    if (entity.enabled) this.entity.push(this.wx(entity.position.x), this.wz(entity.position.z));
    else this.entity.push(NaN, NaN);
  }

  mark(type, pos) {
    this.tasks.push({ type, x: this.wx(pos.x), z: this.wz(pos.z) });
  }

  // Chunks the player stood in, as [cx, cz] (world meters / chunk size = global chunk index).
  visited() {
    const out = new Map();
    const S = this.chunks.size;
    for (let i = 0; i < this.player.length; i += 2) {
      const cx = Math.floor(this.player[i] / S), cz = Math.floor(this.player[i + 1] / S);
      out.set(`${cx},${cz}`, [cx, cz]);
    }
    return [...out.values()];
  }

  // chalk: flat scene [x, z, …] of marks still in the world. cause: 'escaped' | 'caught' | 'time'.
  draw(canvas, seed, cause, chalk) {
    const S = this.chunks.size;
    const n = CONFIG.world.chunkCells;
    const C = CONFIG.world.cellSize;
    const chunks = this.visited();
    if (!chunks.length) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [cx, cz] of chunks) {
      x0 = Math.min(x0, cx * S); z0 = Math.min(z0, cz * S);
      x1 = Math.max(x1, (cx + 1) * S); z1 = Math.max(z1, (cz + 1) * S);
    }
    const k = (CONFIG.recap.maxPx - 2 * PAD) / Math.max(x1 - x0, z1 - z0);
    const w = Math.round((x1 - x0) * k + 2 * PAD);
    const h = Math.round((z1 - z0) * k + 2 * PAD);
    canvas.width = Math.max(w, 560); // room for the legend
    canvas.height = h + LEGEND;
    const ox = (canvas.width - w) / 2;
    const X = (x) => ox + PAD + (x - x0) * k;
    const Y = (z) => PAD + (z - z0) * k;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Walls and pillars.
    ctx.strokeStyle = ctx.fillStyle = COL.wall;
    ctx.lineWidth = Math.max(1, CONFIG.world.wallThickness * k);
    ctx.beginPath();
    const ps = CONFIG.world.pillarSize / 2;
    for (const [cx, cz] of chunks) {
      const d = generateChunk(seed, cx, cz);
      const bx = cx * S, bz = cz * S;
      for (let line = 0; line <= n; line++) {
        for (let i = 0; i < n; i++) {
          if (d.h[line * n + i]) { ctx.moveTo(X(bx + i * C), Y(bz + line * C)); ctx.lineTo(X(bx + (i + 1) * C), Y(bz + line * C)); }
          if (d.v[line * n + i]) { ctx.moveTo(X(bx + line * C), Y(bz + i * C)); ctx.lineTo(X(bx + line * C), Y(bz + (i + 1) * C)); }
        }
      }
      for (const [px, pz] of d.pillars) ctx.fillRect(X(bx + px * C - ps), Y(bz + pz * C - ps), 2 * ps * k, 2 * ps * k);
      for (const s of d.hiding) ctx.fillRect(X(bx + s.x - s.hx), Y(bz + s.z - s.hz), 2 * s.hx * k, 2 * s.hz * k);
    }
    ctx.stroke();

    // Paths, clipped to the visited area (the entity wanders and relocates outside it).
    ctx.save();
    ctx.beginPath();
    ctx.rect(X(x0), Y(z0), (x1 - x0) * k, (z1 - z0) * k);
    ctx.clip();
    ctx.lineJoin = ctx.lineCap = 'round';
    const path = (A, color, breakDist) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < A.length; i += 2) {
        if (Number.isNaN(A[i])) { pen = false; continue; }
        if (pen && Math.hypot(A[i] - A[i - 2], A[i + 1] - A[i - 1]) > breakDist) pen = false;
        if (pen) ctx.lineTo(X(A[i]), Y(A[i + 1]));
        else ctx.moveTo(X(A[i]), Y(A[i + 1]));
        pen = true;
      }
      ctx.stroke();
    };
    path(this.entity, COL.entity, CONFIG.recap.breakDist); // relocations are gaps
    path(this.player, COL.player, Infinity);

    // Markers.
    const cross = (x, y, r) => { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); };
    ctx.strokeStyle = COL.chalk;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < chalk.length; i += 2) cross(X(this.wx(chalk[i])), Y(this.wz(chalk[i + 1])), 3);
    ctx.stroke();

    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.tasks) {
      ctx.fillStyle = COL.task;
      ctx.beginPath();
      ctx.arc(X(t.x), Y(t.z), 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COL.bg;
      ctx.fillText(t.type[0].toUpperCase(), X(t.x), Y(t.z) + 0.5);
    }

    const P = this.player;
    ctx.strokeStyle = COL.player;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(P[0]), Y(P[1]), 6, 0, Math.PI * 2);
    ctx.stroke();

    const ex = X(P[P.length - 2]), ey = Y(P[P.length - 1]);
    ctx.beginPath();
    if (cause === 'escaped') {
      ctx.fillStyle = COL.task;
      ctx.fillRect(ex - 6, ey - 6, 12, 12);
    } else {
      ctx.strokeStyle = COL.entity;
      ctx.lineWidth = 3;
      cross(ex, ey, 7);
      ctx.stroke();
    }
    ctx.restore();

    // Legend + seed, so a saved image explains itself.
    const items = [[COL.player, 'you'], [COL.entity, 'it'], [COL.task, 'task'], [COL.chalk, 'chalk'], [cause === 'escaped' ? COL.task : COL.entity, cause === 'escaped' ? 'exit' : 'end']];
    ctx.font = '13px monospace';
    ctx.textAlign = 'left';
    let lx = PAD;
    const ly = canvas.height - LEGEND / 2;
    for (const [color, label] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly - 5, 10, 10);
      ctx.fillStyle = COL.text;
      ctx.fillText(label, lx + 16, ly);
      lx += 26 + ctx.measureText(label).width;
    }
    ctx.textAlign = 'right';
    ctx.fillText(`seed ${seed}`, canvas.width - PAD, ly);
  }
}
