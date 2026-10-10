import { hash, mulberry32 } from '../core/rng.js';
import { playKeypadBeep } from '../audio/tasks.js';

// Keypad: 4-digit code from hash(seed, id). Code is painted on a nearby wall as a canvas-texture quad.
// The player enters the code in an HTML overlay.

export function codeForKeypad(seed, taskId) {
  const rng = mulberry32(hash(seed, 88, ...taskId.split(',').map(Number)));
  return Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join('');
}

export function createKeypadTask(taskObj, seed) {
  const code = codeForKeypad(seed, taskObj.id);
  let input = '';
  let done = false;

  const overlay = document.getElementById('keypad-overlay');
  const displayEl = overlay?.querySelector('.keypad-display');
  const buttons = overlay?.querySelectorAll('.keypad-btn[data-digit]');
  const clearBtn = overlay?.querySelector('.keypad-clear');

  function refreshDisplay() {
    if (displayEl) displayEl.textContent = input.padEnd(4, '_');
  }

  function onDigit(d) {
    if (input.length >= 4) return;
    input += d;
    playKeypadBeep(false);
    refreshDisplay();
    if (input.length === 4) {
      if (input === code) {
        done = true;
        playKeypadBeep(true);
      } else {
        setTimeout(() => { input = ''; refreshDisplay(); }, 400);
      }
    }
  }

  function onClear() { input = ''; refreshDisplay(); }

  if (buttons) {
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => onDigit(btn.dataset.digit));
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', onClear);

  refreshDisplay();

  return {
    type: 'keypad',
    taskObj,
    code,
    get done() { return done; },
    devComplete() { done = true; },
    dispose() {
      if (buttons) buttons.forEach((btn) => btn.removeEventListener('click', () => {}));
    },
  };
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
