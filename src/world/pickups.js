import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { hash, mulberry32 } from '../core/rng.js';
import { load, save } from '../core/storage.js';
import { NOTES } from '../content/notes.js';
import { spawnYaw } from './chunkGen.js';

// Water bottles and notes lying on the floor. Placement is deterministic per (seed, chunk) like task
// objects, and picked-up ids are remembered across chunk unloads. A pickup = { id, type, lx, lz, rot,
// wx, wz, taken, mesh }. Which of the 15 notes a paper shows is decided when it is picked up: the
// lowest-numbered note this browser hasn't read (saved in localStorage), so they read in order.

const BOTTLE_SALT = 95;
const NOTE_SALT = 94;

// A free interior cell of the chunk, not a landmark cell and not in `avoid` ("gx,gz" strings).
function freeCell(rng, flags, avoid) {
  const n = CONFIG.world.chunkCells;
  let gx = 1, gz = 1;
  for (let i = 0; i < 20; i++) {
    gx = 1 + Math.floor(rng() * (n - 2));
    gz = 1 + Math.floor(rng() * (n - 2));
    if (!flags[gz * n + gx] && !avoid.has(`${gx},${gz}`)) break;
  }
  avoid.add(`${gx},${gz}`);
  return [gx, gz];
}

function make(id, type, rng, [gx, gz]) {
  const C = CONFIG.world.cellSize;
  // Off-centre inside the cell so a pickup never sits exactly on a task prop.
  const ox = (rng() - 0.5) * C * 0.5;
  const oz = (rng() - 0.5) * C * 0.5;
  return { id, type, lx: (gx + 0.5) * C + ox, lz: (gz + 0.5) * C + oz, rot: rng() * Math.PI * 2, wx: 0, wz: 0, taken: false, mesh: null };
}

export function pickupsForChunk(seed, cx, cz, data, avoid) {
  const out = [];
  const G = CONFIG.game;
  const C = CONFIG.world.cellSize;
  const br = mulberry32(hash(seed, BOTTLE_SALT, cx, cz));
  if (br() < G.bottleChance) out.push(make(`b${cx},${cz}`, 'bottle', br, freeCell(br, data.flags, avoid)));
  const nr = mulberry32(hash(seed, NOTE_SALT, cx, cz));
  if (cx === 0 && cz === 0) {
    // The first note lies just in front of the player at spawn.
    const [sx, sz] = CONFIG.world.spawnCell;
    const yaw = spawnYaw(data);
    const note = make('n0,0', 'note', nr, [sx, sz]);
    note.lx = (sx + 0.5) * C - Math.sin(yaw) * 1.3;
    note.lz = (sz + 0.5) * C - Math.cos(yaw) * 1.3;
    out.push(note);
  } else if (nr() < G.noteChance) {
    out.push(make(`n${cx},${cz}`, 'note', nr, freeCell(nr, data.flags, avoid)));
  }
  return out;
}

export class Pickups {
  constructor(seed, assets) {
    this.seed = seed;
    this.props = assets.props;
    this.all = new Map(); // id → pickup, loaded or not
    this.loaded = new Set(); // ids in loaded chunks
    this.bottles = 0;
    this.read = new Set(load('notesRead', [])); // note indices read in this browser, any run
    this.stats = { bottlesFound: 0, bottlesDrunk: 0, notesRead: 0, newNotes: 0 };
    this.reading = null; // index into NOTES while a note is open
  }

  // After TaskObjects.placeChunk, so task cells can be avoided.
  placeChunk(chunk) {
    const avoid = new Set((chunk.taskObjs ?? []).map((t) => `${t.gx},${t.gz}`));
    if (chunk.cx === 0 && chunk.cz === 0) avoid.add(CONFIG.world.spawnCell.join(','));
    const items = pickupsForChunk(this.seed, chunk.cx, chunk.cz, chunk.data, avoid).map(
      (p) => this.all.get(p.id) ?? (this.all.set(p.id, p), p)
    );
    for (const p of items) {
      p.wx = p.lx + chunk.ox;
      p.wz = p.lz + chunk.oz;
      this.loaded.add(p.id);
      p.mesh = new THREE.Mesh(this.props.geometries[p.type], this.props.materials[p.type]);
      p.mesh.position.set(p.lx, chunk.heightAt(p.lx, p.lz), p.lz);
      p.mesh.rotation.y = p.rot;
      p.mesh.visible = !p.taken;
      chunk.group.add(p.mesh);
    }
    chunk.pickups = items;
  }

  unplaceChunk(chunk) {
    for (const p of chunk.pickups ?? []) {
      this.loaded.delete(p.id);
      p.mesh = null;
    }
  }

  rebase(dx, dz) {
    for (const p of this.all.values()) {
      p.wx -= dx;
      p.wz -= dz;
    }
  }

  // Closest untaken pickup in reach that the player is facing (same rule as task objects).
  target(player) {
    const G = CONFIG.game;
    const pos = player.position;
    let best = null;
    let bestD = G.interactRange;
    for (const id of this.loaded) {
      const p = this.all.get(id);
      if (p.taken) continue;
      const dx = p.wx - pos.x;
      const dz = p.wz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if (d > 0.3 && (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / d < G.interactFacingDot) continue;
      best = p;
      bestD = d;
    }
    return best;
  }

  get handsFull() {
    return this.bottles >= CONFIG.game.bottleMax;
  }

  // Returns 'bottle' or 'note' if something was picked up.
  take(p) {
    if (p.type === 'bottle') {
      if (this.handsFull) return null;
      this.bottles++;
      this.stats.bottlesFound++;
    } else {
      this.reading = this.nextNote(p);
      this.stats.notesRead++;
      if (!this.read.has(this.reading)) {
        this.read.add(this.reading);
        this.stats.newNotes++;
        save('notesRead', [...this.read]);
      }
    }
    p.taken = true;
    if (p.mesh) p.mesh.visible = false;
    return p.type;
  }

  // Lowest unread note; once all 15 are read, any note (fixed per pickup).
  nextNote(p) {
    for (let i = 0; i < NOTES.length; i++) if (!this.read.has(i)) return i;
    const ids = p.id.slice(1).split(',').map(Number);
    return mulberry32(hash(this.seed, NOTE_SALT + 1, ...ids))() * NOTES.length | 0;
  }

  drink() {
    if (this.bottles === 0) return false;
    this.bottles--;
    this.stats.bottlesDrunk++;
    return true;
  }
}
