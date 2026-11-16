import { describe, expect, it } from 'vitest';
import { formatChords, formatMelody, NotationError, parseChords, parseMelody, parsePitchName } from '../src/core/notation.js';

describe('かんたん記法', () => {
  it('音の名前', () => {
    expect(parsePitchName('C4')).toBe(60);
    expect(parsePitchName('A4')).toBe(69);
    expect(parsePitchName('F#4')).toBe(66);
    expect(parsePitchName('Bb3')).toBe(58);
    expect(parsePitchName('H4')).toBeNull();
  });
  it('メロディを読む(休み、小節線、強調、3連符)', () => {
    const notes = parseMelody('E5:1 D5:0.5 r:0.5 | C5:2! , A4:1/3 A4:1/3 A4:1/3');
    expect(notes.map((n) => [n.start, n.pitch])).toEqual([[0, 76], [480, 74], [960, 72], [1920, 69], [2080, 69], [2240, 69]]);
    expect(notes[2].velocity).toBeGreaterThan(notes[0].velocity);
    expect(notes[0].start + notes[0].length).toBeLessThanOrEqual(480);
  });
  it('読めない書き方は理由付きで断る', () => {
    expect(() => parseMelody('E5')).toThrow(NotationError);
    expect(() => parseMelody('X5:1')).toThrow(/音の名前/);
    expect(() => parseMelody('C5:abc')).toThrow(/長さ/);
    expect(() => parseChords('Zm:4')).toThrow(/コード名/);
  });
  it('コードを読む', () => {
    expect(parseChords('Am7:4 F:2 G/B:2')).toEqual([
      { start: 0, length: 1920, symbol: 'Am7' }, { start: 1920, length: 960, symbol: 'F' }, { start: 2880, length: 960, symbol: 'G/B' },
    ]);
    expect(parseChords('N.C.:4 C:4')).toEqual([{ start: 1920, length: 1920, symbol: 'C' }]);
  });
  it('書き出して読み戻すと、同じ位置と高さになる', () => {
    const text = 'r:0.5 E5:0.5 D5:1 C5:2 | A4:1/3 A4:1/3 A4:1/3 G4:0.25 G4:0.75 r:2 | E4:4';
    const notes = parseMelody(text);
    const again = parseMelody(formatMelody(notes, { totalTicks: 3 * 1920 }));
    expect(again.map((n) => [n.start, n.pitch])).toEqual(notes.map((n) => [n.start, n.pitch]));
    const chords = parseChords('Am7:4 F:2 G:2');
    expect(parseChords(formatChords(chords))).toEqual(chords);
  });
});
