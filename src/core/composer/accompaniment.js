// 伴奏(和音のパート、ベース、背景の持続音)を作る。コードの音だけを使うのでキーから外れない。
import { chordPitchClasses, mod12, parseChord, scalePitchesInRange, ticksPerBar } from '../theory.js';

/** @typedef {import('../types.js').Key} Key */
/** @typedef {import('../types.js').Chord} Chord */
/** @typedef {import('../random.js').Rng} Rng */
/** @typedef {Omit<import('../types.js').Note, 'id'>} NoteData */

const S = 120;

/**
 * コードの音を、前の和音から手の動きが少なくなる形で積む(声部の進行をなめらかに)
 * @param {string} symbol
 * @param {number[] | null} prev
 * @param {number} low
 * @param {number} high
 */
export function voiceChord(symbol, prev, low = 52, high = 74) {
  const parsed = parseChord(symbol);
  const pcs = parsed ? parsed.intervals.map((i) => mod12(parsed.root + i)) : chordPitchClasses(symbol);
  const uniq = [...new Set(pcs)].slice(0, 4);
  /** @type {number[][]} */
  const candidates = [];
  for (let inv = 0; inv < uniq.length; inv++) {
    const order = [...uniq.slice(inv), ...uniq.slice(0, inv)];
    for (let base = low; base < low + 12; base++) {
      if (mod12(base) !== order[0]) continue;
      /** @type {number[]} */
      const v = [base];
      for (const pc of order.slice(1)) {
        let p = v[v.length - 1] + 1;
        while (mod12(p) !== pc) p++;
        v.push(p);
      }
      if (v[v.length - 1] <= high) candidates.push(v);
    }
  }
  if (!candidates.length) return uniq.map((pc) => 60 + pc);
  const center = (low + high) / 2;
  /** @param {number[]} v */
  const cost = (v) => {
    if (!prev) return Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
    const a = [...v].sort((x, y) => x - y);
    const b = [...prev].sort((x, y) => x - y);
    let c = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) c += Math.abs((a[Math.min(i, a.length - 1)] ?? 0) - (b[Math.min(i, b.length - 1)] ?? 0));
    return c;
  };
  return candidates.reduce((best, v) => (cost(v) < cost(best) ? v : best));
}

/**
 * 和音の根音(分数コードなら低音)を low〜low+11 の高さで
 * @param {string} symbol
 * @param {number} low
 */
function rootPitch(symbol, low) {
  const c = parseChord(symbol);
  const pc = c ? (c.bass ?? c.root) : 0;
  let p = low;
  while (mod12(p) !== pc) p++;
  return p;
}

/**
 * 1小節の中のパターンを、コードごとに区切って敷き詰める
 * @param {Chord[]} chords
 * @param {number} bars
 * @param {number} barTicks
 * @param {(chord: Chord, slot: number, barStart: number, index: number) => NoteData[]} make slotは16分音符単位の小節内位置
 * @param {number[]} slotsInBar
 */
function fillPattern(chords, bars, barTicks, make, slotsInBar) {
  /** @type {NoteData[]} */
  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barTicks;
    slotsInBar.forEach((slot, i) => {
      const t = barStart + slot * S;
      const chord = chords.find((c) => t >= c.start && t < c.start + c.length);
      if (!chord) return;
      for (const n of make(chord, slot, barStart, i)) {
        const end = Math.min(n.start + n.length, chord.start + chord.length, bars * barTicks);
        if (end > n.start) out.push({ ...n, length: end - n.start });
      }
    });
  }
  return out;
}

/**
 * @typedef {object} AccompanimentOptions
 * @property {Key} key
 * @property {Chord[]} chords
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {Rng} rng
 * @property {string} style
 */

/**
 * 和音のパート
 * @param {AccompanimentOptions} o
 * @returns {NoteData[]}
 */
