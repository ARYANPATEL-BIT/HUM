import { CONFIG } from '../config.js';

// One AudioContext, created when the game first starts. Master → DynamicsCompressor → destination.
// Separate gain buses for ambience / sfx / entity / ui.
// A new context can report 'suspended' until the browser starts it (Firefox, Safari, autoplay rules),
// so generators are built as soon as the context exists and resumeAudio() runs on every click.
let ctx = null;
let master = null;
let compressor = null;
export const buses = { ambience: null, sfx: null, entity: null, ui: null };

export function getCtx() { return ctx; }
export function isReady() { return ctx !== null && ctx.state === 'running'; }

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  resumeAudio();
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

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setMasterVolume(v) {
  CONFIG.audio.masterVolume = v;
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
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
