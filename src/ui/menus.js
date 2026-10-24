// Full-screen overlay panels (title / paused / settings / touch). Only one is visible at a time.
export class Menus {
  constructor(root) {
    this.root = root;
    this.panels = new Map();
    this.current = null;
    this.previous = null; // where settings' back button returns to
    root.querySelectorAll('[data-screen]').forEach((el) => this.panels.set(el.dataset.screen, el));
    root.querySelectorAll('[data-open-settings]').forEach((b) => b.addEventListener('click', () => this.show('settings')));
    root.querySelector('[data-settings-back]')?.addEventListener('click', () => this.show(this.previous ?? 'title'));
  }

  show(name) {
    if (name === 'settings' && this.current !== 'settings') this.previous = this.current;
    this.current = name;
    this.root.classList.remove('hidden');
    for (const [key, el] of this.panels) el.classList.toggle('active', key === name);
  }

  hide() {
    this.current = null;
    this.root.classList.add('hidden');
  }

  onClick(fn) {
    this.root.addEventListener('click', fn);
  }
}

export function isTouchOnlyDevice() {
  // Coarse pointer with no fine pointer available = phone/tablet. Touch laptops still have a fine pointer.
  return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
}
