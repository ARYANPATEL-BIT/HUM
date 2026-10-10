// Noise events: position + radius objects that the entity can hear.
// Emitters call emit(); the entity calls flush() each frame.

const _events = [];

export const noiseEvents = {
  emit(x, z, radius) {
    _events.push({ x, z, radius, time: Date.now() });
  },
  flush() {
    const out = _events.splice(0); // drain all events
    return out;
  },
};
