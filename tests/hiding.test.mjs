import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { mulberry32 } from '../src/core/rng.js';
import { generateChunk } from '../src/world/chunkGen.js';
import { ChunkManager } from '../src/world/chunkManager.js';
import { panelGeometry, chairGeometry, hidingGeometries } from '../src/world/assets.js';
import { CollisionWorld } from '../src/player/collision.js';
import { PlayerController } from '../src/player/controller.js';
import { Hiding } from '../src/player/hiding.js';
import { Entity } from '../src/entity/entity.js';
import { noiseEvents } from '../src/entity/noiseEvents.js';

// Hiding spots: placement, the entity's rules for a hidden player, and a chase simulation that measures
// how often hiding breaks a chase (the target is "about half the time").

globalThis.document = new EventTarget(); // entity-caught is dispatched on document
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
const n = CONFIG.world.chunkCells, C = CONFIG.world.cellSize, T = CONFIG.world.wallThickness;
const H = CONFIG.hiding;

// 1. placement
{
  let ordinary = 0, withSpots = 0, spots = 0;
  const types = { desk: 0, cupboard: 0 };
  for (const seed of [1, 12345, 4242]) {
    for (let cz = -15; cz < 15; cz++) for (let cx = -15; cx < 15; cx++) {
      const d = generateChunk(seed, cx, cz);
      check(JSON.stringify(d.hiding) === JSON.stringify(generateChunk(seed, cx, cz).hiding), `deterministic ${seed} ${cx},${cz}`);
      if (d.landmark) { check(d.hiding.length === 0, 'no spots in landmark chunks'); continue; }
      ordinary++;
      if (d.hiding.length) withSpots++;
      const cells = new Set();
      for (const s of d.hiding) {
        spots++; types[s.type]++;
        const nx = Math.round(Math.sin(s.yaw)), nz = Math.round(Math.cos(s.yaw));
        const gx = Math.floor(s.fx / C), gz = Math.floor(s.fz / C);
        const id = `${seed} ${cx},${cz} ${s.type}`;
        check(!cells.has(gz * n + gx), `one spot per cell ${id}`);
        cells.add(gz * n + gx);
        check(d.rooms.some((r) => gx >= r.x && gx < r.x + r.w && gz >= r.z && gz < r.z + r.h), `in a room ${id}`);
        const wall = nz === 1 ? d.h[gz * n + gx] : nz === -1 ? d.h[(gz + 1) * n + gx] : nx === 1 ? d.v[gx * n + gz] : d.v[(gx + 1) * n + gz];
        check(wall === 1, `back against a wall ${id}`);
        // Box inside its cell, clear of the walls around it.
        const x0 = gx * C + T / 2, x1 = (gx + 1) * C - T / 2, z0 = gz * C + T / 2, z1 = (gz + 1) * C - T / 2;
        check(s.x - s.hx >= x0 && s.x + s.hx <= x1 && s.z - s.hz >= z0 && s.z + s.hz <= z1, `inside its cell ${id}`);
        // Cell centre and the open edges' midpoints (task props, entity A* checks) clear by the entity
        // radius. The midpoint of the wall behind it is in the wall, blocked for A* anyway.
        const r = CONFIG.entity.radius;
        for (const [px, pz] of [[0.5, 0.5], [0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]]) {
          if (px === 0.5 - nx / 2 && pz === 0.5 - nz / 2) continue;
          const x = (gx + px) * C, z = (gz + pz) * C;
          check(!(Math.abs(x - s.x) < s.hx + r && Math.abs(z - s.z) < s.hz + r), `keeps cell point ${px},${pz} clear ${id}`);
        }
        // Cupboards stay off the middle of the wall edge, where keypad codes (1 m wide, eye height) go.
        if (s.type === 'cupboard') check(Math.abs(nx ? s.z - (gz + 0.5) * C : s.x - (gx + 0.5) * C) - H.cupboard.size[0] / 2 >= 0.5, `cupboard off the code spot ${id}`);
        // Front point: in the same cell, outside the box by more than the player radius.
        check(Math.abs(s.fx - s.x) - s.hx > CONFIG.player.radius || Math.abs(s.fz - s.z) - s.hz > CONFIG.player.radius, `front point outside the box ${id}`);
      }
    }
  }
  const rate = withSpots / ordinary;
  console.log(`placement: ${withSpots}/${ordinary} ordinary chunks have spots (1 in ${(1 / rate).toFixed(2)}), ${spots} spots`, types);
  check(rate > 0.28 && rate < 0.39, `about 1 in 3 chunks (${rate.toFixed(3)})`);
}

