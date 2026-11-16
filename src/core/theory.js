// 音楽の基礎計算:キーに合う音の判定、コード名から構成音、ティックと秒の変換。
import { TICKS_PER_BEAT } from './types.js';

/** @typedef {import('./types.js').Key} Key */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** 音名→0〜11(ドを0) */
const NAME_TO_PC = /** @type {Record<string, number>} */ ({
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
});

const SCALE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** 画面用のドレミ(音楽用語を避けるため) */
const DOREMI = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

/** @param {number} n */
export const mod12 = (n) => ((n % 12) + 12) % 12;

/**
 * 音名から 0〜11 を返す。知らない名前なら null
 * @param {string} name
 * @returns {number | null}
 */
export function pitchClassOf(name) {
  const pc = NAME_TO_PC[name];
  return pc === undefined ? null : pc;
}

/** @param {string} name */
export const isValidTonic = (name) =>
  SHARP_NAMES.includes(name) || FLAT_NAMES.includes(name);

/**
 * キーで使える音(0〜11)を、そのキーの1番目の音から順に返す
 * @param {Key} key
 * @returns {number[]}
 */
export function scalePitchClasses(key) {
  const tonic = pitchClassOf(key.tonic);
  if (tonic === null) throw new Error(`知らない音名です: ${key.tonic}`);
  return SCALE_STEPS[key.mode].map((s) => mod12(tonic + s));
}

/**
 * MIDIの音番号がキーに合っているか
 * @param {number} pitch
 * @param {Key} key
 */
export function isInKey(pitch, key) {
  return scalePitchClasses(key).includes(mod12(pitch));
}

/**
 * キーに合う音だけを、low以上high以下で並べて返す
 * @param {Key} key
 * @param {number} low
 * @param {number} high
 */
export function scalePitchesInRange(key, low, high) {
  const pcs = scalePitchClasses(key);
  /** @type {number[]} */
  const out = [];
  for (let p = low; p <= high; p++) if (pcs.includes(mod12(p))) out.push(p);
  return out;
}

/**
 * 指定した音に一番近い、キーに合う音を返す(同じ距離なら下)
 * @param {number} pitch
 * @param {Key} key
 */
export function snapToKey(pitch, key) {
  for (let d = 0; d < 12; d++) {
    if (isInKey(pitch - d, key)) return pitch - d;
    if (isInKey(pitch + d, key)) return pitch + d;
  }
  return pitch;
}

/**
 * 音番号から表示用の名前(例: 69 → "A4")
 * @param {number} pitch
 * @param {boolean} [preferFlat]
 */
export function pitchName(pitch, preferFlat = false) {
  const names = preferFlat ? FLAT_NAMES : SHARP_NAMES;
  return `${names[mod12(pitch)]}${Math.floor(pitch / 12) - 1}`;
}

/**
 * 音番号からドレミの名前(例: 69 → "ラ4")
 * @param {number} pitch
 */
export function pitchNameDoremi(pitch) {
  return `${DOREMI[mod12(pitch)]}${Math.floor(pitch / 12) - 1}`;
}

/** キーをフラット表記にするか(F、B♭などのキー) @param {Key} key */
export function keyPrefersFlat(key) {
  const majorTonic = mod12((pitchClassOf(key.tonic) ?? 0) + (key.mode === 'minor' ? 3 : 0));
  return [5, 10, 3, 8, 1, 6].includes(majorTonic) && key.tonic !== 'F#';
}

/**
 * 0〜11 を音名にする
 * @param {number} pc
 * @param {boolean} [preferFlat]
 */
