import { CONFIG } from '../config.js';

// One AudioContext, created on first click. Master → DynamicsCompressor → destination.
// Separate gain buses for ambience / sfx / entity / ui.
let ctx = null;
let master = null;
let compressor = null;
export const buses = { ambience: null, sfx: null, entity: null, ui: null };

export function getCtx() { return ctx; }
export function isReady() { return ctx !== null && ctx.state === 'running'; }

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.release.value = 0.25;
  compressor.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = CONFIG.audio.masterVolume;
  master.connect(compressor);

  const A = CONFIG.audio;
  for (const [name, vol] of [['ambience', A.ambienceVolume], ['sfx', A.sfxVolume], ['entity', A.entityVolume], ['ui', A.uiVolume]]) {
    const g = ctx.createGain();
    g.gain.value = vol;
    g.connect(master);
    buses[name] = g;
  }
}

// Muffles the world (ambience + sfx) through a lowpass while a task overlay is open.
let muffle = null;
export function setMuffle(active) {
  if (!isReady()) return;
  if (active && !muffle) {
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 400;
    // Reconnect ambience + sfx through muffle.
    buses.ambience.disconnect();
    buses.sfx.disconnect();
    buses.ambience.connect(muffle);
    buses.sfx.connect(muffle);
    muffle.connect(master);
  } else if (!active && muffle) {
    buses.ambience.disconnect();
    buses.sfx.disconnect();
    muffle.disconnect();
    buses.ambience.connect(master);
    buses.sfx.connect(master);
    muffle = null;
  }
}
