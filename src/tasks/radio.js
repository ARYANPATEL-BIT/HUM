import { hash, mulberry32 } from '../core/rng.js';
import { playRadioSuccess } from '../audio/tasks.js';

// Radio task: HTML/CSS overlay with a draggable dial.
// Target frequency is deterministic from hash(seed, taskId).
// Static fades out as you approach the target; plays a voice tone on find.

export function createRadioTask(taskObj, seed) {
  // Target freq in [88, 108] MHz range (display only; internally 0..1).
  const rng = mulberry32(hash(seed, 77, taskObj.cx, taskObj.cz));
  const target = 0.2 + rng() * 0.6; // avoid extremes
  let value = 0; // current dial position 0..1
  let found = false;
  let successFired = false;

  const overlay = document.getElementById('radio-overlay');
  const dialEl = overlay?.querySelector('.radio-dial');
  const freqEl = overlay?.querySelector('.radio-freq');
  const staticEl = overlay?.querySelector('.radio-static');

  function update() {
    if (!overlay) return;
    const dist = Math.abs(value - target);
    const strength = Math.max(0, 1 - dist / 0.08);
    if (staticEl) staticEl.style.opacity = String(1 - strength);
    const displayFreq = (88 + value * 20).toFixed(1);
    if (freqEl) freqEl.textContent = displayFreq + ' MHz';
    if (strength > 0.95 && !successFired) {
      successFired = true;
      found = true;
      playRadioSuccess();
    }
  }

  // Drag handler.
  let dragging = false;
  let dragStartX = 0;
  let dragStartVal = 0;

  function onMouseDown(e) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartVal = value;
  }
  function onMouseMove(e) {
    if (!dragging) return;
    const delta = (e.clientX - dragStartX) / 300;
    value = Math.max(0, Math.min(1, dragStartVal + delta));
    update();
  }
  function onMouseUp() { dragging = false; }

  if (dialEl) {
    dialEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
  update();

  return {
    type: 'radio',
    taskObj,
    get done() { return found; },
    // DevKey: instant complete.
    devComplete() { value = target; found = true; successFired = true; },
    dispose() {
      if (dialEl) dialEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    },
  };
}
