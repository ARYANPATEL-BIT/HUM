import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createBreakerTask } from './breaker.js';
import { createRadioTask } from './radio.js';
import { createCassetteTask, isCarryingCassette } from './cassette.js';
import { createKeypadTask, makeCodeTexture } from './keypad.js';
import { setMuffle } from '../audio/audio.js';
import { playExitTone } from '../audio/tasks.js';
import { hash, mulberry32 } from '../core/rng.js';

// Task manager: interaction, overlay routing, exit door, win/lose.
export class TaskManager {
  constructor(scene, chunks, taskObjects, seed, gfx) {
    this.scene = scene;
    this.chunks = chunks;
    this.taskObjects = taskObjects;
    this.seed = seed;
    this.gfx = gfx;
    this.lightPool = null; // set by main.js

    this.activeTask = null; // currently open overlay task
    this.overlayOpen = false;

    this.completedTypes = new Set();
    this.allTypesRequired = ['breaker', 'radio', 'cassette', 'keypad'];

    this.exitDoor = null; // { mesh, wx, wz, tone }
    this.exitSpawned = false;
    this.won = false;
    this.lost = false;

    // Keypad code wall quads: chunkKey → mesh
    this.codeQuads = new Map();

    // Timer
    this.timeLeft = CONFIG.game.timer;
    this.timerRunning = false;

    // Cassette delivery point tracking.
    this.cassetteTask = null;
    this.cassetteTapePlayer = null; // { wx, wz }

    this.interactBoxes = []; // for collision query reuse
  }

  start() { this.timerRunning = true; }
  pause() { this.timerRunning = false; }

