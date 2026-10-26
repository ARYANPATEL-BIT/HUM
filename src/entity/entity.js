import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { CollisionWorld } from '../player/collision.js';
import { playEntityFootstep, updateEntityAudio, initEntityAudio, rebaseEntityAudio } from '../audio/entity.js';

// Entity: tall thin figure from primitives with vertex-jitter shader.
// State machine: wander → investigate → chase → lose → wander.
// In every state it moves along an A* path over grid cells (capped at pathMaxExpansions,
// recomputed at pathRecomputeHz) and collides with walls like the player.
// LoS: ray-march through the collider grid (ChunkManager.hasLineOfSight).

// Colour is linear (≈ 0.04–0.08 on screen) and goes through three's colourspace + fog chunks, so the
// figure looks the same with or without the post pass and fades into the fog like the walls.
const JITTER_VERT = /* glsl */`
  #include <fog_pars_vertex>
  uniform float time;
  uniform float jitterAmt;
  varying vec3 vNormal;
  void main() {
    vNormal = normalMatrix * normal;
    vec3 p = position;
    p.x += sin(p.y * 3.0 + time * 4.0) * jitterAmt;
    p.z += cos(p.y * 2.7 + time * 3.7) * jitterAmt;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const JITTER_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  varying vec3 vNormal;
  void main() {
    float d = dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    gl_FragColor = vec4(vec3(0.003 + d * 0.004), 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const STATES = { WANDER: 'wander', INVESTIGATE: 'investigate', CHASE: 'chase', LOSE: 'lose' };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Entity {
  constructor(scene, chunks) {
    this.scene = scene;
    this.chunks = chunks;
    this.collision = new CollisionWorld(chunks);
    this.near = [];
    this.position = new THREE.Vector3();
    this.state = STATES.WANDER;
    this.enabled = false;

    this.material = new THREE.ShaderMaterial({
      vertexShader: JITTER_VERT,
      fragmentShader: JITTER_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, jitterAmt: { value: 0.02 } }]),
      fog: true,
      side: THREE.DoubleSide,
    });

    this.mesh = this._buildMesh();
    this.mesh.visible = false;
    scene.add(this.mesh);

    // Navigation
    this.path = [];
    this.pathTimer = 0;
    this.target = null;
    this.noiseTarget = null;
    this.loseTimer = 0;
    this.gracePeriod = 0;
    this.footstepTimer = 0;
    this.lastSeen = new THREE.Vector3(); // player position at the last frame it had line of sight
    this.spawned = false;
    this.elapsed = 0;
  }

  _buildMesh() {
    const parts = [
      // Body (tall thin box).
      new THREE.BoxGeometry(0.28, 1.6, 0.18).translate(0, 0.9, 0),
      // Head.
      new THREE.BoxGeometry(0.22, 0.28, 0.18).translate(0, 1.85, 0),
      // Arms.
      new THREE.BoxGeometry(0.1, 0.9, 0.1).translate(-0.22, 0.95, 0),
      new THREE.BoxGeometry(0.1, 0.9, 0.1).translate(0.22, 0.95, 0),
      // Legs.
      new THREE.BoxGeometry(0.12, 0.85, 0.14).translate(-0.1, 0.45, 0),
      new THREE.BoxGeometry(0.12, 0.85, 0.14).translate(0.1, 0.45, 0),
    ];
    // One geometry (one draw call); the jitter shader works on these merged positions unchanged.
    const geo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return new THREE.Mesh(geo, this.material);
  }

  // Put the entity at the centre of the cell containing (x, z) and drop its path.
  _placeAt(x, z) {
    const C = CONFIG.world.cellSize;
    this.position.set((Math.floor(x / C) + 0.5) * C, 0, (Math.floor(z / C) + 0.5) * C);
    this.path = [];
    this.pathTimer = 0;
  }

  spawn(x, z) {
    this._placeAt(x, z);
    this.mesh.visible = true;
    this.enabled = true;
    this.state = STATES.WANDER;
    initEntityAudio();
  }

  enable() {
    this.enabled = true;
    this.mesh.visible = true;
  }

  disable() {
    this.enabled = false;
    this.mesh.visible = false;
  }

  // hiding: the player's Hiding state (or null). A hidden player is invisible to it unless hiding.found.
  update(dt, playerPos, playerCamera, pressure, noiseEvents, hiding = null) {
    if (!this.enabled) return;
    const H = CONFIG.hiding;
    const hidden = hiding?.active && !hiding.found;
    this.elapsed += dt;
    this.material.uniforms.time.value = this.elapsed;

    // Pressure-scaled jitter.
    this.material.uniforms.jitterAmt.value = 0.02 + pressure * 0.06;

    // Check noise events for investigation.
    this._checkNoiseEvents(noiseEvents, pressure);

    // Grace period (after losing player).
    if (this.gracePeriod > 0) {
      this.gracePeriod -= dt;
      if (this.gracePeriod < 0) this.gracePeriod = 0;
    }

    // LoS check. A found hiding player counts as seen (the spot's own box would block the ray).
    const hasLos = hiding?.active ? hiding.found : this._hasLoS(playerPos);
    if (hasLos) this.lastSeen.copy(playerPos);

    // State machine.
    switch (this.state) {
      case STATES.WANDER:
        this._wander(dt);
        if (hasLos) {
          const d = this.position.distanceTo(playerPos);
          if (d < CONFIG.entity.chaseLosDist && this.gracePeriod <= 0) this._setState(STATES.CHASE);
        }
        break;
      case STATES.INVESTIGATE:
        // Checking a noise right next to someone who has been hiding long enough to breathe loudly.
        if (hidden && hiding.breathing && this.position.distanceTo(playerPos) < H.searchRadius) hiding.found = true;
        this._investigate(dt);
        if (hasLos && this.gracePeriod <= 0) {
          const d = this.position.distanceTo(playerPos);
          if (d < CONFIG.entity.chaseLosDist) this._setState(STATES.CHASE);
        }
        break;
      case STATES.CHASE:
        // Normally it tracks you for loseDist s after losing sight; if you hid, only to where it last saw you.
        this._follow(dt, hidden ? this.lastSeen : playerPos, CONFIG.entity.chaseSpeed * (1 + pressure * (CONFIG.entity.rampSpeedMax - 1)));
        if (!hasLos) {
          this.loseTimer += dt;
          if (this.loseTimer > CONFIG.entity.loseDist) this._setState(STATES.LOSE);
        } else {
          this.loseTimer = 0;
        }
        if (hidden && this.state === STATES.CHASE && this.position.distanceTo(this.lastSeen) < 1.5) {
          // There: check the hiding place next to it, or give up.
          if (this.position.distanceTo(playerPos) < H.searchRadius && Math.random() < H.searchChance) hiding.found = true;
          else this._setState(STATES.LOSE);
        }
        // Caught?
        if (!hidden && this.position.distanceTo(playerPos) < (hiding?.active ? H.catchDist : CONFIG.entity.caughtDist)) {
          document.dispatchEvent(new CustomEvent('entity-caught'));
        }
        break;
      case STATES.LOSE:
        // Lost the player: a grace period before it can chase again.
        this.gracePeriod = CONFIG.entity.gracePeriod;
        this._setState(STATES.WANDER);
        break;
    }
    this.position.y = this.chunks.groundAt(this.position.x, this.position.z);

    // Footsteps.
    this.footstepTimer -= dt;
    if (this.footstepTimer <= 0 && this.state !== STATES.WANDER) {
      this.footstepTimer = this.state === STATES.CHASE ? 0.3 : 0.5;
      playEntityFootstep(this.position.x, this.position.y, this.position.z);
    }

    // Audio.
    updateEntityAudio(dt, this.position, playerPos, this.state);

    // Mesh follows position, facing the next waypoint.
    this.mesh.position.copy(this.position);
    if (this.path.length > 0) {
      const next = this.path[0];
      const dx = next.x - this.position.x, dz = next.z - this.position.z;
      if (dx !== 0 || dz !== 0) this.mesh.rotation.y = Math.atan2(dx, dz);
    }

    // Relocate if player is too far away.
    this._maybeRelocate(dt, playerPos, playerCamera);
  }

  _setState(s) {
    this.state = s;
    this.loseTimer = 0;
    this.pathTimer = 0; // new goal: re-plan now
    if (s === STATES.WANDER) this.target = null;
  }

  _hasLoS(playerPos) {
    return this.chunks.hasLineOfSight(this.position.x, this.position.z, playerPos.x, playerPos.z);
  }

  _wander(dt) {
    // New target when arrived or when the current path has run out (target unreachable).
    if (!this.target || this.position.distanceTo(this.target) < 1.5 || (!this.path.length && this.pathTimer > 0)) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 12;
      this.target = new THREE.Vector3(
        this.position.x + Math.cos(angle) * dist,
        0,
        this.position.z + Math.sin(angle) * dist
      );
      this.pathTimer = 0;
    }
    this._follow(dt, this.target, CONFIG.entity.wanderSpeed);
  }

  _investigate(dt) {
    if (!this.noiseTarget || this.position.distanceTo(this.noiseTarget) < 2 || (!this.path.length && this.pathTimer > 0)) {
      this.noiseTarget = null;
      this._setState(STATES.WANDER);
      return;
    }
    this._follow(dt, this.noiseTarget, CONFIG.entity.investigateSpeed);
  }

  // Walk the A* path toward goal, re-planning at pathRecomputeHz, sliding along walls.
  _follow(dt, goal, speed) {
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = 1 / CONFIG.entity.pathRecomputeHz;
      this.path = this._astar(this.position, goal);
    }
    const next = this.path[0];
    if (!next) return;
    const dx = next.x - this.position.x;
    const dz = next.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) {
      this.path.shift();
      return;
    }
    const step = Math.min(speed * dt, d);
    this.collision.move(this.position, (dx / d) * step, (dz / d) * step, CONFIG.entity.radius);
  }

  // Is a point inside (or within entity radius of) any collider?
  _solid(x, z) {
    const r = CONFIG.entity.radius;
    for (const b of this.chunks.query(x, z, r, this.near)) {
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return false;
  }

  // A move from cell (x, z) by (dx, dz) is blocked by a wall on the shared edge or something in the next cell.
  _blocked(x, z, dx, dz) {
    const C = CONFIG.world.cellSize;
    return (
      this._solid((x + 0.5 + dx / 2) * C, (z + 0.5 + dz / 2) * C) ||
      this._solid((x + 0.5 + dx) * C, (z + 0.5 + dz) * C)
    );
  }

  // A* on the cell grid of loaded chunks, capped at pathMaxExpansions. Returns cell-centre waypoints
  // ending at `to`; if the cap is hit, the path leads to the explored cell closest to `to`.
  _astar(from, to) {
    const C = CONFIG.world.cellSize;
    const sx = Math.floor(from.x / C), sz = Math.floor(from.z / C);
    const ex = Math.floor(to.x / C), ez = Math.floor(to.z / C);
    const key = (x, z) => `${x},${z}`;
    const heur = (x, z) => Math.abs(x - ex) + Math.abs(z - ez);

    const start = key(sx, sz);
    const open = new Map([[start, [sx, sz]]]);
    const g = new Map([[start, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    let best = start, bestH = heur(sx, sz), goal = null;

    for (let n = 0; open.size > 0 && n < CONFIG.entity.pathMaxExpansions; n++) {
      let k = null, kf = Infinity;
      for (const [ok, [ox, oz]] of open) {
        const f = g.get(ok) + heur(ox, oz);
        if (f < kf) { kf = f; k = ok; }
      }
      const [cx, cz] = open.get(k);
      open.delete(k);
      closed.add(k);
      const h = heur(cx, cz);
      if (h < bestH) { bestH = h; best = k; }
      if (h === 0) { goal = k; break; }

      for (const [dx, dz] of DIRS) {
        const nk = key(cx + dx, cz + dz);
        if (closed.has(nk) || this._blocked(cx, cz, dx, dz)) continue;
        const ng = g.get(k) + 1;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          cameFrom.set(nk, k);
          open.set(nk, [cx + dx, cz + dz]);
        }
      }
    }

    const path = [];
    for (let k = goal ?? best; cameFrom.has(k); k = cameFrom.get(k)) {
      const [x, z] = k.split(',').map(Number);
      path.unshift(new THREE.Vector3((x + 0.5) * C, 0, (z + 0.5) * C));
    }
    if (goal) path.push(to.clone());
    return path;
  }

  _checkNoiseEvents(noiseEvents, pressure) {
    const E = CONFIG.entity;
    const hearRadius = E.hearingRadius * (1 + pressure * (E.rampHearingMax - 1));
    for (const ev of noiseEvents.flush()) {
      const d = Math.hypot(ev.x - this.position.x, ev.z - this.position.z);
      if (d < Math.min(hearRadius, ev.radius)) {
        this.noiseTarget = new THREE.Vector3(ev.x, 0, ev.z);
        if (this.state === STATES.WANDER) this._setState(STATES.INVESTIGATE);
        break;
      }
    }
  }

  _maybeRelocate(dt, playerPos, camera) {
    const chunkSize = this.chunks.size;
    const dist = this.position.distanceTo(playerPos);
    const chunkDist = dist / chunkSize;
    if (chunkDist > CONFIG.entity.relocateChunks) {
      // After relocateDelay, teleport behind the player relative to camera.
      this._relocateTimer = (this._relocateTimer || 0) + dt;
      if (this._relocateTimer > CONFIG.entity.relocateDelay) {
        this._relocateTimer = 0;
        // Place just outside fog behind the player.
        const yaw = camera.rotation.y;
        const backDist = CONFIG.world.loadRadius * chunkSize + 4;
        this._placeAt(playerPos.x + Math.sin(yaw) * backDist, playerPos.z + Math.cos(yaw) * backDist);
      }
    } else {
      this._relocateTimer = 0;
    }
  }

  rebase(dx, dz) {
    this.position.x -= dx;
    this.position.z -= dz;
    this.mesh.position.copy(this.position);
    if (this.target) { this.target.x -= dx; this.target.z -= dz; }
    if (this.noiseTarget) { this.noiseTarget.x -= dx; this.noiseTarget.z -= dz; }
    this.lastSeen.x -= dx;
    this.lastSeen.z -= dz;
    for (const p of this.path) { p.x -= dx; p.z -= dz; }
    rebaseEntityAudio(dx, dz);
  }
}
