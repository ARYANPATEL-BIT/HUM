import { CONFIG } from '../config.js';
import { generateChunk, spawnYaw } from './chunkGen.js';
import { buildChunk } from './chunkBuilder.js';

// Streams chunks around the player and owns the floating origin.
//
// Coordinates: "global" chunk indices (cx, cz) are unbounded integers. Scene positions are
// relative to the origin chunk (originCX, originCZ), so they always stay small:
//   sceneX = (cx - originCX) * chunkSize + localX
export class ChunkManager {
  constructor(scene, seed, assets) {
    this.scene = scene;
    this.seed = seed;
    this.assets = assets;
    this.size = CONFIG.world.chunkCells * CONFIG.world.cellSize;
    this.chunks = new Map();
    this.originCX = 0;
    this.originCZ = 0;
    this.stamp = 0;
    this.rebaseListeners = [];
    this.pending = 0;
    this.stats = { built: 0, unloaded: 0 };
    this.lightPool = null; // set by main.js after LightPool construction
    this.onChunkLoaded = null; // optional callback(chunk) for task system
    this.onChunkUnloaded = null; // optional callback(key) for task system
  }

  key(cx, cz) {
    return cx * 4294967296 + (cz >>> 0);
  }

  get(cx, cz) {
    return this.chunks.get(this.key(cx, cz));
  }

  chunkAt(x, z) {
    return [Math.floor(x / this.size) + this.originCX, Math.floor(z / this.size) + this.originCZ];
  }

  preload(pos) {
    while (this.buildNext(pos)) { /* keep going */ }
  }

  update(pos) {
    this.maybeRebase(pos);
    this.unloadFar(pos);
    for (let i = 0; i < CONFIG.world.maxBuildsPerFrame; i++) if (!this.buildNext(pos)) break;
  }

