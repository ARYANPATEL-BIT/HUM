import { getCtx, isReady, buses } from './audio.js';
import { CONFIG } from '../config.js';

// One-shot sounds for chalk, water bottles and notes, all shaped from one noise buffer.

let noise = null;

function noiseBuffer(ctx) {
  if (noise) return noise;
  const len = ctx.sampleRate;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

// Filtered noise burst with an attack/decay envelope, `offset` seconds from now.
function burst({ type, freq, q = 1, gain, attack, length, offset = 0, rate = 1 }) {
  const ctx = getCtx();
  const t = ctx.currentTime + offset;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(f);
  f.connect(g);
  g.connect(buses.sfx);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.02);
}

// Chalk on drywall: three short scratchy strokes.
export function playChalk() {
  if (!isReady()) return;
  const gain = CONFIG.audio.chalkGain;
  for (let i = 0; i < 3; i++) {
    burst({ type: 'bandpass', freq: 2600 + Math.random() * 1400, q: 2.5, gain, attack: 0.01, length: 0.07 + Math.random() * 0.05, offset: i * 0.11 });
  }
}

// Unscrew + gulps.
export function playDrink() {
  if (!isReady()) return;
  const gain = CONFIG.audio.drinkGain;
  burst({ type: 'highpass', freq: 3000, gain: gain * 0.6, attack: 0.005, length: 0.12 });
  for (let i = 0; i < 3; i++) {
    burst({ type: 'lowpass', freq: 380, q: 6, gain, attack: 0.03, length: 0.16, offset: 0.35 + i * 0.32, rate: 0.5 });
  }
}

// One breath while hiding: slow inhale, longer lower exhale (half-speed noise so it lasts the second).
export function playBreath(gain) {
  if (!isReady()) return;
  burst({ type: 'bandpass', freq: 1100, q: 0.7, gain, attack: 0.55, length: 0.85, rate: 0.5 });
  burst({ type: 'bandpass', freq: 650, q: 0.8, gain: gain * 1.2, attack: 0.15, length: 1.0, offset: 1.0, rate: 0.5 });
}

// Paper rustle.
export function playPaper() {
  if (!isReady()) return;
  const gain = CONFIG.audio.paperGain;
  burst({ type: 'highpass', freq: 1800, gain, attack: 0.02, length: 0.18 });
  burst({ type: 'bandpass', freq: 4200, q: 1.2, gain: gain * 0.7, attack: 0.03, length: 0.22, offset: 0.12 });
}
