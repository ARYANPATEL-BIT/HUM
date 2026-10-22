import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { CONFIG } from '../config.js';

const _v = new THREE.Vector3();

// Dev builds only (dynamically imported behind import.meta.env.DEV).
// Debug mode (backquote) also draws the entity's A* path and a state label above it.
export class DevTools {
  constructor(gfx, player, chunks, input, lightPool, entity) {
    this.gfx = gfx;
    this.player = player;
    this.chunks = chunks;
    this.input = input;
    this.lightPool = lightPool;
    this.entity = entity;
    this.pathLine = this.makePathLine();
    gfx.scene.add(this.pathLine);
    this.label = document.createElement('div');
    this.label.style.cssText = 'position:fixed;left:0;top:0;color:#f55;font-size:12px;pointer-events:none';
    document.body.appendChild(this.label);
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
    this.buildGui();
    window.hum = { gfx, player, chunks, lightPool };
  }

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

  makePathLine() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(256 * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false, fog: false }));
    line.renderOrder = 999;
    line.frustumCulled = false;
    return line;
  }

  drawEntity() {
    const e = this.entity;
    const show = this.debug && e.enabled;
    this.pathLine.visible = show;
    this.label.hidden = !show;
    if (!show) return;
    const pts = [e.position, ...e.path].slice(0, 256);
    const attr = this.pathLine.geometry.attributes.position;
    pts.forEach((p, i) => attr.setXYZ(i, p.x, 0.1, p.z));
    attr.needsUpdate = true;
    this.pathLine.geometry.setDrawRange(0, pts.length);
    _v.copy(e.position).setY(2.3).project(this.gfx.camera);
    this.label.hidden = _v.z > 1;
    this.label.style.transform = `translate(${((_v.x + 1) / 2) * innerWidth}px, ${((1 - _v.y) / 2) * innerHeight}px)`;
    this.label.textContent = e.state;
  }

  checkFogCoversLoading() {
    const d = CONFIG.world.loadRadius * this.chunks.size;
    const hidden = 1 - Math.exp(-((CONFIG.atmosphere.fogDensity * d) ** 2));
    if (hidden < CONFIG.dev.fogWarnThreshold) {
      console.warn(`Fog only hides ${(hidden * 100).toFixed(1)}% at ${d} m: chunk loading may be visible.`);
    }
  }

  buildGui() {
    const gui = new GUI({ title: 'HUM tuning' });
    this.gui = gui;

    // Preset switcher
    const presetObj = { preset: CONFIG.preset };
    gui.add(presetObj, 'preset', ['low', 'medium', 'high']).name('Graphics preset').onChange((v) => {
      this.gfx.setPreset(v);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    });

    // Lighting (LightPool reads these every frame)
    const L = CONFIG.lighting;
    const F = L.flicker;
    const lf = gui.addFolder('Lighting');
    lf.add(L, 'intensity', 0, 20, 0.5).name('Pool intensity');
    lf.add(L, 'deadPanelChance', 0, 0.5, 0.01).name('Dead panels');
    lf.add(F, 'rate', 1, 60, 1).name('Burst noise rate');
    lf.add(F, 'offBelow', 0, 1, 0.01).name('Burst off threshold');
    lf.add(F, 'low', 0, 1, 0.01).name('Burst off level');

    // Post
    const P = CONFIG.post;
    const pf = gui.addFolder('Post');
    pf.add(P, 'enabled').name('Post enabled');
    pf.add(P, 'grainStrength', 0, 0.2, 0.002).name('Grain');
    pf.add(P, 'vignetteDarkness', 0, 2, 0.05).name('Vignette');
    pf.add(P, 'caStrength', 0, 0.005, 0.0001).name('Chrom. aberr.');

    // Fog
    const af = gui.addFolder('Atmosphere');
    const fogProxy = { density: CONFIG.atmosphere.fogDensity };
    af.add(fogProxy, 'density', 0, 0.15, 0.001).name('Fog density').onChange((v) => {
      this.gfx.scene.fog.density = v;
    });

    // Copy config
    const copyObj = {
      copyConfig: () => {
        const out = JSON.stringify({
          lighting: { intensity: L.intensity, deadPanelChance: L.deadPanelChance, flicker: F },
          post: { grainStrength: P.grainStrength, vignetteDarkness: P.vignetteDarkness, caStrength: P.caStrength },
          atmosphere: { fogDensity: fogProxy.density },
        }, null, 2);
        navigator.clipboard?.writeText(out).catch(() => console.log(out));
        console.log('[config copy]', out);
      }
    };
    gui.add(copyObj, 'copyConfig').name('Copy config to clipboard');
  }

  begin() { this.stats.begin(); }
  end() { this.stats.end(); }

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
    this.drawEntity();

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
