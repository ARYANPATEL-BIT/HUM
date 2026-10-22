import { hash, mulberry32 } from '../core/rng.js';
import { playRadioSuccess } from '../audio/tasks.js';

// Radio task: HTML/CSS overlay with a draggable dial.
// Target frequency is deterministic from hash(seed, taskId).
// Static fades out as you approach the target; plays a voice tone on find.
// Drag handlers are bound once and drive `current`.

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
    if (dragX !== null) current?.set(startVal + (e.clientX - dragX) / 300);
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

  current = {
    type: 'radio',
    taskObj,
    value: 0, // dial position 0..1
    get done() { return done; },
    set(v) {
      this.value = Math.max(0, Math.min(1, v));
      const strength = Math.max(0, 1 - Math.abs(this.value - target) / 0.08);
      staticEl.style.opacity = String(1 - strength);
      freqEl.textContent = (88 + this.value * 20).toFixed(1) + ' MHz';
      dialEl.style.transform = `rotate(${this.value * 270 - 135}deg)`;
      if (strength > 0.95 && !done) {
        done = true;
        playRadioSuccess();
      }
    },
    devComplete() { this.set(target); },
  };
  current.set(0);
  return current;
}
