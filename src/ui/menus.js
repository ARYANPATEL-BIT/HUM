// Full-screen overlay panels (title / paused / touch). Only one is visible at a time.
export class Menus {
  constructor(root) {
    this.root = root;
    this.panels = new Map();
    root.querySelectorAll('[data-screen]').forEach((el) => this.panels.set(el.dataset.screen, el));
  }

  show(name) {
    this.root.classList.remove('hidden');
    for (const [key, el] of this.panels) el.classList.toggle('active', key === name);
  }

  hide() {
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