export function generateChordPart(o) {
  const { chords, bars, timeSignature, rng, style } = o;
  const barTicks = ticksPerBar(timeSignature);
  /** @type {Map<Chord, number[]>} */
  const voicings = new Map();
  /** @type {number[] | null} */
  let prev = null;
  for (const c of chords) {
    prev = voiceChord(c.symbol, prev);
    voicings.set(c, prev);
  }
  /** @param {Chord} c */
  const v = (c) => voicings.get(c) ?? [];
  const human = () => rng.int(-5, 5);

  switch (style) {
    case 'arpeggio': {
      const order = rng.pick([[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 2, 1, 0, 2], [0, 1, 2, 1, 3, 1, 2, 1]]);
      return fillPattern(chords, bars, barTicks, (c, slot, barStart, i) => {
        const vo = v(c);
        const low = rootPitch(c.symbol, 40);
        const tones = [low, ...vo];
        const p = tones[order[i % order.length] % tones.length];
        return [{ start: barStart + slot * S, length: 2 * S * 2, pitch: p, velocity: 70 + (i % 4 === 0 ? 14 : 0) + human() }];
      }, [0, 2, 4, 6, 8, 10, 12, 14]);
    }
    case 'strum':
      return fillPattern(chords, bars, barTicks, (c, slot, barStart, i) =>
        v(c).map((p, k) => ({ start: barStart + slot * S + k * 8, length: 2 * S - 10, pitch: p, velocity: [96, 62, 78, 62, 90, 62, 78, 66][i] + human() })),
      [0, 2, 4, 6, 8, 10, 12, 14]);
    case 'palm':
      return fillPattern(chords, bars, barTicks, (c, slot, barStart, i) => {
        const r = rootPitch(c.symbol, 40);
        return [r, r + 7].map((p) => ({ start: barStart + slot * S, length: S, pitch: snapFifth(p, c.symbol, r), velocity: (i % 2 ? 70 : 92) + human() }));
      }, [0, 2, 4, 6, 8, 10, 12, 14]);
    case 'power':
      return fillPattern(chords, bars, barTicks, (c, slot, barStart) => {
        const r = rootPitch(c.symbol, 40);
        return [r, snapFifth(r + 7, c.symbol, r), r + 12].map((p) => ({ start: barStart + slot * S, length: slot === 0 ? 6 * S : 2 * S, pitch: p, velocity: 96 + human() }));
      }, [0, 6, 8, 12, 14]);
    case 'syncopated':
      return fillPattern(chords, bars, barTicks, (c, slot, barStart) =>
        v(c).map((p) => ({ start: barStart + slot * S, length: (slot === 0 ? 3 : 2) * S, pitch: p, velocity: (slot === 0 ? 92 : 78) + human() })),
      [0, 3, 6, 10, 12]);
    case 'quarter':
      return fillPattern(chords, bars, barTicks, (c, slot, barStart) =>
        v(c).map((p) => ({ start: barStart + slot * S, length: 3 * S, pitch: p, velocity: (slot % 8 === 0 ? 88 : 72) + human() })),
      [0, 4, 8, 12]);
    case 'pluck16':
      // 和音の音を16分音符で細かく上下する(EDMの粒の細かい音)
      return fillPattern(chords, bars, barTicks, (c, slot, barStart, i) => {
        const vo = v(c);
        const tones = [...vo, ...vo.map((p) => p + 12)];
        const p = tones[[0, 1, 2, 3, 4, 3, 2, 1][i % 8] % tones.length];
        return [{ start: barStart + slot * S, length: S - 20, pitch: p, velocity: (i % 4 === 0 ? 88 : 66) + human() }];
      }, Array.from({ length: 16 }, (_, i) => i));
    case 'offbeat-stab':
      // 拍の裏で短く和音を刻む
      return fillPattern(chords, bars, barTicks, (c, slot, barStart) =>
        v(c).map((p) => ({ start: barStart + slot * S, length: S + 40, pitch: p + 12, velocity: 84 + human() })),
      [2, 6, 10, 14]);
    case 'pump': {
      // 厚い和音を伸ばす(バスドラムに合わせたうねりは再生側で付ける)
      return chords.flatMap((c) => {
        const vo = v(c);
        const low = rootPitch(c.symbol, 48);
        return [low, ...vo, vo[vo.length - 1] + 12 > 88 ? vo[0] + 12 : vo[vo.length - 1] + 12]
          .filter((p, i, a) => a.indexOf(p) === i)
          .map((p) => ({ start: c.start, length: c.length - 10, pitch: p, velocity: 88 + human() }));
      });
    }
    case 'sustain':
    default:
      return chords.flatMap((c) => v(c).map((p) => ({ start: c.start, length: c.length - 20, pitch: p, velocity: 74 + human() })));
  }
}

/**
 * パワーコードの5度がコードにない(減5度の和音など)時は、コードの音に寄せる
 * @param {number} p
 * @param {string} symbol
 * @param {number} root
 */
