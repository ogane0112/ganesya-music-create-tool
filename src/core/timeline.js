// 並び順どおりに部品をつなぎ、曲の頭からの時刻で音符を並べる。再生・WAV・MIDIで共通に使う。
import { ticksPerBar, ticksToSeconds } from './theory.js';

/** @typedef {import('./types.js').Song} Song */

/**
 * @typedef {object} TimelineEvent
 * @property {number} tick 曲(または再生範囲)の頭からのティック
 * @property {number} length
 * @property {string} trackId
 * @property {number} pitch
 * @property {number} velocity
 * @property {string} itemId 並び順のどこの音か
 * @property {string} noteId
 */

/**
 * @typedef {object} TimelineItem
 * @property {string} itemId
 * @property {string} sectionId
 * @property {string} name
 * @property {number} startTick
 * @property {number} endTick
 */

/**
 * @typedef {object} Timeline
 * @property {TimelineEvent[]} events 開始時刻の順
 * @property {TimelineItem[]} items
 * @property {number} totalTicks
 */

/**
 * @param {Song} song
 * @param {{ itemIds?: string[] }} [opts] 一部の部品だけを並べる(部品単位の再生)
 * @returns {Timeline}
 */
export function buildTimeline(song, opts = {}) {
  const barTicks = ticksPerBar(song.timeSignature);
  /** @type {TimelineEvent[]} */
  const events = [];
  /** @type {TimelineItem[]} */
  const items = [];
  let offset = 0;
  for (const item of song.arrangement) {
    if (opts.itemIds && !opts.itemIds.includes(item.id)) continue;
    const section = song.sections.find((s) => s.id === item.sectionId);
    if (!section) continue;
    const length = section.bars * barTicks;
    items.push({ itemId: item.id, sectionId: section.id, name: section.name, startTick: offset, endTick: offset + length });
    for (const [trackId, notes] of Object.entries(section.parts)) {
      for (const n of notes) {
        events.push({ tick: offset + n.start, length: n.length, trackId, pitch: n.pitch, velocity: n.velocity, itemId: item.id, noteId: n.id });
      }
    }
    offset += length;
  }
  events.sort((a, b) => a.tick - b.tick || a.trackId.localeCompare(b.trackId) || a.pitch - b.pitch);
  return { events, items, totalTicks: offset };
}

/**
 * 曲の長さ(秒)
 * @param {Song} song
 * @param {{ itemIds?: string[] }} [opts]
 */
export function songDurationSeconds(song, opts = {}) {
  return ticksToSeconds(buildTimeline(song, opts).totalTicks, song.tempo);
}
