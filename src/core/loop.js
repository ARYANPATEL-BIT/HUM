import { CONFIG } from '../config.js';

// requestAnimationFrame loop with a clamped delta. Update callbacks receive (dt, elapsed).
export class GameLoop {
  constructor(update) {
    this.update = update;
    this.elapsed = 0;
    this.last = 0;
    this.running = false;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  tick(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, CONFIG.loop.maxDelta);
    this.last = now;
    this.elapsed += dt;
    this.update(dt, this.elapsed);
    requestAnimationFrame(this.tick);
  }
}
