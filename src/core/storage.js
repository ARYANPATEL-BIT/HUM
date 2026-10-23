// localStorage JSON helpers. Storage can be missing or throw (private windows, blocked site data);
// the game then just forgets between visits.
const PREFIX = 'hum.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* not persisted */
  }
}
