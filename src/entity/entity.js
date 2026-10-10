import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { playEntityFootstep, updateEntityAudio, initEntityAudio, rebaseEntityAudio } from '../audio/entity.js';

// Entity: tall thin figure from primitives with vertex-jitter shader.
// State machine: wander → investigate → chase → lose → wander.
// A* pathfinding (capped at 4000 node expansions, 2 Hz recompute).
// LoS: DDA through grid cells (not three's Raycaster).

const JITTER_VERT = /* glsl */`
  uniform float time;
  uniform float jitterAmt;
  varying vec3 vNormal;
  void main() {
    vNormal = normalMatrix * normal;
    vec3 p = position;
    p.x += sin(p.y * 3.0 + time * 4.0) * jitterAmt;
    p.z += cos(p.y * 2.7 + time * 3.7) * jitterAmt;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const JITTER_FRAG = /* glsl */`
  varying vec3 vNormal;
  void main() {
    float d = dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    gl_FragColor = vec4(vec3(0.04 + d * 0.04), 1.0);
  }
`;

const STATES = { WANDER: 'wander', INVESTIGATE: 'investigate', CHASE: 'chase', LOSE: 'lose' };

export class Entity {
  constructor(scene, chunks) {
    this.scene = scene;
    this.chunks = chunks;
    this.position = new THREE.Vector3();
    this.state = STATES.WANDER;
    this.enabled = false;

    this.material = new THREE.ShaderMaterial({
      vertexShader: JITTER_VERT,
      fragmentShader: JITTER_FRAG,
      uniforms: {
        time: { value: 0 },
        jitterAmt: { value: 0.02 },
      },
      side: THREE.DoubleSide,
    });

    this.mesh = this._buildMesh();
    this.mesh.visible = false;
    scene.add(this.mesh);

    // Navigation
    this.path = [];
    this.pathTimer = 0;
    this.pathRecomputeInterval = 1 / CONFIG.entity.pathRecomputeHz;
    this.target = null;
    this.noiseTarget = null;
    this.loseTimer = 0;
    this.gracePeriod = 0;
    this.footstepTimer = 0;
    this.spawnTimer = 0;
    this.spawned = false;
    this.elapsed = 0;

    // Path debug (dev).
    this.pathLine = null;
    this.stateLabelEl = null;
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
    const { mergeGeometries } = THREE;
    // three r165+ has mergeGeometries on BufferGeometryUtils, not THREE directly.
    // Build manually.
    const group = new THREE.Group();
    for (const geo of parts) {
      group.add(new THREE.Mesh(geo, this.material));
    }
    return group;
  }

  spawn(x, z) {
    this.position.set(x, 0, z);
    this.mesh.position.set(x, 0, z);
    this.mesh.visible = true;
    this.enabled = true;
    this.state = STATES.WANDER;
    initEntityAudio();
  }

  disable() {
    this.enabled = false;
    this.mesh.visible = false;
  }

  update(dt, playerPos, playerCamera, pressure, lightPool, noiseEvents) {
    if (!this.enabled) return;
    this.elapsed += dt;
    this.material.uniforms.time.value = this.elapsed;

    // Pressure-scaled jitter.
    this.material.uniforms.jitterAmt.value = 0.02 + pressure * 0.06;

    // Check noise events for investigation.
    this._checkNoiseEvents(noiseEvents);

    // Grace period (after losing player).
    if (this.gracePeriod > 0) {
      this.gracePeriod -= dt;
      if (this.gracePeriod < 0) this.gracePeriod = 0;
    }

    // LoS check.
    const hasLos = this._hasLoS(playerPos);

    // State machine.
    switch (this.state) {
      case STATES.WANDER:
        this._wander(dt, playerPos, lightPool);
        if (hasLos) {
          const d = this.position.distanceTo(playerPos);
          if (d < CONFIG.entity.chaseLosDist && this.gracePeriod <= 0) this._setState(STATES.CHASE);
        }
        break;
      case STATES.INVESTIGATE:
        this._investigate(dt, playerPos);
        if (hasLos && this.gracePeriod <= 0) {
          const d = this.position.distanceTo(playerPos);
          if (d < CONFIG.entity.chaseLosDist) this._setState(STATES.CHASE);
        }
        break;
      case STATES.CHASE:
        this._chase(dt, playerPos, pressure);
        if (!hasLos) {
          this.loseTimer += dt;
          if (this.loseTimer > CONFIG.entity.loseDist) this._setState(STATES.LOSE);
        } else {
          this.loseTimer = 0;
        }
        // Caught?
        if (this.position.distanceTo(playerPos) < CONFIG.entity.caughtDist) {
          document.dispatchEvent(new CustomEvent('entity-caught'));
        }
        break;
      case STATES.LOSE:
        this._wander(dt, playerPos, lightPool);
        // Grace period starts when we lose the player.
        if (this.loseTimer === 0) {
          this.gracePeriod = CONFIG.entity.gracePeriod;
        }
        this._setState(STATES.WANDER);
        break;
    }

    // Footsteps.
    this.footstepTimer -= dt;
    if (this.footstepTimer <= 0 && this.state !== STATES.WANDER) {
      this.footstepTimer = this.state === STATES.CHASE ? 0.3 : 0.5;
      playEntityFootstep(this.position.x, this.position.y, this.position.z);
    }

    // Audio.
    updateEntityAudio(dt, this.position, playerPos, this.state);

    // Mesh follows position.
    this.mesh.position.copy(this.position);
    // Face movement direction.
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
    if (s === STATES.WANDER) this.target = null;
  }

  _hasLoS(playerPos) {
    return this.chunks.hasLineOfSight(this.position.x, this.position.z, playerPos.x, playerPos.z);
  }

  _wander(dt, playerPos, lightPool) {
    if (!this.target || this.position.distanceTo(this.target) < 1.5) {
      // Pick a new wander target: a random point 8-20m away.
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 12;
      this.target = new THREE.Vector3(
        this.position.x + Math.cos(angle) * dist,
        0,
        this.position.z + Math.sin(angle) * dist
      );
    }
    this._moveToward(dt, this.target, CONFIG.entity.wanderSpeed);
  }

  _investigate(dt, playerPos) {
    if (this.noiseTarget) {
      this._moveToward(dt, this.noiseTarget, CONFIG.entity.investigateSpeed);
      if (this.position.distanceTo(this.noiseTarget) < 2) {
        this.noiseTarget = null;
        this._setState(STATES.WANDER);
      }
    } else {
      this._setState(STATES.WANDER);
    }
  }

  _chase(dt, playerPos, pressure) {
    const speed = CONFIG.entity.chaseSpeed * (1 + pressure * (CONFIG.entity.rampSpeedMax - 1));
    // Recompute path at 2 Hz.
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = this.pathRecomputeInterval;
      this.path = this._astar(this.position, playerPos);
    }
    if (this.path.length > 0) {
      const next = this.path[0];
      const d = this.position.distanceTo(next);
      if (d < 0.5) this.path.shift();
      else this._moveToward(dt, next, speed);
    } else {
      this._moveToward(dt, playerPos, speed);
    }
  }

  _moveToward(dt, target, speed) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return;
    const step = Math.min(speed * dt, dist);
    this.position.x += (dx / dist) * step;
    this.position.z += (dz / dist) * step;
  }

  // A* on the cell grid of loaded chunks. Capped at 4000 node expansions.
  _astar(from, to) {
    const C = CONFIG.world.cellSize;
    const toCell = (x, z) => [Math.floor(x / C), Math.floor(z / C)];
    const toWorld = (gx, gz) => new THREE.Vector3((gx + 0.5) * C, 0, (gz + 0.5) * C);

    const [sx, sz] = toCell(from.x, from.z);
    const [ex, ez] = toCell(to.x, to.z);
    if (sx === ex && sz === ez) return [to.clone()];

    const key = (x, z) => `${x},${z}`;
    const heur = (x, z) => Math.abs(x - ex) + Math.abs(z - ez);

    const open = new Map();
    const closed = new Set();
    const cameFrom = new Map();
    const g = new Map();
    const f = new Map();

    const startKey = key(sx, sz);
    g.set(startKey, 0);
    f.set(startKey, heur(sx, sz));
    open.set(startKey, [sx, sz]);

    let expansions = 0;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    while (open.size > 0 && expansions < CONFIG.entity.pathMaxExpansions) {
      // Find min f in open.
      let minF = Infinity, minKey = null;
      for (const [k] of open) {
        const fv = f.get(k) ?? Infinity;
        if (fv < minF) { minF = fv; minKey = k; }
      }
      if (!minKey) break;
      const [cx, cz] = open.get(minKey);
      open.delete(minKey);
      if (cx === ex && cz === ez) {
        // Reconstruct.
        const path = [];
        let ck = minKey;
        while (cameFrom.has(ck)) {
          const [nx, nz] = cameFrom.get(ck).split(',').map(Number);
          path.unshift(toWorld(nx, nz));
          ck = cameFrom.get(ck);
        }
        path.push(to.clone());
        return path;
      }
      closed.add(minKey);
      expansions++;

      for (const [dx, dz] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        const nk = key(nx, nz);
        if (closed.has(nk)) continue;
        // Check walkable: no collider at centre of cell.
        const wx = (nx + 0.5) * C, wz = (nz + 0.5) * C;
        const boxes = this.chunks.query(wx, wz, 0.25, []);
        if (boxes.length > 0) continue;
        const ng = (g.get(minKey) ?? 0) + 1;
        if (ng < (g.get(nk) ?? Infinity)) {
          cameFrom.set(nk, minKey);
          g.set(nk, ng);
          f.set(nk, ng + heur(nx, nz));
          open.set(nk, [nx, nz]);
        }
      }
    }
    // Fallback: straight line.
    return [to.clone()];
  }

  _checkNoiseEvents(noiseEvents) {
    if (!noiseEvents) return;
    const E = CONFIG.entity;
    const hearRadius = E.hearingRadius;
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
        this.position.set(
          playerPos.x + Math.sin(yaw) * backDist,
          0,
          playerPos.z + Math.cos(yaw) * backDist
        );
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
    for (const p of this.path) { p.x -= dx; p.z -= dz; }
    rebaseEntityAudio(dx, dz);
  }

  // Exported for lighting system (phase 6 spec).
  flickerIntensityAt(lightPool) {
    if (!lightPool) return 1;
    return lightPool.flickerIntensityAt(this.position.x, this.position.y, this.position.z);
  }
}
