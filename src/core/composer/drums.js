// ドラムを作る。音の高さの代わりに、General MIDI の打楽器の番号を使う。
import { ticksPerBar } from '../theory.js';

/** @typedef {import('../random.js').Rng} Rng */
/** @typedef {Omit<import('../types.js').Note, 'id'>} NoteData */

/** General MIDI の打楽器の番号 */
export const DRUM = {
  kick: 36,
  sideStick: 37,
  snare: 38,
  closedHat: 42,
  pedalHat: 44,
  openHat: 46,
  lowTom: 45,
  midTom: 47,
  highTom: 50,
  crash: 49,
  ride: 51,
  clap: 39,
  /** 上がっていく効果音(GMでは High Q。このアプリでは雑音が高くなっていく音にする) */
  riser: 27,
};

const S = 120;

/**
 * 1小節のパターン。16文字で、x=強く、o=弱く、.=休み
 * @typedef {Partial<Record<keyof typeof DRUM, string>>} DrumPattern
 */

/** @type {Record<string, DrumPattern>} */
export const DRUM_PATTERNS = {
  light: { kick: 'x.......x.......', sideStick: '....x.......x...', closedHat: 'x.o.x.o.x.o.x.o.' },
  'half-time': { kick: 'x.........x.....', snare: '........x.......', closedHat: 'x.o.x.o.x.o.x.o.' },
  'eight-beat': { kick: 'x.....x.x.......', snare: '....x.......x...', closedHat: 'x.o.x.o.x.o.x.o.' },
  sixteen: { kick: 'x..o..x...x..o..', snare: '....x.......x...', closedHat: 'xoooxoooxoooxooo' },
  'four-floor': { kick: 'x...x...x...x...', snare: '....x.......x...', openHat: '..x...x...x...x.', closedHat: 'x...x...x...x...' },
  ride: { kick: 'x.....x...x.....', snare: '....x.......x...', ride: 'x.o.x.o.x.o.x.o.' },
  // EDMの四つ打ち:裏で開いたハイハット、16分の閉じたハイハット
  edm: { kick: 'x...x...x...x...', snare: '....x.......x...', openHat: '..x...x...x...x.', closedHat: 'oooooooooooooooo' },
};

/** 部品の終わりの1拍半〜2拍に入れる「おかず」 */
const FILLS = /** @type {DrumPattern[]} */ ([
  { kick: 'x.....x.........', snare: '....x...x.o.x.xo', closedHat: 'x.o.x.o.........' },
  { kick: 'x.......x.......', snare: '....x.......xxxx', closedHat: 'x.o.x.o.x.o.....' },
  { kick: 'x.....x.........', snare: '....x...x.......', highTom: '..........x.x...', midTom: '............x.x.', lowTom: '..............xx', closedHat: 'x.o.x.o.........' },
  { kick: 'x.....x.x.......', snare: '....x.....xoxoxx', closedHat: 'x.o.x.o.x.......' },
]);

/** Bメロの終わりの盛り上げ(だんだん細かくなる) */
const BUILD = /** @type {DrumPattern} */ ({ kick: 'x...x...x...x...', snare: 'x.x.x.x.xxxxxxxx' });

const LENGTHS = /** @type {Record<keyof typeof DRUM, number>} */ ({
  kick: 240, sideStick: 60, snare: 180, closedHat: 60, pedalHat: 60, openHat: 200,
  lowTom: 240, midTom: 240, highTom: 240, crash: 1440, ride: 300,
});

/**
 * @param {DrumPattern} pattern
 * @param {number} barStart
 * @param {Rng} rng
 * @param {number} [scale] 強さの倍率
 * @returns {NoteData[]}
 */
function renderBar(pattern, barStart, rng, scale = 1) {
  /** @type {NoteData[]} */
  const out = [];
  for (const [name, row] of /** @type {[keyof typeof DRUM, string][]} */ (Object.entries(pattern))) {
    for (let i = 0; i < 16; i++) {
      const ch = row[i];
      if (ch !== 'x' && ch !== 'o') continue;
      const base = ch === 'x' ? 100 : 66;
      out.push({
        start: barStart + i * S,
        length: LENGTHS[name],
        pitch: DRUM[name],
        velocity: Math.max(1, Math.min(127, Math.round((base + rng.int(-6, 6)) * scale))),
      });
    }
  }
  return out;
}

/**
 * @typedef {object} DrumOptions
 * @property {'verse' | 'prechorus' | 'chorus'} kind
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {Rng} rng
 * @property {string} style
 */

/**
 * @param {DrumOptions} o
 * @returns {NoteData[]}
 */
export function generateDrums(o) {
  const { kind, bars, timeSignature, rng, style } = o;
  const barTicks = ticksPerBar(timeSignature);
  const pattern = DRUM_PATTERNS[style] ?? DRUM_PATTERNS['eight-beat'];
  const scale = kind === 'verse' ? 0.85 : 1;
  /** @type {NoteData[]} */
  const notes = [];
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * barTicks;
    const last = bar === bars - 1;
    const fillEvery4 = !last && bar % 4 === 3 && rng.chance(0.4);
    if (style === 'four-floor' && kind === 'prechorus' && bar >= bars - 2) {
      // EDMの盛り上げ:スネアがだんだん細かく強くなり、最後の2拍はバスドラムを抜いて溜める
      const row = bar === bars - 2 ? 'x...x...x.x.x.x.' : 'x.x.x.x.xxxxxxxx';
      for (let i = 0; i < 16; i++) {
        if (row[i] !== 'x') continue;
        const progress = (bar - (bars - 2) + i / 16) / 2;
        notes.push({ start: start + i * S, length: 120, pitch: DRUM.snare, velocity: Math.round(55 + 70 * progress) });
      }
      const kick = bar === bars - 2 ? 'x...x...x...x...' : 'x...x...........';
      for (let i = 0; i < 16; i++) if (kick[i] === 'x') notes.push({ start: start + i * S, length: 240, pitch: DRUM.kick, velocity: 100 });
    } else if (last && kind === 'prechorus' && rng.chance(0.6)) notes.push(...renderBar(BUILD, start, rng, 1));
    else if (last || fillEvery4) notes.push(...renderBar(rng.pick(FILLS), start, rng, scale));
    else notes.push(...renderBar(pattern, start, rng, scale));
  }
  // サビの頭、4小節ごとにシンバル
  if (kind === 'chorus') {
    for (let bar = 0; bar < bars; bar += 4) notes.push({ start: bar * barTicks, length: LENGTHS.crash, pitch: DRUM.crash, velocity: 104 });
  }
  return notes;
}
