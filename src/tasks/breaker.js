import { getCtx, isReady } from '../audio/audio.js';
import { CONFIG } from '../config.js';

// Breaker: hold E for 3s while lights strobe. Moving or looking away resets progress.
// Returns { start, update(dt, holding, moving, lookingAway), progress [0..1], done }.

export function createBreakerTask(taskObj, lightPool) {
  let progress = 0;
  const duration = 3.0;
  let strobeTimer = 0;

  return {
    type: 'breaker',
    taskObj,
    get progress() { return progress; },
    update(dt, holding, moving, lookingAway) {
      if (!holding || moving || lookingAway) {
        progress = Math.max(0, progress - dt * 1.5);
        return false;
      }
      progress += dt / duration;
      // Strobe nearby lights.
      strobeTimer += dt;
      if (strobeTimer > 0.08) {
        strobeTimer = 0;
        lightPool?.spikeNearest(taskObj.wx, taskObj.wz);
      }
      if (progress >= 1) { progress = 1; return true; }
      return false;
    },
    dispose() {},
  };
}
