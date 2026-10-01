import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { CONFIG } from '../config.js';

// Dev builds only (dynamically imported behind import.meta.env.DEV, so it never ships).
//   `  toggle debug view: chunk grid through walls, fog off, memory readout
//   G  toggle auto-run: noclip straight ahead at dev.autoRunSpeed (for the 2 km memory test)
export class DevTools {
  constructor(gfx, player, chunks, input) {
    this.gfx = gfx;
    this.player = player;
    this.chunks = chunks;
    this.input = input;
    this.info = document.getElementById('dev-info');
    this.info.hidden = false;
    this.stats = new Stats();
    document.body.appendChild(this.stats.dom);
    this.acc = 0;
    this.debug = false;
    this.grid = this.makeGrid();
    this.grid.visible = false;
    gfx.scene.add(this.grid);
    this.checkFogCoversLoading();
    window.hum = { gfx, player, chunks }; // poke at the game from the browser console
  }

  // Chunk boundaries for the loaded 5x5 area, drawn on top of everything.
  makeGrid() {
    const R = CONFIG.world.loadRadius + 1;
    const S = this.chunks.size;
    const pts = [];
    for (let i = -R; i <= R + 1; i++) {
      pts.push(i * S, 0.05, -R * S, i * S, 0.05, (R + 1) * S);
      pts.push(-R * S, 0.05, i * S, (R + 1) * S, 0.05, i * S);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff66, depthTest: false, fog: false });
    const grid = new THREE.LineSegments(geo, mat);
    grid.renderOrder = 999;
    return grid;
  }

  // The nearest an unloaded chunk can be is loadRadius chunks away; it must be fully fogged there.
  checkFogCoversLoading() {
    const d = CONFIG.world.loadRadius * this.chunks.size;
    const hidden = 1 - Math.exp(-((CONFIG.atmosphere.fogDensity * d) ** 2));
    if (hidden < CONFIG.dev.fogWarnThreshold) {
      console.warn(`Fog only hides ${(hidden * 100).toFixed(1)}% at ${d} m: chunk loading may be visible.`);
    }
  }

  begin() {
    this.stats.begin();
  }

  end() {
    this.stats.end();
  }

  update(dt) {
    const input = this.input;
    if (input.wasPressed(CONFIG.dev.debugKey)) {
      this.debug = !this.debug;
      this.grid.visible = this.debug;
      this.gfx.scene.fog.density = this.debug ? 0 : CONFIG.atmosphere.fogDensity;
    }
    if (input.wasPressed(CONFIG.dev.autoRunKey)) this.player.autoRun = !this.player.autoRun;

    if (this.debug) {
      const [cx, cz] = this.chunks.chunkAt(this.player.position.x, this.player.position.z);
      const S = this.chunks.size;
      this.grid.position.set((cx - this.chunks.originCX) * S, 0, (cz - this.chunks.originCZ) * S);
    }

    this.acc += dt;
    if (this.acc < CONFIG.dev.infoUpdateInterval) return;
    this.acc = 0;
    const r = this.gfx.renderer.info;
    const p = this.player.position;
    const [cx, cz] = this.chunks.chunkAt(p.x, p.z);
    let text =
      `draw calls ${r.render.calls}  tris ${r.render.triangles}\n` +
      `chunk ${cx}, ${cz}  pos ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}\n` +
      `speed ${this.player.speed.toFixed(2)}${this.player.sprinting ? ' SPRINT' : ''}` +
      `${this.player.autoRun ? '  AUTORUN' : ''}  walked ${this.player.distanceWalked.toFixed(0)} m`;
    if (this.debug) {
      const heap = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'n/a';
      text +=
        `\n\n[debug]  loaded ${this.chunks.loadedCount}  queued ${this.chunks.pending}` +
        `  built ${this.chunks.stats.built}  unloaded ${this.chunks.stats.unloaded}\n` +
        `gpu geometries ${r.memory.geometries}  textures ${r.memory.textures}  js heap ${heap}\n` +
        `origin chunk ${this.chunks.originCX}, ${this.chunks.originCZ}`;
    }
    this.info.textContent = text;
  }
}
