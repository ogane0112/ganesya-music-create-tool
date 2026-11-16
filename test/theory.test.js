import { describe, expect, it } from 'vitest';
import {
  chordPitchClasses, chordPitches, diatonicChord, isChordInKey, isInKey, parseChord, pitchName,
  pitchNameDoremi, scalePitchClasses, secondsToTicks, snapToKey, ticksPerBar, ticksToSeconds, transposeChord,
} from '../src/core/theory.js';

describe('キーに合う音', () => {
  it('Aマイナーの音', () => {
    expect(scalePitchClasses({ tonic: 'A', mode: 'minor' })).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });
  it('Eb メジャーはフラットの名前でも読める', () => {
    expect(scalePitchClasses({ tonic: 'Eb', mode: 'major' })).toEqual([3, 5, 7, 8, 10, 0, 2]);
  });
  it('判定', () => {
    const key = /** @type {const} */ ({ tonic: 'C', mode: 'major' });
    expect(isInKey(60, key)).toBe(true);
    expect(isInKey(61, key)).toBe(false);
    expect(isInKey(71, key)).toBe(true);
  });
  it('一番近いキーに合う音に寄せる', () => {
    expect(snapToKey(61, { tonic: 'C', mode: 'major' })).toBe(60);
    expect(snapToKey(66, { tonic: 'C', mode: 'major' })).toBe(65);
  });
  it('音の名前', () => {
    expect(pitchName(69)).toBe('A4');
    expect(pitchName(60)).toBe('C4');
    expect(pitchName(70, true)).toBe('Bb4');
    expect(pitchNameDoremi(69)).toBe('ラ4');
  });
});

describe('コード', () => {
  it('コード名を読む', () => {
    expect(parseChord('Am7')).toMatchObject({ root: 9, quality: 'm7' });
    expect(parseChord('F#m7b5')).toMatchObject({ root: 6, quality: 'm7b5' });
    expect(parseChord('CM7')).toMatchObject({ quality: 'maj7' });
    expect(parseChord('G/B')).toMatchObject({ root: 7, bass: 11 });
    expect(parseChord('H')).toBeNull();
    expect(parseChord('Cxyz')).toBeNull();
  });
  it('構成音', () => {
    expect(chordPitchClasses('C')).toEqual([0, 4, 7]);
    expect(chordPitchClasses('Am')).toEqual([9, 0, 4]);
    expect(chordPitchClasses('G7')).toEqual([7, 11, 2, 5]);
    expect(chordPitchClasses('C/E')).toEqual([0, 4, 7]);
    expect(chordPitchClasses('Am/G')).toEqual([7, 9, 0, 4]);
  });
  it('実際の高さ', () => {
    expect(chordPitches('C', 4)).toEqual([60, 64, 67]);
    expect(chordPitches('G/B', 3)).toEqual([47, 55, 59, 62]);
  });
  it('キーに合うコードか', () => {
    const key = /** @type {const} */ ({ tonic: 'C', mode: 'major' });
    expect(isChordInKey('Am7', key)).toBe(true);
    expect(isChordInKey('E7', key)).toBe(false);
  });
  it('移調', () => {
    expect(transposeChord('Am7', 2)).toBe('Bm7');
    expect(transposeChord('G/B', -2, true)).toBe('F/A');
    expect(transposeChord('C', 1, true)).toBe('Db');
  });
  it('度数からコード', () => {
    const c = /** @type {const} */ ({ tonic: 'C', mode: 'major' });
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => diatonicChord(c, d))).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect(diatonicChord(c, 4, { seventh: true })).toBe('Fmaj7');
    expect(diatonicChord(c, 5, { seventh: true })).toBe('G7');
    expect(diatonicChord({ tonic: 'F', mode: 'major' }, 4)).toBe('Bb');
  });
});

describe('時間', () => {
  it('1小節', () => {
    expect(ticksPerBar([4, 4])).toBe(1920);
    expect(ticksPerBar([6, 8])).toBe(1440);
  });
  it('ティックと秒', () => {
    expect(ticksToSeconds(480, 120)).toBe(0.5);
    expect(ticksToSeconds(1920, 96)).toBe(2.5);
    expect(secondsToTicks(0.5, 120)).toBe(480);
    expect(secondsToTicks(ticksToSeconds(12345, 87), 87)).toBeCloseTo(12345, 9);
  });
});
