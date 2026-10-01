// Deterministic randomness. Everything in the world derives from (seed, coords, salt).

// mulberry32: tiny, fast 32-bit PRNG. Returns floats in [0, 1).
export function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// murmur3 finalizer: scrambles all bits so nearby inputs give unrelated outputs.
function fmix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Hash any number of integers into one uint32. Order matters: hash(s, 1, 2) != hash(s, 2, 1).
export function hash(seed, ...ints) {
  let h = fmix(seed ^ 0x9e3779b9);
  for (const n of ints) h = fmix(h ^ Math.imul(n | 0, 0x27d4eb2d) ^ (h << 6));
  return h;
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Seed from ?seed= (numbers used directly, text hashed) or a random one.
export function resolveSeed() {
  const param = new URLSearchParams(window.location.search).get('seed');
  if (param !== null && param.trim() !== '') {
    const n = Number(param);
    if (Number.isInteger(n)) return n >>> 0;
    let h = 0;
    for (const ch of param) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    return h >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}
