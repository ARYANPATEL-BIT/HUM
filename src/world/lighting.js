import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Fixed pool of PointLights (poolSize, never changes) that snap to the live panels nearest the camera.
//
// Every panel runs a burst flicker state machine:
//   steady --(gap elapses)--> burst --(duration elapses)--> steady
//   any normal panel whose roll < current dead fraction --> dead (permanent)
// During a burst, 1D value noise switches the panel off whenever it drops below `offBelow`.
// Pressure shortens the gaps and raises the dead fraction. Brightness is written into the chunk's
// InstancedMesh colours; a pooled light copies its panel's brightness and reports each switch-off
// through onFlicker(lightIndex) (main.js plays the hum crackle).

const _col = new THREE.Color();
const rand = ([a, b]) => a + Math.random() * (b - a);

// Smooth 1D value noise in [0, 1).
function noise1(x) {
  const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const i = Math.floor(x);
  const f = x - i;
  return h(i) + (h(i + 1) - h(i)) * f * f * (3 - 2 * f);
}

function paint(p) {
  const C = CONFIG.colors;
  if (p.brightness === 0) _col.set(C.panelDead);
  else _col.set(p.kind === 'red' ? CONFIG.landmarks.redLight.panelColor : C.panelOn).multiplyScalar(p.brightness);
  p.mesh.setColorAt(p.index, _col);
  if (p.mirror !== undefined) p.mesh.setColorAt(p.mirror, _col.multiplyScalar(C.mirrorDim));
  p.mesh.instanceColor.needsUpdate = true;
}

export class LightPool {
  constructor(scene) {
    this.lights = [];
    this.panels = [];
    this.onFlicker = null;
    const L = CONFIG.lighting;
    for (let i = 0; i < L.poolSize; i++) {
      const light = new THREE.PointLight(L.color, L.intensity, L.distance, L.decay);
      light.visible = false;
      scene.add(light);
      this.lights.push({ light, flicker: 1 });
    }
    this.elapsed = 0;
  }

  // Called by ChunkManager after a chunk is built. Registers all its panels.
  addChunk(key, chunk) {
    chunk.panels.forEach((p, i) => {
      const dead = p.kind === 'dead';
      this.panels.push({
        key,
        mesh: chunk.panelMesh,
        index: i,
        mirror: p.mirror,
        wx: p.x + chunk.ox,
        wy: p.y,
        wz: p.z + chunk.oz,
        kind: p.kind,
        roll: p.roll,
        state: dead ? 'dead' : 'steady',
        timer: rand(CONFIG.lighting.flicker.gap),
        seed: Math.random() * 1000,
        brightness: dead ? 0 : 1,
      });
    });
  }

  removeChunk(key) {
    this.panels = this.panels.filter((p) => p.key !== key);
  }

  // After a floating-origin shift, panels and lights move with the world.
  rebase(dx, dz) {
    for (const p of this.panels) {
      p.wx -= dx;
      p.wz -= dz;
    }
    for (const { light } of this.lights) {
      light.position.x -= dx;
      light.position.z -= dz;
    }
  }

  update(dt, camera, pressure = 0) {
    const L = CONFIG.lighting;
    const F = L.flicker;
    const E = CONFIG.entity;
    this.elapsed += dt;
    const gapScale = 1 + pressure * (E.rampFlickerMax - 1);
    const deadFrac = L.deadPanelChance + pressure * (E.rampDeadPanelMax - L.deadPanelChance);

    for (const p of this.panels) {
      if (p.state !== 'dead' && p.kind === 'normal' && p.roll < deadFrac) p.state = 'dead';
      if (p.state !== 'dead') {
        p.timer -= p.state === 'steady' ? dt * gapScale : dt;
        if (p.timer <= 0) {
          p.state = p.state === 'steady' ? 'burst' : 'steady';
          p.timer = rand(p.state === 'burst' ? F.duration : F.gap);
        }
      }
      let b = 1;
      if (p.state === 'dead') b = 0;
      else if (p.state === 'burst' && noise1(this.elapsed * F.rate + p.seed) < F.offBelow) b = F.low;
      p.flickered = b < p.brightness;
      if (b !== p.brightness) {
        p.brightness = b;
        paint(p);
      }
    }

    // Assign the pool to the nearest live panels: linear O(n*k) scan instead of a sort.
    const camPos = camera.position;
    const k = this.lights.length;
    const nearest = new Array(k).fill(null);
    const nearDist = new Array(k).fill(Infinity);
    for (const p of this.panels) {
      if (p.state === 'dead') continue;
      const d = (p.wx - camPos.x) ** 2 + (p.wy - camPos.y) ** 2 + (p.wz - camPos.z) ** 2;
      let slot = 0;
      for (let i = 1; i < k; i++) if (nearDist[i] > nearDist[slot]) slot = i;
      if (d < nearDist[slot]) {
        nearest[slot] = p;
        nearDist[slot] = d;
      }
    }

    for (let i = 0; i < k; i++) {
      const entry = this.lights[i];
      const p = nearest[i];
      entry.light.visible = !!p;
      if (!p) continue;
      entry.light.position.set(p.wx, p.wy - 0.1, p.wz);
      entry.light.intensity = L.intensity * p.brightness;
      entry.flicker = p.brightness;
      if (p.flickered) this.onFlicker?.(i);
    }
  }

  // Breaker strobe: kick the nearest live panel into a short burst.
  spikeNearest(wx, wz) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.panels) {
      if (p.state === 'dead') continue;
      const d = (p.wx - wx) ** 2 + (p.wz - wz) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && best.state === 'steady') {
      best.state = 'burst';
      best.timer = 0.3;
    }
  }
}
