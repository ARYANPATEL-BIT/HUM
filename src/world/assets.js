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
      ceiling: new THREE.MeshLambertMaterial({ map: tex.ceiling }),
      panel: new THREE.MeshBasicMaterial({ color: 0xffffff }), // per-instance colour
      chair: new THREE.MeshLambertMaterial({ color: col.chair }),
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
    },
  };
}

// Light panel quad, facing down.
export function panelGeometry() {
  const [w, d] = CONFIG.world.panelSize;
  return new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2);
}

// Office chair from primitives, origin at the floor under the stem. Proportions are model data.
export function chairGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.5, 0.08, 0.48).translate(0, 0.47, 0), // seat
    new THREE.BoxGeometry(0.46, 0.5, 0.06).translate(0, 0.8, -0.22), // backrest
    new THREE.BoxGeometry(0.04, 0.3, 0.04).translate(0, 0.5, -0.22), // back post
    new THREE.CylinderGeometry(0.03, 0.03, 0.36, 6).translate(0, 0.26, 0), // gas lift
  ];
  for (let i = 0; i < 5; i++) {
    // Five-star base: legs radiating every 72 degrees.
    parts.push(new THREE.BoxGeometry(0.3, 0.04, 0.05).translate(0.15, 0.07, 0).rotateY((i * Math.PI * 2) / 5));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}
