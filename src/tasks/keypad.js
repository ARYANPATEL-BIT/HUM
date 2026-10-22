import { CONFIG } from '../config.js';
import { hash, mulberry32 } from '../core/rng.js';
import { playKeypadBeep } from '../audio/tasks.js';
import { noiseEvents } from '../entity/noiseEvents.js';

// Keypad: 4-digit code from hash(seed, id). Code is painted on a nearby wall as a canvas-texture quad.
// The player enters the code in an HTML overlay. Button handlers are bound once and drive `current`.

let current = null;
let display = null;

function bind() {
  if (display) return;
  const overlay = document.getElementById('keypad-overlay');
  display = overlay.querySelector('.keypad-display');
  overlay.querySelectorAll('.keypad-btn[data-digit]').forEach((btn) => {
    btn.addEventListener('click', () => current?.digit(btn.dataset.digit));
  });
  overlay.querySelector('.keypad-clear').addEventListener('click', () => current?.clear());
}

export function codeForKeypad(seed, taskId) {
  const rng = mulberry32(hash(seed, 88, ...taskId.split(',').map(Number)));
  return Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join('');
}

export function createKeypadTask(taskObj, seed) {
  bind();
  const code = codeForKeypad(seed, taskObj.id);
  let input = '';
  let done = false;
  const refresh = () => { display.textContent = input.padEnd(4, '_'); };

  current = {
    type: 'keypad',
    taskObj,
    get done() { return done; },
    digit(d) {
      if (done || input.length >= 4) return;
      input += d;
      playKeypadBeep(false);
      noiseEvents.emit(taskObj.wx, taskObj.wz, CONFIG.entity.keypadNoise);
      refresh();
      if (input.length < 4) return;
      if (input === code) {
        done = true;
        playKeypadBeep(true);
      } else {
        setTimeout(() => { input = ''; refresh(); }, 400);
      }
    },
    clear() { input = ''; refresh(); },
    devComplete() { done = true; },
  };
  refresh();
  return current;
}

// Generate a canvas texture showing the 4-digit code.
export function makeCodeTexture(code) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1800';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffdf60';
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, 128, 32);
  return canvas;
}
