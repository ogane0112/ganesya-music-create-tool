import { describe, expect, it } from 'vitest';
import {
  addArrangementItem, addSection, createEmptySong, moveArrangementItem, registerSong, removeArrangementItem,
  renameSection, replaceSection, resplitSections, updateSongSettings,
} from '../src/core/operations.js';
import { History } from '../src/core/history.js';
import { validateSong } from '../src/core/validate.js';
import { loadMinimalSong, unwrap } from './helpers.js';

/** 2部品(Aメロ・サビ)の曲 */
function twoSectionSong() {
  const song = loadMinimalSong();
  song.sections.push({
    id: 's2', name: 'サビ', kind: 'chorus', bars: 4,
    chords: [{ start: 0, length: 1920, symbol: 'F' }],
    parts: { t1: [{ id: 'n2', start: 0, length: 960, pitch: 72, velocity: 100 }] },
  });
  song.arrangement.push({ id: 'a2', sectionId: 's2', lyrics: [] });
  return song;
}

/**
 * 元のデータが変わっていないことを確かめる
 * @param {(song: import('../src/core/types.js').Song) => import('../src/core/types.js').Result<import('../src/core/types.js').Song>} fn
 */
function expectUnchanged(fn) {
  const song = twoSectionSong();
  const before = structuredClone(song);
  const r = fn(song);
  expect(song).toEqual(before);
  return r;
}

describe('曲を作る', () => {
  it('空の曲は検査を通る', () => {
    expect(validateSong(createEmptySong()).ok).toBe(true);
  });
  it('取り込んだ曲データを登録すると revision が0になる', () => {
    const s = unwrap(registerSong(loadMinimalSong()));
    expect(s.revision).toBe(0);
  });
  it('足りない細かい項目は補う', () => {
    const data = /** @type {any} */ (loadMinimalSong());
    delete data.extensions;
    delete data.arrangement[0].lyrics;
    expect(registerSong(data).ok).toBe(true);
  });
  it('キーから外れた音は、取り込みでなければ拒否', () => {
    const data = loadMinimalSong();
    data.sections[0].parts.t1[0].pitch = 70;
    expect(registerSong(data).ok).toBe(false);
    expect(registerSong(data, { allowOutOfKey: true }).ok).toBe(true);
  });
});

