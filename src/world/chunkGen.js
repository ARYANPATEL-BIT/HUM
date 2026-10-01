import { CONFIG } from '../config.js';
import { hash, mulberry32, randInt, shuffle } from '../core/rng.js';

// Pure chunk layout generation: (seed, cx, cz) -> plain data. No three.js here, so it's
// cheap to regenerate, deterministic on revisit, and testable in Node.
//
// Walls live on grid lines. With n = cells per side:
//   h[z * n + x]  wall along X on line z (0..n), above cell (x, z)
//   v[x * n + z]  wall along Z on line x (0..n), left of cell (x, z)
// Lines 0 and n are chunk seams. Line 0 is built by this chunk, line n by the neighbour,
// but both chunks compute both from the same edge hash so they always agree.

const SALT = { CHUNK: 1, EDGE_H: 2, EDGE_V: 3, LANDMARK: 4 };
export const LANDMARK_TYPES = ['flooded', 'chairs', 'redLight', 'stairs'];
export const CELL_NO_FLOOR = 1;
export const CELL_TALL = 2;

const LOCKED = 1; // landmark perimeter: repair avoids opening it
const FORBIDDEN = 2; // never opened (e.g. the wall the stairs run along)

// Openings on one shared chunk edge. axis 'h' = the line z = cz*n, 'v' = the line x = cx*n.
export function edgeOpenings(seed, axis, cx, cz) {
  const n = CONFIG.world.chunkCells;
  const rng = mulberry32(hash(seed, axis === 'h' ? SALT.EDGE_H : SALT.EDGE_V, cx, cz));
  const [min, max] = CONFIG.world.edgeOpenings;
  const slots = shuffle(rng, [...Array(n).keys()]);
  const open = new Uint8Array(n);
  const count = randInt(rng, min, max);
  for (let i = 0; i < count; i++) open[slots[i]] = 1;
  return open;
}

export function landmarkType(seed, cx, cz) {
  if (cx === 0 && cz === 0) return null; // the spawn chunk is always ordinary
  const rng = mulberry32(hash(seed, SALT.LANDMARK, cx, cz));
  if (rng() >= CONFIG.landmarks.chance) return null;
  return LANDMARK_TYPES[Math.floor(rng() * LANDMARK_TYPES.length)];
}

