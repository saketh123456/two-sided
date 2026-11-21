// Seeded pseudo-random numbers: xoshiro128** seeded through splitmix32.
// Deterministic across browsers and Node for the same integer seed.

function splitmix32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

const rotl = (x, k) => (x << k) | (x >>> (32 - k));
const INV_2_32 = 1 / 4294967296;
const TWO_PI = 2 * Math.PI;

export class Rng {
  constructor(seed) {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new RangeError(`seed must be a non-negative safe integer, got ${seed}`);
    }
    const hi = Math.floor(seed / 4294967296);
    const sm = splitmix32((seed >>> 0) ^ Math.imul(hi, 0x85ebca6b));
    this.s = Uint32Array.of(sm(), sm(), sm(), sm());
  }

  nextU32() {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform on [0, 1). */
  random() {
    return this.nextU32() * INV_2_32;
  }

  fillUniform(out) {
    for (let i = 0; i < out.length; i++) out[i] = this.nextU32() * INV_2_32;
    return out;
  }

  /** Standard normals via Box–Muller, two per pair of uniforms. */
  fillNormal(out) {
    const n = out.length;
    for (let i = 0; i < n; i += 2) {
      const u1 = 1 - this.nextU32() * INV_2_32; // (0, 1]
      const u2 = this.nextU32() * INV_2_32;
      const r = Math.sqrt(-2 * Math.log(u1));
      out[i] = r * Math.cos(TWO_PI * u2);
      if (i + 1 < n) out[i + 1] = r * Math.sin(TWO_PI * u2);
    }
    return out;
  }
}