describe('部品を差し替える', () => {
  it('コード進行とパートを置き換え、元のデータは変わらない', () => {
    const r = expectUnchanged((song) =>
      replaceSection(song, 's1', {
        chords: [{ start: 0, length: 1920, symbol: 'Dm' }],
        parts: { t1: [{ start: 0, length: 480, pitch: 74, velocity: 80 }, { start: 480, length: 480, pitch: 76, velocity: 80 }] },
      }),
    );
    const s = unwrap(r);
    expect(s.sections[0].chords[0].symbol).toBe('Dm');
    expect(s.sections[0].parts.t1.map((n) => n.pitch)).toEqual([74, 76]);
    // IDは曲の中で重ならない
    const ids = s.sections.flatMap((x) => Object.values(x.parts).flat().map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('置き換えで消えた音符の歌詞は外れる', () => {
    const s = unwrap(replaceSection(twoSectionSong(), 's1', { parts: { t1: [] } }));
    expect(s.arrangement[0].lyrics).toEqual([]);
  });
  it('キーから外れた音は拒否し、どの音かを返す', () => {
    const r = replaceSection(twoSectionSong(), 's1', { parts: { t1: [{ start: 0, length: 480, pitch: 61, velocity: 80 }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch('ド#4');
  });
  it('ない部品は not_found', () => {
    const r = replaceSection(twoSectionSong(), 'zz', {});
    expect(!r.ok && r.error.code).toBe('not_found');
  });
});

describe('並び順を変える', () => {
  it('既存の部品をもう一度並べる', () => {
    const s = unwrap(expectUnchanged((song) => addArrangementItem(song, 's2')));
    expect(s.arrangement.map((a) => a.sectionId)).toEqual(['s1', 's2', 's2']);
    expect(new Set(s.arrangement.map((a) => a.id)).size).toBe(3);
  });
  it('新しい部品を足す', () => {
    const s = unwrap(
      expectUnchanged((song) =>
        addSection(song, { name: 'Bメロ', kind: 'prechorus', bars: 4, chords: [], parts: { t1: [{ id: 'x', start: 0, length: 480, pitch: 64, velocity: 90 }] } }, 1),
      ),
    );
    expect(s.arrangement.map((a) => s.sections.find((x) => x.id === a.sectionId)?.name)).toEqual(['Aメロ', 'Bメロ', 'サビ']);
  });
  it('外すと、使われなくなった部品の定義も消える', () => {
    const s = unwrap(expectUnchanged((song) => removeArrangementItem(song, 'a2')));
    expect(s.sections.map((x) => x.id)).toEqual(['s1']);
  });
  it('2回使っている部品は、1か所外しても定義は残る', () => {
    const s1 = unwrap(addArrangementItem(twoSectionSong(), 's2'));
    const s2 = unwrap(removeArrangementItem(s1, 'a2'));
    expect(s2.sections.map((x) => x.id)).toEqual(['s1', 's2']);
  });
  it('最後の1つは消せない', () => {
    expect(removeArrangementItem(loadMinimalSong(), 'a1').ok).toBe(false);
  });
  it('並べ替え', () => {
    const s = unwrap(expectUnchanged((song) => moveArrangementItem(song, 'a2', 0)));
    expect(s.arrangement.map((a) => a.id)).toEqual(['a2', 'a1']);
  });
});

describe('部品の区切りを直す', () => {
  it('名前と種類を変える', () => {
    const s = unwrap(expectUnchanged((song) => renameSection(song, 's2', { name: ' 大サビ ', kind: 'chorus' })));
    expect(s.sections[1].name).toBe('大サビ');
  });
  it('空の名前は拒否', () => {
    expect(renameSection(twoSectionSong(), 's1', { name: ' ' }).ok).toBe(false);
  });
  it('区切りを切り直すと、音符は同じ時刻に残る', () => {
    // 合計12小節(8+4)を 0,6 で切る
    const s = unwrap(expectUnchanged((song) => resplitSections(song, [{ startBar: 0, name: 'A' }, { startBar: 6, name: 'B', kind: 'chorus' }])));
    expect(s.sections.map((x) => x.bars)).toEqual([6, 6]);
    expect(s.sections[1].parts.t1[0]).toMatchObject({ start: 2 * 1920, pitch: 72 });
    expect(s.sections[1].chords[0]).toMatchObject({ start: 2 * 1920, symbol: 'F' });
    expect(s.arrangement).toHaveLength(2);
  });
  it('曲の外の区切りは拒否', () => {
    expect(resplitSections(twoSectionSong(), [{ startBar: 0, name: 'A' }, { startBar: 12, name: 'B' }]).ok).toBe(false);
    expect(resplitSections(twoSectionSong(), [{ startBar: 2, name: 'A' }]).ok).toBe(false);
  });
});

describe('曲の設定を変える', () => {
  it('曲名、テンポ、楽器、音量、消音', () => {
    const s = unwrap(
      expectUnchanged((song) =>
        updateSongSettings(song, { title: '夜', tempo: 140, tracks: [{ id: 't2', instrument: 'piano', volume: 0.3, muted: true }] }),
      ),
    );
    expect(s.meta.title).toBe('夜');
    expect(s.tempo).toBe(140);
    expect(s.tracks[1]).toMatchObject({ instrument: 'piano', volume: 0.3, muted: true });
  });
  it('範囲外は拒否', () => {
    expect(updateSongSettings(twoSectionSong(), { tempo: 999 }).ok).toBe(false);
    expect(updateSongSettings(twoSectionSong(), { tracks: [{ id: 't1', volume: 2 }] }).ok).toBe(false);
    expect(updateSongSettings(twoSectionSong(), { tracks: [{ id: 't1', instrument: /** @type {any} */ ('kazoo') }] }).ok).toBe(false);
  });
  it('キーを変えると音符とコードも移り、キーに合ったまま', () => {
    const s = unwrap(updateSongSettings(twoSectionSong(), { key: { tonic: 'B', mode: 'minor' } }));
    expect(s.sections[0].parts.t1[0].pitch).toBe(71);
    expect(s.sections[0].chords[0].symbol).toBe('Bm');
    expect(validateSong(s).ok).toBe(true);
  });
  it('平行調(Aマイナー→Cメジャー)は音を動かさない', () => {
    const s = unwrap(updateSongSettings(twoSectionSong(), { key: { tonic: 'C', mode: 'major' } }));
    expect(s.sections[0].parts.t1[0].pitch).toBe(69);
  });
});

describe('元に戻す', () => {
  it('何手でも戻せる', () => {
    const h = new History(twoSectionSong());
    const start = h.current;
    for (let t = 100; t < 110; t++) h.push(unwrap(updateSongSettings(h.current, { tempo: t })), `テンポ${t}`);
    expect(h.current.tempo).toBe(109);
    expect(h.undoLabel).toBe('テンポ109');
    for (let i = 0; i < 10; i++) expect(h.undo()).not.toBeNull();
    expect(h.current).toBe(start);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });
  it('最新を読み込んだら履歴は消える', () => {
    const h = new History(twoSectionSong());
    h.push(unwrap(updateSongSettings(h.current, { tempo: 120 })));
    h.reset(loadMinimalSong());
    expect(h.canUndo).toBe(false);
  });
});

describe('知らない項目', () => {
  it('操作を通しても残る', () => {
    const song = /** @type {any} */ (twoSectionSong());
    song.future = 1;
    song.sections[0].color = 'blue';
    const s = /** @type {any} */ (unwrap(updateSongSettings(song, { tempo: 120 })));
    expect(s.future).toBe(1);
    expect(s.sections[0].color).toBe('blue');
  });
});
