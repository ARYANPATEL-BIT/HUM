import * as THREE from 'three';
import { CONFIG } from '../config.js';

// First-person controller: mouse look, WASD with smoothed velocity, sprint with stamina, wall collision,
// head bob. position is at the player's feet; the camera sits eyeHeight above it (plus the bob).
// `stepped` is true on the frame a foot lands (footsteps play on it).
export class PlayerController {
  constructor(camera, input, collision, groundAt = () => 0) {
    this.camera = camera;
    this.input = input;
    this.collision = collision;
    this.groundAt = groundAt;
    this.distanceWalked = 0;
    this.autoRun = 0; // dev only: speed of a straight-ahead noclip run (0 = off)
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector2(); // x, z in m/s
    this.yaw = 0;
    this.pitch = 0;
    this.sprinting = false;
    this.canSprint = true; // false while carrying the cassette
    this.frozen = false; // reading a note: no movement, look still works
    this.stamina = 1;
    this.exhausted = false;
    this.staminaIdle = 0; // seconds since sprint last drained stamina
    this.stepPhase = 0; // steps taken, fractional
    this.stepped = false;
    this.bobAmount = 0;
  }

  spawn(x, z, yaw = 0) {
    this.position.set(x, this.groundAt(x, z), z);
    this.velocity.set(0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.syncCamera();
  }

  // Water bottle.
  refillStamina() {
    this.stamina = 1;
    this.exhausted = false;
  }

  update(dt) {
    const pc = CONFIG.player;
    const ic = CONFIG.input;
    const input = this.input;

    // --- look ---
    const { dx, dy } = input.consumeMouse();
    this.yaw -= dx * ic.mouseSensitivity;
    this.pitch -= dy * ic.mouseSensitivity * (ic.invertY ? -1 : 1);
    this.pitch = Math.max(-ic.pitchLimit, Math.min(ic.pitchLimit, this.pitch));

    // --- move ---
    let f = 0;
    let s = 0;
    if (!this.frozen) {
      if (input.isDown('KeyW', 'ArrowUp')) f += 1;
      if (input.isDown('KeyS', 'ArrowDown')) f -= 1;
      if (input.isDown('KeyD', 'ArrowRight')) s += 1;
      if (input.isDown('KeyA', 'ArrowLeft')) s -= 1;
    }

    if (this.autoRun) {
      f = 1;
      s = 0;
    }
    const moving = f !== 0 || s !== 0;
    const wantSprint = moving && f > 0 && this.canSprint && input.isDown('ShiftLeft', 'ShiftRight');
    this.sprinting = wantSprint && !this.exhausted;
    this.updateStamina(dt);
    let speed = this.sprinting ? pc.sprintSpeed : pc.walkSpeed;
    if (this.autoRun) speed = this.autoRun;

    // Camera looks down -Z at yaw 0. Forward = (-sin, -cos), right = (cos, -sin).
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx = (wx / wl) * speed;
      wz = (wz / wl) * speed;
    }

    // Frame-rate independent exponential smoothing toward the target velocity.
    const rate = moving ? pc.accel : pc.decel;
    const k = 1 - Math.exp(-rate * dt);
    this.velocity.x += (wx - this.velocity.x) * k;
    this.velocity.y += (wz - this.velocity.y) * k;

    const bx = this.position.x;
    const bz = this.position.z;
    if (this.autoRun) {
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.y * dt;
    } else {
      this.collision.move(this.position, this.velocity.x * dt, this.velocity.y * dt, pc.radius);
    }
    const mx = this.position.x - bx;
    const mz = this.position.z - bz;
    const moved = Math.hypot(mx, mz);
    this.distanceWalked += moved;

    // Bleed off velocity that walls absorbed so we don't "stick" and then shoot off a corner.
    if (dt > 0) {
      this.velocity.x = mx / dt;
      this.velocity.y = mz / dt;
    }

    // Steps: the phase advances with distance; a foot lands on every whole step.
    const sprintT = Math.min(1, Math.max(0, (this.speed - pc.walkSpeed) / (pc.sprintSpeed - pc.walkSpeed)));
    const stride = pc.stride[0] + (pc.stride[1] - pc.stride[0]) * sprintT;
    const before = Math.floor(this.stepPhase);
    if (this.speed > 0.3) this.stepPhase += moved / stride;
    this.stepped = Math.floor(this.stepPhase) !== before;
    const bobTarget = this.speed > 0.3 ? Math.min(1, this.speed / pc.walkSpeed) * (1 + sprintT * (pc.bob.sprintScale - 1)) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * (1 - Math.exp(-pc.bob.fade * dt));

    // Follow the ground height (stairs) smoothly rather than snapping step by step.
    const ground = this.groundAt(this.position.x, this.position.z);
    this.position.y += (ground - this.position.y) * (1 - Math.exp(-pc.stepSmoothing * dt));

    this.syncCamera();
  }

  updateStamina(dt) {
    const S = CONFIG.player.stamina;
    if (this.sprinting && this.speed > 0.5) {
      this.stamina = Math.max(0, this.stamina - S.drain * dt);
      this.staminaIdle = 0;
      if (this.stamina === 0) this.exhausted = true;
    } else {
      this.staminaIdle += dt;
      if (this.staminaIdle > S.regenDelay) this.stamina = Math.min(1, this.stamina + S.regen * dt);
      if (this.exhausted && this.stamina >= S.minToSprint) this.exhausted = false;
    }
  }

  get speed() {
    return this.velocity.length();
  }

  syncCamera() {
    const B = CONFIG.player.bob;
    let bobY = 0;
    let bobX = 0;
    if (B.enabled) {
      // Lowest point when a foot lands (whole step), sideways sway over a two-step stride.
      bobY = -((1 + Math.cos(this.stepPhase * Math.PI * 2)) / 2) * B.vertical * this.bobAmount;
      bobX = Math.sin(this.stepPhase * Math.PI) * B.sideways * this.bobAmount;
    }
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.camera.position.set(
      this.position.x + cos * bobX,
      this.position.y + CONFIG.player.eyeHeight + bobY,
      this.position.z - sin * bobX
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
