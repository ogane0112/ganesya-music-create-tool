// 歌声の置き場(メモリ上)。歌声エンジンが作った音声を覚えておき、再生とWAVで歌メロの楽器の代わりに鳴らす。
// 中身(メロディ・歌詞・テンポ・歌い手)から作った鍵で覚えるので、メロディや歌詞を変えると古い歌声は使われなくなる。
// ページを閉じると消える(作り直せる)。
import { sungNotes, vocalTracks } from '../core/lyrics.js';
import { singerOf } from '../connectors/voicevox.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/performance.js').PerformedNote} PerformedNote */

/** 歌声の音量(楽器とのつり合い)。音の詰まった伴奏(ロックなど)では、歌が埋もれないよう大きくする。細かい調整は「歌メロ」の音量つまみ */
const VOCAL_GAIN = 1.15;
const VOCAL_GAIN_BY_MOOD = /** @type {Record<string, number>} */ ({ rock: 1.5, shissou: 1.4, 'wafu-edm': 1.4, dark: 1.25 });

/** @param {Song} song */
const vocalGain = (song) => (song.mood && VOCAL_GAIN_BY_MOOD[song.mood]) || VOCAL_GAIN;

/** @type {Map<string, { wav: ArrayBuffer, leadSeconds: number, decoded: Map<number, AudioBuffer> }>} */
const store = new Map();

/**
 * その箇所・その歌のパートの歌声を見分ける鍵
 * @param {Song} song
 * @param {string} itemId
 * @param {string} [trackId] 省略で主旋律
 */
export function vocalKey(song, itemId, trackId) {
  const tid = trackId ?? vocalTracks(song)[0]?.id ?? '';
  const sung = sungNotes(song, itemId, tid).map(({ note, kana }) => [note.start, note.length, note.pitch, kana]);
  return JSON.stringify([tid, song.tempo, singerOf(song, tid), sung]);
}

/**
 * @param {Song} song
 * @param {string} itemId
 * @param {{ wav: ArrayBuffer, leadSeconds: number }} vocal
 * @param {string} [trackId] 省略で主旋律
 */
export function setVocal(song, itemId, vocal, trackId) {
  store.set(vocalKey(song, itemId, trackId), { ...vocal, decoded: new Map() });
}

/** 今の中身に合う歌声があるか(trackId を省くと、どれかの歌のパートにあるか) @param {Song} song @param {string} itemId @param {string} [trackId] */
export function hasVocal(song, itemId, trackId) {
  if (trackId) return store.has(vocalKey(song, itemId, trackId));
  return vocalTracks(song).some((t) => store.has(vocalKey(song, itemId, t.id)));
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
    for (const t of vocalTracks(song)) {
      const v = store.get(vocalKey(song, item.id, t.id));
      if (!v || v.decoded.has(sampleRate)) continue;
      // 歌声は 24000Hz。ここで再生側のレートに直る
      const ctx = new OfflineAudioContext(1, 1, sampleRate);
      v.decoded.set(sampleRate, await ctx.decodeAudioData(v.wav.slice(0)));
    }
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
  /** @type {Set<string>} 歌声に置きかえる「場所:パート」 */
  const sung = new Set();
  /** @type {{ time: number, buffer: AudioBuffer, trackId: string, gain: number }[]} */
  const clips = [];
  for (const track of vocalTracks(song)) {
    for (const item of performed.timeline.items) {
      const v = store.get(vocalKey(song, item.itemId, track.id));
      const buffer = v?.decoded.get(sampleRate);
      if (!v || !buffer) continue;
      sung.add(`${item.itemId}:${track.id}`);
      const mix = song.arrangement.find((a) => a.id === item.itemId)?.mix?.[track.id];
      if (mix?.muted) continue; // この場所だけ歌を消す
      const factor = mix?.volume === undefined ? 1 : track.volume > 0.02 ? Math.min(2.5, mix.volume / track.volume) : mix.volume;
      clips.push({ time: (item.startTick / 480) * (60 / song.tempo) - v.leadSeconds, buffer, trackId: track.id, gain: vocalGain(song) * factor });
    }
  }
  clips.sort((a, b) => a.time - b.time);
  return { notes: performed.notes.filter((n) => !sung.has(`${n.itemId}:${n.trackId}`)), clips };
}
