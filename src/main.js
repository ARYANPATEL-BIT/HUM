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
import { initHum, updateHumPanners, updateListener } from './audio/hum.js';
import { updateFootsteps } from './audio/footsteps.js';
import { updateTaskAudio, rebaseTaskAudio } from './audio/tasks.js';
import { isCarryingCassette } from './tasks/cassette.js';

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
  chunks.lightPool = lightPool;

  const collision = new CollisionWorld(chunks);
  const player = new PlayerController(gfx.camera, input, collision, (x, z) => chunks.groundAt(x, z));

  // Task system.
  const taskObjects = new TaskObjects(seed, chunks.size);
  chunks.onChunkLoaded = (chunk) => taskObjects.placeChunk(chunk);
  chunks.onChunkUnloaded = (key, chunk) => taskObjects.unplaceChunk(key, chunk);

  const taskManager = new TaskManager(gfx.scene, chunks, taskObjects, seed, gfx);
  taskManager.lightPool = lightPool;

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
    player.position.x -= 0; // already handled by ChunkManager.maybeRebase
    taskObjects.rebase(dx, dz);
    entity.rebase(dx, dz);
    rebaseTaskAudio(dx, dz, taskObjects.active);
  });

  chunks.preload({ x: 0, z: 0 });
  const spawn = chunks.spawnPoint();
  player.spawn(spawn.x, spawn.z, spawn.yaw);

  let dev = null;
  if (import.meta.env.DEV) {
    import('./core/devTools.js').then(({ DevTools }) => {
      dev = new DevTools(gfx, player, chunks, input, lightPool);
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
          if (t) { player.position.x = t.x; player.position.z = t.z; }
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

        // Cassette blocks sprint.
        player.canSprint = !isCarryingCassette();

        player.update(dt);
        chunks.update(player.position);
        lightPool.update(dt, gfx.camera);

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
            // Spawn far from player, outside camera view.
            const angle = player.yaw + Math.PI + (Math.random() - 0.5) * Math.PI;
            const dist = CONFIG.entity.spawnMinDist + 5;
            entity.spawn(
              player.position.x + Math.sin(angle) * dist,
              player.position.z + Math.cos(angle) * dist
            );
          }
        }

        if (entity.enabled) {
          entity.update(dt, player.position, gfx.camera, p, lightPool, noiseEvents);
        }

        // Pressure: scale flicker and hum pitch.
        CONFIG.lighting.flickerIntensityBase = 1 + p * (CONFIG.entity.rampFlickerMax - 1);

        // Red vignette: entity within 10m while overlay open.
        if (taskManager.overlayOpen && entity.enabled) {
          const dist = entity.position.distanceTo(player.position);
          const v = dist < CONFIG.entity.overlayWarnDist ? Math.sin(Date.now() / 300) * 0.5 + 0.5 : 0;
          gfx.post.setRedVignette(v);
        } else {
          gfx.post.setRedVignette(0);
        }

        // Hum pitch in last 60s.
        if (taskManager.timeLeft < 60) {
          const { setHumPitch } = require('./audio/hum.js');
          // Dynamic import already done; use a flag.
        }

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
    else if (game.is('playing')) game.set('paused');
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
