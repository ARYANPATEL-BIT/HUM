import { CONFIG } from '../config.js';
import { load, save } from '../core/storage.js';

// Player settings: graphics preset, FOV, mouse sensitivity, invert Y, head bob, volume.
// Saved in localStorage and written into CONFIG. loadSettings() runs before the renderer is created
// so the saved preset (and its antialias choice) applies at startup.

const BASE_SENSITIVITY = CONFIG.input.mouseSensitivity;
const DEFAULTS = {
  preset: CONFIG.preset,
  fov: CONFIG.render.fov,
  sensitivity: 1,
  invertY: CONFIG.input.invertY,
  headBob: CONFIG.player.bob.enabled,
  volume: CONFIG.audio.masterVolume,
};
const RANGES = { fov: [60, 100], sensitivity: [0.2, 3], volume: [0, 1] };

function sanitize(raw) {
  const s = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const v = raw?.[key];
    if (typeof v !== typeof DEFAULTS[key]) continue;
    if (RANGES[key]) s[key] = Math.min(RANGES[key][1], Math.max(RANGES[key][0], v));
    else s[key] = v;
  }
  if (!CONFIG.presets[s.preset]) s.preset = DEFAULTS.preset;
  return s;
}

function applyToConfig(s) {
  CONFIG.preset = s.preset;
  CONFIG.render.fov = s.fov;
  CONFIG.input.mouseSensitivity = BASE_SENSITIVITY * s.sensitivity;
  CONFIG.input.invertY = s.invertY;
  CONFIG.player.bob.enabled = s.headBob;
  CONFIG.audio.masterVolume = s.volume;
}

export function loadSettings() {
  const s = sanitize(load('settings', null));
  applyToConfig(s);
  return s;
}

// Binds the [data-setting] controls in `panel`. hooks: { preset(name), fov(deg), volume(v) } apply
// changes that need more than a CONFIG write.
export class SettingsPanel {
  constructor(panel, settings, hooks) {
    this.settings = settings;
    this.antialiasAtStart = CONFIG.presets[settings.preset].render.antialias;
    this.reloadNote = panel.querySelector('[data-reload-note]');
    panel.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting;
      const out = el.parentElement.querySelector('output');
      const show = () => {
        if (out) out.textContent = key === 'volume' ? `${Math.round(settings[key] * 100)}%` : key === 'sensitivity' ? `${settings[key].toFixed(2)}x` : String(settings[key]);
      };
      if (el.type === 'checkbox') el.checked = settings[key];
      else el.value = settings[key];
      show();
      el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
        settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
        applyToConfig(settings);
        hooks[key]?.(settings[key]);
        save('settings', settings);
        show();
        this.updateReloadNote();
      });
    });
    this.updateReloadNote();
  }

  updateReloadNote() {
    const aa = CONFIG.presets[this.settings.preset].render.antialias;
    this.reloadNote.hidden = aa === this.antialiasAtStart;
  }
}
