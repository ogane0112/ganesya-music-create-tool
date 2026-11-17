import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../src/core/catalog.js';
import { parseMelody, formatMelody } from '../src/core/notation.js';
import { updateSongSettings } from '../src/core/operations.js';
import { performSong } from '../src/core/performance.js';
import { songToMidi } from '../src/connectors/midi/encode.js';
import { validateSong } from '../src/core/validate.js';
import { createDraftSong } from '../src/core/operations.js';
import { loadMinimalSong, unwrap } from './helpers.js';

describe('Q2・Q3 パートごとの左右と残響', () => {
  it('設定でき、範囲外は断る。元の曲は変わらない', () => {
    const song = loadMinimalSong();
    const s = unwrap(updateSongSettings(song, { tracks: [{ id: 't1', pan: -0.5, reverb: 0.7 }] }));
    expect(s.tracks[0]).toMatchObject({ pan: -0.5, reverb: 0.7 });
    expect(song.tracks[0].pan).toBeUndefined();
    expect(updateSongSettings(song, { tracks: [{ id: 't1', pan: 2 }] }).ok).toBe(false);
    expect(updateSongSettings(song, { tracks: [{ id: 't1', reverb: -1 }] }).ok).toBe(false);
  });
  it('検査も範囲を見る', () => {
    const song = loadMinimalSong();
    song.tracks[0].pan = 5;
    expect(validateSong(song).ok).toBe(false);
  });
});

describe('Q4 揺らぎと強弱の記法', () => {
  const song = unwrap(createDraftSong({ mood: 'setsunai', tempo: 92, seed: 5 }));
  it('揺らぎを0にすると楽譜どおり、1で標準、中間はその間', () => {
    const off = performSong(unwrap(updateSongSettings(song, { humanize: 0 })));
    const base = performSong(song);
    const mid = performSong(unwrap(updateSongSettings(song, { humanize: 0.5 })));
    const grid = 60 / song.tempo / 4;
    const dev = (/** @type {typeof off} */ p) => p.notes.reduce((s, n) => s + Math.abs(n.time - Math.round(n.time / grid) * grid), 0) / p.notes.length;
    expect(dev(off)).toBeLessThan(1e-9);
    expect(dev(mid)).toBeGreaterThan(dev(off));
    expect(dev(base)).toBeGreaterThan(dev(mid));
    // 0 のときの強さは楽譜の値そのもの
    const tl = off.timeline.events.map((e) => e.velocity).sort((a, b) => a - b);
    expect(off.notes.map((n) => n.velocity).sort((a, b) => a - b)).toEqual(tl);
    expect(updateSongSettings(song, { humanize: 2 }).ok).toBe(false);
  });
  it('音ごとの強さを @数字 で書ける', () => {
    const n = parseMelody('A4:1@40 B4:1 C5:1! D5:1@127');
    expect(n.map((x) => x.velocity)).toEqual([40, 94, 112, 127]);
    expect(() => parseMelody('A4:1@0')).toThrow(/1〜127/);
    expect(() => parseMelody('A4:1@200')).toThrow(/1〜127/);
    const text = formatMelody(n, { velocities: true });
    expect(text).toContain('A4:1@40');
    expect(parseMelody(text).map((x) => x.velocity)).toEqual([40, 94, 112, 127]);
    expect(formatMelody(n)).not.toContain('@');
  });
});

describe('Q5 楽器の追加', () => {
  const added = ['brass', 'organ', 'synth-bass', 'choir', 'taiko', 'shamisen', 'shinobue'];
  it('7種が選べて、MIDIの音色にも対応している', () => {
    const ids = INSTRUMENTS.map((i) => i.id);
    for (const id of added) expect(ids).toContain(id);
    const song = loadMinimalSong();
    for (const id of added) {
      const s = unwrap(updateSongSettings(song, { tracks: [{ id: 't1', instrument: /** @type {any} */ (id) }] }));
      expect(s.tracks[0].instrument).toBe(id);
      expect(songToMidi(s).bytes.length).toBeGreaterThan(50);
    }
    expect(updateSongSettings(song, { tracks: [{ id: 't1', instrument: /** @type {any} */ ('kazoo') }] }).ok).toBe(false);
  });
});
