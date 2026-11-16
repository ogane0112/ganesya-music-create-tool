// 曲をオーディオの部品につなぐ共通処理。再生(AudioContext)とWAV書き出し(OfflineAudioContext)で使う。
import { getInstrument } from './instruments/index.js';

/** @typedef {import('../core/types.js').Song} Song */

/**
 * @typedef {object} MixBus
 * @property {GainNode} master
 * @property {Map<string, { gain: GainNode, voice: import('./instruments/index.js').InstrumentVoice, instrument: string }>} tracks
 */

/**
 * パートごとの音量つまみと楽器を用意する
 * @param {BaseAudioContext} ctx
 * @param {Song} song
 * @param {AudioNode} destination
 * @returns {MixBus}
 */
export function createMix(ctx, song, destination) {
  const master = ctx.createGain();
  master.gain.value = 0.62;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  master.connect(comp).connect(destination);
  /** @type {MixBus['tracks']} */
  const tracks = new Map();
  for (const t of song.tracks) {
    const gain = ctx.createGain();
    gain.gain.value = trackGain(song, t.id);
    gain.connect(master);
    tracks.set(t.id, { gain, voice: getInstrument(t.instrument).setup(ctx, gain), instrument: t.instrument });
  }
  return { master, tracks };
}

/**
 * 消音を考えたパートの音量
 * @param {Song} song
 * @param {string} trackId
 */
export function trackGain(song, trackId) {
  const t = song.tracks.find((x) => x.id === trackId);
  if (!t || t.muted) return 0;
  return t.volume;
}

/**
 * 曲の設定の変化(音量・消音・楽器)を、鳴らしている途中のつまみに反映する
 * @param {BaseAudioContext} ctx
 * @param {MixBus} mix
 * @param {Song} song
 */
export function updateMix(ctx, mix, song) {
  for (const t of song.tracks) {
    const entry = mix.tracks.get(t.id);
    if (!entry) continue;
    entry.gain.gain.setTargetAtTime(trackGain(song, t.id), ctx.currentTime, 0.02);
    if (entry.instrument !== t.instrument) {
      entry.voice = getInstrument(t.instrument).setup(ctx, entry.gain);
      entry.instrument = t.instrument;
    }
  }
}
