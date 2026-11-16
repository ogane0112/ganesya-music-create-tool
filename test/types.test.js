// B1: 曲データ設計の例が型チェックを通ること(tsc がこのファイルを検査する)
import { describe, expect, it } from 'vitest';
import { loadMinimalSong } from './helpers.js';

/** @type {import('../src/core/types.js').Song} */
const typed = {
  formatVersion: 1,
  revision: 12,
  meta: { title: '無題の曲', artist: '', createdAt: '2026-11-16T02:00:00Z', updatedAt: '2026-11-16T02:30:00Z' },
  tempo: 96,
  key: { tonic: 'A', mode: 'minor' },
  timeSignature: [4, 4],
  mood: 'setsunai',
  tracks: [
    { id: 't1', role: 'vocal', instrument: 'piano', volume: 0.8 },
    { id: 't2', role: 'chords', instrument: 'acoustic-guitar', volume: 0.6 },
  ],
  sections: [
    {
      id: 's1', name: 'Aメロ', kind: 'verse', bars: 8,
      chords: [{ start: 0, length: 1920, symbol: 'Am' }],
      parts: { t1: [{ id: 'n1', start: 0, length: 480, pitch: 69, velocity: 90 }] },
    },
  ],
  arrangement: [{ id: 'a1', sectionId: 's1', lyrics: [{ noteId: 'n1', kana: 'よ' }] }],
  extensions: {},
};

describe('曲データの型', () => {
  it('設計書の例と同じ形を型付きで書ける', () => {
    expect(typed).toEqual(loadMinimalSong());
  });
});
