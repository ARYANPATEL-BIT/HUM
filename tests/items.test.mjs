import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { generateChunk } from '../src/world/chunkGen.js';
import { taskObjectsForChunk } from '../src/world/taskObjects.js';
import { pickupsForChunk, Pickups } from '../src/world/pickups.js';
import { NOTES } from '../src/content/notes.js';
import { PlayerController } from '../src/player/controller.js';
import { loadSettings } from '../src/ui/settings.js';

// Phase 7 logic that runs without a browser: pickups, notes, stamina, steps/head bob, settings.
// (No localStorage in Node: storage falls back to defaults, which is also what a private window gets.)

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
const n = CONFIG.world.chunkCells;
const C = CONFIG.world.cellSize;

// 1. pickups: deterministic, off landmark cells, off task cells, inside the chunk
for (const seed of [1, 12345, 4242]) {
  let landmarkHits = 0, total = 0;
  for (let cz = -8; cz < 8; cz++) for (let cx = -8; cx < 8; cx++) {
    const data = generateChunk(seed, cx, cz);
    const taskCells = new Set(taskObjectsForChunk(seed, cx, cz, data.flags).map((t) => `${t.gx},${t.gz}`));
    const a = pickupsForChunk(seed, cx, cz, data, new Set(taskCells));
    const b = pickupsForChunk(seed, cx, cz, data, new Set(taskCells));
    check(JSON.stringify(a) === JSON.stringify(b), `pickups deterministic ${seed} ${cx},${cz}`);
    for (const p of a) {
      total++;
      const gx = Math.floor(p.lx / C), gz = Math.floor(p.lz / C);
      check(p.lx > 0 && p.lx < n * C && p.lz > 0 && p.lz < n * C, `pickup inside chunk ${p.id}`);
      if (!(cx === 0 && cz === 0)) check(!taskCells.has(`${gx},${gz}`), `pickup on a task cell ${p.id}`);
      if (data.flags[gz * n + gx]) landmarkHits++;
    }
  }
  // freeCell gives up after 20 tries; a pickup on a landmark cell should be very rare.
  check(landmarkHits <= total * 0.01, `pickups on landmark cells ${landmarkHits}/${total}`);
}

// 2. spawn chunk always has a note in front of the player, inside the spawn cell
for (const seed of [1, 2, 3, 12345, 99999]) {
  const data = generateChunk(seed, 0, 0);
  const notes = pickupsForChunk(seed, 0, 0, data, new Set()).filter((p) => p.type === 'note');
  check(notes.length === 1, `spawn note count seed ${seed}`);
  const [sx, sz] = CONFIG.world.spawnCell;
  const p = notes[0];
  check(Math.floor(p.lx / C) === sx && Math.floor(p.lz / C) === sz, `spawn note in spawn cell seed ${seed}`);
}

// 3. notes: 15, read in order, then repeats stay in range
check(NOTES.length === 15 && NOTES.every((x) => x.title && x.body), '15 notes with title and body');
{
  const pickups = new Pickups(7, { props: { geometries: {}, materials: {} } });
  const order = [];
  for (let i = 0; i < 20; i++) {
    pickups.take({ id: `n${i},0`, type: 'note', taken: false, mesh: null });
    order.push(pickups.reading);
  }
  check(order.slice(0, 15).join() === [...Array(15).keys()].join(), `notes read in order: ${order.slice(0, 15)}`);
  check(order.slice(15).every((i) => i >= 0 && i < 15), 'repeat notes in range');
  check(pickups.read.size === 15 && pickups.stats.newNotes === 15 && pickups.stats.notesRead === 20, 'note stats');

  for (let i = 0; i < 5; i++) pickups.take({ id: `b${i},0`, type: 'bottle', taken: false, mesh: null });
  check(pickups.bottles === CONFIG.game.bottleMax, 'bottles capped');
  check(pickups.drink() && pickups.bottles === CONFIG.game.bottleMax - 1, 'drink');
}

// 4. stamina, steps and head bob through the real controller
{
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  const keys = new Set(['KeyW', 'ShiftLeft']);
  const input = { isDown: (...c) => c.some((k) => keys.has(k)), consumeMouse: () => ({ dx: 0, dy: 0 }) };
  const collision = { move(pos, dx, dz) { pos.x += dx; pos.z += dz; } };
  const player = new PlayerController(camera, input, collision);
  player.spawn(0, 0, 0);
  const dt = 1 / 60;
  let t = 0, steps = 0;
  while (!player.exhausted && t < 30) { player.update(dt); t += dt; if (player.stepped) steps++; }
  const S = CONFIG.player.stamina;
  check(Math.abs(t - 1 / S.drain) < 0.6, `sprint lasts ~${(1 / S.drain).toFixed(1)} s (got ${t.toFixed(2)})`);
  const stride = player.distanceWalked / steps;
  check(stride > CONFIG.player.stride[0] - 0.1 && stride < CONFIG.player.stride[1] + 0.1, `stride ${stride.toFixed(2)} m`);
  player.update(dt);
  check(!player.sprinting, 'no sprint while exhausted');
  for (let i = 0; i < 120; i++) player.update(dt);
  check(player.exhausted, 'still exhausted during regen delay');
  player.refillStamina();
  player.update(dt);
  check(player.sprinting && player.stamina < 1, 'water refills stamina');

  // Bob: off -> camera exactly at eye height; on -> it moves.
  keys.delete('ShiftLeft');
  CONFIG.player.bob.enabled = false;
  let maxOff = 0;
  for (let i = 0; i < 120; i++) { player.update(dt); maxOff = Math.max(maxOff, Math.abs(camera.position.y - CONFIG.player.eyeHeight)); }
  check(maxOff < 1e-9, 'no bob when disabled');
  CONFIG.player.bob.enabled = true;
  maxOff = 0;
  for (let i = 0; i < 120; i++) { player.update(dt); maxOff = Math.max(maxOff, Math.abs(camera.position.y - CONFIG.player.eyeHeight)); }
  check(maxOff > CONFIG.player.bob.vertical * 0.5, `bob when walking (${maxOff.toFixed(3)})`);
  keys.clear();
  for (let i = 0; i < 240; i++) player.update(dt);
  check(Math.abs(camera.position.y - CONFIG.player.eyeHeight) < 0.002, 'bob settles when standing');

  // Frozen (reading a note): no movement.
  const before = player.position.clone();
  keys.add('KeyW');
  player.frozen = true;
  for (let i = 0; i < 60; i++) player.update(dt);
  check(player.position.distanceTo(before) < 1e-6, 'frozen player does not move');
}

// 5. settings: defaults without storage
{
  const s = loadSettings();
  check(s.preset === CONFIG.preset && s.sensitivity === 1 && s.headBob === true, 'settings defaults');
}

console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
