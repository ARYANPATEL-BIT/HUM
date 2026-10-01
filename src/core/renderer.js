import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createRenderer(container) {
  const cfg = CONFIG.render;

  const renderer = new THREE.WebGLRenderer({ antialias: cfg.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Clear to the fog colour so anything past the far plane reads as more fog.
  renderer.setClearColor(CONFIG.atmosphere.fogColor);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CONFIG.atmosphere.fogColor, CONFIG.atmosphere.fogDensity);
  const camera = new THREE.PerspectiveCamera(cfg.fov, window.innerWidth / window.innerHeight, cfg.near, cfg.far);
  camera.rotation.order = 'YXZ'; // yaw first, then pitch: standard FPS camera

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    render() {
      renderer.render(scene, camera);
    },
  };
}
