import { describe, expect, it } from 'vitest';
import { createAuthoredSong } from '../src/core/authoring.js';
import { setLyrics } from '../src/core/operations.js';
import { buildScore } from '../src/connectors/voicevox.js';
import { unwrap } from './helpers.js';

const base = unwrap(createAuthoredSong({
  title: 'うた', mood: 'setsunai', tempo: 96, key: { tonic: 'A', mode: 'minor' },
  sections: [{ name: 'Aメロ', kind: 'verse', bars: 4, chords: 'Am:8 F:8', melody: 'A4:1 C5:1 E5:1 D5:0.5 C5:1.5 r:3 | A4:0.5 A4:0.5 C5:1 E5:1 D5:1 C5:1 A4:2 r:1' }],
}));
const itemId = base.arrangement[0].id;

describe('歌詞を入れる(操作)', () => {
  it('音数が合えば注意書きなし。元の曲は変わらない', () => {
    const r = setLyrics(base, itemId, 'よるのまち\nひとりであるく');
    expect(r.ok && r.warnings).toEqual([]);
    expect(base.arrangement[0].lyrics).toEqual([]);
    expect(unwrap(r).arrangement[0].lyrics).toHaveLength(12);
  });
  it('ズレは注意書きで知らせる。strict なら断る', () => {
    const r = setLyrics(base, itemId, 'よるの\nひとりであるいたみち');
    expect(r.ok && r.warnings.join()).toMatch(/1行目.*2音足りない.*2行目.*3音多い/s);
    const strict = setLyrics(base, itemId, 'よるの\nひとりであるいたみち', { strict: true });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.error.hint).toContain('5・7');
  });
  it('空にすると歌詞が消える', () => {
    const withLyrics = unwrap(setLyrics(base, itemId, 'よるのまち\nひとりであるく'));
    expect(unwrap(setLyrics(withLyrics, itemId, '')).arrangement[0].lyrics).toEqual([]);
  });
});

describe('VOICEVOX の楽譜', () => {
  const song = unwrap(setLyrics(base, itemId, 'よるのまち\nひとりであるー'));
  const score = buildScore(song, itemId);
  if (!score) throw new Error('楽譜ができない');

  it('先頭は休み。長さの合計は 部品の長さ+頭の休み+余韻 に一致する(ずれがたまらない)', () => {
    expect(score.notes[0]).toMatchObject({ key: null, lyric: '' });
    const frames = score.notes.reduce((s, n) => s + n.frame_length, 0);
    // 4小節 = 16拍 = 10秒(テンポ96)
    expect(frames).toBe(Math.round((0.5 + 10) * 93.75) + Math.round(0.3 * 93.75));
    expect(score.leadSeconds).toBe(0.5);
  });
  it('歌う音は12個。「ー」は前の母音にして送る。休みはまとめる', () => {
    const sung = score.notes.filter((n) => n.key !== null);
    expect(sung.map((n) => n.lyric).join('')).toBe('よるのまちひとりであるう');
    expect(sung.map((n) => n.key).slice(0, 5)).toEqual([69, 72, 76, 74, 72]);
    for (let i = 1; i < score.notes.length; i++) expect(score.notes[i].key === null && score.notes[i - 1].key === null).toBe(false);
    for (const n of score.notes) expect(n.frame_length).toBeGreaterThan(0);
  });
  it('隣り合う音はつなげて歌う(楽譜上の短い隙間を埋める)', () => {
    // 1音目(1拍 = 0.625秒)は、次の音の頭まで伸びる
    expect(score.notes[1].frame_length).toBe(Math.round((0.5 + 0.625) * 93.75) - Math.round(0.5 * 93.75));
  });
  it('歌詞がなくても歌える(「ら」で歌う)', () => {
    const s = buildScore(base, itemId);
    expect(s?.notes.find((n) => n.key !== null)?.lyric).toBe('ら');
  });
});
