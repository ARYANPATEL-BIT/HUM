import { hash, mulberry32 } from '../core/rng.js';
import { playRadioSuccess } from '../audio/tasks.js';

// Radio task: HTML/CSS overlay with a draggable dial.
// Target frequency is deterministic from hash(seed, taskId).
// Static fades out as you approach the target; holding the dial on it locks the signal and plays a voice tone.
// Drag handlers are bound once and drive `current`.

// Dial travel: pixels of horizontal drag for the full 0..1 range.
const DRAG_PX = 600;
// Static fades within `fade` of the target; the signal locks once the dial stays within `lock` for `hold` s.
const TUNE = { fade: 0.1, lock: 0.012, hold: 0.4 };

let current = null;
let bound = false;

function bind() {
  if (bound) return;
  bound = true;
  const dial = document.querySelector('#radio-overlay .radio-dial');
  let dragX = null;
  let startVal = 0;
  dial.addEventListener('mousedown', (e) => {
    dragX = e.clientX;
    startVal = current?.value ?? 0;
  });
  window.addEventListener('mousemove', (e) => {
    if (dragX !== null) current?.set(startVal + (e.clientX - dragX) / DRAG_PX);
  });
  window.addEventListener('mouseup', () => { dragX = null; });
}

export function createRadioTask(taskObj, seed) {
  bind();
  const rng = mulberry32(hash(seed, 77, taskObj.cx, taskObj.cz));
  const target = 0.2 + rng() * 0.6; // avoid extremes
  const overlay = document.getElementById('radio-overlay');
  const dialEl = overlay.querySelector('.radio-dial');
  const freqEl = overlay.querySelector('.radio-freq');
  const staticEl = overlay.querySelector('.radio-static');
  let done = false;
  let lockedSince = null;

  current = {
    type: 'radio',
    taskObj,
    value: 0, // dial position 0..1
    get done() {
      if (!done && lockedSince !== null && performance.now() - lockedSince >= TUNE.hold * 1000) {
        done = true;
        playRadioSuccess();
      }
      return done;
    },
    set(v) {
      this.value = Math.max(0, Math.min(1, v));
      const off = Math.abs(this.value - target);
      staticEl.style.opacity = String(Math.min(1, off / TUNE.fade));
      freqEl.textContent = (88 + this.value * 20).toFixed(1) + ' MHz';
      dialEl.style.transform = `rotate(${this.value * 270 - 135}deg)`;
      if (off > TUNE.lock) lockedSince = null;
      else lockedSince ??= performance.now();
    },
    devComplete() { this.set(target); lockedSince = -Infinity; },
  };
  current.set(0);
  return current;
}
