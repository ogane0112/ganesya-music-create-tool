import { describe, expect, it } from 'vitest';
import { checkShape, findOutOfKeyNotes, validateSong } from '../src/core/validate.js';
import { loadMinimalSong } from './helpers.js';

describe('曲データの検査', () => {
  it('設計書の例は通る', () => {
    const r = validateSong(loadMinimalSong());
    expect(r.ok).toBe(true);
  });

  it('知らない項目は消さずに残す', () => {
    const song = /** @type {any} */ (loadMinimalSong());
    song.futureField = { x: 1 };
    song.sections[0].color = 'red';
    song.extensions.voicevox = { speaker: 3 };
    const r = validateSong(song);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(/** @type {any} */ (r.value).futureField).toEqual({ x: 1 });
      expect(/** @type {any} */ (r.value.sections[0]).color).toBe('red');
    }
  });

  it('壊れた曲は理由付きで拒否される', () => {
    const song = /** @type {any} */ (loadMinimalSong());
    song.tempo = 'fast';
    song.tracks[0].instrument = 'kazoo';
    song.sections[0].parts.t1[0].pitch = 200;
    song.arrangement[0].sectionId = 'nope';
    const r = validateSong(song);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('invalid_song');
      expect(r.error.hint).toBeTruthy();
      const paths = /** @type {any} */ (r.error.details).problems.map((/** @type {any} */ p) => p.path);
      expect(paths).toEqual(expect.arrayContaining(['tempo', 'tracks[0].instrument', 'sections[0].parts.t1[0].pitch', 'arrangement[0].sectionId']));
    }
  });

  it('オブジェクトでなければ拒否', () => {
    expect(checkShape(null)).toHaveLength(1);
    expect(validateSong('x').ok).toBe(false);
  });

  it('部品からはみ出した音符、重複ID、知らないパート、存在しない音符への歌詞', () => {
    const song = /** @type {any} */ (loadMinimalSong());
    song.sections[0].parts.t1.push({ id: 'n1', start: 8 * 1920 - 100, length: 480, pitch: 69, velocity: 90 });
    song.sections[0].parts.t9 = [];
    song.arrangement[0].lyrics.push({ noteId: 'n99', kana: 'る' });
    const problems = checkShape(song);
    const msgs = problems.map((p) => p.message).join('\n');
    expect(msgs).toMatch('重複');
    expect(msgs).toMatch('はみ出し');
    expect(msgs).toMatch('知らないパート');
    expect(msgs).toMatch('存在しない音符');
  });

  it('読めないコード名を拒否', () => {
    const song = loadMinimalSong();
    song.sections[0].chords[0].symbol = 'Zm';
    expect(validateSong(song).ok).toBe(false);
  });

  it('キーから外れた音を検出し、どの音かを返す', () => {
    const song = loadMinimalSong();
    song.sections[0].parts.t1.push({ id: 'n2', start: 480, length: 480, pitch: 70, velocity: 90 });
    const out = findOutOfKeyNotes(song);
    expect(out).toEqual([{ sectionId: 's1', trackId: 't1', noteId: 'n2', pitch: 70, name: 'ラ#4' }]);
    const r = validateSong(song);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch('ラ#4');
  });

  it('取り込み時はキーから外れた音を注意書きにとどめる', () => {
    const song = loadMinimalSong();
    song.sections[0].parts.t1.push({ id: 'n2', start: 480, length: 480, pitch: 70, velocity: 90 });
    const r = validateSong(song, { allowOutOfKey: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings[0]).toMatch('キーに合わない');
  });

  it('ドラムのパートはキーを調べない', () => {
    const song = loadMinimalSong();
    song.tracks.push({ id: 't3', role: 'drums', instrument: 'drums', volume: 0.7 });
    song.sections[0].parts.t3 = [{ id: 'd1', start: 0, length: 120, pitch: 42, velocity: 80 }];
    expect(validateSong(song).ok).toBe(true);
  });
});
