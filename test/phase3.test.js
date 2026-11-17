import { describe, expect, it } from 'vitest';
import { createAuthoredSong } from '../src/core/authoring.js';
import { addVocalPart, createDraftSong, removeVocalPart, setLyrics } from '../src/core/operations.js';
import { formatMelody, parseMelody } from '../src/core/notation.js';
import { lyricLines, melodyPhrases, vocalTracks } from '../src/core/lyrics.js';
import { findOutOfKeyNotes, validateSong } from '../src/core/validate.js';
import { buildScore, singerOf, DEFAULT_SINGER, DEFAULT_SECOND_SINGER } from '../src/connectors/voicevox.js';
import { scalePitchesInRange } from '../src/core/theory.js';
import { unwrap } from './helpers.js';

const authored = (/** @type {string} */ melody, /** @type {string} */ chords = 'C:4 G:4 Am:4 F:4') =>
  unwrap(createAuthoredSong({ mood: 'akarui', tempo: 120, key: { tonic: 'C', mode: 'major' }, seed: 3, sections: [{ name: 'サビ', kind: 'chorus', bars: 4, chords, melody }] }));

describe('F6 キー外の音の印(~)', () => {
  it('~ を付けた音は free になり、検査で止められない', () => {
    const notes = parseMelody('C5:1 C#5:1~ D5:2');
    expect(notes[1]).toMatchObject({ pitch: 73, free: true });
    expect(notes[0].free).toBeUndefined();
    expect(formatMelody(notes)).toContain('C#5:1~');
    const ok = authored('C5:1 C#5:1~ D5:2 | E5:4 | D5:4 | C5:4');
    expect(findOutOfKeyNotes(ok)).toHaveLength(0);
    expect(validateSong(ok).ok).toBe(true);
  });
  it('印のないキー外の音は、これまでどおり見つかる', () => {
    const r = createAuthoredSong({ mood: 'akarui', tempo: 120, key: { tonic: 'C', mode: 'major' }, sections: [{ name: 'サビ', kind: 'chorus', bars: 1, chords: 'C:4', melody: 'C5:1 C#5:1 D5:2' }] });
    expect(r.ok).toBe(false);
  });
});

describe('F7 フレーズの区切り(/)', () => {
  it('/ で区切った所で行が分かれる(自動の区切りより優先)', () => {
    const notes = parseMelody('C5:0.5 D5:0.5 E5:0.5 F5:0.5 / G5:0.5 A5:0.5 G5:0.5 E5:0.5 | C5:4');
    expect(notes[4].phrase).toBe(true);
    expect(formatMelody(notes)).toMatch(/ \/ G5/);
    const s = authored('C5:0.5 D5:0.5 E5:0.5 F5:0.5 / G5:0.5 A5:0.5 G5:0.5 E5:0.5 | C5:2 / D5:2 | E5:4 | C5:4');
    const phrases = melodyPhrases(s, s.sections[0].id);
    expect(phrases.map((p) => p.length)).toEqual([4, 5, 3]);
  });
});

describe('F4 歌のパートを足す', () => {
  const song = authored('E5:1 D5:1 C5:2 | D5:1 E5:1 G5:2 | A5:1 G5:1 E5:2 | F5:2 E5:2');
  const item = song.arrangement[0].id;
  const withLyrics = unwrap(setLyrics(song, item, lyricLines(song, item).map((l) => 'ら'.repeat(l.notes)).join('\n')));

  it('3度上のハモリはキーの中の音で、主旋律と同じ長さ・同じ歌詞', () => {
    const r = unwrap(addVocalPart(withLyrics, { harmony: 'third-above' }));
    const [main, harm] = vocalTracks(r);
    expect(harm).toBeDefined();
    const sec = r.sections[0];
    const m = sec.parts[main.id];
    const hn = sec.parts[harm.id];
    expect(hn).toHaveLength(m.length);
    const scale = new Set(scalePitchesInRange(r.key, 24, 108));
    hn.forEach((n, i) => {
      expect(n.start).toBe(m[i].start);
      expect(n.pitch).toBeGreaterThan(m[i].pitch);
      expect(n.pitch - m[i].pitch).toBeLessThanOrEqual(5);
      expect(scale.has(n.pitch)).toBe(true);
    });
    expect(lyricLines(r, item, harm.id).map((l) => l.kana)).toEqual(lyricLines(r, item).map((l) => l.kana));
    expect(validateSong(r).ok).toBe(true);
  });

  it('パートごとに歌詞を入れても、ほかのパートの歌詞は消えない', () => {
    const r = unwrap(addVocalPart(withLyrics, { harmony: 'third-below' }));
    const harm = vocalTracks(r)[1];
    const lines = lyricLines(r, item, harm.id).map((l) => 'あ'.repeat(l.notes)).join('\n');
    const s = unwrap(setLyrics(r, item, lines, { trackId: harm.id }));
    expect(lyricLines(s, item, harm.id)[0].kana).toMatch(/^あ+$/);
    expect(lyricLines(s, item)[0].kana).toMatch(/^ら+$/);
  });

  it('空のパートは音符なしで足せ、外すと元どおり。主旋律は外せない', () => {
    const r = unwrap(addVocalPart(song, { name: '男声' }));
    const duet = vocalTracks(r)[1];
    expect(duet.name).toBe('男声');
    expect(r.sections[0].parts[duet.id]).toEqual([]);
    const back = unwrap(removeVocalPart(r, duet.id));
    expect(vocalTracks(back)).toHaveLength(1);
    expect(back.sections[0].parts[duet.id]).toBeUndefined();
    expect(removeVocalPart(r, vocalTracks(r)[0].id).ok).toBe(false);
  });

  it('歌い手はパートごと。2本目は初期で別の声', () => {
    const r = unwrap(addVocalPart(withLyrics, { harmony: 'third-above' }));
    const [main, harm] = vocalTracks(r);
    expect(singerOf(r, main.id)).toBe(DEFAULT_SINGER);
    expect(singerOf(r, harm.id)).toBe(DEFAULT_SECOND_SINGER);
    r.extensions.voicevox = { singer: 3005, singers: { [harm.id]: 3010 } };
    expect(singerOf(r)).toBe(3005);
    expect(singerOf(r, harm.id)).toBe(3010);
    const score = buildScore(r, item, harm.id);
    expect(score?.notes.some((n) => n.key !== null && n.key !== undefined && n.key > 0)).toBe(true);
  });

  it('4本までで止まり、知らないハモリは断る', () => {
    let s = song;
    for (let i = 0; i < 3; i++) s = unwrap(addVocalPart(s, { harmony: 'unison' }));
    expect(addVocalPart(s).ok).toBe(false);
    expect(addVocalPart(song, { harmony: /** @type {any} */ ('fifth') }).ok).toBe(false);
  });

  it('既存の曲(歌のパート1本)はそのまま', () => {
    const d = unwrap(createDraftSong({ mood: 'setsunai', tempo: 90, seed: 5 }));
    expect(vocalTracks(d)).toHaveLength(1);
    expect(validateSong(d).ok).toBe(true);
  });
});