  update(dt, player, input) {
    if (this.lost || this.won) return;

    // Timer
    if (this.timerRunning && !this.overlayOpen) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._triggerLose(player);
        return;
      }
    }

    // Escape closes overlay.
    if (this.overlayOpen && input.wasPressed('Escape')) {
      this.closeOverlay();
      return;
    }

    // E interaction.
    if (!this.overlayOpen && input.wasPressed('KeyE')) {
      this._tryInteract(player);
    }

    // Active overlay task update.
    if (this.overlayOpen && this.activeTask) {
      this._updateActiveTask(dt, player, input);
    }

    // Exit door check.
    if (this.exitDoor && !this.won) {
      const d = Math.hypot(player.position.x - this.exitDoor.wx, player.position.z - this.exitDoor.wz);
      if (d < 2.0) this._triggerWin();
    }
  }

  _tryInteract(player) {
    const pos = player.position;
    const G = CONFIG.game;
    const tasks = this.taskObjects.active;

    // Check cassette delivery first.
    if (isCarryingCassette() && this.cassetteTapePlayer) {
      const d = Math.hypot(pos.x - this.cassetteTapePlayer.wx, pos.z - this.cassetteTapePlayer.wz);
      if (d < G.cassetteDeliverRange) {
        this._completeTask('cassette', null);
        if (this.cassetteTask) this.cassetteTask.putDown();
        return;
      }
    }

    for (const taskObj of tasks) {
      const d = Math.hypot(pos.x - taskObj.wx, pos.z - taskObj.wz);
      if (d > G.interactRange) continue;
      // Facing check: dot product of forward direction with (task - player).
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      const dx = taskObj.wx - pos.x;
      const dz = taskObj.wz - pos.z;
      const dist = Math.hypot(dx, dz);
      const dot = dist > 0 ? (-sin * dx / dist + -cos * dz / dist) : 1;
      if (dot < G.interactFacingDot) continue;

      this._openTask(taskObj, player);
      return;
    }

    // Pickup cassette if nearby.
    for (const taskObj of tasks) {
      if (taskObj.type !== 'cassette') continue;
      const d = Math.hypot(pos.x - taskObj.wx, pos.z - taskObj.wz);
      if (d > G.interactRange) continue;
      if (this.cassetteTask && !this.cassetteTask.isCarried) {
        this.cassetteTask.pickup();
      }
    }
  }

  _openTask(taskObj, player) {
    const type = taskObj.type;
    let task;
    if (type === 'breaker') {
      task = createBreakerTask(taskObj, this.lightPool);
      // Breaker doesn't open an overlay.
      this.activeTask = task;
      return;
    } else if (type === 'radio') {
      task = createRadioTask(taskObj, this.seed);
      this._showOverlay('radio-overlay');
    } else if (type === 'cassette') {
      if (!this.cassetteTask) this.cassetteTask = createCassetteTask(taskObj);
      this.cassetteTask.pickup();
      return; // no overlay
    } else if (type === 'keypad') {
      task = createKeypadTask(taskObj, this.seed);
      this._showOverlay('keypad-overlay');
    }
    this.activeTask = task;
  }

  _showOverlay(id) {
    document.querySelectorAll('.task-overlay').forEach((el) => el.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    document.getElementById('task-overlay-root')?.classList.remove('hidden');
    this.overlayOpen = true;
    setMuffle(true);
  }

  closeOverlay() {
    document.getElementById('task-overlay-root')?.classList.add('hidden');
    document.querySelectorAll('.task-overlay').forEach((el) => el.classList.remove('active'));
    this.overlayOpen = false;
    if (this.activeTask?.type !== 'breaker') this.activeTask = null;
    setMuffle(false);
  }

  _updateActiveTask(dt, player, input) {
    const task = this.activeTask;
    if (!task) return;
    if (task.type === 'radio' && task.done) {
      this._completeTask('radio', task);
      return;
    }
    if (task.type === 'keypad' && task.done) {
      this._completeTask('keypad', task);
      return;
    }
  }

  // Breaker is updated from player controller (no overlay), checked here.
  updateBreaker(dt, player, input) {
    if (!this.activeTask || this.activeTask.type !== 'breaker') return;
    const task = this.activeTask;
    const holding = input.isDown('KeyE');
    const moving = player.speed > 0.5;
    // Looking away: task obj must be in front.
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const dx = task.taskObj.wx - player.position.x;
    const dz = task.taskObj.wz - player.position.z;
    const dist = Math.hypot(dx, dz);
    const dot = dist > 0 ? (-sin * dx / dist + -cos * dz / dist) : 1;
    const lookingAway = dot < 0.3;

    if (dist > CONFIG.game.interactRange * 1.5) {
      // Left the task area, cancel.
      this.activeTask = null;
      return;
    }

    const done = task.update(dt, holding, moving, lookingAway);
    if (done) {
      this._completeTask('breaker', task);
    }
  }

  _completeTask(type, task) {
    this.completedTypes.add(type);
    if (task) {
      this.taskObjects.markCompleted(task.taskObj.id);
      task.dispose?.();
    }
    this.activeTask = null;
    if (this.overlayOpen) this.closeOverlay();
    document.dispatchEvent(new CustomEvent('task-complete', { detail: { type } }));

    // Check if all tasks done → spawn exit.
    if (this.completedTypes.size >= this.allTypesRequired.length && !this.exitSpawned) {
      this._spawnExit();
    }
  }

  _spawnExit() {
    this.exitSpawned = true;
    // Exit door goes ~50m ahead of origin.
    const angle = Math.random() * Math.PI * 2;
    const dist = CONFIG.game.exitSpawnDist;
    const wx = Math.cos(angle) * dist;
    const wz = Math.sin(angle) * dist;

    // Simple marker mesh.
    const geo = new THREE.BoxGeometry(1.5, 2.8, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(wx, 1.4, wz);
    this.scene.add(mesh);

    const tone = playExitTone(wx, 1.4, wz);
    this.exitDoor = { mesh, wx, wz, tone };
    document.dispatchEvent(new CustomEvent('exit-spawned'));
  }

  _triggerWin() {
    this.won = true;
    this.timerRunning = false;
    if (this.exitDoor?.tone) this.exitDoor.tone.stop();
    document.dispatchEvent(new CustomEvent('game-end', { detail: { won: true, timeLeft: this.timeLeft } }));
  }

  _triggerLose() {
    this.lost = true;
    this.timerRunning = false;
    document.dispatchEvent(new CustomEvent('game-end', { detail: { won: false, timeLeft: 0 } }));
  }

  // Dev: instant-complete current task.
  devCompleteTask() {
    if (this.activeTask?.devComplete) {
      this.activeTask.devComplete();
    } else {
      // Complete the first nearby incomplete task.
      const tasks = this.taskObjects.active;
      if (tasks.length) this._completeTask(tasks[0].type, { taskObj: tasks[0], dispose: () => {} });
    }
  }

  // Dev: +/- 60s.
  devAddTime(s) { this.timeLeft = Math.max(0, this.timeLeft + s); }

  // Dev: teleport to nearest task.
  devNearestTask(playerPos) {
    let best = null, bestD = Infinity;
    for (const t of this.taskObjects.active) {
      const d = Math.hypot(t.wx - playerPos.x, t.wz - playerPos.z);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ? { x: best.wx, z: best.wz } : null;
  }
}
