import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { hash, mulberry32 } from '../core/rng.js';
import { CELL_NO_FLOOR, CELL_TALL, chunkHeightAt } from './chunkGen.js';
import { GeoBuilder } from './geoBuilder.js';

// Turns chunk layout data into meshes (chunk-local coords) + collision boxes.
// Draw calls per chunk: walls, floor, ceiling, panels (+ water or chairs in some landmarks).

const BUILD_SALT = 5;
const TINT_SALT = 6;
const _obj = new THREE.Object3D();
const _col = new THREE.Color();

export function buildChunk(data, assets) {
  const W = CONFIG.world;
  const { n, h, v, flags } = data;
  const C = W.cellSize;
  const H = W.wallHeight;
  const T = W.wallThickness;
  const tall = CONFIG.landmarks.stairs.ceiling;
  const rng = mulberry32(hash(data.seed, BUILD_SALT, data.cx, data.cz));
  const tex = CONFIG.textures;
  const [wallTexW, wallTexH] = tex.wallpaper.meters;

  const walls = new GeoBuilder();
  const floor = new GeoBuilder(true);
  const ceiling = new GeoBuilder();
  const colliders = [];
  const water = data.landmark?.water;

  const flagAt = (x, z) => (x < 0 || z < 0 || x >= n || z >= n ? 0 : flags[z * n + x]);
  // Is this box inside the flooded room? Then it also gets a mirrored copy below the water.
  const inWater = (x0, z0, x1, z1) =>
    water && x1 > water.x0 - T && x0 < water.x1 + T && z1 > water.z0 - T && z0 < water.z1 + T;

  function addBox(x0, z0, x1, z1, y0, y1, collide, uOffset) {
    walls.boxSides(x0, z0, x1, z1, y0, y1, wallTexW, wallTexH, uOffset);
    if (collide) colliders.push({ minX: x0, minZ: z0, maxX: x1, maxZ: z1 });
    if (y0 === 0 && inWater(x0, z0, x1, z1)) {
      walls.boxSides(x0, z0, x1, z1, -y1, 0, wallTexW, wallTexH, uOffset, true);
    }
  }

  // --- walls: merge consecutive edges on a line into one run; this chunk owns lines 0..n-1 ---
  // A wall is tall if either neighbouring cell is tall. An open edge between a tall and a normal
  // cell (a doorway into the tall room) gets a header filling the gap above the doorway.
  const sides = (axis, line, i) =>
    axis === 'h' ? [flagAt(i, line - 1), flagAt(i, line)] : [flagAt(line - 1, i), flagAt(line, i)];
  const edgeTall = (axis, line, i) => {
    const [a, b] = sides(axis, line, i);
    return (a | b) & CELL_TALL;
  };
  const needsHeader = (axis, line, i) => {
    const [a, b] = sides(axis, line, i);
    return (a ^ b) & CELL_TALL;
  };

  for (const axis of ['h', 'v']) {
    const arr = axis === 'h' ? h : v;
    for (let line = 0; line < n; line++) {
      let i = 0;
      while (i < n) {
        const isTall = edgeTall(axis, line, i);
        if (!arr[line * n + i]) {
          if (needsHeader(axis, line, i)) emitRun(axis, line, i, i + 1, H, tall, false); // doorway header
          i++;
          continue;
        }
        let j = i + 1;
        while (j < n && arr[line * n + j] && edgeTall(axis, line, j) === isTall) j++;
        emitRun(axis, line, i, j, 0, isTall ? tall : H, true);
        i = j;
      }
    }
  }

  function emitRun(axis, line, from, to, y0, y1, collide) {
    // Extend half a thickness past each end so runs meeting at a corner close the gap.
    const a = from * C - T / 2;
    const b = to * C + T / 2;
    const l = line * C;
    const uOffset = rng() * wallTexW; // random wallpaper phase hides the texture repeat
    if (axis === 'h') addBox(a, l - T / 2, b, l + T / 2, y0, y1, collide, uOffset);
    else addBox(l - T / 2, a, l + T / 2, b, y0, y1, collide, uOffset);
  }

  const ps = W.pillarSize / 2;
  for (const [px, pz] of data.pillars) {
    addBox(px * C - ps, pz * C - ps, px * C + ps, pz * C + ps, 0, H, true, rng() * wallTexW);
  }

  // --- floor & ceiling, one quad per cell ---
  // Carpet tint is hashed per *global* grid vertex, so it blends smoothly across cells and seams.
  const ft = W.floorTint;
  const floorTint = (lx, lz) => {
    const gx = data.cx * n + Math.round(lx / C);
    const gz = data.cz * n + Math.round(lz / C);
    const r = mulberry32(hash(data.seed, TINT_SALT, gx, gz));
    let k = 1 - r() * ft.variation;
    if (r() < ft.dampChance) k *= 1 - ft.dampDarken;
    return [k, k * 0.98, k * 0.95];
  };
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const f = flags[z * n + x];
      const x0 = x * C;
      const z0 = z * C;
      if (!(f & CELL_NO_FLOOR)) {
        floor.hquad(x0, z0, x0 + C, z0 + C, 0, true, tex.carpet.meters, floorTint);
      } else {
        // Flooded: reflected ceiling below the water surface.
        ceiling.hquad(x0, z0, x0 + C, z0 + C, -H, true, tex.ceiling.meters);
      }
      ceiling.hquad(x0, z0, x0 + C, z0 + C, f & CELL_TALL ? tall : H, false, tex.ceiling.meters);
    }
  }

  const stairs = data.landmark?.stairs;
  if (stairs) buildStairs(stairs, floor, colliders, tex.carpet.meters);

  // --- assemble meshes ---
  const group = new THREE.Group();
  const M = assets.materials;
  const owned = []; // geometries this chunk must dispose
  const addMesh = (builder, mat) => {
    if (builder.empty) return;
    const geo = builder.build();
    owned.push(geo);
    group.add(new THREE.Mesh(geo, mat));
  };
  addMesh(walls, M.wall);
  addMesh(floor, M.floor);
  addMesh(ceiling, M.ceiling);

  const panels = buildPanels(data, assets, water, tall);
  group.add(panels);

  if (water) {
    const geo = new THREE.PlaneGeometry(water.x1 - water.x0, water.z1 - water.z0).rotateX(-Math.PI / 2);
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, M.water);
    mesh.position.set((water.x0 + water.x1) / 2, water.y, (water.z0 + water.z1) / 2);
    group.add(mesh);
  }

  let chairs = null;
  if (data.landmark?.piles) {
    chairs = buildChairs(data.landmark.piles, assets);
    group.add(chairs);
    const r = CONFIG.landmarks.chairs.pileRadius;
    for (const p of data.landmark.piles) colliders.push({ minX: p.x - r, minZ: p.z - r, maxX: p.x + r, maxZ: p.z + r });
  }

  return {
    group,
    colliders,
    panels: data.panels,
    heightAt: (lx, lz) => chunkHeightAt(data, lx, lz),
    dispose() {
      owned.forEach((g) => g.dispose());
      panels.dispose(); // frees instance buffers; the shared panel geometry stays
      chairs?.dispose();
    },
  };
}