// World + actors for the behaviour tests.
const mat = new THREE.MeshBasicMaterial();
const assets = { materials: { wall: mat, floor: mat, ceiling: mat, panel: mat, chair: mat, water: mat, hiding: mat }, geometries: { panel: panelGeometry(), chair: chairGeometry(), ...hidingGeometries() } };
const seed = 4242;
const scene = new THREE.Scene();
const cm = new ChunkManager(scene, seed, assets);
const camera = new THREE.PerspectiveCamera();
camera.rotation.order = 'YXZ';
const keys = new Set();
const input = { isDown: (...c) => c.some((k) => keys.has(k)), consumeMouse: () => ({ dx: 0, dy: 0 }) };
const pathfinder = new Entity(scene, cm); // its A* plans the player's route
let caught = false;
document.addEventListener('entity-caught', () => { caught = true; });

// Spots (scene coords) in chunks around the origin.
const allSpots = [];
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
  for (const s of generateChunk(seed, cx, cz).hiding) allSpots.push({ ...s, x: s.x + cx * cm.size, z: s.z + cz * cm.size, fx: s.fx + cx * cm.size, fz: s.fz + cz * cm.size });
}
check(allSpots.length >= 4, `spots near the origin (${allSpots.length})`);

// Walkable cell centres with line of sight to (x, z) at a straight distance in [d0, d1].
function cellsAround(x, z, d0, d1) {
  const out = [];
  const g = Math.ceil(d1 / C);
  for (let dz = -g; dz <= g; dz++) for (let dx = -g; dx <= g; dx++) {
    const px = (Math.floor(x / C) + dx + 0.5) * C, pz = (Math.floor(z / C) + dz + 0.5) * C;
    const d = Math.hypot(px - x, pz - z);
    if (d >= d0 && d <= d1 && cm.hasLineOfSight(x, z, px, pz) && !pathfinder._solid(px, pz)) out.push([px, pz]);
  }
  return out;
}

// One run: the player walks/sprints from (px, pz) to the spot and holds C for `hold` seconds; the entity
// starts at (ex, ez) in `state`. Returns { hid, caught, caughtHidden, found, spotted, hiddenTime, lastState }.
function run({ spot, px, pz, ex, ez, state = 'chase', sprint = true, pressure = 0, hold = 15, maxTime = 60, hide = true }) {
  cm.preload({ x: spot.x, z: spot.z });
  const player = new PlayerController(camera, input, new CollisionWorld(cm), (x, z) => cm.groundAt(x, z));
  player.spawn(px, pz, 0);
  const entity = new Entity(scene, cm);
  entity.spawn(ex, ez);
  entity.position.set(ex, 0, ez);
  entity.state = state;
  if (state === 'chase') entity.lastSeen.set(px, 0, pz); // a chase starts from a sighting
  const hiding = new Hiding(cm);
  noiseEvents.flush();
  caught = false;
  const out = { hid: false, caught: false, caughtHidden: false, found: false, spotted: false, hiddenTime: 0 };
  const dt = 1 / 30;
  let path = [], pathT = 0;
  for (let t = 0; t < maxTime && !caught; t += dt) {
    if (!hiding.active) {
      const atFront = hiding.near(player.position) && Math.hypot(player.position.x - spot.fx, player.position.z - spot.fz) < 0.6;
      if (atFront && hide) {
        hiding.enter(spot, player, entity);
        out.hid = true;
        out.spotted = hiding.found;
      } else {
        if ((pathT -= dt) <= 0) { path = pathfinder._astar(player.position, new THREE.Vector3(spot.fx, 0, spot.fz)); pathT = 0.5; }
        while (path.length && Math.hypot(path[0].x - player.position.x, path[0].z - player.position.z) < 0.4) path.shift();
        const next = path[0] ?? { x: spot.fx, z: spot.fz };
        player.yaw = Math.atan2(-(next.x - player.position.x), -(next.z - player.position.z));
        keys.clear();
        if (!atFront) keys.add('KeyW');
        if (sprint) keys.add('ShiftLeft');
        player.update(dt);
        if (player.sprinting && player.speed > 2) noiseEvents.emit(player.position.x, player.position.z, CONFIG.entity.hearingRadius * 1.5);
      }
    } else {
      player.look();
      hiding.update(dt, player, camera);
      out.hiddenTime += dt;
      if (out.hiddenTime >= hold) break;
    }
    entity.update(dt, player.position, camera, pressure, noiseEvents, hiding);
    if (hiding.found) out.found = true;
  }
  out.caught = caught;
  out.caughtHidden = caught && hiding.active;
  out.lastState = entity.state;
  scene.remove(entity.mesh);
  return out;
}