export function generateChunk(seed, cx, cz) {
  const W = CONFIG.world;
  const n = W.chunkCells;
  const C = W.cellSize;
  const rng = mulberry32(hash(seed, SALT.CHUNK, cx, cz));

  const h = new Uint8Array((n + 1) * n).fill(1);
  const v = new Uint8Array((n + 1) * n).fill(1);
  const hLock = new Uint8Array(h.length);
  const vLock = new Uint8Array(v.length);
  const flags = new Uint8Array(n * n);

  // --- seams, shared with neighbours ---
  const north = edgeOpenings(seed, 'h', cx, cz);
  const south = edgeOpenings(seed, 'h', cx, cz + 1);
  const west = edgeOpenings(seed, 'v', cx, cz);
  const east = edgeOpenings(seed, 'v', cx + 1, cz);
  for (let i = 0; i < n; i++) {
    h[i] = north[i] ? 0 : 1;
    h[n * n + i] = south[i] ? 0 : 1;
    v[i] = west[i] ? 0 : 1;
    v[n * n + i] = east[i] ? 0 : 1;
  }

  // Interior edge between two orthogonally adjacent cells, as [array, index, lockArray].
  const edgeBetween = (x0, z0, x1, z1) =>
    x0 === x1 ? [h, Math.max(z0, z1) * n + x0, hLock] : [v, Math.max(x0, x1) * n + z0, vLock];
  const neighbours = (x, z) => {
    const out = [];
    if (x > 0) out.push([x - 1, z]);
    if (x < n - 1) out.push([x + 1, z]);
    if (z > 0) out.push([x, z - 1]);
    if (z < n - 1) out.push([x, z + 1]);
    return out;
  };

  // --- 1. recursive backtracker (iterative) => spanning tree, every cell reachable ---
  const visited = new Uint8Array(n * n);
  const stack = [[randInt(rng, 0, n - 1), randInt(rng, 0, n - 1)]];
  visited[stack[0][1] * n + stack[0][0]] = 1;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const options = neighbours(x, z).filter(([a, b]) => !visited[b * n + a]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nx, nz] = options[Math.floor(rng() * options.length)];
    const [arr, i] = edgeBetween(x, z, nx, nz);
    arr[i] = 0;
    visited[nz * n + nx] = 1;
    stack.push([nx, nz]);
  }

  // --- 2. knock out extra walls so it loops like office space, not a corridor maze ---
  for (let line = 1; line < n; line++) {
    for (let i = 0; i < n; i++) {
      if (h[line * n + i] && rng() < W.extraWallRemoval) h[line * n + i] = 0;
      if (v[line * n + i] && rng() < W.extraWallRemoval) v[line * n + i] = 0;
    }
  }

  const clearRect = (r) => {
    for (let z = r.z; z < r.z + r.h; z++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x + 1 < r.x + r.w) v[(x + 1) * n + z] = 0;
        if (z + 1 < r.z + r.h) h[(z + 1) * n + x] = 0;
      }
    }
  };

  // --- 3. rooms or a landmark ---
  const rooms = [];
  const type = landmarkType(seed, cx, cz);
  let landmark = null;
  if (type) {
    landmark = placeLandmark(type, rng, { n, C, h, v, hLock, vLock, flags, clearRect });
    rooms.push({ ...landmark.rect, pillars: type === 'flooded' });
  } else {
    const count = randInt(rng, ...W.roomsPerChunk);
    for (let i = 0; i < count; i++) {
      const w = randInt(rng, ...W.roomSize);
      const d = randInt(rng, ...W.roomSize);
      const r = { x: randInt(rng, 0, n - w), z: randInt(rng, 0, n - d), w, h: d, pillars: true };
      clearRect(r);
      rooms.push(r);
    }
  }

  // --- 4. connectivity repair: anything the edits cut off gets a doorway back ---
  repairConnectivity(rng, n, flags, edgeBetween, neighbours);

  // --- 5. pillars at interior grid vertices of big rooms ---
  const pillars = [];
  for (const r of rooms) {
    if (!r.pillars || r.w < W.pillarMinRoomSize || r.h < W.pillarMinRoomSize) continue;
    for (let px = r.x + W.pillarSpacing; px < r.x + r.w; px += W.pillarSpacing) {
      for (let pz = r.z + W.pillarSpacing; pz < r.z + r.h; pz += W.pillarSpacing) {
        pillars.push([px, pz]);
      }
    }
  }

  // --- 6. ceiling light panels every panelSpacing cells (odd cells => centred in 8) ---
  const panels = [];
  const s = W.panelSpacing;
  for (let z = s >> 1; z < n; z += s) {
    for (let x = s >> 1; x < n; x += s) {
      panels.push({ x: (x + 0.5) * C, z: (z + 0.5) * C, cell: [x, z], kind: 'normal' });
    }
  }
  if (landmark?.type === 'redLight') applyRedLight(landmark.rect, panels, C);

  return { seed, cx, cz, n, h, v, flags, pillars, panels, landmark, rooms };
}

function repairConnectivity(rng, n, flags, edgeBetween, neighbours) {
  const reached = new Uint8Array(n * n);
  const flood = (sx, sz) => {
    const q = [[sx, sz]];
    reached[sz * n + sx] = 1;
    while (q.length) {
      const [x, z] = q.pop();
      for (const [a, b] of neighbours(x, z)) {
        if (reached[b * n + a]) continue;
        const [arr, i] = edgeBetween(x, z, a, b);
        if (arr[i]) continue;
        reached[b * n + a] = 1;
        q.push([a, b]);
      }
    }
  };
  flood(0, 0);
  for (;;) {
    // All walls between reached and unreached cells, preferring unlocked ones.
    const free = [];
    const locked = [];
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        if (!reached[z * n + x]) continue;
        for (const [a, b] of neighbours(x, z)) {
          if (reached[b * n + a]) continue;
          const e = edgeBetween(x, z, a, b);
          const lock = e[2][e[1]];
          if (lock === FORBIDDEN) continue;
          (lock === LOCKED ? locked : free).push([e, a, b]);
        }
      }
    }
    const pool = free.length ? free : locked;
    if (!pool.length) break; // everything reachable (or only forbidden walls left)
    const [[arr, i], a, b] = pool[Math.floor(rng() * pool.length)];
    arr[i] = 0;
    flood(a, b);
  }
}

// Perimeter edges of a rect: { arr, i, lockArr, side, along } where along = cell index on that side.
function perimeterEdges(r, n, h, v, hLock, vLock) {
  const edges = [];
  for (let x = r.x; x < r.x + r.w; x++) {
    edges.push({ arr: h, lock: hLock, i: r.z * n + x, side: 'n', along: x });
    edges.push({ arr: h, lock: hLock, i: (r.z + r.h) * n + x, side: 's', along: x });
  }
  for (let z = r.z; z < r.z + r.h; z++) {
    edges.push({ arr: v, lock: vLock, i: r.x * n + z, side: 'w', along: z });
    edges.push({ arr: v, lock: vLock, i: (r.x + r.w) * n + z, side: 'e', along: z });
  }
  return edges;
}

