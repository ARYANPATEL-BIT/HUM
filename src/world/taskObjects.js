import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { hash, mulberry32 } from '../core/rng.js';
import { codeForKeypad, makeCodeTexture } from '../tasks/keypad.js';

// Deterministic task object placement. A task object = { id, type, cx, cz, gx, gz, lx, lz, wx, wz, completed }.
// Type 'tape' is a tape player (cassette delivery point); it never shares a chunk with a cassette.
// Objects persist in `all` across chunk unloads, so completed ones stay completed.
// Meshes and keypad code quads are added to the chunk group: they follow rebases and vanish on unload.

export const TASK_TYPES = ['breaker', 'radio', 'cassette', 'keypad'];
const TASK_SALT = 99;
const TAPE_SALT = 98;
const FORCE_SALT = 97;
const CODE_SALT = 96;

// A random interior cell, avoiding landmark cells (when flags are known) and `avoid`.
function freeCell(rng, flags, avoid) {
  const n = CONFIG.world.chunkCells;
  let gx, gz;
  for (let i = 0; i < 20; i++) {
    gx = 1 + Math.floor(rng() * (n - 2));
    gz = 1 + Math.floor(rng() * (n - 2));
    if ((!flags || !flags[gz * n + gx]) && !(avoid && avoid.gx === gx && avoid.gz === gz)) break;
  }
  return [gx, gz];
}

function makeObj(id, type, cx, cz, [gx, gz]) {
  const C = CONFIG.world.cellSize;
  return { id, type, cx, cz, gx, gz, lx: (gx + 0.5) * C, lz: (gz + 0.5) * C, wx: 0, wz: 0, completed: false, carried: false, mesh: null };
}

// The objects in chunk (cx, cz). Existence and type depend only on (seed, cx, cz); flags only move the cell.
export function taskObjectsForChunk(seed, cx, cz, flags = null) {
  if (cx === 0 && cz === 0) return []; // spawn chunk is task-free
  const out = [];
  const rng = mulberry32(hash(seed, TASK_SALT, cx, cz));
  if (rng() < CONFIG.game.taskDensity) {
    const type = TASK_TYPES[Math.floor(rng() * TASK_TYPES.length)];
    out.push(makeObj(`${cx},${cz},0`, type, cx, cz, freeCell(rng, flags)));
  }
  const tapeRng = mulberry32(hash(seed, TAPE_SALT, cx, cz));
  if (tapeRng() < CONFIG.game.tapeDensity && out[0]?.type !== 'cassette') {
    out.push(makeObj(`${cx},${cz},1`, 'tape', cx, cz, freeCell(tapeRng, flags, out[0])));
  }
  return out;
}

// Chunk whose wall shows a keypad's code: one of the 3x3 around it (forced keypads: their own chunk).
function codeChunk(seed, k) {
  if (k.forced) return [k.cx, k.cz];
  const r = mulberry32(hash(seed, CODE_SALT, k.cx, k.cz));
  return [k.cx + Math.floor(r() * 3) - 1, k.cz + Math.floor(r() * 3) - 1];
}

export class TaskObjects {
  constructor(seed, chunkSize, assets) {
    this.seed = seed;
    this.chunkSize = chunkSize;
    this.props = assets.props;
    this.all = new Map(); // id → task object, loaded or not
    this.activeIds = new Set(); // ids whose chunk is loaded
    this.doneTypes = new Set();
    this.codeQuads = new Map(); // chunk key → meshes with their own texture/material
  }

