import { getCtx, isReady, buses } from './audio.js';
import { CONFIG } from '../config.js';

// The hum: a shared generator (120Hz sawtooth + quiet 240Hz sine + bandpassed noise)
// feeding a gain + PannerNode per pooled light. The LightPool has at most 4 active lights.

const panners = []; // { gain, panner, active }
let sawOsc = null;
let sineOsc = null;
let noiseSource = null;
let noiseBuffer = null; // shared with the crackle
let sharedGain = null; // connects generator output into each panner
let initiated = false;

function createNoiseBuffer(ctx, seconds = 2) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function initHum(poolSize) {
  if (!getCtx() || initiated) return;
  initiated = true;
  const ctx = getCtx();
  const H = CONFIG.audio.hum;
  const bus = buses.ambience;

  // Shared generator: saw + sine + bandpassed noise → sharedGain
  sawOsc = ctx.createOscillator();
  sawOsc.type = 'sawtooth';
  sawOsc.frequency.value = H.sawFreq;

  const sawLp = ctx.createBiquadFilter();
  sawLp.type = 'lowpass';
  sawLp.frequency.value = 600;
  sawLp.Q.value = 0.5;

  sineOsc = ctx.createOscillator();
  sineOsc.type = 'sine';
  sineOsc.frequency.value = H.sineFreq;
  const sineGain = ctx.createGain();
  sineGain.gain.value = H.sineGain;

  noiseBuffer = createNoiseBuffer(ctx, 4);
  noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;

  const noiseBp = ctx.createBiquadFilter();
  noiseBp.type = 'bandpass';
  noiseBp.frequency.value = (H.noiseFreqLow + H.noiseFreqHigh) / 2;
  noiseBp.Q.value = (H.noiseFreqHigh - H.noiseFreqLow) / noiseBp.frequency.value;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = H.noiseGain;

  sharedGain = ctx.createGain();
  sharedGain.gain.value = 1;

  sawOsc.connect(sawLp);
  sawLp.connect(sharedGain);
  sineOsc.connect(sineGain);
  sineGain.connect(sharedGain);
  noiseSource.connect(noiseBp);
  noiseBp.connect(noiseGain);
  noiseGain.connect(sharedGain);

  sawOsc.start();
  sineOsc.start();
  noiseSource.start();

  // Create one gain + PannerNode per pool slot.
  for (let i = 0; i < poolSize; i++) {
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = 20;
    panner.rolloffFactor = 1.5;

    const g = ctx.createGain();
    g.gain.value = 0; // start silent; activated when light is placed

    sharedGain.connect(g);
    g.connect(panner);
    panner.connect(bus);

    panners.push({ gain: g, panner, active: false });
  }
}

// Called each frame by LightPool after it assigns lights.
export function updateHumPanners(lights) {
  if (!isReady() || !initiated) return;
  const H = CONFIG.audio.hum;
  for (let i = 0; i < panners.length; i++) {
    const entry = panners[i];
    const light = lights[i];
    if (!light || !light.light.visible) {
      entry.gain.gain.setTargetAtTime(0, getCtx().currentTime, 0.1);
      entry.active = false;
    } else {
      const p = light.light.position;
      entry.panner.positionX.value = p.x;
      entry.panner.positionY.value = p.y;
      entry.panner.positionZ.value = p.z;
      const targetGain = H.baseGain * light.flicker;
      entry.gain.gain.setTargetAtTime(targetGain, getCtx().currentTime, 0.05);
      entry.active = true;
    }
  }
}

// Short noise crackle through the panner of pooled light `pannerIndex` (called when it flickers off).
export function triggerCrackle(pannerIndex) {
  if (!isReady() || !initiated || !panners[pannerIndex]) return;
  const ctx = getCtx();
  const H = CONFIG.audio.hum;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(H.crackleGain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + H.crackleMs / 1000);
  src.connect(g);
  g.connect(panners[pannerIndex].panner);
  src.start(t, Math.random() * 3);
  src.stop(t + H.crackleMs / 1000);
}

// Update listener position from camera each frame.
export function updateListener(camera) {
  if (!isReady()) return;
  const ctx = getCtx();
  const L = ctx.listener;
  const pos = camera.position;
  if (L.positionX) {
    L.positionX.value = pos.x;
    L.positionY.value = pos.y;
    L.positionZ.value = pos.z;
  } else {
    L.setPosition(pos.x, pos.y, pos.z);
  }
  // Forward from yaw/pitch (camera looks down -Z at yaw 0); up is world Y.
  const dir = new Float32Array(3);
  const sin = Math.sin(camera.rotation.y);
  const cos = Math.cos(camera.rotation.y);
  const sp = Math.sin(camera.rotation.x);
  const cp = Math.cos(camera.rotation.x);
  dir[0] = -sin * cp;
  dir[1] = sp;
  dir[2] = -cos * cp;
  if (L.forwardX) {
    L.forwardX.value = dir[0];
    L.forwardY.value = dir[1];
    L.forwardZ.value = dir[2];
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setOrientation(dir[0], dir[1], dir[2], 0, 1, 0);
  }
}

// After floating-origin shift, re-sync every panner to its light.
export function rebaseHumPanners(lights) {
  if (!isReady() || !initiated) return;
  updateHumPanners(lights);
}

// Pitch ramp for pressure (phase 6).
export function setHumPitch(extraHz) {
  if (!sawOsc) return;
  const H = CONFIG.audio.hum;
  sawOsc.frequency.value = H.sawFreq + extraHz;
  sineOsc.frequency.value = H.sineFreq + extraHz * 2;
}
