import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { ChunkManager } from '../src/world/chunkManager.js';
import { panelGeometry, chairGeometry, hidingGeometries } from '../src/world/assets.js';
import { Recap } from '../src/ui/recap.js';

// Recap recorder: sample rate, flat number arrays, world coordinates that survive floating-origin rebases.

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

const mat = new THREE.MeshBasicMaterial();
const assets = { materials: { wall: mat, floor: mat, ceiling: mat, panel: mat, chair: mat, water: mat, hiding: mat }, geometries: { panel: panelGeometry(), chair: chairGeometry(), ...hidingGeometries() } };
const cm = new ChunkManager(new THREE.Scene(), 4242, assets);
const pos = new THREE.Vector3(14, 0, 14);
cm.preload(pos);
let rebases = 0;
cm.onRebase(() => rebases++);

const recap = new Recap(cm);
// The entity follows 3 m behind; it only comes out after 10 s, like the real spawn delay.
const entity = { enabled: false, position: new THREE.Vector3() };
cm.onRebase((dx, dz) => { entity.position.x -= dx; entity.position.z -= dz; });
const dir = [Math.cos(0.3), Math.sin(0.3)];
const speed = 25, dt = 1 / 60;
let t = 0;
while (t < 1500 / speed) {
  pos.x += dir[0] * speed * dt;
  pos.z += dir[1] * speed * dt;
  t += dt;
  cm.update(pos);
  entity.enabled = t > 10;
  entity.position.set(pos.x - dir[0] * 3, 0, pos.z - dir[1] * 3);
  recap.update(dt, pos, entity);
}

const P = recap.player, E = recap.entity;
const expected = Math.floor(t / CONFIG.recap.interval) + 1; // + the sample at t = 0
check(rebases >= 1, 'a rebase happened during the walk');
check(Array.isArray(P) && Array.isArray(E), 'plain arrays');
check(P.every((v) => typeof v === 'number') && E.every((v) => typeof v === 'number'), 'flat numbers, no objects');
check(Math.abs(P.length / 2 - expected) <= 1, `sample count ${P.length / 2} vs ${expected}`);
check(E.length === P.length, 'entity samples aligned with player samples');
check(Number.isNaN(E[0]) && !Number.isNaN(E[E.length - 1]), 'entity NaN before it is out, numbers after');

// Every step between samples is speed × interval in world meters, rebase or not.
const step = speed * CONFIG.recap.interval;
let worst = 0;
for (let i = 2; i < P.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(P[i] - P[i - 2], P[i + 1] - P[i - 1]) - step));
check(worst < 0.5, `player path continuous across rebases (worst step error ${worst.toFixed(3)} m)`);
let gap = 0;
for (let i = 0; i < P.length; i += 2) if (!Number.isNaN(E[i])) gap = Math.max(gap, Math.abs(Math.hypot(P[i] - E[i], P[i + 1] - E[i + 1]) - 3));
check(gap < 1e-6, `entity stays 3 m behind in world coords (error ${gap.toExponential(1)})`);
const end = Math.hypot(P[P.length - 2] - 14, P[P.length - 1] - 14);
check(Math.abs(end - speed * t) < step, `world end point ${end.toFixed(0)} m from the start (walked ${(speed * t).toFixed(0)} m)`);

// Visited chunks: every chunk the straight line crossed at a sample, as global chunk indices.
const visited = recap.visited();
check(visited.some(([cx, cz]) => cx === 0 && cz === 0), 'spawn chunk visited');
const [lcx, lcz] = cm.chunkAt(pos.x, pos.z);
check(visited.some(([cx, cz]) => cx === lcx && cz === lcz), 'final chunk visited (global index)');
console.log(`recap: ${P.length / 2} samples, ${visited.length} chunks visited, ${rebases} rebase(s)`);

// Task markers are stored in world meters too.
recap.mark('radio', pos);
const m = recap.tasks[0];
check(Math.abs(m.x - P[P.length - 2]) < step && Math.abs(m.z - P[P.length - 1]) < step, 'task marker in world coords');

console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