function placeLandmark(type, rng, ctx) {
  const { n, C, h, v, hLock, vLock, flags, clearRect } = ctx;
  const L = CONFIG.landmarks;
  const spec = L[type];
  const [w, d] = type === 'stairs' ? spec.size : [randInt(rng, ...spec.size), randInt(rng, ...spec.size)];
  // Strictly inside the chunk (1 cell margin) so the room never sits on a seam.
  const rect = { x: randInt(rng, 1, n - 1 - w), z: randInt(rng, 1, n - 1 - d), w, h: d };
  clearRect(rect);

  const landmark = { type, rect };
  const edges = perimeterEdges(rect, n, h, v, hLock, vLock);
  for (const e of edges) {
    e.arr[e.i] = 1;
    e.lock[e.i] = LOCKED;
  }

  for (let z = rect.z; z < rect.z + rect.h; z++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (type === 'flooded') flags[z * n + x] |= CELL_NO_FLOOR;
      if (type === 'stairs') flags[z * n + x] |= CELL_TALL;
    }
  }

  if (type === 'flooded') {
    landmark.water = {
      x0: rect.x * C,
      z0: rect.z * C,
      x1: (rect.x + rect.w) * C,
      z1: (rect.z + rect.h) * C,
      y: spec.waterLevel,
    };
  } else if (type === 'stairs') {
    // Stairs hug the west wall and climb +Z until they die against the south wall.
    const zEnd = (rect.z + rect.h) * C;
    const zStart = zEnd - spec.steps * spec.run;
    landmark.stairs = {
      x0: rect.x * C,
      x1: rect.x * C + spec.width,
      zStart,
      zEnd,
      steps: spec.steps,
      rise: spec.rise,
      run: spec.run,
    };
    const firstBlockedCell = Math.floor(zStart / C);
    for (const e of edges) {
      const alongsideStairs = e.side === 'w' && e.along >= firstBlockedCell;
      const atStairTop = e.side === 's' && e.along === rect.x;
      if (alongsideStairs || atStairTop) e.lock[e.i] = FORBIDDEN;
    }
  } else if (type === 'chairs') {
    landmark.piles = placeChairPiles(rng, rect, C);
  }

  const candidates = shuffle(rng, edges.filter((e) => e.lock[e.i] !== FORBIDDEN));
  for (let k = 0; k < L.doorways && k < candidates.length; k++) candidates[k].arr[candidates[k].i] = 0;

  return landmark;
}

function placeChairPiles(rng, rect, C) {
  const S = CONFIG.landmarks.chairs;
  const x0 = rect.x * C + S.wallMargin;
  const z0 = rect.z * C + S.wallMargin;
  const x1 = (rect.x + rect.w) * C - S.wallMargin;
  const z1 = (rect.z + rect.h) * C - S.wallMargin;
  const target = Math.round(rect.w * rect.h * S.pilesPerCell);
  const piles = [];
  // Rejection sampling with a minimum spacing so there are always gaps to squeeze through.
  for (let tries = 0; tries < target * 20 && piles.length < target; tries++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    if (piles.some((p) => Math.hypot(p.x - x, p.z - z) < S.pileSpacing)) continue;
    const chairs = [];
    const count = randInt(rng, 1, S.maxStack);
    for (let k = 0; k < count; k++) {
      chairs.push({
        yaw: rng() * Math.PI * 2,
        tiltX: (rng() * 2 - 1) * S.maxTilt,
        tiltZ: (rng() * 2 - 1) * S.maxTilt,
      });
    }
    piles.push({ x, z, chairs });
  }
  return piles;
}

// Red room: one red panel nearest the room centre, every other panel inside it dead.
function applyRedLight(rect, panels, C) {
  const cx = (rect.x + rect.w / 2) * C;
  const cz = (rect.z + rect.h / 2) * C;
  let best = null;
  for (const p of panels) {
    const [x, z] = p.cell;
    if (x < rect.x || x >= rect.x + rect.w || z < rect.z || z >= rect.z + rect.h) continue;
    p.kind = 'dead';
    if (!best || Math.hypot(p.x - cx, p.z - cz) < Math.hypot(best.x - cx, best.z - cz)) best = p;
  }
  if (best) best.kind = 'red';
}

// Ground height inside a chunk (local meters). Only the stairs landmark isn't flat.
export function chunkHeightAt(data, lx, lz) {
  const s = data.landmark?.stairs;
  if (!s || lx < s.x0 || lx > s.x1 || lz < s.zStart || lz > s.zEnd) return 0;
  const step = Math.min(s.steps, Math.floor((lz - s.zStart) / s.run) + 1);
  return step * s.rise;
}
