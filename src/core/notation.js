// かんたん記法:メロディとコード進行を短い文字で書く。AI(MCP)が書きやすく、人も読める。
//   メロディ: "E5:1 D5:0.5 r:0.5 | C5:2 ..."   音の名前:長さ(拍)。r は休み。| は小節の区切り(飾り。なくてもよい)
//             長さは小数か分数(3連符は 1/3)。末尾に ! を付けると強く
//   コード  : "Am7:4 F:2 G:2"                   コード名:長さ(拍)
import { TICKS_PER_BEAT } from './types.js';
import { parseChord, pitchClassOf, pitchName } from './theory.js';

/** @typedef {Omit<import('./types.js').Note, 'id'>} NoteData */
/** @typedef {import('./types.js').Chord} Chord */

export class NotationError extends Error {}

/** @param {string} text @param {string} token */
function parseBeats(text, token) {
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+))?$/.exec(text);
  const beats = m ? Number(m[1]) / (m[2] ? Number(m[2]) : 1) : NaN;
  if (!(beats > 0) || beats > 64) throw new NotationError(`長さが読めません: "${token}"(例 C5:1、3連符は C5:1/3)`);
  return beats;
}

/**
 * 音の名前(C4=60)を音番号にする
 * @param {string} name
 * @returns {number | null}
 */
export function parsePitchName(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const pc = pitchClassOf(m[1].toUpperCase() + m[2]);
  if (pc === null) return null;
  const pitch = (Number(m[3]) + 1) * 12 + pc;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

/** @param {string} text */
const tokens = (text) => text.split(/[\s,|]+/).filter(Boolean);

/**
 * @param {string} text
 * @returns {NoteData[]}
 */
export function parseMelody(text) {
  /** @type {NoteData[]} */
  const notes = [];
  let pos = 0; // 拍(誤差をためないよう、ティックへは都度丸める)
  for (const token of tokens(text)) {
    const m = /^([^:!]+):([^:!]+)(!?)$/.exec(token);
    if (!m) throw new NotationError(`読めません: "${token}"(「音の名前:長さ」で書きます。例 E5:1、休みは r:1)`);
    const beats = parseBeats(m[2], token);
    const start = Math.round(pos * TICKS_PER_BEAT);
    const end = Math.round((pos + beats) * TICKS_PER_BEAT);
    pos += beats;
    if (/^(r|R|-|rest)$/.test(m[1])) continue;
    const pitch = parsePitchName(m[1]);
    if (pitch === null) throw new NotationError(`音の名前が読めません: "${token}"(例 C4、F#4、Bb3。C4 が真ん中のド)`);
    const span = end - start;
    notes.push({ start, length: Math.max(30, span >= 120 ? span - 15 : span), pitch, velocity: m[3] ? 112 : 94 });
  }
  return notes;
}

/**
 * @param {string} text
 * @returns {Chord[]}
 */
export function parseChords(text) {
  /** @type {Chord[]} */
  const chords = [];
  let pos = 0;
  for (const token of tokens(text)) {
    const i = token.lastIndexOf(':');
    if (i < 0) throw new NotationError(`読めません: "${token}"(「コード名:長さ」で書きます。例 Am7:4)`);
    const symbol = token.slice(0, i);
    const beats = parseBeats(token.slice(i + 1), token);
    const start = Math.round(pos * TICKS_PER_BEAT);
    const end = Math.round((pos + beats) * TICKS_PER_BEAT);
    pos += beats;
    if (/^(N\.?C\.?|r|-)$/i.test(symbol)) continue; // コードなし
    if (!parseChord(symbol)) throw new NotationError(`コード名が読めません: "${symbol}"(例 C、Am7、Fmaj7、G/B、E7、Dm7b5、Gsus4、Cadd9、Bdim)`);
    chords.push({ start, length: end - start, symbol });
  }
  return chords;
}

/** @param {number} ticks */
function beatsText(ticks) {
  const beats = ticks / TICKS_PER_BEAT;
  if (Number.isInteger(beats * 4)) return String(beats);
  if (Number.isInteger(ticks / 160)) return `${ticks / 160}/3`;
  return String(Math.round(beats * 1000) / 1000);
}

/**
 * 音符をかんたん記法にする(同時に鳴る音は一番高い音だけ)。小節ごとに | を入れる
 * @param {{ start: number, length: number, pitch: number, velocity?: number }[]} notes
 * @param {{ flat?: boolean, barTicks?: number, totalTicks?: number }} [opts]
 */
export function formatMelody(notes, opts = {}) {
  const barTicks = opts.barTicks ?? 1920;
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  /** @type {string[]} */
  const out = [];
  let pos = 0;
  /** @param {number} to 休みを小節の区切りで分けて入れる */
  const rest = (to) => {
    while (pos < to) {
      const next = Math.min(to, (Math.floor(pos / barTicks) + 1) * barTicks);
      out.push(`r:${beatsText(next - pos)}`);
      pos = next;
      if (pos % barTicks === 0 && pos < to) out.push('|');
    }
  };
  sorted.forEach((n, i) => {
    if (n.start < pos) return; // 重なる音は飛ばす
    // 16分音符の格子に寄せた終わり(作る時に少し短くした分を戻す)
    const nextStart = sorted.slice(i + 1).find((x) => x.start > n.start)?.start ?? Infinity;
    let end = Math.min(nextStart, Math.ceil((n.start + n.length) / 120) * 120);
    if (end <= n.start) end = n.start + n.length;
    rest(n.start);
    if (pos > 0 && pos % barTicks === 0) out.push('|');
    out.push(`${pitchName(n.pitch, opts.flat)}:${beatsText(end - n.start)}${(n.velocity ?? 0) >= 108 ? '!' : ''}`);
    pos = end;
  });
  if (opts.totalTicks) rest(opts.totalTicks);
  return out.join(' ').replace(/\| \|/g, '|');
}

/**
 * @param {Chord[]} chords
 */
export function formatChords(chords) {
  /** @type {string[]} */
  const out = [];
  let pos = 0;
  for (const c of [...chords].sort((a, b) => a.start - b.start)) {
    if (c.start > pos) out.push(`N.C.:${beatsText(c.start - pos)}`);
    out.push(`${c.symbol}:${beatsText(c.length)}`);
    pos = c.start + c.length;
  }
  return out.join(' ');
}
