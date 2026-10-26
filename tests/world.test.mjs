import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { generateChunk, landmarkType } from '../src/world/chunkGen.js';
import { ChunkManager } from '../src/world/chunkManager.js';
import { CollisionWorld } from '../src/player/collision.js';
import { panelGeometry, chairGeometry, hidingGeometries } from '../src/world/assets.js';

const seed = 12345;
const n = CONFIG.world.chunkCells;
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

// 1. determinism
const a = generateChunk(seed, 7, -3), b = generateChunk(seed, 7, -3);
check(a.h.join() === b.h.join() && a.v.join() === b.v.join() && JSON.stringify(a.landmark) === JSON.stringify(b.landmark), 'determinism');

// 2. seams agree + openings in range
const R = 12;
const cache = new Map();
const get = (cx, cz) => { const k = cx + ',' + cz; if (!cache.has(k)) cache.set(k, generateChunk(seed, cx, cz)); return cache.get(k); };
for (let cz = -R; cz < R; cz++) for (let cx = -R; cx < R; cx++) {
  const c = get(cx, cz), e = get(cx + 1, cz), s = get(cx, cz + 1);
  let openE = 0, openS = 0;
  for (let i = 0; i < n; i++) {
    check(c.v[n * n + i] === e.v[i], `seam E ${cx},${cz}`);
    check(c.h[n * n + i] === s.h[i], `seam S ${cx},${cz}`);
    openE += !c.v[n * n + i]; openS += !c.h[n * n + i];
  }
  check(openE >= 1 && openE <= 3 && openS >= 1 && openS <= 3, `opening count ${cx},${cz}`);
}

// 3. global connectivity over a (2R)^2 chunk region, flood from one cell
const N = 2 * R * n, off = R * n;
const cellOpen = (gx, gz, dx, dz) => {
  // is the edge from global cell (gx,gz) to (gx+dx,gz+dz) open?
  const tx = Math.min(gx, gx + dx), tz = Math.min(gz, gz + dz);
  if (dx) { const line = gx + Math.max(dx, 0); const cx = Math.floor(line / n); const c = get(cx, Math.floor(gz / n)); return !c.v[(line - cx * n) * n + (gz - Math.floor(gz / n) * n)]; }
  const line = gz + Math.max(dz, 0); const cz = Math.floor(line / n); const c = get(Math.floor(gx / n), cz); return !c.h[(line - cz * n) * n + (gx - Math.floor(gx / n) * n)];
};
const seen = new Uint8Array(N * N); const q = [[0, 0]]; seen[off * N + off] = 1; let count = 1;
while (q.length) {
  const [x, z] = q.pop();
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = x + dx, nz = z + dz;
    if (nx < -off || nz < -off || nx >= off || nz >= off) continue;
    const i = (nz + off) * N + nx + off;
    if (seen[i] || !cellOpen(x, z, dx, dz)) continue;
    seen[i] = 1; count++; q.push([nx, nz]);
  }
}
// Region border may cut some pockets whose only exit leaves the region, so allow a tiny margin
console.log(`connectivity: ${count}/${N * N} cells reachable (${(100 * count / (N * N)).toFixed(2)}%)`);
check(count / (N * N) > 0.995, 'connectivity');
// intra-chunk: every chunk's cells all reachable internally
let intraBad = 0;
for (const c of cache.values()) {
  const r = new Uint8Array(n * n); const st = [[0, 0]]; r[0] = 1; let k = 1;
  while (st.length) { const [x, z] = st.pop();
    const nb = [[x+1,z, c.v[(x+1)*n+z]],[x-1,z, c.v[x*n+z]],[x,z+1, c.h[(z+1)*n+x]],[x,z-1, c.h[z*n+x]]];
    for (const [a2, b2, w] of nb) { if (a2<0||b2<0||a2>=n||b2>=n||w||r[b2*n+a2]) continue; r[b2*n+a2]=1; k++; st.push([a2,b2]); } }
  if (k !== n * n) intraBad++;
}
check(intraBad === 0, `intra-chunk connectivity (${intraBad} bad)`);

