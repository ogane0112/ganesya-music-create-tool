// コード進行を作る。
import { TICKS_PER_BEAT } from '../types.js';
import { diatonicChord, isChordInKey, keyPrefersFlat, mod12, pcName, pitchClassOf, scalePitchClasses, ticksPerBar } from '../theory.js';

/** @typedef {import('../types.js').Key} Key */
/** @typedef {import('../types.js').Chord} Chord */
/** @typedef {import('./styles.js').ChordStep} ChordStep */
/** @typedef {import('./styles.js').MoodStyle} MoodStyle */
/** @typedef {import('../random.js').Rng} Rng */

/**
 * 曲のキーと同じ音の並びを持つ明るい側のキー(暗いキーなら平行調)
 * @param {Key} key
 * @returns {Key}
 */
export function majorFrame(key) {
  if (key.mode === 'major') return key;
  const pc = mod12((pitchClassOf(key.tonic) ?? 0) + 3);
  return { tonic: /** @type {any} */ (pcName(pc, keyPrefersFlat(key))), mode: 'major' };
}

/**
 * 度数の指定からコード名を作る。キーから外れる彩りは付けない
 * @param {Key} key 曲のキー
 * @param {ChordStep} step
 * @param {boolean} seventh
 */
export function chordSymbolFor(key, step, seventh) {
  const frame = majorFrame(key);
  const flat = keyPrefersFlat(key);
  const scale = scalePitchClasses(frame);
  const plain = diatonicChord(frame, step.deg);
  let symbol = plain;
  const root = pcName(scale[step.deg - 1], flat);
  if (step.color === 'sus4') symbol = `${root}sus4`;
  else if (step.color === '7' || seventh) symbol = diatonicChord(frame, step.deg, { seventh: true });
  else if (step.color === 'add9') symbol = plain.endsWith('m') ? `${plain}add9` : plain.endsWith('dim') ? plain : `${plain}add9`;
  if (!isChordInKey(symbol, key)) symbol = plain;
  if (step.bassDeg) {
    const withBass = `${symbol}/${pcName(scale[step.bassDeg - 1], flat)}`;
    if (isChordInKey(withBass, key)) symbol = withBass;
  }
  return symbol;
}

/**
 * 部品の終わりに置く落ち着き先の度数
 * @param {'verse' | 'prechorus' | 'chorus'} kind
 * @param {Key} key
 * @param {Rng} rng
 * @returns {ChordStep}
 */
function cadenceStep(kind, key, rng) {
  if (kind === 'prechorus') return rng.pick([{ deg: 5, beats: 4 }, { deg: 5, beats: 4, color: /** @type {const} */ ('sus4') }, { deg: 4, beats: 4, bassDeg: 5 }]);
  if (kind === 'verse') return rng.pick([{ deg: 5, beats: 4 }, { deg: 4, beats: 4 }]);
  return key.mode === 'minor' ? { deg: 6, beats: 4 } : { deg: 1, beats: 4 };
}

/**
 * 部品1つ分のコード進行を作る
 * @param {object} p
 * @param {Key} p.key
 * @param {MoodStyle} p.style
 * @param {'verse' | 'prechorus' | 'chorus'} p.kind
 * @param {number} p.bars
 * @param {[number, number]} p.timeSignature
 * @param {Rng} p.rng
 * @param {ChordStep[]} [p.avoid] 同じ進行を避けたい時
 * @returns {Chord[]}
 */
export function generateProgression({ key, style, kind, bars, timeSignature, rng, avoid }) {
  const candidates = style.progressions[kind].filter((c) => c !== avoid);
  const base = rng.pick(candidates.length ? candidates : style.progressions[kind]);
  // 4和音にする度数を部品ごとに決める(同じコードが行ったり来たりしないように)
  const seventhDegrees = new Set(rng.chance(style.seventhChance) ? [1, 2, 3, 4, 5, 6].filter((d) => d === 4 || d === 6 || rng.chance(0.4)) : []);
  const barTicks = ticksPerBar(timeSignature);
  const total = bars * barTicks;
  /** @type {Chord[]} */
  const chords = [];
  let t = 0;
  let cycle = 0;
  while (t < total) {
    const lastCycle = t + base.reduce((s, c) => s + c.beats * TICKS_PER_BEAT, 0) >= total;
    for (let i = 0; i < base.length && t < total; i++) {
      let step = base[i];
      const length = Math.min(step.beats * TICKS_PER_BEAT, total - t);
      const isLast = t + length >= total;
      if (isLast && lastCycle && cycle > 0 && rng.chance(0.6)) step = { ...cadenceStep(kind, key, rng), beats: step.beats };
      const useSeventh = seventhDegrees.has(step.deg);
      chords.push({ start: t, length, symbol: chordSymbolFor(key, step, useSeventh) });
      t += length;
    }
    cycle++;
  }
  return chords;
}

/**
 * 時刻 tick に鳴っているコード
 * @param {Chord[]} chords
 * @param {number} tick
 */
export function chordAt(chords, tick) {
  for (const c of chords) if (tick >= c.start && tick < c.start + c.length) return c;
  return chords.length ? chords[chords.length - 1] : null;
}
