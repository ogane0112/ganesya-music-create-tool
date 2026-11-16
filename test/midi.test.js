import { describe, expect, it } from 'vitest';
import { songToMidi } from '../src/connectors/midi/encode.js';
import { createDraftSong } from '../src/core/operations.js';
import { buildTimeline } from '../src/core/timeline.js';
import { unwrap } from './helpers.js';

/** 書き出したMIDIを最低限読む(チャンクごとのイベント数を数える) @param {Uint8Array} b */
function readMidi(b) {
  const v = new DataView(b.buffer);
  const tracks = [];
  let o = 14;
  while (o < b.length) {
    const len = v.getUint32(o + 4);
    const end = o + 8 + len;
    let p = o + 8;
    let noteOn = 0;
    let tick = 0;
    const markers = [];
    while (p < end) {
      let delta = 0;
      for (;;) { const c = b[p++]; delta = (delta << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
      tick += delta;
      const st = b[p++];
      if (st === 0xff) {
        const type = b[p++];
        let l = 0;
        for (;;) { const c = b[p++]; l = (l << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
        if (type === 0x06) markers.push([tick, new TextDecoder().decode(b.slice(p, p + l))]);
        p += l;
      } else if ((st & 0xf0) === 0xc0) p += 1;
      else {
        if ((st & 0xf0) === 0x90) noteOn++;
        p += 2;
      }
    }
    tracks.push({ noteOn, markers, endTick: tick });
    o = end;
  }
  return { format: v.getUint16(8), ntracks: v.getUint16(10), division: v.getUint16(12), tracks };
}

describe('MIDI書き出し', () => {
  const song = unwrap(createDraftSong({ mood: 'wafu-edm', tempo: 160, seed: 4 }));
  const { bytes, warnings } = songToMidi(song);
  const midi = readMidi(bytes);

  it('ヘッダ(形式1、480ティック、パート数+1)', () => {
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('MThd');
    expect(midi.format).toBe(1);
    expect(midi.division).toBe(480);
    expect(midi.ntracks).toBe(song.tracks.length + 1);
    expect(midi.tracks).toHaveLength(song.tracks.length + 1);
  });
  it('音符の数が曲と一致する', () => {
    const tl = buildTimeline(song);
    song.tracks.forEach((t, i) => {
      expect(midi.tracks[i + 1].noteOn).toBe(tl.events.filter((e) => e.trackId === t.id).length);
    });
  });
  it('部品の区切りがマーカーで入る', () => {
    const tl = buildTimeline(song);
    expect(midi.tracks[0].markers.slice(0, -1)).toEqual(tl.items.map((i) => [i.startTick, i.name]));
  });
  it('情報が落ちることを注意書きで知らせる', () => {
    expect(warnings.join()).toMatch('コード進行');
  });
});