  buildNext(pos) {
    const R = CONFIG.world.loadRadius;
    const [pcx, pcz] = this.chunkAt(pos.x, pos.z);
    let best = null;
    let bestD = Infinity;
    let missing = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (this.chunks.has(this.key(pcx + dx, pcz + dz))) continue;
        missing++;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = [pcx + dx, pcz + dz];
        }
      }
    }
    this.pending = Math.max(0, missing - 1);
    if (!best) {
      this.pending = 0;
      return false;
    }
    this.load(best[0], best[1]);
    return true;
  }

  load(cx, cz) {
    const k = this.key(cx, cz);
    if (this.chunks.has(k)) return this.chunks.get(k);
    const data = generateChunk(this.seed, cx, cz);
    const built = buildChunk(data, this.assets);
    const chunk = { cx, cz, data, ...built, ox: 0, oz: 0, cells: null, key: k };
    this.place(chunk);
    this.chunks.set(k, chunk);
    this.scene.add(chunk.group);
    this.stats.built++;
    if (this.lightPool) {
      this.lightPool.addChunk(k, chunk);
    }
    if (this.onChunkLoaded) this.onChunkLoaded(chunk);
    return chunk;
  }

  place(chunk) {
    const ox = (chunk.cx - this.originCX) * this.size;
    const oz = (chunk.cz - this.originCZ) * this.size;
    const dx = ox - chunk.ox;
    const dz = oz - chunk.oz;
    chunk.ox = ox;
    chunk.oz = oz;
    chunk.group.position.set(ox, 0, oz);
    for (const b of chunk.colliders) {
      b.minX += dx;
      b.maxX += dx;
      b.minZ += dz;
      b.maxZ += dz;
      b.seen = b.seen || 0;
    }
    if (!chunk.cells) chunk.cells = this.bucket(chunk);
  }

  bucket(chunk) {
    const n = CONFIG.world.chunkCells;
    const C = CONFIG.world.cellSize;
    const cells = Array.from({ length: n * n }, () => []);
    const clamp = (i) => Math.max(0, Math.min(n - 1, i));
    for (const b of chunk.colliders) {
      const x0 = clamp(Math.floor((b.minX - chunk.ox) / C));
      const x1 = clamp(Math.floor((b.maxX - chunk.ox) / C));
      const z0 = clamp(Math.floor((b.minZ - chunk.oz) / C));
      const z1 = clamp(Math.floor((b.maxZ - chunk.oz) / C));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells[z * n + x].push(b);
    }
    return cells;
  }

  unloadFar(pos) {
    const limit = CONFIG.world.unloadDistance;
    for (const [k, c] of this.chunks) {
      const dx = Math.max(c.ox - pos.x, 0, pos.x - (c.ox + this.size));
      const dz = Math.max(c.oz - pos.z, 0, pos.z - (c.oz + this.size));
      if (Math.max(dx, dz) <= limit) continue;
      this.scene.remove(c.group);
      c.dispose();
      if (this.lightPool) this.lightPool.removeChunk(k);
      if (this.onChunkUnloaded) this.onChunkUnloaded(k, c);
      this.chunks.delete(k);
      this.stats.unloaded++;
    }
  }

  maybeRebase(pos) {
    const limit = CONFIG.world.rebaseDistance;
    if (Math.abs(pos.x) < limit && Math.abs(pos.z) < limit) return;
    const sx = Math.trunc(pos.x / this.size);
    const sz = Math.trunc(pos.z / this.size);
    this.originCX += sx;
    this.originCZ += sz;
    const dx = sx * this.size;
    const dz = sz * this.size;
    for (const c of this.chunks.values()) this.place(c);
    pos.x -= dx;
    pos.z -= dz;
    if (this.lightPool) this.lightPool.rebase(dx, dz);
    for (const fn of this.rebaseListeners) fn(dx, dz);
  }

  onRebase(fn) {
    this.rebaseListeners.push(fn);
  }

  query(x, z, r, out) {
    out.length = 0;
    const stamp = ++this.stamp;
    const n = CONFIG.world.chunkCells;
    const C = CONFIG.world.cellSize;
    const m = r + CONFIG.world.wallThickness;
    const [cx0, cz0] = this.chunkAt(x - m, z - m);
    const [cx1, cz1] = this.chunkAt(x + m, z + m);
    const clamp = (i) => Math.max(0, Math.min(n - 1, i));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.get(cx, cz);
        if (!c) continue;
        const lx = x - c.ox;
        const lz = z - c.oz;
        const gx0 = clamp(Math.floor((lx - m) / C));
        const gx1 = clamp(Math.floor((lx + m) / C));
        const gz0 = clamp(Math.floor((lz - m) / C));
        const gz1 = clamp(Math.floor((lz + m) / C));
        for (let gz = gz0; gz <= gz1; gz++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            for (const b of c.cells[gz * n + gx]) {
              if (b.seen === stamp) continue;
              b.seen = stamp;
              out.push(b);
            }
          }
        }
      }
    }
    return out;
  }

  groundAt(x, z) {
    const [cx, cz] = this.chunkAt(x, z);
    const c = this.get(cx, cz);
    return c ? c.heightAt(x - c.ox, z - c.oz) : 0;
  }

  // Is (wx, wz) behind a wall from (fx, fz)? Simple DDA ray-march through the cell grid.
  // Returns true if blocked (used by entity LoS and A*).
  hasLineOfSight(fx, fz, tx, tz) {
    const C = CONFIG.world.cellSize;
    let cx = fx, cz = fz;
    const dx = tx - fx, dz = tz - fz;
    const steps = Math.ceil(Math.hypot(dx, dz) / (C * 0.5));
    if (steps === 0) return true;
    const sx = dx / steps, sz = dz / steps;
    for (let i = 1; i <= steps; i++) {
      cx += sx; cz += sz;
      const boxes = this.query(cx, cz, 0.15, []);
      for (const b of boxes) {
        if (cx > b.minX && cx < b.maxX && cz > b.minZ && cz < b.maxZ) return false;
      }
    }
    return true;
  }

  // Centre of the spawn cell in chunk (0, 0), facing an open side.
  spawnPoint() {
    const [sx, sz] = CONFIG.world.spawnCell;
    const C = CONFIG.world.cellSize;
    const c = this.get(0, 0) || (this.load(0, 0), this.get(0, 0));
    return { x: c.ox + (sx + 0.5) * C, z: c.oz + (sz + 0.5) * C, yaw: spawnYaw(c.data) };
  }

  get loadedCount() {
    return this.chunks.size;
  }
}
