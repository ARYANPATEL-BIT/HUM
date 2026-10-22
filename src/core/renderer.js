import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createComposer } from './post.js';

export function applyPreset(name) {
  const preset = CONFIG.presets[name];
  if (!preset) return;
  // Shallow merge preset overrides into live config.
  if (preset.render) Object.assign(CONFIG.render, preset.render);
  if (preset.post) Object.assign(CONFIG.post, preset.post);
  if (preset.lighting) Object.assign(CONFIG.lighting, preset.lighting);
  CONFIG.preset = name;
}

export function createRenderer(container) {
  applyPreset(CONFIG.preset);
  const cfg = CONFIG.render;

  const renderer = new THREE.WebGLRenderer({
    antialias: cfg.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(CONFIG.atmosphere.fogColor);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CONFIG.atmosphere.fogColor, CONFIG.atmosphere.fogDensity);
  const camera = new THREE.PerspectiveCamera(cfg.fov, window.innerWidth / window.innerHeight, cfg.near, cfg.far);
  camera.rotation.order = 'YXZ';

  const post = createComposer(renderer, scene, camera);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.composer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    post,
    // Live preset switch: pixel ratio and post apply now; antialias needs a new WebGL context (reload).
    setPreset(name) {
      applyPreset(name);
      const ratio = Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio);
      renderer.setPixelRatio(ratio);
      post.composer.setPixelRatio(ratio);
      resize();
    },
    render(dt) {
      if (dt) post.tick(dt);
      if (CONFIG.post.enabled) {
        post.composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
  };
}
