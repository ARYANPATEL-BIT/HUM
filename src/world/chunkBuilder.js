import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { hash, mulberry32 } from '../core/rng.js';
import { CELL_NO_FLOOR, CELL_TALL, chunkHeightAt } from './chunkGen.js';
import { GeoBuilder } from './geoBuilder.js';

// Turns chunk layout data into meshes (chunk-local coords) + collision boxes.
// Draw calls per chunk: walls, floor, ceiling, panels (+ water or chairs in some landmarks, + desks and
// cupboards in ~1 of 3 ordinary chunks).

const BUILD_SALT = 5;
const TINT_SALT = 6;
const DEAD_SALT = 7;
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
  const ceiling = new GeoBuilder(true); // vertex color for baked light
  const colliders = [];
  const water = data.landmark?.water;

  const flagAt = (x, z) => (x < 0 || z < 0 || x >= n || z >= n ? 0 : flags[z * n + x]);
  const inWater = (x0, z0, x1, z1) =>
    water && x1 > water.x0 - T && x0 < water.x1 + T && z1 > water.z0 - T && z0 < water.z1 + T;

  function addBox(x0, z0, x1, z1, y0, y1, collide, uOffset) {
    walls.boxSides(x0, z0, x1, z1, y0, y1, wallTexW, wallTexH, uOffset);
    if (collide) colliders.push({ minX: x0, minZ: z0, maxX: x1, maxZ: z1 });
    if (y0 === 0 && inWater(x0, z0, x1, z1)) {
      walls.boxSides(x0, z0, x1, z1, -y1, 0, wallTexW, wallTexH, uOffset, true);
    }
  }

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
          if (needsHeader(axis, line, i)) emitRun(axis, line, i, i + 1, H, tall, false);
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
    const a = from * C - T / 2;
    const b = to * C + T / 2;
    const l = line * C;
    const uOffset = rng() * wallTexW;
    if (axis === 'h') addBox(a, l - T / 2, b, l + T / 2, y0, y1, collide, uOffset);
    else addBox(l - T / 2, a, l + T / 2, b, y0, y1, collide, uOffset);
  }

  const ps = W.pillarSize / 2;
  for (const [px, pz] of data.pillars) {
    addBox(px * C - ps, pz * C - ps, px * C + ps, pz * C + ps, 0, H, true, rng() * wallTexW);
  }

  // Each panel gets a fixed roll; normal panels below deadPanelChance start dead (LightPool kills
  // more as pressure rises, lowest rolls first).
  const L = CONFIG.lighting;
  const deadRng = mulberry32(hash(data.seed, DEAD_SALT, data.cx, data.cz));
  for (const p of data.panels) {
    p.roll = deadRng();
    if (p.kind === 'normal' && p.roll < L.deadPanelChance) p.kind = 'dead';
  }

  // Baked vertex lighting: approximate a panel-above contribution per vertex.
  // Each panel contributes a falloff term; ceiling gets more, floor gets base ambient.
  const bakedLight = (lx, lz, isFloor) => {
    let bright = L.bakeAmbient;
    for (const p of data.panels) {
      if (p.kind === 'dead') continue;
      const dist2 = (p.x - lx) ** 2 + (p.z - lz) ** 2;
      const r = W.panelSpacing * C * 1.5;
      const falloff = Math.max(0, 1 - dist2 / (r * r));
      bright += falloff * L.bakeDirY * (isFloor ? 0.6 : 1.0);
    }
    return Math.min(1, bright);
  };

  const ft = W.floorTint;
  const floorTint = (lx, lz) => {
    const gx = data.cx * n + Math.round(lx / C);
    const gz = data.cz * n + Math.round(lz / C);
    const r = mulberry32(hash(data.seed, TINT_SALT, gx, gz));
    let k = 1 - r() * ft.variation;
    if (r() < ft.dampChance) k *= 1 - ft.dampDarken;
    const b = bakedLight(lx, lz, true);
    return [k * b, k * b * 0.98, k * b * 0.95];
  };
  const ceilTint = (lx, lz) => {
    const b = bakedLight(lx, lz, false);
    return [b, b * 0.99, b * 0.97];
  };

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const f = flags[z * n + x];
      const x0 = x * C;
      const z0 = z * C;
      if (!(f & CELL_NO_FLOOR)) {
        floor.hquad(x0, z0, x0 + C, z0 + C, 0, true, tex.carpet.meters, floorTint);
      } else {
        ceiling.hquad(x0, z0, x0 + C, z0 + C, -H, true, tex.ceiling.meters, ceilTint);
      }
      ceiling.hquad(x0, z0, x0 + C, z0 + C, f & CELL_TALL ? tall : H, false, tex.ceiling.meters, ceilTint);
    }
  }

  const stairs = data.landmark?.stairs;
  if (stairs) buildStairs(stairs, floor, colliders, tex.carpet.meters);

  // --- assemble meshes ---
  const group = new THREE.Group();
  const M = assets.materials;
  const owned = [];
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

  // Desks and cupboards: one merged mesh per chunk, box colliders.
  if (data.hiding.length) {
    const parts = data.hiding.map((s) => assets.geometries[s.type].clone().rotateY(s.yaw).translate(s.x, 0, s.z));
    const geo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    owned.push(geo);
    group.add(new THREE.Mesh(geo, M.hiding));
    for (const s of data.hiding) colliders.push({ minX: s.x - s.hx, minZ: s.z - s.hz, maxX: s.x + s.hx, maxZ: s.z + s.hz });
  }

  return {
    group,
    colliders,
    panels: data.panels,
    panelMesh: panels,
    heightAt: (lx, lz) => chunkHeightAt(data, lx, lz),
    dispose() {
      owned.forEach((g) => g.dispose());
      panels.dispose();
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
    floor.hquad(s.x0, z0, s.x1, z1, y1, true, texMeters, tint);
    floor.vquad(s.x1, z0, -width, 0, y0, y1, -s.x1 / texMeters, -s.x0 / texMeters, y0 / texMeters, y1 / texMeters, tint);
    floor.vquad(s.x1, z1, 0, -s.run, 0, y1, -z1 / texMeters, -z0 / texMeters, 0, y1 / texMeters, tint);
  }
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
    p.y = y;
  }
  for (const p of mirrored) {
    _obj.position.set(p.x, -(H - W.panelGap), p.z);
    _obj.rotation.set(Math.PI, 0, 0);
    _obj.updateMatrix();
    mesh.setMatrixAt(i, _obj.matrix);
    p.mirror = i; // reflection instance, recoloured with the panel
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
