// Minimal finite state machine. States are plain objects with optional enter/exit/update.
export class StateMachine {
  constructor(states) {
    this.states = states;
    this.current = null;
    this.name = null;
  }

  set(name) {
    if (name === this.name) return;
    const next = this.states[name];
    if (!next) throw new Error(`Unknown state: ${name}`);
    const prev = this.name;
    this.current?.exit?.(name);
    this.current = next;
    this.name = name;
    next.enter?.(prev);
  }

  is(name) {
    return this.name === name;
  }

  update(dt, elapsed) {
    this.current?.update?.(dt, elapsed);
  }
}
