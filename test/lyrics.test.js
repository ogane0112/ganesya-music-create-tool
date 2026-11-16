import { describe, expect, it } from 'vitest';
import { createAuthoredSong } from '../src/core/authoring.js';
import { assignLyrics, lyricLines, melodyPhrases, splitMorae, sungNotes, vowelOf } from '../src/core/lyrics.js';
import { unwrap } from './helpers.js';

const song = unwrap(createAuthoredSong({
  title: 'うた', mood: 'setsunai', tempo: 96, key: { tonic: 'A', mode: 'minor' },
  // 2フレーズ:5音 + 休み + 7音
  sections: [{ name: 'Aメロ', kind: 'verse', bars: 4, chords: 'Am:8 F:8', melody: 'A4:1 C5:1 E5:1 D5:0.5 C5:1.5 r:3 | A4:0.5 A4:0.5 C5:1 E5:1 D5:1 C5:1 A4:2 r:1' }],
}));
const sec = song.sections[0];

describe('歌詞', () => {
  it('かなを1音ずつに分ける(小さい字は前とまとめ、ん・っ・ー は1音)', () => {
    expect(splitMorae('きょうは、いい てんき').morae).toEqual(['きょ', 'う', 'は', 'い', 'い', 'て', 'ん', 'き']);
    expect(splitMorae('ずっとスキー').morae).toEqual(['ず', 'っ', 'と', 'す', 'き', 'ー']);
    expect(splitMorae('夜の hello').invalid).toEqual(['夜', 'h', 'e', 'l', 'o']);
    expect(splitMorae('ファイト').morae).toEqual(['ふぁ', 'い', 'と']);
  });
  it('メロディを息継ぎで区切る', () => {
    expect(melodyPhrases(song, sec.id).map((p) => p.length)).toEqual([5, 7]);
  });
  it('行ごとにフレーズへ割り当て、音数が合っているかを返す', () => {
    const ok = assignLyrics(song, sec.id, 'よるのまち\nひとりであるく');
    expect(ok.fits).toBe(true);
    expect(ok.lyrics).toHaveLength(12);
    expect(ok.lines).toEqual([{ notes: 5, morae: 5, kana: 'よるのまち' }, { notes: 7, morae: 7, kana: 'ひとりであるく' }]);
  });
  it('字余り・字足らずを行ごとに知らせる', () => {
    const r = assignLyrics(song, sec.id, 'よるの / ひとりであるいたみち');
    expect(r.fits).toBe(false);
    expect(r.lines.map((l) => l.morae - l.notes)).toEqual([-2, 3]);
    // 入る分だけ乗る
    expect(r.lyrics).toHaveLength(3 + 7);
  });
  it('行数がフレーズと合わない時は、頭から順に乗せる', () => {
    const r = assignLyrics(song, sec.id, 'よるのまちひとりであるいて');
    expect(r.lines.map((l) => l.kana)).toEqual(['よるのまち', 'ひとりであるい']);
    expect(r.fits).toBe(false); // 「て」が余る
  });
  it('歌わせる時、歌詞のない音は前の母音を伸ばす', () => {
    const r = assignLyrics(song, sec.id, 'そら\nきょー');
    const withLyrics = { ...song, arrangement: [{ ...song.arrangement[0], lyrics: r.lyrics }] };
    expect(sungNotes(withLyrics, song.arrangement[0].id).map((x) => x.kana).join(' ')).toBe('そ ら あ あ あ きょ お お お お お お');
    expect(lyricLines(withLyrics, song.arrangement[0].id)[0]).toEqual({ notes: 5, morae: 2, kana: 'そら' });
    expect(sungNotes(song, song.arrangement[0].id)[0].kana).toBe('ら');
    expect(vowelOf('しゅ')).toBe('う');
    expect(vowelOf('ん')).toBe('ん');
  });
});
