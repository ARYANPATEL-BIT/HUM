import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createRenderer } from './core/renderer.js';
import { GameLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { StateMachine } from './core/stateMachine.js';
import { resolveSeed } from './core/rng.js';
import { CollisionWorld } from './player/collision.js';
import { PlayerController } from './player/controller.js';
import { createAssets } from './world/assets.js';
import { ChunkManager } from './world/chunkManager.js';
import { LightPool } from './world/lighting.js';
import { Menus, isTouchOnlyDevice } from './ui/menus.js';
import { HUD, showEndScreen } from './ui/hud.js';
import { TaskObjects } from './world/taskObjects.js';
import { TaskManager } from './tasks/taskManager.js';
import { Entity } from './entity/entity.js';
import { noiseEvents } from './entity/noiseEvents.js';
import { initAudio, isReady } from './audio/audio.js';
import { initHum, updateHumPanners, updateListener, setHumPitch, triggerCrackle, rebaseHumPanners } from './audio/hum.js';
import { updateFootsteps } from './audio/footsteps.js';
import { updateTaskAudio, rebaseTaskAudio } from './audio/tasks.js';

const menus = new Menus(document.getElementById('overlay'));

if (isTouchOnlyDevice()) {
  menus.show('touch');
} else {
  boot();
}

function boot() {
  const seed = resolveSeed();
  document.getElementById('seed').textContent = seed;

  const gfx = createRenderer(document.getElementById('app'));
  const A = CONFIG.atmosphere;
  gfx.scene.add(new THREE.HemisphereLight(A.hemi.sky, A.hemi.ground, A.hemi.intensity));

  const input = new Input(gfx.renderer.domElement);
  const assets = createAssets(gfx.renderer);
  const chunks = new ChunkManager(gfx.scene, seed, assets);
  const lightPool = new LightPool(gfx.scene);
  lightPool.onFlicker = triggerCrackle;
  chunks.lightPool = lightPool;

  const collision = new CollisionWorld(chunks);
  const player = new PlayerController(gfx.camera, input, collision, (x, z) => chunks.groundAt(x, z));

  // Task system.
  const taskObjects = new TaskObjects(seed, chunks.size, assets);
  chunks.onChunkLoaded = (chunk) => taskObjects.placeChunk(chunk, player.position);
  chunks.onChunkUnloaded = (key, chunk) => taskObjects.unplaceChunk(key, chunk);

  const taskManager = new TaskManager(gfx.scene, chunks, taskObjects, seed, player);
  taskManager.lightPool = lightPool;

  // Difficulty picker (title screen). The click then bubbles to the overlay and starts the game.
  document.querySelectorAll('[data-difficulty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      CONFIG.game.timer = CONFIG.game.timers[btn.dataset.difficulty];
      if (btn.dataset.difficulty === 'hard') CONFIG.entity.spawnDelay = 0;
      taskManager.timeLeft = CONFIG.game.timer;
    });
  });

  // Task overlays release pointer lock. The close button re-locks inside its click handler;
  // finishing a task re-locks right after the click that finished it.
  document.querySelectorAll('[data-close-overlay]').forEach((btn) => {
    btn.addEventListener('click', () => {
      taskManager.closeOverlay();
      input.requestLock();
    });
  });
  document.addEventListener('task-complete', () => {
    if (game.is('playing') && !input.locked) input.requestLock();
  });
  input.onLockFail = () => {
    if (game.is('playing') && !input.locked && !taskManager.overlayOpen) game.set('paused');
  };

  const hud = new HUD();
  hud.refreshChecklist();

  // Entity.
  const entity = new Entity(gfx.scene, chunks);
  let entitySpawnTimer = 0;
  let entityEnabled = true;

  // Pressure ramp: 0 at full time, 1 at timeLeft = 0.
  function pressure() {
    return 1 - Math.max(0, taskManager.timeLeft / CONFIG.game.timer);
  }

  // Rebase listeners.
  chunks.onRebase((dx, dz) => {
    taskObjects.rebase(dx, dz);
    taskManager.rebase(dx, dz);
    entity.rebase(dx, dz);
    rebaseTaskAudio(dx, dz);
    rebaseHumPanners(lightPool.lights); // LightPool.rebase already moved the lights
  });

  chunks.preload({ x: 0, z: 0 });
  const spawn = chunks.spawnPoint();
  player.spawn(spawn.x, spawn.z, spawn.yaw);

  let dev = null;
  if (import.meta.env.DEV) {
    import('./core/devTools.js').then(({ DevTools }) => {
      dev = new DevTools(gfx, player, chunks, input, lightPool, entity);
      // Extend dev update for entity / task dev keys.
      const baseUpdate = dev.update.bind(dev);
      dev.update = (dt) => {
        baseUpdate(dt);
        // F1: instant-complete current task.
        if (input.wasPressed('F1')) taskManager.devCompleteTask();
        // F2/F3: add/remove 60s.
        if (input.wasPressed('F2')) taskManager.devAddTime(60);
        if (input.wasPressed('F3')) taskManager.devAddTime(-60);
        // F4: teleport to nearest task.
        if (input.wasPressed('F4')) {
          const t = taskManager.devNearestTask(player.position);
          if (t) { player.position.x = t.wx; player.position.z = t.wz; }
        }
        // F5: toggle entity.
        if (input.wasPressed('F5')) {
          entityEnabled = !entityEnabled;
          if (!entityEnabled) entity.disable();
          else if (entity.spawned) entity.enable();
        }
      };
    });
  }

  // Win/lose events.
  document.addEventListener('game-end', (e) => {
    game.set('end');
    document.exitPointerLock(); // free the cursor for the end-screen buttons
    showEndScreen(
      { ...e.detail, tasks: taskManager.completedTypes.size },
      seed,
      player
    );
  });
  document.addEventListener('entity-caught', () => {
    if (!taskManager.won && !taskManager.lost) {
      taskManager.lost = true;
      taskManager.timerRunning = false;
      document.dispatchEvent(new CustomEvent('game-end', { detail: { won: false, timeLeft: 0, tasks: taskManager.completedTypes.size } }));
    }
  });

  const game = new StateMachine({
    title: { enter: () => menus.show('title') },
    paused: { enter: () => { menus.show('paused'); taskManager.pause(); } },
    playing: {
      enter: () => {
        menus.hide();
        taskManager.start();
        // Init audio on first click.
        if (!isReady()) {
          initAudio();
          initHum(CONFIG.lighting.poolSize);
        }
      },
      update: (dt) => {
        const p = pressure();

        // Esc inside a task overlay (pointer already unlocked): close it and pause.
        if (taskManager.overlayOpen && input.wasPressed('Escape')) {
          taskManager.closeOverlay();
          game.set('paused');
          return;
        }

        // Cassette blocks sprint.
        player.canSprint = !taskManager.carrying;

        if (!taskManager.overlayOpen) player.update(dt);
        chunks.update(player.position);
        lightPool.update(dt, gfx.camera, p); // pressure: shorter flicker gaps, more dead panels

        // Noise events from sprinting.
        if (player.sprinting && player.speed > 2) {
          noiseEvents.emit(player.position.x, player.position.z, CONFIG.entity.hearingRadius * 1.5);
        }

        // Breaker (no overlay).
        taskManager.updateBreaker(dt, player, input);

        taskManager.update(dt, player, input);

        // Entity spawn after delay.
        if (!entity.spawned && entityEnabled) {
          entitySpawnTimer += dt;
          const delay = CONFIG.entity.spawnDelay;
          if (entitySpawnTimer >= delay) {
            entity.spawned = true;
            // Spawn far from player, behind the camera ((sin yaw, cos yaw) points backwards).
            const angle = player.yaw + (Math.random() - 0.5) * Math.PI;
            const dist = CONFIG.entity.spawnMinDist + 5;
            entity.spawn(
              player.position.x + Math.sin(angle) * dist,
              player.position.z + Math.cos(angle) * dist
            );
          }
        }

        if (entity.enabled) {
          entity.update(dt, player.position, gfx.camera, p, noiseEvents);
        } else {
          noiseEvents.flush(); // nobody is listening; don't let events pile up
        }

        // Red vignette: entity within 10m while overlay open.
        if (taskManager.overlayOpen && entity.enabled) {
          const dist = entity.position.distanceTo(player.position);
          const v = dist < CONFIG.entity.overlayWarnDist ? Math.sin(Date.now() / 300) * 0.5 + 0.5 : 0;
          gfx.post.setRedVignette(v);
        } else {
          gfx.post.setRedVignette(0);
        }

        // Hum pitch rises over the last 60 s.
        setHumPitch(Math.max(0, 1 - taskManager.timeLeft / 60) * CONFIG.entity.rampHumPitchHz);

        // Audio update.
        if (isReady()) {
          updateHumPanners(lightPool.lights);
          updateListener(gfx.camera);
          updateFootsteps(dt, player.speed, player.sprinting);
          updateTaskAudio(taskObjects.active, player.position);
        }

        hud.update(taskManager.timeLeft, taskManager, player, input);
      },
    },
    end: {
      enter: () => {
        // End screen is shown via the game-end event handler.
      },
    },
  });
  game.set('title');

  menus.onClick(() => {
    if (game.is('title') || game.is('paused')) input.requestLock();
  });
  input.onLockChange = (locked) => {
    if (locked) game.set('playing');
    else if (game.is('playing') && !taskManager.overlayOpen) game.set('paused');
  };

  new GameLoop((dt, elapsed) => {
    dev?.begin();
    game.update(dt, elapsed);
    dev?.update(dt);
    gfx.render(dt);
    input.endFrame();
    dev?.end();
  }).start();
}