function buildStairs(s, floor, colliders, texMeters) {
  const tint = CONFIG.landmarks.stairs.tint;
  const width = s.x1 - s.x0;
  for (let i = 0; i < s.steps; i++) {
    const z0 = s.zStart + i * s.run;
    const z1 = z0 + s.run;
    const y0 = i * s.rise;
    const y1 = y0 + s.rise;
    floor.hquad(s.x0, z0, s.x1, z1, y1, true, texMeters, tint); // tread
    // Riser (faces -Z) and the open side (faces +X), UVs in meters like the tread.
    floor.vquad(s.x1, z0, -width, 0, y0, y1, -s.x1 / texMeters, -s.x0 / texMeters, y0 / texMeters, y1 / texMeters, tint);
    floor.vquad(s.x1, z1, 0, -s.run, 0, y1, -z1 / texMeters, -z0 / texMeters, 0, y1 / texMeters, tint);
  }
  // Block the open side once the steps get too tall to step onto, so the only way up is the front.
  const sideBlock = CONFIG.landmarks.stairs.sideBlockHeight;
  const firstBlocked = Math.ceil(sideBlock / s.rise) - 1;
  const t = CONFIG.world.wallThickness / 2;
  colliders.push({ minX: s.x1 - t, minZ: s.zStart + firstBlocked * s.run, maxX: s.x1 + t, maxZ: s.zEnd });
}

function buildPanels(data, assets, water, tall) {
  const W = CONFIG.world;
  const col = CONFIG.colors;
  const H = W.wallHeight;
  const n = data.n;
  const inWater = (p) => water && p.x > water.x0 && p.x < water.x1 && p.z > water.z0 && p.z < water.z1;
  const mirrored = data.panels.filter(inWater);
  const mesh = new THREE.InstancedMesh(assets.geometries.panel, assets.materials.panel, data.panels.length + mirrored.length);

  const colorOf = (p) =>
    p.kind === 'dead' ? col.panelDead : p.kind === 'red' ? CONFIG.landmarks.redLight.panelColor : col.panelOn;
  let i = 0;
  for (const p of data.panels) {
    const [cx, cz] = p.cell;
    const y = (data.flags[cz * n + cx] & CELL_TALL ? tall : H) - W.panelGap;
    _obj.position.set(p.x, y, p.z);
    _obj.rotation.set(0, 0, 0);
    _obj.updateMatrix();
    mesh.setMatrixAt(i, _obj.matrix);
    mesh.setColorAt(i++, _col.set(colorOf(p)));
    p.y = y; // phase 3's light pool reads panel positions from here
  }
  for (const p of mirrored) {
    // Reflection: same panel mirrored through the floor, flipped to face up.
    _obj.position.set(p.x, -(H - W.panelGap), p.z);
    _obj.rotation.set(Math.PI, 0, 0);
    _obj.updateMatrix();
    mesh.setMatrixAt(i, _obj.matrix);
    mesh.setColorAt(i++, _col.set(colorOf(p)).multiplyScalar(col.mirrorDim));
  }
  mesh.computeBoundingSphere();
  return mesh;
}

function buildChairs(piles, assets) {
  const S = CONFIG.landmarks.chairs;
  const count = piles.reduce((s, p) => s + p.chairs.length, 0);
  const mesh = new THREE.InstancedMesh(assets.geometries.chair, assets.materials.chair, count);
  let i = 0;
  for (const p of piles) {
    p.chairs.forEach((c, k) => {
      _obj.position.set(p.x, k * S.stackStep, p.z);
      _obj.rotation.set(c.tiltX, c.yaw, c.tiltZ);
      _obj.updateMatrix();
      mesh.setMatrixAt(i++, _obj.matrix);
    });
  }
  mesh.computeBoundingSphere();
  return mesh;
}
