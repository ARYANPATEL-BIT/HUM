import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createBreakerTask } from './breaker.js';
import { createRadioTask } from './radio.js';
import { createKeypadTask } from './keypad.js';
import { setMuffle } from '../audio/audio.js';
import { playExitTone } from '../audio/tasks.js';
import { TASK_TYPES } from '../world/taskObjects.js';

// Task manager: interaction, overlay routing, cassette carrying, exit door, win/lose.
// Opening an overlay releases pointer lock; main.js re-locks from the close button and treats
// Esc as pause, so the overlay never trips the normal "lost lock → paused" path.
export class TaskManager {
  constructor(scene, chunks, taskObjects, seed, player) {
    this.scene = scene;
    this.chunks = chunks;
    this.taskObjects = taskObjects;
    this.seed = seed;
    this.player = player;
    this.lightPool = null; // set by main.js

    this.activeTask = null; // open overlay task, or the breaker being held
    this.overlayOpen = false;
    this.carrying = null; // cassette task object while carried

    this.completedTypes = new Set();
    this.exitDoor = null; // { mesh, wx, wz, tone }
    this.won = false;
    this.lost = false;

    this.timeLeft = CONFIG.game.timer;
    this.timerRunning = false;
  }

  start() { this.timerRunning = true; }
  pause() { this.timerRunning = false; }

  update(dt, player, input) {
    if (this.lost || this.won) return;

    if (this.timerRunning && !this.overlayOpen) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._triggerLose();
        return;
      }
    }

    if (!this.overlayOpen && input.wasPressed('KeyE')) this._tryInteract(player);

    // Radio / keypad report completion through `done`.
    if (this.overlayOpen && this.activeTask?.done) this._complete(this.activeTask.taskObj);

    if (this.exitDoor) {
      const d = Math.hypot(player.position.x - this.exitDoor.wx, player.position.z - this.exitDoor.wz);
      if (d < 2.0) this._triggerWin();
    }
  }

  _facing(player, t, minDot) {
    const dx = t.wx - player.position.x;
    const dz = t.wz - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist === 0) return true;
    return (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / dist >= minDot;
  }

  _tryInteract(player) {
    const pos = player.position;
    const G = CONFIG.game;

    // Deliver the carried cassette to a tape player in another chunk.
    if (this.carrying) {
      const c = this.carrying;
      for (const t of this.taskObjects.tapes) {
        if (t.cx === c.cx && t.cz === c.cz) continue;
        if (Math.hypot(pos.x - t.wx, pos.z - t.wz) < G.cassetteDeliverRange) {
          this.carrying = null;
          this._complete(c);
          return;
        }
      }
    }

    for (const t of this.taskObjects.active) {
      if (Math.hypot(pos.x - t.wx, pos.z - t.wz) > G.interactRange) continue;
      if (!this._facing(player, t, G.interactFacingDot)) continue;
      this._open(t);
      return;
    }
  }

  _open(t) {
    if (t.type === 'breaker') {
      this.activeTask = createBreakerTask(t, this.lightPool);
    } else if (t.type === 'cassette') {
      if (this.carrying) return;
      this.carrying = t;
      t.carried = true;
      if (t.mesh) t.mesh.visible = false;
    } else if (t.type === 'radio') {
      this.activeTask = createRadioTask(t, this.seed);
      this._showOverlay('radio-overlay');
    } else if (t.type === 'keypad') {
      this.activeTask = createKeypadTask(t, this.seed);
      this._showOverlay('keypad-overlay');
    }
  }

  _showOverlay(id) {
    document.querySelectorAll('.task-overlay').forEach((el) => el.classList.toggle('active', el.id === id));
    document.getElementById('task-overlay-root').classList.remove('hidden');
    this.overlayOpen = true; // set before the lock change event fires
    document.exitPointerLock();
    setMuffle(true);
  }

  closeOverlay() {
    if (!this.overlayOpen) return;
    document.getElementById('task-overlay-root').classList.add('hidden');
    this.overlayOpen = false;
    this.activeTask = null;
    setMuffle(false);
  }

  // Breaker has no overlay: hold E while facing it.
  updateBreaker(dt, player, input) {
    const task = this.activeTask;
    if (task?.type !== 'breaker') return;
    const t = task.taskObj;
    if (Math.hypot(t.wx - player.position.x, t.wz - player.position.z) > CONFIG.game.interactRange * 1.5) {
      this.activeTask = null; // walked away
      return;
    }
    const lookingAway = !this._facing(player, t, 0.3);
    if (task.update(dt, input.isDown('KeyE'), player.speed > 0.5, lookingAway)) this._complete(t);
  }

  _complete(t) {
    this.taskObjects.markCompleted(t.id);
    this.completedTypes.add(t.type);
    this.closeOverlay();
    this.activeTask = null;
    document.dispatchEvent(new CustomEvent('task-complete', { detail: { type: t.type } }));
    if (!this.exitDoor && TASK_TYPES.every((ty) => this.completedTypes.has(ty))) this._spawnExit();
  }

  // Exit door: a cell centre ~exitSpawnDist from the player, facing them.
  _spawnExit() {
    const C = CONFIG.world.cellSize;
    const p = this.player.position;
    const angle = Math.random() * Math.PI * 2;
    const wx = (Math.floor((p.x + Math.cos(angle) * CONFIG.game.exitSpawnDist) / C) + 0.5) * C;
    const wz = (Math.floor((p.z + Math.sin(angle) * CONFIG.game.exitSpawnDist) / C) + 0.5) * C;
    const props = this.taskObjects.props;
    const mesh = new THREE.Mesh(props.geometries.exit, props.materials.exit);
    mesh.position.set(wx, this.chunks.groundAt(wx, wz), wz);
    mesh.rotation.y = Math.atan2(p.x - wx, p.z - wz);
    this.scene.add(mesh);
    this.exitDoor = { mesh, wx, wz, tone: playExitTone(wx, 1.4, wz) };
    document.dispatchEvent(new CustomEvent('exit-spawned'));
  }

  rebase(dx, dz) {
    const door = this.exitDoor;
    if (!door) return;
    door.wx -= dx;
    door.wz -= dz;
    door.mesh.position.x -= dx;
    door.mesh.position.z -= dz;
    if (door.tone) {
      door.tone.panner.positionX.value -= dx;
      door.tone.panner.positionZ.value -= dz;
    }
  }

  _triggerWin() {
    this.won = true;
    this.timerRunning = false;
    this.exitDoor.tone?.stop();
    document.dispatchEvent(new CustomEvent('game-end', { detail: { won: true, timeLeft: this.timeLeft } }));
  }

  _triggerLose() {
    this.lost = true;
    this.timerRunning = false;
    document.dispatchEvent(new CustomEvent('game-end', { detail: { won: false, timeLeft: 0 } }));
  }

  // Dev: complete the open task, or the nearest active one.
  devCompleteTask() {
    if (this.activeTask?.devComplete) return this.activeTask.devComplete();
    const t = this.devNearestTask(this.player.position);
    if (t) this._complete(t);
  }

  // Dev: +/- 60s.
  devAddTime(s) { this.timeLeft = Math.max(0, this.timeLeft + s); }

  devNearestTask(playerPos) {
    let best = null, bestD = Infinity;
    for (const t of this.taskObjects.active) {
      const d = Math.hypot(t.wx - playerPos.x, t.wz - playerPos.z);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }
}
