// 曲をオーディオの部品につなぐ共通処理。再生(AudioContext)とWAV書き出し(OfflineAudioContext)で使う。
// パートごとに: 楽器 → うねり(sidechain) → 音量 → 左右 → 全体。さらに残響(リバーブ)へ少し送る。
import { getInstrument } from './instruments/index.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').TrackRole} TrackRole */

/** 役割ごとの左右の位置と残響の量 */
const ROLE_MIX = /** @type {Record<TrackRole, { pan: number, reverb: number }>} */ ({
  vocal: { pan: 0, reverb: 0.22 },
  chords: { pan: -0.3, reverb: 0.18 },
  bass: { pan: 0, reverb: 0 },
  drums: { pan: 0, reverb: 0.06 },
  pad: { pan: 0.25, reverb: 0.35 },
  lead: { pan: 0.3, reverb: 0.25 },
  other: { pan: 0, reverb: 0.15 },
});

const KICKS = new Set([35, 36]);

/**
 * @typedef {object} TrackBus
 * @property {GainNode} gain 音量
 * @property {GainNode} duck うねり用
 * @property {import('./instruments/index.js').InstrumentVoice} voice
 * @property {string} instrument
 * @property {boolean} sidechain
 * @property {boolean} isDrums
 */

/**
 * @typedef {object} MixBus
 * @property {BaseAudioContext} ctx
 * @property {GainNode} master
 * @property {Map<string, TrackBus>} tracks
 */

/** @type {WeakMap<BaseAudioContext, AudioBuffer>} */
const irCache = new WeakMap();
/**
 * 残響の響き方(だんだん小さくなる雑音)を作る
 * @param {BaseAudioContext} ctx
 */
function impulseResponse(ctx) {
  let b = irCache.get(ctx);
  if (b) return b;
  const seconds = 2.2;
  const len = Math.floor(ctx.sampleRate * seconds);
  b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      lp += 0.35 * (Math.random() * 2 - 1 - lp); // 高い音を少し丸める
      d[i] = lp * Math.exp(-t * 3.2) * (t < 0.01 ? t / 0.01 : 1);
    }
  }
  irCache.set(ctx, b);
  return b;
}

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

  const reverb = ctx.createConvolver();
  reverb.buffer = impulseResponse(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.5;
  reverb.connect(reverbReturn).connect(master);

  /** @type {MixBus['tracks']} */
  const tracks = new Map();
  for (const t of song.tracks) {
    const role = ROLE_MIX[t.role] ?? ROLE_MIX.other;
    const duck = ctx.createGain();
    const gain = ctx.createGain();
    gain.gain.value = trackGain(song, t.id);
    const pan = ctx.createStereoPanner();
    pan.pan.value = role.pan;
    duck.connect(gain).connect(pan).connect(master);
    if (role.reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = role.reverb;
      pan.connect(send).connect(reverb);
    }
    tracks.set(t.id, {
      gain, duck,
      voice: getInstrument(t.instrument).setup(ctx, duck),
      instrument: t.instrument,
      sidechain: !!t.sidechain,
      isDrums: t.role === 'drums',
    });
  }
  return { ctx, master, tracks };
}

/**
 * 音符1つを鳴らす予約。バスドラムなら、うねりを付けるパートの音量を一瞬下げる
 * 時刻の順に呼ぶこと
 * @param {MixBus} mix
 * @param {string} trackId
 * @param {import('./instruments/index.js').NoteEvent} note
 */
export function playNote(mix, trackId, note) {
  const track = mix.tracks.get(trackId);
  if (!track) return;
  track.voice.play(note);
  if (track.isDrums && KICKS.has(note.pitch)) {
    for (const t of mix.tracks.values()) {
      if (!t.sidechain) continue;
      const g = t.duck.gain;
      g.cancelScheduledValues(note.time);
      g.setValueAtTime(0.25, note.time);
      g.setTargetAtTime(1, note.time + 0.03, 0.07);
    }
  }
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
      entry.voice = getInstrument(t.instrument).setup(ctx, entry.duck);
      entry.instrument = t.instrument;
    }
  }
}
