import { CONFIG } from '../config.js';
import { noiseEvents } from '../entity/noiseEvents.js';
import { playBreath } from '../audio/items.js';

// Hiding: hold C at a desk or cupboard (spots come from chunk data, see placeHidingSpots). While hidden the
// player's position is the spot's centre, the camera sits under the desk or inside the cupboard and only
// mouse look works. `found` = the entity knows where they are (Entity.update decides when).
// Breathing gets loud after breathAfter seconds and then makes noise the entity can hear.
const lerp = (a, b, k) => a + (b - a) * k;

export class Hiding {
  constructor(chunks) {
    this.chunks = chunks;
    this.spot = null; // scene-space copy of the spot while hidden
    this.time = 0;
    this.found = false;
    this.breathT = 0;
    this.backX = 0;
    this.backZ = 0;
  }

  get active() { return this.spot !== null; }
  get breathing() { return this.time > CONFIG.hiding.breathAfter; }

  // The spot whose front the player is standing at (scene coords), or null.
  near(pos) {
    let best = null;
    let bestD = CONFIG.hiding.reach;
    for (const c of this.chunks.chunks.values()) {
      for (const s of c.data.hiding) {
        const d = Math.hypot(c.ox + s.fx - pos.x, c.oz + s.fz - pos.z);
        if (d < bestD) { bestD = d; best = { c, s }; }
      }
    }
    return best && { ...best.s, x: best.c.ox + best.s.x, z: best.c.oz + best.s.z };
  }

  enter(spot, player, entity) {
    this.spot = spot;
    this.time = 0;
    this.breathT = 1;
    this.backX = player.position.x;
    this.backZ = player.position.z;
    // It saw you get in.
    this.found = entity.enabled && entity.state === 'chase' && entity.position.distanceTo(player.position) < CONFIG.hiding.spottedDist;
    player.position.x = spot.x;
    player.position.z = spot.z;
    player.velocity.set(0, 0);
    player.sprinting = false;
    player.yaw = spot.yaw + Math.PI; // face out (forward is (-sin, -cos) of yaw)
    player.pitch = 0;
  }

  exit(player) {
    player.position.x = this.backX;
    player.position.z = this.backZ;
    this.spot = null;
    player.syncCamera();
  }

  update(dt, player, camera) {
    const H = CONFIG.hiding;
    this.time += dt;
    this.breathT -= dt;
    if (this.breathT <= 0) {
      const k = Math.min(1, Math.max(0, (this.time - H.breathAfter) / H.breathRamp));
      this.breathT = lerp(H.breathPeriod[0], H.breathPeriod[1], k);
      playBreath(lerp(H.breathGain[0], H.breathGain[1], k));
      if (this.breathing) noiseEvents.emit(this.spot.x, this.spot.z, lerp(H.breathNoise[0], H.breathNoise[1], k));
    }
    this.syncCamera(player, camera);
  }

  syncCamera(player, camera) {
    const s = this.spot;
    const T = CONFIG.hiding[s.type];
    camera.position.set(s.x + Math.sin(s.yaw) * T.inset, player.position.y + T.eye, s.z + Math.cos(s.yaw) * T.inset);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  rebase(dx, dz) {
    this.backX -= dx;
    this.backZ -= dz;
    if (this.spot) { this.spot.x -= dx; this.spot.z -= dz; }
  }
}
