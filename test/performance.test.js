import { describe, expect, it } from 'vitest';
import { createDraftSong } from '../src/core/operations.js';
import { performSong } from '../src/core/performance.js';
import { buildTimeline } from '../src/core/timeline.js';
import { ticksToSeconds } from '../src/core/theory.js';
import { unwrap } from './helpers.js';

describe('演奏の表情', () => {
  const song = unwrap(createDraftSong({ mood: 'setsunai', tempo: 92, seed: 5 }));
  const a = performSong(song);

  it('同じ曲なら毎回同じ演奏になる(再生とWAVが一致する)', () => {
    expect(performSong(song).notes).toEqual(a.notes);
  });
  it('音符の数は変わらず、鳴らす順に並ぶ', () => {
    expect(a.notes).toHaveLength(buildTimeline(song).events.length);
    for (let i = 1; i < a.notes.length; i++) expect(a.notes[i].time).toBeGreaterThanOrEqual(a.notes[i - 1].time);
  });
  it('ずれは聞いて分からない程度(楽譜の位置から最大70ミリ秒)で、機械的にそろってはいない', () => {
    const grid = 60 / song.tempo / 4; // 16分音符
    let moved = 0;
    for (const n of a.notes) {
      const off = Math.abs(n.time - Math.round(n.time / grid) * grid);
      expect(off).toBeLessThan(0.07);
      if (off > 0.0005) moved++;
      expect(n.velocity).toBeGreaterThanOrEqual(1);
      expect(n.velocity).toBeLessThanOrEqual(127);
    }
    expect(moved / a.notes.length).toBeGreaterThan(0.5);
  });
  it('サビはAメロより強く弾く(楽譜の強さに対する倍率で比べる)', () => {
    const tl = buildTimeline(song);
    const original = new Map(tl.events.map((e) => [`${e.trackId}:${e.itemId}:${e.pitch}:${e.tick}`, e.velocity]));
    /** @param {string} kind */
    const ratio = (kind) => {
      const item = tl.items.find((i) => song.sections.find((s) => s.id === i.sectionId)?.kind === kind);
      if (!item) throw new Error('部品がない');
      const events = tl.events.filter((e) => e.itemId === item.itemId && e.trackId === 't3');
      const performed = a.notes.filter((n) => n.itemId === item.itemId && n.trackId === 't3');
      const sum = (/** @type {number[]} */ v) => v.reduce((x, y) => x + y, 0);
      expect(original.size).toBeGreaterThan(0);
      return sum(performed.map((n) => n.velocity)) / sum(events.map((e) => e.velocity));
    };
    expect(ratio('chorus')).toBeGreaterThan(ratio('verse') + 0.1);
  });
  it('ギターの和音は弦を順に弾く(同時ではなく少しずつずれる)', () => {
    // 和音をじゃかじゃか弾く曲を探す
    for (let seed = 1; seed < 40; seed++) {
      const s = unwrap(createDraftSong({ mood: 'setsunai', tempo: 92, seed }));
      const tl = buildTimeline(s);
      const chord = tl.events.filter((e) => e.trackId === 't2' && e.tick === tl.events.find((x) => x.trackId === 't2')?.tick);
      if (chord.length < 3) continue;
      const times = performSong(s).notes.filter((n) => n.trackId === 't2').slice(0, chord.length).map((n) => n.time);
      expect(new Set(times.map((t) => t.toFixed(4))).size).toBe(chord.length);
      expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(0.01);
      expect(Math.max(...times) - Math.min(...times)).toBeLessThan(0.06);
      return;
    }
    throw new Error('和音を弾く曲が見つからない');
  });
});
