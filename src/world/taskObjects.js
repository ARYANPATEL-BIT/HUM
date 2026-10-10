import { CONFIG } from '../config.js';
import { hash, mulberry32 } from '../core/rng.js';

// Deterministic task object placement. A task object = { id, type, cx, cz, lx, lz, wx, wz, completed }.
// The "used" set persists task-object ids across chunk unloads so repeated visits don't re-activate them.

const TASK_TYPES = ['breaker', 'radio', 'cassette', 'keypad'];
const TASK_SALT = 99;

// Returns the task objects that should exist in chunk (cx, cz).
// Count is deterministic from hash; at most 1 task per chunk on average.
export function taskObjectsForChunk(seed, cx, cz) {
  if (cx === 0 && cz === 0) return []; // spawn chunk is task-free
  const rng = mulberry32(hash(seed, TASK_SALT, cx, cz));
  if (rng() > CONFIG.game.taskDensity) return [];
  const C = CONFIG.world.cellSize;
  const n = CONFIG.world.chunkCells;
  // Place it at the centre of a random interior cell.
  const lx = (Math.floor(rng() * (n - 2)) + 1.5) * C;
  const lz = (Math.floor(rng() * (n - 2)) + 1.5) * C;
  const typeIndex = Math.floor(rng() * TASK_TYPES.length);
  const id = `${cx},${cz},0`;
  return [{
    id,
    type: TASK_TYPES[typeIndex],
    cx, cz,
    lx, lz,
    wx: 0, wz: 0, // filled in by TaskObjects.placeChunk
    completed: false,
  }];
}

// Manager: registers task objects when chunks load, tracks used ids, handles density guarantee.
export class TaskObjects {
  constructor(seed, chunkSize) {
    this.seed = seed;
    this.chunkSize = chunkSize;
    // All known task objects (loaded and unloaded chunks).
    this.all = new Map(); // id → task object
    // Ids of tasks that have been completed; persisted even after chunk unloads.
    this.usedIds = new Set();
    // Ids of tasks whose chunk is currently loaded.
    this.activeIds = new Set();
    // Ids of tasks currently needing to be density-forced.
    this.pendingForce = new Map(); // type → { cx, cz } to force into
  }

  placeChunk(chunk) {
    const tasks = taskObjectsForChunk(this.seed, chunk.cx, chunk.cz);
    const ox = chunk.ox;
    const oz = chunk.oz;
    for (const t of tasks) {
      t.wx = t.lx + ox;
      t.wz = t.lz + oz;
      if (this.usedIds.has(t.id)) t.completed = true;
      if (!this.all.has(t.id)) this.all.set(t.id, t);
      else {
        // Update world pos (origin may have shifted).
        const existing = this.all.get(t.id);
        existing.wx = t.wx;
        existing.wz = t.wz;
      }
      this.activeIds.add(t.id);
    }
  }

  unplaceChunk(key, chunk) {
    const tasks = taskObjectsForChunk(this.seed, chunk.cx, chunk.cz);
    for (const t of tasks) {
      this.activeIds.delete(t.id);
    }
  }

  markCompleted(taskId) {
    this.usedIds.add(taskId);
    const t = this.all.get(taskId);
    if (t) t.completed = true;
  }

  // Active incomplete tasks (chunk loaded).
  get active() {
    const result = [];
    for (const id of this.activeIds) {
      const t = this.all.get(id);
      if (t && !t.completed) result.push(t);
    }
    return result;
  }

  // All known incomplete tasks (including unloaded).
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

  // Check if any task type lacks an instance within densityMaxRange of player.
  // Returns list of missing types.
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
