import { getCtx, isReady, buses } from '../audio/audio.js';

// Entity audio: HRTF panner for footsteps, low drone that grows with proximity, heartbeat during chase.

let droneOsc = null;
let droneGain = null;
let dronePanner = null;
let heartbeatTimer = 0;
let heartbeatActive = false;
let initiated = false;

export function initEntityAudio() {
  if (!isReady() || initiated) return;
  initiated = true;
  const ctx = getCtx();
  const bus = buses.entity;

  // Low drone.
  droneOsc = ctx.createOscillator();
  droneOsc.type = 'sawtooth';
  droneOsc.frequency.value = 38;
  const droneLp = ctx.createBiquadFilter();
  droneLp.type = 'lowpass';
  droneLp.frequency.value = 120;
  droneGain = ctx.createGain();
  droneGain.gain.value = 0;

  dronePanner = ctx.createPanner();
  dronePanner.panningModel = 'HRTF';
  dronePanner.distanceModel = 'inverse';
  dronePanner.refDistance = 3;
  dronePanner.maxDistance = 50;
  dronePanner.rolloffFactor = 1.5;

  droneOsc.connect(droneLp);
  droneLp.connect(droneGain);
  droneGain.connect(dronePanner);
  dronePanner.connect(bus);
  droneOsc.start();
}

export function updateEntityAudio(dt, entityPos, playerPos, state) {
  if (!isReady() || !initiated) return;
  const ctx = getCtx();

  // Update panner position.
  dronePanner.positionX.value = entityPos.x;
  dronePanner.positionY.value = entityPos.y || 0;
  dronePanner.positionZ.value = entityPos.z;

  const dist = Math.hypot(entityPos.x - playerPos.x, entityPos.z - playerPos.z);
  const chase = state === 'chase';

  // Drone grows as entity approaches.
  const proximity = Math.max(0, 1 - dist / 30);
  const targetGain = proximity * (chase ? 0.7 : 0.3);
  droneGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.3);
  droneOsc.frequency.setTargetAtTime(chase ? 55 : 38, ctx.currentTime, 0.5);

  // Heartbeat during chase.
  heartbeatActive = chase;
  if (heartbeatActive) {
    heartbeatTimer -= dt;
    if (heartbeatTimer <= 0) {
      heartbeatTimer = 0.6 + Math.random() * 0.2;
      playHeartbeat();
    }
  }
}

function playHeartbeat() {
  if (!isReady()) return;
  const ctx = getCtx();
  for (const [delay, freq] of [[0, 60], [0.12, 45]]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime + delay);
    g.gain.linearRampToValueAtTime(0.35, ctx.currentTime + delay + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2);
    osc.connect(g);
    g.connect(buses.ui);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + 0.25);
  }
}

// Entity footstep: short noise burst through HRTF panner at entity position.
let noiseBuffer = null;
export function playEntityFootstep(wx, wy, wz) {
  if (!isReady()) return;
  const ctx = getCtx();
  if (!noiseBuffer) {
    const len = Math.floor(ctx.sampleRate * 0.06);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25));
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 2;
  panner.maxDistance = 30;
  panner.positionX.value = wx;
  panner.positionY.value = wy;
  panner.positionZ.value = wz;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.value = 0.4;
  src.connect(lp);
  lp.connect(g);
  g.connect(panner);
  panner.connect(buses.entity);
  src.start();
}

export function rebaseEntityAudio(dx, dz) {
  if (dronePanner) {
    dronePanner.positionX.value -= dx;
    dronePanner.positionZ.value -= dz;
  }
}
