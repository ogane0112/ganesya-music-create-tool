// 曲全体を音のデータにする(C3)。再生と同じ作り置きの音・同じ音量つまみ・同じ残響を使う。
// 速くするため、音符はパートごとに JavaScript で足し合わせてから、エフェクトだけを OfflineAudioContext に通す
// (音符ごとに Web Audio の部品を作ると、1曲で千を超える部品になり遅い)。
import { buildTimeline } from '../core/timeline.js';
import { ticksToSeconds } from '../core/theory.js';
import { createMix, DUCK, KICKS } from './render.js';
import { lookupNote, prepareSong } from './note-cache.js';
import { master } from './master.js';
import { encodeWav } from './wav-encode.js';

/** @typedef {import('../core/types.js').Song} Song */

const TAIL_SECONDS = 2.5; // 最後の音の余韻
const LEAD_SECONDS = 0.05;

/**
 * @param {Song} song
 * @param {{ sampleRate?: number, itemIds?: string[], onProgress?: (done: number, total: number) => void }} [opts]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSong(song, opts = {}) {
  const sampleRate = opts.sampleRate ?? 44100;
  await prepareSong(song, sampleRate, { itemIds: opts.itemIds, onProgress: opts.onProgress });
  const timeline = buildTimeline(song, { itemIds: opts.itemIds });
  const seconds = LEAD_SECONDS + ticksToSeconds(timeline.totalTicks, song.tempo) + TAIL_SECONDS;
  const frames = Math.ceil(seconds * sampleRate);

  // パートごとに音符を足し合わせる
  /** @type {Map<string, [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]>} */
  const stems = new Map();
  /** @type {Map<string, number>} ドラムの2通りを交互に使う */
  const rounds = new Map();
  /** @type {number[]} バスドラムの時刻 */
  const kicks = [];
  const instrumentOf = new Map(song.tracks.map((t) => [t.id, t.instrument]));
  const drumTracks = new Set(song.tracks.filter((t) => t.role === 'drums').map((t) => t.id));
  for (const ev of timeline.events) {
    const instrument = instrumentOf.get(ev.trackId);
    if (!instrument) continue;
    const time = LEAD_SECONDS + ticksToSeconds(ev.tick, song.tempo);
    if (drumTracks.has(ev.trackId) && KICKS.has(ev.pitch)) kicks.push(time);
    const round = rounds.get(ev.trackId) ?? 0;
    rounds.set(ev.trackId, round + 1);
    const hit = lookupNote(instrument, sampleRate, { time, duration: ticksToSeconds(ev.length, song.tempo), pitch: ev.pitch, velocity: ev.velocity }, round);
    if (!hit) continue;
    let stem = stems.get(ev.trackId);
    if (!stem) stems.set(ev.trackId, (stem = [new Float32Array(frames), new Float32Array(frames)]));
    const at = Math.round(time * sampleRate);
    const n = Math.min(hit.buffer.length, frames - at);
    for (let c = 0; c < 2; c++) {
      const src = hit.buffer.getChannelData(c);
      const dst = stem[c];
      for (let i = 0; i < n; i++) dst[at + i] += src[i] * hit.gain;
    }
  }

  // うねり(バスドラムに合わせて音量をへこませる)
  const duckCurve = kicks.length ? makeDuckCurve(kicks, frames, sampleRate) : null;

  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const mix = createMix(ctx, song, ctx.destination, { voices: false });
  for (const t of song.tracks) {
    const stem = stems.get(t.id);
    const bus = mix.tracks.get(t.id);
    if (!stem || !bus) continue;
    if (bus.sidechain && duckCurve) {
      for (let c = 0; c < 2; c++) for (let i = 0; i < frames; i++) stem[c][i] *= duckCurve[i];
    }
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate });
    buffer.copyToChannel(stem[0], 0);
    buffer.copyToChannel(stem[1], 1);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(bus.duck);
    src.start(0);
  }
  return ctx.startRendering();
}

/**
 * 再生時の setValueAtTime / setTargetAtTime と同じ形の音量の曲線
 * @param {number[]} kicks 秒
 * @param {number} frames
 * @param {number} sampleRate
 */
function makeDuckCurve(kicks, frames, sampleRate) {
  const curve = new Float32Array(frames).fill(1);
  const sorted = [...kicks].sort((a, b) => a - b);
  for (let k = 0; k < sorted.length; k++) {
    const from = Math.round(sorted[k] * sampleRate);
    const to = k + 1 < sorted.length ? Math.round(sorted[k + 1] * sampleRate) : frames;
    for (let i = from; i < to && i < frames; i++) {
      const t = (i - from) / sampleRate;
      curve[i] = t < DUCK.hold ? DUCK.depth : 1 - (1 - DUCK.depth) * Math.exp(-(t - DUCK.hold) / DUCK.recover);
    }
  }
  return curve;
}

/**
 * 曲全体を WAV のバイト列にする
 * @param {Song} song
 * @param {{ sampleRate?: number, itemIds?: string[], onProgress?: (done: number, total: number) => void }} [opts]
 */
export async function renderSongToWav(song, opts = {}) {
  const buffer = await renderSong(song, opts);
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  // 配信の基準の大きさ(-14 LUFS、最大 -1 dB)にそろえる
  master(channels, buffer.sampleRate);
  return encodeWav(channels, buffer.sampleRate);
}
