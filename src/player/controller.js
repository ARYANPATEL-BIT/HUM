import * as THREE from 'three';
import { CONFIG } from '../config.js';

// First-person controller: mouse look, WASD with smoothed velocity, sprint, wall collision.
// position is at the player's feet; the camera sits eyeHeight above it.
export class PlayerController {
  constructor(camera, input, collision, groundAt = () => 0) {
    this.camera = camera;
    this.input = input;
    this.collision = collision;
    this.groundAt = groundAt;
    this.distanceWalked = 0;
    this.noclip = false; // dev only
    this.autoRun = false; // dev only: run straight ahead at dev.autoRunSpeed, noclip
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector2(); // x, z in m/s
    this.yaw = 0;
    this.pitch = 0;
    this.sprinting = false;
  }

  spawn(x, z, yaw = 0) {
    this.position.set(x, this.groundAt(x, z), z);
    this.velocity.set(0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.syncCamera();
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
    if (input.isDown('KeyW', 'ArrowUp')) f += 1;
    if (input.isDown('KeyS', 'ArrowDown')) f -= 1;
    if (input.isDown('KeyD', 'ArrowRight')) s += 1;
    if (input.isDown('KeyA', 'ArrowLeft')) s -= 1;

    if (this.autoRun) {
      f = 1;
      s = 0;
    }
    const moving = f !== 0 || s !== 0;
    this.sprinting = moving && f > 0 && input.isDown('ShiftLeft', 'ShiftRight');
    let speed = this.sprinting ? pc.sprintSpeed : pc.walkSpeed;
    if (this.autoRun) speed = CONFIG.dev.autoRunSpeed;

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
    if (this.noclip || this.autoRun) {
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.y * dt;
    } else {
      this.collision.move(this.position, this.velocity.x * dt, this.velocity.y * dt, pc.radius);
    }
    const mx = this.position.x - bx;
    const mz = this.position.z - bz;
    this.distanceWalked += Math.hypot(mx, mz);

    // Bleed off velocity that walls absorbed so we don't "stick" and then shoot off a corner.
    if (dt > 0) {
      this.velocity.x = mx / dt;
      this.velocity.y = mz / dt;
    }

    // Follow the ground height (stairs) smoothly rather than snapping step by step.
    const ground = this.groundAt(this.position.x, this.position.z);
    this.position.y += (ground - this.position.y) * (1 - Math.exp(-pc.stepSmoothing * dt));

    this.syncCamera();
  }

  get speed() {
    return this.velocity.length();
  }

  syncCamera() {
    this.camera.position.set(this.position.x, this.position.y + CONFIG.player.eyeHeight, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
