// メロディ(歌メロ)を作る。
// 2小節を1フレーズとし、8小節を「a a' b a''」のように、リズムと形を繰り返しながら作る(覚えやすさのため)。
// 音の高さは「キーに合う音の並び」の何番目かで扱うので、外れた音はそもそも出ない。
import { scalePitchesInRange, chordPitchClasses, mod12, pitchClassOf, ticksPerBar } from '../theory.js';
import { chordAt } from './progressions.js';

/** @typedef {import('../types.js').Key} Key */
/** @typedef {import('../types.js').Chord} Chord */
/** @typedef {import('../types.js').Note} Note */
/** @typedef {import('../random.js').Rng} Rng */
/** @typedef {import('./styles.js').MoodStyle} MoodStyle */
/** @typedef {Omit<Note, 'id'>} NoteData */

const S = 120; // 16分音符のティック

/** 1小節のリズムの型([開始, 長さ] を16分音符の数で)。重みの名前ごとに分ける */
const BODY_RHYTHMS = /** @type {Record<string, [number, number][][]>} */ ({
  eighths: [
    [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
    [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  ],
  syncopate: [
    [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
    [[0, 2], [2, 2], [4, 2], [6, 4], [10, 2], [12, 2], [14, 2]],
    [[0, 2], [2, 4], [6, 2], [8, 2], [10, 4], [14, 2]],
  ],
  dotted: [
    [[0, 3], [3, 1], [4, 3], [7, 1], [8, 4], [12, 4]],
    [[0, 6], [6, 2], [8, 3], [11, 1], [12, 4]],
  ],
  restStart: [
    [[2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]],
    [[4, 2], [6, 2], [8, 2], [10, 1], [11, 1], [12, 2], [14, 2]],
    [[2, 2], [4, 1], [5, 1], [6, 2], [8, 4], [12, 2], [14, 2]],
  ],
  run16: [
    [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 2], [10, 2], [12, 4]],
    [[0, 2], [2, 1], [3, 1], [4, 2], [6, 1], [7, 1], [8, 2], [10, 2], [12, 2], [14, 2]],
  ],
  quarters: [
    [[0, 4], [4, 4], [8, 4], [12, 4]],
    [[0, 4], [4, 2], [6, 2], [8, 8]],
  ],
});

/** フレーズの終わり(2小節目)のリズム。最後を伸ばし、息継ぎの間を残す */
const END_RHYTHMS = /** @type {[number, number][][]} */ ([
  [[0, 2], [2, 2], [4, 8]],
  [[0, 4], [4, 8]],
  [[0, 2], [2, 2], [4, 2], [6, 8]],
  [[0, 3], [3, 3], [6, 8]],
  [[0, 10]],
  [[0, 2], [2, 2], [4, 4], [8, 4]],
]);

/**
 * @typedef {object} PhraseRhythm
 * @property {[number, number][]} bar1
 * @property {[number, number][]} bar2
 */

/**
 * @param {MoodStyle} style
 * @param {'verse' | 'prechorus' | 'chorus'} kind
 * @param {Rng} rng
 * @returns {PhraseRhythm}
 */
function pickPhraseRhythm(style, kind, rng) {
  const weights = { ...style.rhythmWeights };
  // サビは長めの音で歌い上げ、Aメロは細かく語るように
  if (kind === 'chorus') {
    weights.quarters = (weights.quarters ?? 0) + 2;
    weights.syncopate = (weights.syncopate ?? 0) + 1;
    weights.run16 = Math.max(0, (weights.run16 ?? 0) - 1);
  } else if (kind === 'verse') {
    weights.run16 = (weights.run16 ?? 0) + 1;
    weights.restStart = (weights.restStart ?? 0) + 1;
  }
  const group = rng.weighted(/** @type {[string, number][]} */ (Object.entries(weights)));
  return { bar1: rng.pick(BODY_RHYTHMS[group]), bar2: rng.pick(END_RHYTHMS) };
}

/**
 * 音域(キーに合う音の並びの範囲)を部品の種類ごとに決める。歌いやすい高さを音の番号で決め、
 * そこに入るキーに合う音を使う。サビほど高い
 * @param {Key} key
 * @param {'verse' | 'prechorus' | 'chorus'} kind
 * @param {number} [shift] 音域を上下にずらす(半音)
 */
function melodyRange(key, kind, shift = 0) {
  const scale = scalePitchesInRange(key, 48, 88);
  const bounds = { verse: [57, 74], prechorus: [60, 76], chorus: [62, 79] };
  const [lo, hi] = bounds[kind];
  const low = scale.findIndex((p) => p >= lo + shift);
  let high = scale.length - 1;
  while (scale[high] > hi + shift) high--;
  // 主音の位置(範囲の下の方にある主音)
  const tonicPc = pitchClassOf(key.tonic) ?? 0;
  let tonicIndex = low;
  for (let i = low; i <= high; i++) {
    if (mod12(scale[i]) === tonicPc) {
      tonicIndex = i;
      break;
    }
  }
  return { scale, low, high, tonicIndex };
}

/**
 * 並びの番号のうち、コードの音に当たるもの
 * @param {number[]} scale
 * @param {string} symbol
 */
function chordToneIndexes(scale, symbol) {
  const pcs = chordPitchClasses(symbol);
  /** @type {number[]} */
  const out = [];
  scale.forEach((p, i) => {
    if (pcs.includes(mod12(p))) out.push(i);
  });
  return out;
}

/**
 * @param {number[]} candidates
 * @param {number} target
 * @param {number} low
 * @param {number} high
 */
function nearestWithin(candidates, target, low, high) {
  let best = target;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c < low || c > high) continue;
    const d = Math.abs(c - target);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * @typedef {object} MelodyOptions
 * @property {Key} key
 * @property {MoodStyle} style
 * @property {'verse' | 'prechorus' | 'chorus'} kind
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {Chord[]} chords
 * @property {Rng} rng
 * @property {'tonic' | 'open'} [ending] 終わり方。tonic=主音で落ち着く、open=次へ続く
 */

/**
 * @param {MelodyOptions} o
 * @returns {NoteData[]}
 */
export function generateMelody(o) {
  const { key, style, kind, bars, timeSignature, chords, rng } = o;
  const barTicks = ticksPerBar(timeSignature);
  const range = melodyRange(key, kind, rng.pick([-2, 0, 0, 2]));
  const phrases = Math.max(1, Math.floor(bars / 2));
  const ending = o.ending ?? (kind === 'chorus' ? 'tonic' : 'open');

  // 繰り返しの形を決める: a a' b a'' / a b a' c / a a' b b'
  const form = rng.pick([
    ['a', "a'", 'b', "a''"],
    ['a', 'b', "a'", 'c'],
    ['a', "a'", 'b', "b'"],
  ]);
  /** @type {Record<string, { rhythm: PhraseRhythm, contour: number[], anchor: number }>} */
  const motifs = {};

  /** @type {NoteData[]} */
  const notes = [];
  let prev = clamp(range.low + rng.int(2, 5), range.low, range.high);

  for (let ph = 0; ph < phrases; ph++) {
    const label = form[ph % form.length];
    const baseLabel = label.replace(/'/g, '');
    const isVariant = label !== baseLabel && motifs[baseLabel];
    const phraseStart = ph * 2 * barTicks;
    const lastPhrase = ph === phrases - 1;

    const rhythm = isVariant ? motifs[baseLabel].rhythm : pickPhraseRhythm(style, kind, rng);
    /** @type {{ start: number, length: number }[]} */
    let slots = [
      ...rhythm.bar1.map(([s, l]) => ({ start: phraseStart + s * S, length: l * S })),
      ...rhythm.bar2.map(([s, l]) => ({ start: phraseStart + barTicks + s * S, length: l * S })),
    ].filter((x) => x.start + x.length <= bars * barTicks);
    // 変化形は終わりのリズムを変えることがある
    if (isVariant && rng.chance(0.4)) {
      const end = rng.pick(END_RHYTHMS);
      slots = [
        ...rhythm.bar1.map(([s, l]) => ({ start: phraseStart + s * S, length: l * S })),
        ...end.map(([s, l]) => ({ start: phraseStart + barTicks + s * S, length: l * S })),
      ];
    }

    // 形:前のフレーズの形をずらして使うか、新しく作る
    /** @type {number[]} */
    let contour;
    let delta = 0;
    if (isVariant && motifs[baseLabel].contour.length === slots.length) {
      delta = rng.pick([0, 0, 1, -1, 2]);
      contour = motifs[baseLabel].contour;
    } else {
      contour = makeContour(slots.length, style, rng);
    }

    // 形を置く高さ:変化形は元のフレーズと同じ高さ(少しずらす)。新しいフレーズは前の音と部品の中心の間から
    const centerRatio = { verse: 0.35, prechorus: 0.5, chorus: 0.6 }[kind];
    const center = Math.round(range.low + (range.high - range.low) * centerRatio);
    let anchor = isVariant && motifs[baseLabel].contour === contour
      ? motifs[baseLabel].anchor + delta
      : Math.round((prev + center) / 2) + rng.int(-1, 1) - contour[0];
    // 形全体が音域に収まるように動かす
    const cMin = Math.min(...contour);
    const cMax = Math.max(...contour);
    anchor = Math.max(range.low - cMin, Math.min(range.high - cMax, anchor));
    if (!motifs[baseLabel]) motifs[baseLabel] = { rhythm, contour, anchor };

    // 形を実際の高さにする。強い拍はコードの音に寄せる
    slots.forEach((slot, i) => {
      const chord = chordAt(chords, slot.start);
      let idx = clamp(anchor + contour[i], range.low, range.high);
      const strong = slot.start % 480 === 0 || slot.length >= 480;
      const isPhraseEnd = i === slots.length - 1;
      if (chord && (strong || isPhraseEnd)) {
        const tones = chordToneIndexes(range.scale, chord.symbol);
        idx = nearestWithin(tones, idx, range.low, range.high);
      }
      if (isPhraseEnd && lastPhrase) {
        idx = endingIndex(range, ending, idx, chord?.symbol);
      }
      // 大きすぎる跳躍を抑える(6度以上は戻す)
      if (notes.length && Math.abs(idx - prev) > 5) idx = prev + Math.sign(idx - prev) * rng.int(2, 4);
      idx = clamp(idx, range.low, range.high);
      const vel = (strong ? 100 : 86) + rng.int(-6, 6);
      notes.push({ start: slot.start, length: Math.max(S, slot.length - 20), pitch: range.scale[idx], velocity: vel });
      prev = idx;
    });
  }
  return notes;
}

/**
 * 終わりの音を決める。tonic なら主音、open なら主音以外のコードの音
 * @param {{ scale: number[], low: number, high: number, tonicIndex: number }} range
 * @param {'tonic' | 'open'} ending
 * @param {number} idx
 * @param {string} [symbol]
 */
function endingIndex(range, ending, idx, symbol) {
  const tonicPc = mod12(range.scale[range.tonicIndex]);
  const candidates = [];
  for (let i = range.low; i <= range.high; i++) {
    const pc = mod12(range.scale[i]);
    const inChord = symbol ? chordPitchClasses(symbol).includes(pc) : true;
    if (ending === 'tonic' ? pc === tonicPc : inChord && pc !== tonicPc) candidates.push(i);
  }
  return candidates.length ? nearestWithin(candidates, idx, range.low, range.high) : idx;
}

/**
 * フレーズの形(並びの番号の上下)。山なり・下り・上りなどから選び、少し揺らす
 * @param {number} n 音の数
 * @param {MoodStyle} style
 * @param {Rng} rng
 */
function makeContour(n, style, rng) {
  const shape = rng.pick(['arch', 'arch', 'fall', 'rise', 'wave']);
  const peak = rng.int(3, 5);
  /** @type {number[]} */
  const out = [];
  let cur = 0;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    let target = 0;
    if (shape === 'arch') target = Math.round(peak * Math.sin(Math.PI * t));
    else if (shape === 'fall') target = Math.round(peak * (1 - t));
    else if (shape === 'rise') target = Math.round(peak * t);
    else target = Math.round(2 * Math.sin(2 * Math.PI * t));
    // 目標に向かって基本は1つずつ動き、ときどき跳ぶ・留まる。目標に着いたら隣へ揺れる
    let step = Math.sign(target - cur);
    if (step === 0) step = rng.weighted([[1, 2], [-1, 2], [0, 1]]);
    else if (rng.chance(style.leapChance)) step *= 2;
    else if (rng.chance(0.1)) step = 0;
    cur += step;
    out.push(cur);
  }
  return out;
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
