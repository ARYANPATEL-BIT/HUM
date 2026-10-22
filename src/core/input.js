import { CONFIG } from '../config.js';

// Keyboard state + pointer-locked mouse deltas. Keys are KeyboardEvent.code values ("KeyW", "ShiftLeft").
export class Input {
  constructor(lockTarget) {
    this.lockTarget = lockTarget;
    this.keys = new Set();
    this.pressed = new Set(); // keys that went down since the last endFrame()
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.onLockChange = null;
    this.onLockFail = null;

    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Losing focus while a key is held would otherwise leave it "stuck" down.
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const max = CONFIG.input.maxMouseDelta;
      if (Math.abs(e.movementX) > max || Math.abs(e.movementY) > max) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.lockTarget;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    // Browsers refuse re-locking for ~1s after Esc; the promise rejects and the user just clicks again.
    try {
      const p = this.lockTarget.requestPointerLock();
      if (p && p.catch) p.catch(() => this.onLockFail?.());
    } catch {
      this.onLockFail?.(); // older browsers throw synchronously
    }
  }

  isDown(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }
}