  placeChunk(chunk, playerPos) {
    const { cx, cz } = chunk;
    const objs = taskObjectsForChunk(this.seed, cx, cz, chunk.data.flags).map(
      (t) => this.all.get(t.id) ?? (this.all.set(t.id, t), t)
    );
    const forced = this.all.get(`${cx},${cz},2`) ?? this.force(chunk, objs, playerPos);
    if (forced) objs.push(forced);

    for (const t of objs) {
      t.wx = t.lx + chunk.ox;
      t.wz = t.lz + chunk.oz;
      this.activeIds.add(t.id);
      t.mesh = new THREE.Mesh(this.props.geometries[t.type], this.props.materials[t.type]);
      t.mesh.position.set(t.lx, chunk.heightAt(t.lx, t.lz), t.lz);
      t.mesh.visible = !t.completed && !t.carried;
      chunk.group.add(t.mesh);
    }
    chunk.taskObjs = objs;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const k of taskObjectsForChunk(this.seed, cx + dx, cz + dz)) {
          const [kx, kz] = codeChunk(this.seed, k);
          if (k.type === 'keypad' && kx === cx && kz === cz) this.addCodeQuad(chunk, k);
        }
      }
    }
    if (forced?.type === 'keypad') this.addCodeQuad(chunk, forced);
  }

  // Density guarantee: if a still-needed type has no instance within densityMaxRange, force one
  // into this chunk (only an empty chunk at least densityMinRange away, so it never pops in nearby).
  force(chunk, objs, playerPos) {
    if (!playerPos) return null;
    const missing = this.checkDensity(playerPos, this.neededTypes());
    const half = this.chunkSize / 2;
    const far = Math.hypot(chunk.ox + half - playerPos.x, chunk.oz + half - playerPos.z) >= CONFIG.game.densityMinRange;
    if (!missing.length || objs.length || !far || (chunk.cx === 0 && chunk.cz === 0)) return null;
    const rng = mulberry32(hash(this.seed, FORCE_SALT, chunk.cx, chunk.cz));
    const t = makeObj(`${chunk.cx},${chunk.cz},2`, missing[0], chunk.cx, chunk.cz, freeCell(rng, chunk.data.flags));
    t.forced = true;
    this.all.set(t.id, t);
    return t;
  }

  // Paints keypad k's code on a wall face in this chunk that faces a plain cell.
  addCodeQuad(chunk, k) {
    const { n, h, v, flags } = chunk.data;
    const C = CONFIG.world.cellSize;
    const off = CONFIG.world.wallThickness / 2 + 0.01;
    const spots = [];
    for (let line = 0; line < n; line++) {
      for (let i = 0; i < n; i++) {
        if (h[line * n + i] && !flags[line * n + i]) spots.push([(i + 0.5) * C, line * C + off, 0]);
        if (v[line * n + i] && !flags[i * n + line]) spots.push([line * C + off, (i + 0.5) * C, Math.PI / 2]);
      }
    }
    if (!spots.length) return;
    const [x, z, rot] = spots[Math.floor(mulberry32(hash(this.seed, CODE_SALT + 1, k.cx, k.cz))() * spots.length)];
    const map = new THREE.CanvasTexture(makeCodeTexture(codeForKeypad(this.seed, k.id)));
    map.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(this.props.geometries.code, new THREE.MeshBasicMaterial({ map }));
    mesh.position.set(x, 1.6, z);
    mesh.rotation.y = rot;
    chunk.group.add(mesh);
    if (!this.codeQuads.has(chunk.key)) this.codeQuads.set(chunk.key, []);
    this.codeQuads.get(chunk.key).push(mesh);
  }

  unplaceChunk(key, chunk) {
    for (const t of chunk.taskObjs ?? []) {
      this.activeIds.delete(t.id);
      t.mesh = null;
    }
    for (const m of this.codeQuads.get(key) ?? []) {
      m.material.map.dispose();
      m.material.dispose();
    }
    this.codeQuads.delete(key);
  }

  markCompleted(taskId) {
    const t = this.all.get(taskId);
    if (!t) return;
    t.completed = true;
    this.doneTypes.add(t.type);
    if (t.mesh) t.mesh.visible = false;
  }

  // Task types the player still needs, plus tape players while the cassette is outstanding.
  neededTypes() {
    const need = TASK_TYPES.filter((ty) => !this.doneTypes.has(ty));
    return need.includes('cassette') ? [...need, 'tape'] : need;
  }

  // Loaded, incomplete, not carried task objects (tape players excluded).
  get active() {
    const result = [];
    for (const id of this.activeIds) {
      const t = this.all.get(id);
      if (!t.completed && !t.carried && t.type !== 'tape') result.push(t);
    }
    return result;
  }

  // Loaded tape players.
  get tapes() {
    const result = [];
    for (const id of this.activeIds) {
      const t = this.all.get(id);
      if (t.type === 'tape') result.push(t);
    }
    return result;
  }

  // All known incomplete objects (including unloaded).
  get allIncomplete() {
    const result = [];
    for (const t of this.all.values()) {
      if (!t.completed) result.push(t);
    }
    return result;
  }

  // After a rebase shift, update all world positions.
  rebase(dx, dz) {
    for (const t of this.all.values()) {
      t.wx -= dx;
      t.wz -= dz;
    }
  }

  // Types from neededTypes with no incomplete instance within densityMaxRange of the player.
  checkDensity(playerPos, neededTypes) {
    const max = CONFIG.game.densityMaxRange;
    const present = new Set();
    for (const t of this.allIncomplete) {
      const d = Math.hypot(t.wx - playerPos.x, t.wz - playerPos.z);
      if (d <= max) present.add(t.type);
    }
    return neededTypes.filter((ty) => !present.has(ty));
  }
}
