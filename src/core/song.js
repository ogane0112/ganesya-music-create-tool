// 曲データの土台を作る。
import { FORMAT_VERSION } from './types.js';

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').Key} Key */

/**
 * 空の曲を作る(叩き台の土台、テスト用)
 * @param {{ title?: string, artist?: string, tempo?: number, key?: Key, mood?: import('./types.js').Mood | null, now?: string }} [opts]
 * @returns {Song}
 */
export function createEmptySong(opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  return {
    formatVersion: FORMAT_VERSION,
    revision: 0,
    meta: { title: opts.title ?? '無題の曲', artist: opts.artist ?? '', createdAt: now, updatedAt: now },
    tempo: opts.tempo ?? 100,
    key: opts.key ?? { tonic: 'C', mode: 'major' },
    timeSignature: [4, 4],
    mood: opts.mood ?? null,
    tracks: [],
    sections: [],
    arrangement: [],
    extensions: {},
  };
}