export function pcName(pc, preferFlat = false) {
  return (preferFlat ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

// ---- コード ----

/** 和音の種類ごとの、根音からの距離 */
const CHORD_QUALITIES = /** @type {Record<string, number[]>} */ ({
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
});

/** 書き方の揺れを正規化する */
const QUALITY_ALIASES = /** @type {Record<string, string>} */ ({
  M7: 'maj7', M9: 'maj9', min: 'm', '-': 'm', min7: 'm7', '-7': 'm7', 'ø': 'm7b5',
  'm7-5': 'm7b5', o: 'dim', o7: 'dim7', '+': 'aug', mM7: 'mmaj7', sus: 'sus4', maj: '',
});

/**
 * @typedef {object} ParsedChord
 * @property {number} root 0〜11
 * @property {string} quality
 * @property {number[]} intervals 根音からの距離
 * @property {number | null} bass 分数コードの低音(0〜11)
 */

/**
 * コード名を読む。読めなければ null
 * @param {string} symbol 例: "Am7", "F#m7b5", "G/B"
 * @returns {ParsedChord | null}
 */
export function parseChord(symbol) {
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(symbol.trim());
  if (!m) return null;
  const root = pitchClassOf(m[1]);
  if (root === null) return null;
  let quality = m[2];
  if (QUALITY_ALIASES[quality] !== undefined) quality = QUALITY_ALIASES[quality];
  const intervals = CHORD_QUALITIES[quality];
  if (!intervals) return null;
  const bass = m[3] ? pitchClassOf(m[3]) : null;
  if (m[3] && bass === null) return null;
  return { root, quality, intervals, bass };
}

/**
 * コードの構成音(0〜11)
 * @param {string} symbol
 * @returns {number[]}
 */
export function chordPitchClasses(symbol) {
  const c = parseChord(symbol);
  if (!c) throw new Error(`読めないコード名です: ${symbol}`);
  const pcs = c.intervals.map((i) => mod12(c.root + i));
  if (c.bass !== null && !pcs.includes(c.bass)) pcs.unshift(c.bass);
  return pcs;
}

/**
 * コードの構成音を実際の音の高さで返す(低音を先頭に)
 * @param {string} symbol
 * @param {number} [rootOctave] 根音のオクターブ(4ならC4=60の段)
 * @returns {number[]}
 */
export function chordPitches(symbol, rootOctave = 4) {
  const c = parseChord(symbol);
  if (!c) throw new Error(`読めないコード名です: ${symbol}`);
  const base = (rootOctave + 1) * 12 + c.root;
  const tones = c.intervals.map((i) => base + i);
  if (c.bass !== null) {
    let b = (rootOctave + 1) * 12 + c.bass;
    while (b >= tones[0]) b -= 12;
    tones.unshift(b);
  }
  return tones;
}

/**
 * コードの全構成音がキーに合っているか
 * @param {string} symbol
 * @param {Key} key
 */
export function isChordInKey(symbol, key) {
  const pcs = scalePitchClasses(key);
  return chordPitchClasses(symbol).every((pc) => pcs.includes(pc));
}

/**
 * コード名を半音ずらす
 * @param {string} symbol
 * @param {number} semitones
 * @param {boolean} [preferFlat]
 */
export function transposeChord(symbol, semitones, preferFlat = false) {
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(symbol.trim());
  if (!m) throw new Error(`読めないコード名です: ${symbol}`);
  const root = pcName((pitchClassOf(m[1]) ?? 0) + semitones, preferFlat);
  const bass = m[3] ? `/${pcName((pitchClassOf(m[3]) ?? 0) + semitones, preferFlat)}` : '';
  return `${root}${m[2]}${bass}`;
}

/**
 * キーの中で、度数(1〜7)からコード名を作る。3和音か4和音か選べる
 * @param {Key} key
 * @param {number} degree 1〜7
 * @param {{ seventh?: boolean }} [opts]
 */
export function diatonicChord(key, degree, opts = {}) {
  const pcs = scalePitchClasses(key);
  const i = degree - 1;
  const root = pcs[i];
  const third = mod12(pcs[(i + 2) % 7] - root);
  const fifth = mod12(pcs[(i + 4) % 7] - root);
  const seventh = mod12(pcs[(i + 6) % 7] - root);
  let q = '';
  if (third === 3 && fifth === 7) q = 'm';
  else if (third === 3 && fifth === 6) q = 'dim';
  if (opts.seventh) {
    if (q === '') q = seventh === 11 ? 'maj7' : '7';
    else if (q === 'm') q = 'm7';
    else if (q === 'dim') q = 'm7b5';
  }
  return `${pcName(root, keyPrefersFlat(key))}${q}`;
}

// ---- 時間 ----

/** @param {[number, number]} timeSignature */
export function ticksPerBar(timeSignature) {
  const [beats, unit] = timeSignature;
  return (beats * TICKS_PER_BEAT * 4) / unit;
}

/**
 * ティック→秒
 * @param {number} ticks
 * @param {number} tempo
 */
export function ticksToSeconds(ticks, tempo) {
  return (ticks / TICKS_PER_BEAT) * (60 / tempo);
}

/**
 * 秒→ティック
 * @param {number} seconds
 * @param {number} tempo
 */
export function secondsToTicks(seconds, tempo) {
  return (seconds * tempo * TICKS_PER_BEAT) / 60;
}
