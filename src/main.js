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
import { Menus, isTouchOnlyDevice } from './ui/menus.js';

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
  const chunks = new ChunkManager(gfx.scene, seed, createAssets(gfx.renderer));
  const collision = new CollisionWorld(chunks);
  const player = new PlayerController(gfx.camera, input, collision, (x, z) => chunks.groundAt(x, z));

  chunks.preload({ x: 0, z: 0 });
  const spawn = chunks.spawnPoint();
  player.spawn(spawn.x, spawn.z, spawn.yaw);

  let dev = null;
  if (import.meta.env.DEV) {
    import('./core/devTools.js').then(({ DevTools }) => {
      dev = new DevTools(gfx, player, chunks, input);
    });
  }

  const game = new StateMachine({
    title: { enter: () => menus.show('title') },
    paused: { enter: () => menus.show('paused') },
    playing: {
      enter: () => menus.hide(),
      update: (dt) => {
        player.update(dt);
        chunks.update(player.position);
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
    gfx.render();
    input.endFrame();
    dev?.end();
  }).start();
}
