// A tiny seedable PRNG (mulberry32) — in keeping with "the patch is text",
// a whole generated patch or sequence reduces to one small number:
// :gen 451 / :randseq 451 always reproduces exactly the same result.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
