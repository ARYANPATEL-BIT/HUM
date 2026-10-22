import { getCtx, isReady, buses } from './audio.js';
import { CONFIG } from '../config.js';

// One looping generator per task type. Only the nearest 4 task objects within 30m get a voice.
// Each voice is a panned oscillator with a characteristic frequency.

const TASK_FREQS = {
  breaker: 55,
  radio: 680,
  cassette: 220,
  keypad: 440,
};

const voices = new Map(); // taskId → { oscillator, panner, gain, active }

export function updateTaskAudio(taskObjects, playerPos) {
  if (!isReady()) return;
  const ctx = getCtx();
  const A = CONFIG.audio;

  // Find nearest 4 tasks within 30m.
  const nearby = [];
  for (const obj of taskObjects) {
    if (obj.completed) continue;
    const d2 = (obj.wx - playerPos.x) ** 2 + (obj.wz - playerPos.z) ** 2;
    if (d2 < A.taskVoiceRadius ** 2) {
      nearby.push({ obj, d2 });
    }
  }
  nearby.sort((a, b) => a.d2 - b.d2);
  const active = new Set(nearby.slice(0, A.taskVoiceMax).map((n) => n.obj.id));

  // Start voices for new active tasks.
  for (const n of nearby.slice(0, A.taskVoiceMax)) {
    const obj = n.obj;
    if (voices.has(obj.id)) continue;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = TASK_FREQS[obj.type] || 220;

    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = A.taskVoiceRadius;
    panner.rolloffFactor = 2;
    panner.positionX.value = obj.wx;
    panner.positionY.value = 1.5;
    panner.positionZ.value = obj.wz;

    const g = ctx.createGain();
    g.gain.value = 0.06;

    osc.connect(g);
    g.connect(panner);
    panner.connect(buses.sfx);
    osc.start();

    voices.set(obj.id, { osc, panner, gain: g });
  }

  // Update positions and stop voices that are no longer active.
  for (const [id, v] of voices) {
    if (!active.has(id)) {
      v.osc.stop();
      v.osc.disconnect();
      voices.delete(id);
    } else {
      // Find the task to get its current world position.
      const task = taskObjects.find((o) => o.id === id);
      if (task) {
        v.panner.positionX.value = task.wx;
        v.panner.positionZ.value = task.wz;
      }
    }
  }
}

// After floating-origin shift, re-sync panner positions.
export function rebaseTaskAudio(dx, dz) {
  for (const v of voices.values()) {
    v.panner.positionX.value -= dx;
    v.panner.positionZ.value -= dz;
  }
}

// Synthesized "voice" tone pattern played when radio hits target freq.
export function playRadioSuccess() {
  if (!isReady()) return;
  const ctx = getCtx();
  const times = [0, 0.18, 0.36, 0.54];
  const freqs = [440, 554, 659, 880];
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqs[i];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime + times[i]);
    g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + times[i] + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + times[i] + 0.25);
    osc.connect(g);
    g.connect(buses.ui);
    osc.start(ctx.currentTime + times[i]);
    osc.stop(ctx.currentTime + times[i] + 0.3);
  }
}

// Short beep for keypad button press.
export function playKeypadBeep(success) {
  if (!isReady()) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = success ? 880 : 220;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.2, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.connect(g);
  g.connect(buses.ui);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

// Exit door low tone.
export function playExitTone(wx, wy, wz) {
  if (!isReady()) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = CONFIG.game.exitTone;

  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = 2;
  panner.maxDistance = 80;
  panner.positionX.value = wx;
  panner.positionY.value = wy;
  panner.positionZ.value = wz;

  const g = ctx.createGain();
  g.gain.value = 0.25;
  osc.connect(g);
  g.connect(panner);
  panner.connect(buses.ambience);
  osc.start();

  return { osc, panner, stop() { osc.stop(); osc.disconnect(); } };
}
