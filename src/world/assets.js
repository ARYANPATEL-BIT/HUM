import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { createTextures } from './textures.js';

// Materials and geometries shared by every chunk. Created once, never disposed per chunk.
export function createAssets(renderer) {
  const tex = createTextures(renderer.capabilities.getMaxAnisotropy());
  const col = CONFIG.colors;
  return {
    materials: {
      wall: new THREE.MeshLambertMaterial({ map: tex.wallpaper }),
      floor: new THREE.MeshLambertMaterial({ map: tex.carpet, vertexColors: true }),
      ceiling: new THREE.MeshLambertMaterial({ map: tex.ceiling, vertexColors: true }),
      panel: new THREE.MeshBasicMaterial({ color: 0xffffff }), // per-instance colour; emissive appearance
      chair: new THREE.MeshLambertMaterial({ color: col.chair }),
      hiding: new THREE.MeshLambertMaterial({ color: col.furniture, side: THREE.DoubleSide }), // seen from inside too
      water: new THREE.MeshStandardMaterial({
        color: col.water,
        roughness: 0.08,
        metalness: 0.2,
        transparent: true,
        opacity: col.waterOpacity,
        depthWrite: false,
      }),
    },
    geometries: {
      panel: panelGeometry(),
      chair: chairGeometry(),
      ...hidingGeometries(),
    },
    // Task objects, tape players, the exit door, bottles and notes. One geometry + material per type, shared by every instance.
    props: {
      geometries: propGeometries(),
      materials: Object.fromEntries(
        Object.entries(col.props).map(([type, color]) => [
          type,
          type === 'exit' ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }),
        ])
      ),
    },
  };
}

function merge(parts) {
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

// Primitive props, origin on the floor. Small items sit on a waist-high stand.
function propGeometries() {
  const onStand = (w, h, d) =>
    merge([new THREE.BoxGeometry(0.45, 0.9, 0.45).translate(0, 0.45, 0), new THREE.BoxGeometry(w, h, d).translate(0, 0.9 + h / 2, 0)]);
  return {
    breaker: new THREE.BoxGeometry(0.7, 1.6, 0.3).translate(0, 0.8, 0),
    radio: onStand(0.5, 0.3, 0.25),
    cassette: onStand(0.25, 0.05, 0.16),
    tape: onStand(0.45, 0.18, 0.3),
    keypad: merge([new THREE.BoxGeometry(0.12, 1.2, 0.12).translate(0, 0.6, 0), new THREE.BoxGeometry(0.3, 0.4, 0.1).translate(0, 1.35, 0)]),
    exit: new THREE.BoxGeometry(1.2, 2.2, 0.12).translate(0, 1.1, 0),
    code: new THREE.PlaneGeometry(1, 0.25),
    bottle: merge([new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10).translate(0, 0.1, 0), new THREE.CylinderGeometry(0.018, 0.03, 0.06, 8).translate(0, 0.23, 0)]),
    note: new THREE.BoxGeometry(0.21, 0.004, 0.29).translate(0, 0.004, 0),
  };
}

// Light panel quad, facing down.
export function panelGeometry() {
  const [w, d] = CONFIG.world.panelSize;
  return new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2);
}

// Hiding spots, origin on the floor at the centre, front facing +Z. Sizes from CONFIG.hiding.
export function hidingGeometries() {
  const t = 0.03;
  const [dw, dh, dd] = CONFIG.hiding.desk.size;
  const desk = merge([
    new THREE.BoxGeometry(dw, t, dd).translate(0, dh - t / 2, 0),
    new THREE.BoxGeometry(t, dh - t, dd).translate(-(dw - t) / 2, (dh - t) / 2, 0),
    new THREE.BoxGeometry(t, dh - t, dd).translate((dw - t) / 2, (dh - t) / 2, 0),
    new THREE.BoxGeometry(dw - 2 * t, 0.4, t).translate(0, dh - t - 0.25, -dd / 2 + 0.05),
  ]);
  const { size: [cw, ch, cd], slit } = CONFIG.hiding.cupboard;
  const door = (cw - slit) / 2;
  const cupboard = merge([
    new THREE.BoxGeometry(cw, ch, t).translate(0, ch / 2, -(cd - t) / 2),
    new THREE.BoxGeometry(t, ch, cd).translate(-(cw - t) / 2, ch / 2, 0),
    new THREE.BoxGeometry(t, ch, cd).translate((cw - t) / 2, ch / 2, 0),
    new THREE.BoxGeometry(cw, t, cd).translate(0, ch - t / 2, 0),
    new THREE.BoxGeometry(cw, t, cd).translate(0, 0.06, 0),
    new THREE.BoxGeometry(door, ch - 2 * t, t).translate(-(slit + door) / 2, ch / 2, (cd - t) / 2),
    new THREE.BoxGeometry(door, ch - 2 * t, t).translate((slit + door) / 2, ch / 2, (cd - t) / 2),
  ]);
  return { desk, cupboard };
}

// Office chair from primitives, origin at the floor under the stem. Proportions are model data.
export function chairGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.5, 0.08, 0.48).translate(0, 0.47, 0),
    new THREE.BoxGeometry(0.46, 0.5, 0.06).translate(0, 0.8, -0.22),
    new THREE.BoxGeometry(0.04, 0.3, 0.04).translate(0, 0.5, -0.22),
    new THREE.CylinderGeometry(0.03, 0.03, 0.36, 6).translate(0, 0.26, 0),
  ];
  for (let i = 0; i < 5; i++) {
    parts.push(new THREE.BoxGeometry(0.3, 0.04, 0.05).translate(0.15, 0.07, 0).rotateY((i * Math.PI * 2) / 5));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}
