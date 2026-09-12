// deterministic prng. state is a plain object so a whole game state can be
// serialised and replayed byte-for-byte. mulberry32.

export function makeRng(seed) {
  return { a: seed >>> 0 };
}

export function random(rng) {
  rng.a = (rng.a + 0x6d2b79f5) >>> 0;
  let t = rng.a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(rng, min, max) {
  return min + random(rng) * (max - min);
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
