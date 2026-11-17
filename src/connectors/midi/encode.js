// 曲データを MIDI ファイル(標準MIDIファイル 形式1)のバイト列にする。
// ブラウザにも Workers にも依存しない(MCP の export_midi でも使う)。
import { buildTimeline } from '../../core/timeline.js';
import { pitchClassOf } from '../../core/theory.js';

/** @typedef {import('../../core/types.js').Song} Song */

/** 楽器 → General MIDI の音色番号(0始まり) */
const PROGRAMS = /** @type {Record<string, number>} */ ({
  piano: 0, 'acoustic-guitar': 25, 'electric-guitar-clean': 27, 'electric-guitar-distortion': 30, bass: 33,
  strings: 48, 'electric-piano': 4, koto: 107, brass: 61, organ: 19, 'synth-bass': 38, choir: 52, taiko: 116, shamisen: 106, shinobue: 73, 'synth-lead': 80, 'synth-pad': 89, bell: 10, supersaw: 81,
});

/** 可変長の数 @param {number} n */
function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
/** @param {string} s */
const text = (s) => [...new TextEncoder().encode(s)];
/** @param {number} n @param {number} size */
const be = (n, size) => Array.from({ length: size }, (_, i) => (n >> (8 * (size - 1 - i))) & 0xff);

/**
 * @param {{ tick: number, order: number, bytes: number[] }[]} events
 */
function track(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  /** @type {number[]} */
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...text('MTrk'), ...be(body.length, 4), ...body];
}

/** @param {number} type @param {string} s */
const meta = (type, s) => {
  const b = text(s);
  return [0xff, type, ...vlq(b.length), ...b];
};

/**
 * @param {Song} song
 * @returns {{ bytes: Uint8Array<ArrayBuffer>, warnings: string[] }}
 */
export function songToMidi(song) {
  const tl = buildTimeline(song);
  /** @type {string[]} */
  const warnings = [];
  if (song.sections.some((s) => s.chords.length)) warnings.push('コード進行はMIDIには含まれません(部品の区切りはマーカーとして入ります)');

  // 最初のトラック:テンポ・拍子・キー・部品の区切り
  /** @type {{ tick: number, order: number, bytes: number[] }[]} */
  const conductor = [];
  conductor.push({ tick: 0, order: 0, bytes: meta(0x03, song.meta.title) });
  conductor.push({ tick: 0, order: 1, bytes: [0xff, 0x51, 3, ...be(Math.round(60000000 / song.tempo), 3)] });
  const [num, den] = song.timeSignature;
  conductor.push({ tick: 0, order: 2, bytes: [0xff, 0x58, 4, num, Math.log2(den), 24, 8] });
  conductor.push({ tick: 0, order: 3, bytes: [0xff, 0x59, 2, keySignature(song) & 0xff, song.key.mode === 'minor' ? 1 : 0] });
  for (const item of tl.items) conductor.push({ tick: item.startTick, order: 4, bytes: meta(0x06, item.name) });
  conductor.push({ tick: tl.totalTicks, order: 9, bytes: meta(0x06, 'end') });

  const chunks = [track(conductor)];
  let nextChannel = 0;
  let usedRiser = false;
  for (const t of song.tracks) {
    const isDrums = t.role === 'drums';
    let ch = 9;
    if (!isDrums) {
      if (nextChannel === 9) nextChannel++;
      ch = Math.min(nextChannel++, 15);
    }
    /** @type {{ tick: number, order: number, bytes: number[] }[]} */
    const ev = [{ tick: 0, order: 0, bytes: meta(0x03, t.name ?? t.id) }];
    if (!isDrums) ev.push({ tick: 0, order: 1, bytes: [0xc0 | ch, PROGRAMS[t.instrument] ?? 0] });
    ev.push({ tick: 0, order: 1, bytes: [0xb0 | ch, 7, Math.round((t.muted ? 0 : t.volume) * 127)] });
    for (const e of tl.events) {
      if (e.trackId !== t.id) continue;
      if (isDrums && e.pitch === 27) usedRiser = true;
      ev.push({ tick: e.tick, order: 3, bytes: [0x90 | ch, e.pitch, e.velocity] });
      ev.push({ tick: e.tick + e.length, order: 2, bytes: [0x80 | ch, e.pitch, 0] });
    }
    chunks.push(track(ev));
  }
  if (usedRiser) warnings.push('サビ前の「上がっていく効果音」は、他のソフトでは別の打楽器の音(High Q)で鳴ります');
  if (song.tracks.some((t) => t.sidechain)) warnings.push('バスドラムに合わせた音量のうねり、残響などの効果はMIDIには含まれません');

  const header = [...text('MThd'), ...be(6, 4), ...be(1, 2), ...be(chunks.length, 2), ...be(480, 2)];
  return { bytes: new Uint8Array([...header, ...chunks.flat()]), warnings };
}

/** 調号(シャープの数。フラットは負) @param {Song} song */
function keySignature(song) {
  const pc = ((pitchClassOf(song.key.tonic) ?? 0) + (song.key.mode === 'minor' ? 3 : 0)) % 12;
  return [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][pc];
}