const realRandom = Math.random;
const spot = allSpots[0];
// Player starts at the front point (hides on the first frame).
const atSpot = { spot, px: spot.fx, pz: spot.fz };

// 2. rules
{
  // a. Chasing and close when you hide: it saw you, it gets you.
  const near = cellsAround(spot.fx, spot.fz, 3, 5.5)[0];
  const a = run({ ...atSpot, ex: near[0], ez: near[1], hold: 10 });
  check(a.hid && a.spotted && a.caughtHidden, `spotted within ${H.spottedDist} m -> caught (${JSON.stringify(a)})`);

  // b/c. Chasing from further away: it goes to where it last saw you and rolls searchChance.
  const far = cellsAround(spot.fx, spot.fz, 8, 11)[0];
  Math.random = () => 0.999;
  const b = run({ ...atSpot, ex: far[0], ez: far[1], hold: 15 });
  check(b.hid && !b.spotted && !b.found && !b.caught && b.lastState !== 'chase', `roll fails -> it gives up (${JSON.stringify(b)})`);
  Math.random = () => 0;
  const c = run({ ...atSpot, ex: far[0], ez: far[1], hold: 15 });
  check(c.hid && !c.spotted && c.found && c.caughtHidden, `roll succeeds -> it checks the spot (${JSON.stringify(c)})`);
  Math.random = realRandom;

  // d. Not chasing, standing 6 m away: safe until the breathing starts, then it hears you.
  const wander = CONFIG.entity.wanderSpeed;
  CONFIG.entity.wanderSpeed = 0;
  const mid = cellsAround(spot.fx, spot.fz, 5.5, 7)[0];
  const d = run({ ...atSpot, ex: mid[0], ez: mid[1], state: 'wander', hold: 60 });
  check(d.hid && d.caughtHidden && d.hiddenTime > H.breathAfter, `breathing gives you away after ${H.breathAfter} s (caught at ${d.hiddenTime.toFixed(1)} s hidden)`);
  CONFIG.entity.wanderSpeed = wander;

  // e. Baseline: standing in the open while chased from 8–11 m gets you caught.
  const e = run({ ...atSpot, ex: far[0], ez: far[1], hide: false, maxTime: 15 });
  check(e.caught, 'chased in the open -> caught');
}

// 3. Chase simulation: the entity is chasing from 6–12 m (line of sight); the player runs to a spot
// 6–24 m away (sprinting, or walking as if carrying the cassette) and hides for 15 s. Seeded.
{
  Math.random = mulberry32(777);
  const stats = { trials: 0, caughtBeforeHiding: 0, neverArrived: 0, escaped: 0, spotted: 0, searched: 0 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  while (stats.trials < 160) {
    const s = pick(allSpots);
    const start = pick(cellsAround(s.fx, s.fz, 6, 24));
    if (!start) continue;
    const ent = pick(cellsAround(start[0], start[1], 6, 12));
    if (!ent) continue;
    stats.trials++;
    const r = run({ spot: s, px: start[0], pz: start[1], ex: ent[0], ez: ent[1], sprint: Math.random() < 0.7, pressure: rnd(0, 1), hold: 15, maxTime: 40 });
    if (!r.hid) { stats[r.caught ? 'caughtBeforeHiding' : 'neverArrived']++; continue; }
    if (r.spotted) stats.spotted++;
    else if (r.found) stats.searched++;
    else if (!r.caught) stats.escaped++;
  }
  Math.random = realRandom;
  const hid = stats.trials - stats.caughtBeforeHiding - stats.neverArrived;
  const rate = stats.escaped / hid;
  console.log(`chase sim: ${JSON.stringify(stats)} -> hiding worked ${stats.escaped}/${hid} = ${(100 * rate).toFixed(0)}%`);
  check(rate > 0.3 && rate < 0.7, `hiding works about half the time (${(100 * rate).toFixed(0)}%)`);
}

console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
