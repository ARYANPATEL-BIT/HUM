import { CONFIG } from '../config.js';
import { noiseEvents } from '../entity/noiseEvents.js';

// Breaker: hold E for 3s while lights strobe. Moving or looking away drains progress.
// While it strobes it makes noise the entity can hear.
// Returns { update(dt, holding, moving, lookingAway) → done, progress [0..1] }.

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
        noiseEvents.emit(taskObj.wx, taskObj.wz, CONFIG.entity.breakerNoise);
      }
      if (progress >= 1) { progress = 1; return true; }
      return false;
    },
  };
}
