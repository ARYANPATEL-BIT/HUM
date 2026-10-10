import { getCtx, isReady, buses } from './audio.js';
import { CONFIG } from '../config.js';

// Footstep system: one noise buffer, played through a lowpass per step with pitch/gain variation.

let noiseBuffer = null;
let stepTimer = 0;

function ensureBuffer() {
  if (noiseBuffer) return;
  const ctx = getCtx();
  const len = Math.floor(ctx.sampleRate * 0.08); // 80 ms noise burst
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // Decaying noise burst for a dull thud.
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.3));
  }
}

export function updateFootsteps(dt, speed, isSprinting) {
  if (!isReady() || speed < 0.3) {
    stepTimer = 0;
    return;
  }
  ensureBuffer();
  const F = CONFIG.audio.footsteps;
  const interval = isSprinting ? F.sprintInterval : F.walkInterval;
  stepTimer -= dt;
  if (stepTimer > 0) return;
  stepTimer = interval;
  playStep(isSprinting);
}

function playStep(sprint) {
  const ctx = getCtx();
  const F = CONFIG.audio.footsteps;
  const rng = Math.random;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 1 + (rng() - 0.5) * F.pitchVariation * 2;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = F.filterFreq * (0.85 + rng() * 0.3);

  const g = ctx.createGain();
  const baseGain = sprint ? F.sprintGain : F.gainBase;
  g.gain.value = baseGain + (rng() - 0.5) * F.gainVariation;

  src.connect(lp);
  lp.connect(g);
  g.connect(buses.sfx);
  src.start();
}
