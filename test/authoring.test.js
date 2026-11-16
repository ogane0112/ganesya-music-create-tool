import { describe, expect, it } from 'vitest';
import { authorSection, createAuthoredSong } from '../src/core/authoring.js';
import { formatChords, formatMelody } from '../src/core/notation.js';
import { replaceSection } from '../src/core/operations.js';
import { unwrap } from './helpers.js';

const base = /** @type {const} */ ({ title: 'テスト', mood: 'setsunai', tempo: 96, key: { tonic: 'A', mode: 'minor' } });

describe('書いたコード進行とメロディから曲を作る', () => {
  it('伴奏はルールが付け、書いたものはそのまま残る。借りてきたコード(E7)も使える', () => {
    const chords = 'Fmaj7:4 E7:4 Am7:4 Gm7:2 C7:2';
    const melody = 'r:0.5 A4:0.5 C5:0.5 E5:0.5 E5:1 D5:1 | G#4:1 B4:1 D5:1.5 C5:0.5 | C5:2 r:2 | Bb4:1 A4:1 G4:1 E4:1';
    const song = unwrap(createAuthoredSong({ ...base, sections: [{ name: 'サビ', kind: 'chorus', bars: 4, chords, melody }] }));
    const sec = song.sections[0];
    expect(formatChords(sec.chords)).toBe(chords);
    expect(formatMelody(sec.parts.t1, { flat: true })).toContain('Ab4:1 B4:1');
    expect(sec.parts.t1).toHaveLength(14);
    expect(sec.parts.t3.length).toBeGreaterThan(0); // ベース
    expect(sec.parts.t4.length).toBeGreaterThan(0); // ドラム
    expect(song.tempo).toBe(96);
  });
  it('キーにもコードにも合わない音は、どの音かを添えて断る', () => {
    const r = createAuthoredSong({ ...base, sections: [{ name: 'A', kind: 'verse', bars: 1, chords: 'Am:4', melody: 'C#5:1 A4:3' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch('ド#5');
  });
  it('長すぎる・読めない・知らない弾き方は理由付きで断る', () => {
    /** @param {any} s */
    const err = (s) => { const r = createAuthoredSong({ ...base, sections: [s] }); return r.ok ? '' : r.error.message; };
    expect(err({ name: 'A', kind: 'verse', bars: 1, chords: 'Am:8' })).toMatch('長すぎ');
    expect(err({ name: 'A', kind: 'verse', bars: 1, chords: 'Am:4', melody: 'A4:5' })).toMatch('長すぎ');
    expect(err({ name: 'A', kind: 'verse', bars: 1, chords: 'Xq:4' })).toMatch('コード名');
    expect(err({ name: 'A', kind: 'verse', bars: 1, chords: 'Am:4', styles: { drumStyle: 'samba' } })).toMatch('drumStyle');
    expect(err({ name: 'A', kind: 'solo', bars: 1 })).toMatch('kind');
  });
  it('コード進行だけ書けば、メロディもルールが作る', () => {
    const song = unwrap(createAuthoredSong({ ...base, sections: [{ name: 'A', kind: 'verse', bars: 4, chords: 'Am:4 F:4 C:4 G:4' }] }));
    expect(song.sections[0].parts.t1.length).toBeGreaterThan(4);
  });
  it('部品の作り直し:メロディだけ書き換えて差し替えられる', () => {
    const song = unwrap(createAuthoredSong({ ...base, sections: [{ name: 'A', kind: 'verse', bars: 2, chords: 'Am:4 F:4', melody: 'A4:4 | A4:4' }] }));
    const sec = song.sections[0];
    const content = authorSection(song, { kind: sec.kind, bars: sec.bars, chords: sec.chords, melody: 'E5:2 D5:2 | C5:4' }, { only: ['melody', 'color'] });
    const next = unwrap(replaceSection(song, sec.id, { parts: content.parts }));
    expect(next.sections[0].parts.t1.map((n) => n.pitch)).toEqual([76, 74, 72]);
    expect(next.sections[0].parts.t3).toEqual(song.sections[0].parts.t3);
  });
});
