import { describe, expect, it } from 'vitest';
import { buildTimeline, songDurationSeconds } from '../src/core/timeline.js';
import { addArrangementItem } from '../src/core/operations.js';
import { loadMinimalSong, unwrap } from './helpers.js';

describe('時間軸', () => {
  it('並び順どおりにつなぐ。同じ部品を2回使うと2回鳴る', () => {
    const song = unwrap(addArrangementItem(loadMinimalSong(), 's1'));
    const tl = buildTimeline(song);
    expect(tl.totalTicks).toBe(2 * 8 * 1920);
    expect(tl.events.map((e) => e.tick)).toEqual([0, 8 * 1920]);
    expect(tl.items.map((i) => i.startTick)).toEqual([0, 8 * 1920]);
  });
  it('部品単位では頭から数える', () => {
    const song = unwrap(addArrangementItem(loadMinimalSong(), 's1'));
    const second = song.arrangement[1].id;
    const tl = buildTimeline(song, { itemIds: [second] });
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0]).toMatchObject({ tick: 0, itemId: second });
  });
  it('長さ(秒)', () => {
    // 8小節 × 4拍 × (60/96)秒 = 20秒
    expect(songDurationSeconds(loadMinimalSong())).toBe(20);
  });
});
