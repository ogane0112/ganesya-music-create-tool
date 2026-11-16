// 歌の裏やイントロで鳴るフレーズ(リフ)を作る。
// riff: 16分音符で5音を駆け回る短い型を作り、コードに合わせて移しながら繰り返す(和風ロックの速いリフ)
// arp : コードの音を16分音符で上下する(EDMの粒の細かいシンセ)
import { chordPitchClasses, mod12, parseChord, pentatonicPitchesInRange, ticksPerBar } from '../theory.js';
import { chordAt } from './progressions.js';

/** @typedef {import('../types.js').Key} Key */
/** @typedef {import('../types.js').Chord} Chord */
/** @typedef {import('../random.js').Rng} Rng */
/** @typedef {Omit<import('../types.js').Note, 'id'>} NoteData */

const S = 120;

/** 1小節のリズム(16文字、x=音) */
const RIFF_RHYTHMS = [
  'xxxxxxxxxxxxxxxx',
  'x.xxx.xxx.xxx.xx',
  'x.x.xxx.x.x.xxx.',
  'xx.xx.xx.xx.x.x.',
  'x.xxx.x.xxx.xxxx',
];

/**
 * @typedef {object} LeadOptions
 * @property {Key} key
 * @property {Chord[]} chords
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {Rng} rng
 * @property {string} style riff | arp | none
 */

/**
 * @param {LeadOptions} o
 * @returns {NoteData[]}
 */
export function generateLead(o) {
  if (o.style === 'riff') return riff(o);
  if (o.style === 'arp') return arp(o);
  return [];
}

/** @param {LeadOptions} o */
function riff(o) {
  const { key, chords, bars, timeSignature, rng } = o;
  const barTicks = ticksPerBar(timeSignature);
  const scale = pentatonicPitchesInRange(key, 62, 93);
  const rhythm = rng.pick(RIFF_RHYTHMS);
  const count = [...rhythm].filter((c) => c === 'x').length;
  // 型:5音の並びの上下。最初の音を0として、小さく行ったり来たりする
  /** @type {number[]} */
  const motif = [0];
  for (let i = 1; i < count; i++) {
    const prev = motif[i - 1];
    let step = rng.weighted([[1, 3], [-1, 3], [2, 1], [-2, 1], [0, 1]]);
    if (Math.abs(prev + step) > 4) step = -Math.sign(prev) * 1;
    motif.push(prev + step);
  }
  // 2小節目は終わりを変える(問いと答え)
  const answer = motif.map((m, i) => (i >= count - 4 ? m + rng.pick([-2, -1, 1, 2]) : m));

  /** @type {NoteData[]} */
  const notes = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barTicks;
    const chord = chordAt(chords, barStart);
    // コードの根音に一番近い5音を起点にする
    const root = chord ? (parseChord(chord.symbol)?.root ?? 0) : 0;
    let base = scale.findIndex((p) => p >= 74 && mod12(p) === root);
    if (base < 0) base = scale.findIndex((p) => p >= 72);
    if (base < 0) base = Math.floor(scale.length / 2);
    const shape = bar % 2 === 0 ? motif : answer;
    let k = 0;
    for (let i = 0; i < 16; i++) {
      if (rhythm[i] !== 'x') continue;
      const idx = Math.max(0, Math.min(scale.length - 1, base + shape[k]));
      k++;
      const t = barStart + i * S;
      const c = chordAt(chords, t);
      // 拍の頭でコードに合わない時は隣のコードの音へ
      let pitch = scale[idx];
      if (c && i % 4 === 0 && !chordPitchClasses(c.symbol).includes(mod12(pitch))) {
        const near = [scale[idx - 1], scale[idx + 1]].find((p) => p !== undefined && chordPitchClasses(c.symbol).includes(mod12(p)));
        if (near !== undefined) pitch = near;
      }
      notes.push({ start: t, length: S - 15, pitch, velocity: (i % 4 === 0 ? 104 : 84) + rng.int(-6, 6) });
    }
  }
  return notes;
}

/** @param {LeadOptions} o */
function arp(o) {
  const { chords, bars, timeSignature, rng } = o;
  const barTicks = ticksPerBar(timeSignature);
  const order = rng.pick([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 0, 1, 2, 3, 4]]);
  /** @type {NoteData[]} */
  const notes = [];
  for (let t = 0; t < bars * barTicks; t += S) {
    const c = chordAt(chords, t);
    if (!c) continue;
    const pcs = chordPitchClasses(c.symbol);
    /** @type {number[]} */
    const tones = [];
    for (let p = 67; p <= 91 && tones.length < 5; p++) if (pcs.includes(mod12(p))) tones.push(p);
    const i = Math.round(t / S);
    notes.push({ start: t, length: S - 20, pitch: tones[order[i % order.length] % tones.length], velocity: (i % 4 === 0 ? 82 : 64) + rng.int(-5, 5) });
  }
  return notes;
}