function snapFifth(p, symbol, root) {
  const pcs = chordPitchClasses(symbol);
  if (pcs.includes(mod12(p))) return p;
  for (const d of [-1, 1, -2, 2]) if (pcs.includes(mod12(p + d))) return p + d;
  return root;
}

/**
 * ベース
 * @param {AccompanimentOptions} o
 * @returns {NoteData[]}
 */
export function generateBass(o) {
  const { key, chords, bars, timeSignature, rng, style } = o;
  const barTicks = ticksPerBar(timeSignature);
  const low = 33; // A1
  /** @param {Chord} c */
  const root = (c) => rootPitch(c.symbol, low);
  /** @param {Chord} c */
  const fifth = (c) => {
    const r = root(c);
    return snapFifth(r + 7, c.symbol, r);
  };
  const vel = (/** @type {boolean} */ strong) => (strong ? 100 : 84) + rng.int(-5, 5);
  const scale = scalePitchesInRange(key, 28, 60);

  /** @type {NoteData[]} */
  let notes;
  switch (style) {
    case 'whole':
      notes = chords.map((c) => ({ start: c.start, length: c.length - 30, pitch: root(c), velocity: vel(true) }));
      break;
    case 'half':
      notes = fillPattern(chords, bars, barTicks, (c, slot, barStart) => [
        { start: barStart + slot * S, length: (slot === 0 ? 6 : 4) * S, pitch: slot === 12 && rng.chance(0.3) ? fifth(c) : root(c), velocity: vel(slot === 0) },
      ], [0, 8, 12]);
      break;
    case 'eighth':
      notes = fillPattern(chords, bars, barTicks, (c, slot, barStart) => [
        { start: barStart + slot * S, length: 2 * S - 30, pitch: root(c), velocity: vel(slot % 4 === 0) },
      ], [0, 2, 4, 6, 8, 10, 12, 14]);
      break;
    case 'octave':
      notes = fillPattern(chords, bars, barTicks, (c, slot, barStart, i) => [
        { start: barStart + slot * S, length: 2 * S - 30, pitch: root(c) + (i % 2 ? 12 : 0), velocity: vel(i % 2 === 0) },
      ], [0, 2, 4, 6, 8, 10, 12, 14]);
      break;
    case 'offbeat':
      // 拍の裏で鳴るベース(EDM)
      notes = fillPattern(chords, bars, barTicks, (c, slot, barStart) => [
        { start: barStart + slot * S, length: 2 * S - 20, pitch: root(c) + 12, velocity: vel(true) },
      ], [2, 6, 10, 14]);
      break;
    case 'rolling':
      // バスドラムの位置をよけて16分音符で転がる
      notes = fillPattern(chords, bars, barTicks, (c, slot, barStart) => [
        { start: barStart + slot * S, length: S - 15, pitch: root(c) + (slot % 4 === 2 ? 12 : 0), velocity: vel(slot % 4 === 2) },
      ], [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]);
      break;
    case 'syncopated':
    default:
      notes = fillPattern(chords, bars, barTicks, (c, slot, barStart) => [
        { start: barStart + slot * S, length: 3 * S - 30, pitch: slot === 8 && rng.chance(0.4) ? fifth(c) : root(c), velocity: vel(slot === 0) },
      ], [0, 3, 6, 8, 11, 14]);
      break;
  }

  // 次のコードへ向かう経過音:コードの変わり目の直前の音を、次の根音の隣の音にする
  if (style !== 'whole' && style !== 'offbeat' && style !== 'rolling') {
    for (let i = 0; i < chords.length - 1; i++) {
      const next = chords[i + 1];
      const before = notes.filter((n) => n.start < next.start && n.start >= next.start - 2 * S);
      const last = before[before.length - 1];
      if (!last || !rng.chance(0.45)) continue;
      const target = root(next);
      const idx = scale.indexOf(target);
      if (idx < 0) continue;
      const from = last.pitch;
      const approach = scale[from <= target ? idx - 1 : idx + 1];
      if (approach !== undefined) last.pitch = approach;
    }
  }
  return notes;
}

/**
 * 背景の持続音(ストリングス・パッド)
 * @param {AccompanimentOptions} o
 * @returns {NoteData[]}
 */
export function generatePad(o) {
  /** @type {number[] | null} */
  let prev = null;
  return o.chords.flatMap((c) => {
    prev = voiceChord(c.symbol, prev, 60, 82);
    return prev.map((p) => ({ start: c.start, length: c.length - 10, pitch: p, velocity: 56 + o.rng.int(-4, 4) }));
  });
}
