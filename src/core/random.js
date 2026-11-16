// 種(seed)付きの乱数。同じ種なら同じ結果になるので、テストと「同じ案をもう一度」に使える。

/**
 * @typedef {object} Rng
 * @property {number} seed
 * @property {() => number} next 0以上1未満
 * @property {(min: number, max: number) => number} int min以上max以下の整数
 * @property {<T>(items: readonly T[]) => T} pick
 * @property {(p: number) => boolean} chance
 * @property {<T>(items: readonly (readonly [T, number])[]) => T} weighted [値, 重み] の並びから選ぶ
 * @property {<T>(items: readonly T[]) => T[]} shuffle
 * @property {() => Rng} fork 別の流れの乱数を作る
 */

/** 種を作る */
export function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * @param {number} [seed]
 * @returns {Rng}
 */
export function createRng(seed = randomSeed()) {
  let a = seed >>> 0;
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** @type {Rng} */
  const rng = {
    seed,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        r -= w;
        if (r < 0) return v;
      }
      return items[items.length - 1][0];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    fork: () => createRng(Math.floor(next() * 0x7fffffff)),
  };
  return rng;
}
