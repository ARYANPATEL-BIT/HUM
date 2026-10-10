import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Fixed pool of 4 PointLights. Each frame they snap to the 4 panels nearest the camera.
// Per-panel flicker is driven by summed sine waves (burst-style) rather than random noise,
// so it looks organic without needing a texture lookup.
//
// flickerIntensityAt(worldPos) is exported for the entity system (phase 6).

const _v = new THREE.Vector3();

export class LightPool {
  constructor(scene) {
    this.scene = scene;
    this.lights = [];
    this.panels = []; // flat list of { wx, wy, wz, kind, phase, chunkGroup }
    const L = CONFIG.lighting;
    for (let i = 0; i < L.poolSize; i++) {
      const light = new THREE.PointLight(L.color, L.intensity, L.distance, L.decay);
      light.visible = false;
      scene.add(light);
      this.lights.push({ light, panelIndex: -1, flicker: 0 });
    }
    this.elapsed = 0;
    this.deadChance = L.deadPanelChance;
  }

  // Called by ChunkManager after a chunk is built. Registers its panels.
  addChunk(chunkKey, panels, groupPosition) {
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      if (p.kind === 'dead') continue;
      this.panels.push({
        key: chunkKey,
        index: i,
        // World position (scene coords) updated when origin shifts.
        wx: p.x + groupPosition.x,
        wy: p.y + groupPosition.y,
        wz: p.z + groupPosition.z,
        kind: p.kind,
        // Each panel gets a unique flicker phase so they don't all pulse in sync.
        phase: Math.random() * Math.PI * 2,
        basePhase2: Math.random() * Math.PI * 2,
      });
    }
  }

  removeChunk(chunkKey) {
    this.panels = this.panels.filter((p) => p.key !== chunkKey);
  }

  // After a floating-origin shift, all panel world positions need updating.
  rebase(dx, dz) {
    for (const p of this.panels) {
      p.wx -= dx;
      p.wz -= dz;
    }
  }

  update(dt, camera) {
    this.elapsed += dt;
    const L = CONFIG.lighting;
    const t = this.elapsed;
    const camPos = camera.position;

    // Sort panels by distance to camera, assign lights to the nearest poolSize.
    // To avoid a full sort every frame, we do a linear O(n*k) scan (k = poolSize = 4).
    const k = this.lights.length;
    const nearest = new Array(k).fill(null);
    const nearDist = new Array(k).fill(Infinity);

    for (const p of this.panels) {
      const d = (p.wx - camPos.x) ** 2 + (p.wy - camPos.y) ** 2 + (p.wz - camPos.z) ** 2;
      let slot = -1;
      for (let i = 0; i < k; i++) {
        if (d < nearDist[i] && (slot === -1 || nearDist[i] > nearDist[slot])) slot = i;
      }
      if (slot >= 0 && d < nearDist[slot]) {
        nearest[slot] = p;
        nearDist[slot] = d;
      }
    }

    for (let i = 0; i < k; i++) {
      const entry = this.lights[i];
      const p = nearest[i];
      if (!p) {
        entry.light.visible = false;
        entry.panelIndex = -1;
        continue;
      }
      // Burst-style flicker: sum of 3 sines at slightly different frequencies.
      const flicker =
        Math.sin(t * L.flickerRate * Math.PI * 2 + p.phase) * 0.5 +
        Math.sin(t * L.flickerRate * 1.7 * Math.PI * 2 + p.basePhase2) * 0.35 +
        Math.sin(t * L.flickerRate * 2.3 * Math.PI * 2 + p.phase * 2) * 0.15;
      // Normalise to [0, 1] roughly, then scale by depth.
      const f = 1 + flicker * L.flickerDepth * L.flickerIntensityBase;

      entry.light.visible = true;
      entry.light.position.set(p.wx, p.wy - 0.1, p.wz);
      entry.light.intensity = L.intensity * f;
      entry.panelIndex = i;
      entry.flicker = f;
    }
  }

  // Spike the gain for a nearby panel on flicker event (used by audio).
  spikeNearest(wx, wz) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.panels) {
      const d = (p.wx - wx) ** 2 + (p.wz - wz) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) {
      // Push the phase to create a visible spike.
      best.phase += Math.PI;
    }
  }

  // Returns a flicker intensity multiplier [0,2] at a world position (for entity system).
  flickerIntensityAt(wx, wy, wz) {
    const L = CONFIG.lighting;
    const t = this.elapsed;
    let best = null;
    let bestD = Infinity;
    for (const p of this.panels) {
      const d = (p.wx - wx) ** 2 + (p.wy - wy) ** 2 + (p.wz - wz) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || bestD > 196) return 1; // > 14 m, not influenced
    const flicker =
      Math.sin(t * L.flickerRate * Math.PI * 2 + best.phase) * 0.5 +
      Math.sin(t * L.flickerRate * 1.7 * Math.PI * 2 + best.basePhase2) * 0.35 +
      Math.sin(t * L.flickerRate * 2.3 * Math.PI * 2 + best.phase * 2) * 0.15;
    return 1 + flicker * L.flickerDepth * L.flickerIntensityBase;
  }
}