// 4. landmark frequency and wall density
const types = {}; let lm = 0, total = 0, walls = 0;
for (let cz = -40; cz < 40; cz++) for (let cx = -40; cx < 40; cx++) { total++; const t = landmarkType(seed, cx, cz); if (t) { lm++; types[t] = (types[t] || 0) + 1; } }
for (const c of cache.values()) for (let l = 1; l < n; l++) for (let i = 0; i < n; i++) walls += c.h[l*n+i] + c.v[l*n+i];
console.log(`landmarks: ${lm}/${total} = 1 in ${(total / lm).toFixed(1)}`, types);
console.log(`interior wall density: ${(100 * walls / (cache.size * 2 * (n - 1) * n)).toFixed(1)}% of interior edges`);

// 5. streaming + memory: walk 2 km in a straight line, count live geometries/instanced meshes
const mat = new THREE.MeshBasicMaterial();
const assets = { materials: { wall: mat, floor: mat, ceiling: mat, panel: mat, chair: mat, water: mat, hiding: mat }, geometries: { panel: panelGeometry(), chair: chairGeometry(), ...hidingGeometries() } };
const scene = new THREE.Scene();
const cm = new ChunkManager(scene, seed, assets);
let live = 0;
const origAdd = scene.add.bind(scene);
scene.add = (obj) => { obj.traverse((o) => { const g = o.isInstancedMesh ? o : o.geometry; if (!g || g === assets.geometries.panel || g === assets.geometries.chair) return; live++; g.addEventListener('dispose', () => live--); }); return origAdd(obj); };
const pos = { x: 14, z: 14 };
cm.preload(pos);
let rebased = 0; cm.onRebase(() => rebased++);
const samples = []; let maxLoaded = 0, frames = 0, walked = 0;
const dir = [Math.cos(0.3), Math.sin(0.3)], speed = 25, dt = 1 / 60;
while (walked < 2000) {
  pos.x += dir[0] * speed * dt; pos.z += dir[1] * speed * dt; walked += speed * dt; frames++;
  cm.update(pos);
  maxLoaded = Math.max(maxLoaded, cm.loadedCount);
  if (frames % 600 === 0) samples.push(`${walked.toFixed(0)}m: loaded=${cm.loadedCount} liveGeo=${live} children=${scene.children.length}`);
  // every needed chunk within radius-1 must always be loaded (the one being walked into is built early)
  const [pcx, pcz] = cm.chunkAt(pos.x, pos.z);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!cm.get(pcx + dx, pcz + dz)) { check(false, `missing near chunk at ${walked.toFixed(0)}m`); }
}
samples.forEach((s) => console.log('  ' + s));
console.log(`max loaded ${maxLoaded}, rebases ${rebased}, built ${cm.stats.built}, unloaded ${cm.stats.unloaded}`);
check(rebased >= 1, 'rebase happened');

// 6. collision against streamed walls: circle never ends inside a box after random moves
const col = new CollisionWorld(cm);
const p = { x: pos.x, z: pos.z }; let inside = 0;
// start at a cell centre (not in a pillar)
const C = CONFIG.world.cellSize; p.x = Math.floor(p.x / C) * C + C / 2; p.z = Math.floor(p.z / C) * C + C / 2;
let rs = 1; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 20000; i++) {
  col.move(p, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, 0.3);
  for (const b of cm.query(p.x, p.z, 0.3, [])) {
    const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    if (Math.hypot(p.x - cx, p.z - cz) < 0.3 - 1e-3) inside++;
  }
}
console.log(`collision random walk: ${inside} penetrations, ended at chunk ${cm.chunkAt(p.x, p.z)}`);
check(inside === 0, 'collision penetration');

// 7. build timing
const t0 = performance.now(); for (let i = 0; i < 50; i++) { const c = cm.load(100 + i, 100); } const t1 = performance.now();
console.log(`avg generate+build per chunk: ${((t1 - t0) / 50).toFixed(2)} ms`);

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASSED');
