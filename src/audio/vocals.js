// 歌声の置き場(メモリ上)。歌声エンジンが作った音声を覚えておき、再生とWAVで歌メロの楽器の代わりに鳴らす。
// 中身(メロディ・歌詞・テンポ・歌い手)から作った鍵で覚えるので、メロディや歌詞を変えると古い歌声は使われなくなる。
// ページを閉じると消える(作り直せる)。
import { sungNotes } from '../core/lyrics.js';
import { singerOf } from '../connectors/voicevox.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/performance.js').PerformedNote} PerformedNote */

/** 歌声の音量(楽器とのつり合い) */
const VOCAL_GAIN = 1.15;

/** @type {Map<string, { wav: ArrayBuffer, leadSeconds: number, decoded: Map<number, AudioBuffer> }>} */
const store = new Map();

/**
 * その箇所の歌声を見分ける鍵
 * @param {Song} song
 * @param {string} itemId
 */
export function vocalKey(song, itemId) {
  const sung = sungNotes(song, itemId).map(({ note, kana }) => [note.start, note.length, note.pitch, kana]);
  return JSON.stringify([song.tempo, singerOf(song), sung]);
}

/**
 * @param {Song} song
 * @param {string} itemId
 * @param {{ wav: ArrayBuffer, leadSeconds: number }} vocal
 */
export function setVocal(song, itemId, vocal) {
  store.set(vocalKey(song, itemId), { ...vocal, decoded: new Map() });
}

/** 今の中身に合う歌声があるか @param {Song} song @param {string} itemId */
export function hasVocal(song, itemId) {
  return store.has(vocalKey(song, itemId));
}

/**
 * 曲の中の歌声を、そのサンプルレート用に用意する(再生・書き出しの前に呼ぶ)
 * @param {Song} song
 * @param {number} sampleRate
 * @param {string[]} [itemIds]
 */
export async function prepareVocals(song, sampleRate, itemIds) {
  for (const item of song.arrangement) {
    if (itemIds && !itemIds.includes(item.id)) continue;
    const v = store.get(vocalKey(song, item.id));
    if (!v || v.decoded.has(sampleRate)) continue;
    // 歌声は 24000Hz。ここで再生側のレートに直る
    const ctx = new OfflineAudioContext(1, 1, sampleRate);
    v.decoded.set(sampleRate, await ctx.decodeAudioData(v.wav.slice(0)));
  }
}

/**
 * 歌声のある箇所は、歌メロの楽器の音符を外して、代わりに歌声を並べる
 * @param {Song} song
 * @param {{ timeline: import('../core/timeline.js').Timeline, notes: PerformedNote[] }} performed
 * @param {number} sampleRate
 * @returns {{ notes: PerformedNote[], clips: { time: number, buffer: AudioBuffer, trackId: string, gain: number }[] }}
 */
export function withVocals(song, performed, sampleRate) {
  const track = song.tracks.find((t) => t.role === 'vocal');
  if (!track) return { notes: performed.notes, clips: [] };
  /** @type {Set<string>} */
  const sungItems = new Set();
  /** @type {{ time: number, buffer: AudioBuffer, trackId: string, gain: number }[]} */
  const clips = [];
  for (const item of performed.timeline.items) {
    const v = store.get(vocalKey(song, item.itemId));
    const buffer = v?.decoded.get(sampleRate);
    if (!v || !buffer) continue;
    sungItems.add(item.itemId);
    clips.push({ time: (item.startTick / 480) * (60 / song.tempo) - v.leadSeconds, buffer, trackId: track.id, gain: VOCAL_GAIN });
  }
  return { notes: performed.notes.filter((n) => !(n.trackId === track.id && sungItems.has(n.itemId))), clips };
}
