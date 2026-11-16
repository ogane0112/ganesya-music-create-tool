// 仕上げ(マスタリング):書き出す音声を、配信サービスの基準の大きさにそろえる。
// - 大きさは「聴いた感じの大きさ」(ラウドネス、ITU-R BS.1770 の LUFS)で測る
// - 目標は -14 LUFS(主な配信サービスの基準)。一番大きい瞬間は -1 dB を超えないようにする
// ブラウザにも Node にも依存しない(テストできる)。

/** 目標の大きさ(LUFS)と、超えてはいけない最大値 */
export const TARGET_LUFS = -14;
export const CEILING = Math.pow(10, -1 / 20);

/**
 * 2次のフィルター(biquad)を通す
 * @param {Float32Array} x
 * @param {[number, number, number, number, number]} c b0,b1,b2,a1,a2
 */
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * 人の耳の感じ方に合わせる重み付け(K特性)のフィルター係数。サンプルレートに合わせて計算する
 * @param {number} fs
 * @returns {[[number, number, number, number, number], [number, number, number, number, number]]}
 */
function kWeighting(fs) {
  // 高い音を持ち上げる棚型
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  /** @type {[number, number, number, number, number]} */
  const shelf = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // ごく低い音を落とす
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / fs);
  const d = 1 + K1 / Q1 + K1 * K1;
  /** @type {[number, number, number, number, number]} */
  const hp = [1, -2, 1, (2 * (K1 * K1 - 1)) / d, (1 - K1 / Q1 + K1 * K1) / d];
  return [shelf, hp];
}

/**
 * 曲全体の大きさ(LUFS)を測る。無音に近い所と、極端に小さい所は数えない(規格どおりのゲート)
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @returns {number} 音がなければ -Infinity
 */
export function measureLufs(channels, sampleRate) {
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted = channels.map((c) => biquad(biquad(c, shelf), hp));
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  /** @type {number[]} */
  const powers = [];
  for (let start = 0; start + block <= weighted[0].length; start += hop) {
    let sum = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = start; i < start + block; i++) s += w[i] * w[i];
      sum += s / block;
    }
    powers.push(sum);
  }
  /** @param {number} p */
  const toLufs = (p) => -0.691 + 10 * Math.log10(p);
  const mean = (/** @type {number[]} */ a) => a.reduce((x, y) => x + y, 0) / a.length;
  const audible = powers.filter((p) => p > 0 && toLufs(p) > -70);
  if (!audible.length) return -Infinity;
  const relative = toLufs(mean(audible)) - 10;
  const gated = audible.filter((p) => toLufs(p) > relative);
  return gated.length ? toLufs(mean(gated)) : -Infinity;
}

/**
 * 天井を超える瞬間だけ音量を下げる(リミッター)。少し先を見て滑らかに下げ、ゆっくり戻す
 * @param {Float32Array[]} channels 書き換える
 * @param {number} sampleRate
 * @param {number} ceiling
 */
export function limit(channels, sampleRate, ceiling = CEILING) {
  const n = channels[0].length;
  const look = Math.round(0.005 * sampleRate);
  const release = Math.exp(-1 / (0.08 * sampleRate));
  // その瞬間に必要な下げ幅(1 = 下げない)
  const need = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const c of channels) peak = Math.max(peak, Math.abs(c[i]));
    if (peak > ceiling) need[i] = ceiling / peak;
  }
  // 少し先の下げ幅を先取りする(look の幅での最小値)
  const ahead = new Float32Array(n);
  /** @type {number[]} 最小値の候補の位置(小さい順) */
  const q = [];
  let head = 0;
  for (let i = 0; i < n + look; i++) {
    if (i < n) {
      while (q.length > head && need[q[q.length - 1]] >= need[i]) q.pop();
      q.push(i);
    }
    const out = i - look;
    if (out >= 0) {
      while (q[head] < out) head++;
      ahead[out] = need[q[head]];
    }
  }
  let gain = 1;
  for (let i = 0; i < n; i++) {
    gain = ahead[i] < gain ? ahead[i] : Math.min(1, 1 - (1 - gain) * release);
    if (gain > ahead[i]) gain = ahead[i];
    for (const c of channels) c[i] *= gain;
  }
}

/**
 * 目標の大きさにそろえ、天井を超えないようにする
 * @param {Float32Array[]} channels 書き換える
 * @param {number} sampleRate
 * @param {{ target?: number, ceiling?: number }} [opts]
 * @returns {{ before: number, after: number }} 仕上げ前後の大きさ(LUFS)
 */
export function master(channels, sampleRate, opts = {}) {
  const target = opts.target ?? TARGET_LUFS;
  const ceiling = opts.ceiling ?? CEILING;
  const before = measureLufs(channels, sampleRate);
  if (!Number.isFinite(before)) return { before, after: before };
  // 上げてから天井で抑えると少し小さくなるので、2回合わせる
  let after = before;
  for (let pass = 0; pass < 2; pass++) {
    const gain = Math.pow(10, (target - after) / 20);
    for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= gain;
    limit(channels, sampleRate, ceiling);
    after = measureLufs(channels, sampleRate);
    if (Math.abs(after - target) < 0.3) break;
  }
  return { before, after };
}
