// 音符の作り置き。同じ楽器・同じ高さ・同じ長さ・近い強さの音は一度だけ合成し、
// あとは録音した音(AudioBuffer)を貼るだけにする。リフやドラムのように同じ音が多い曲ほど速くなる。
// 再生(AudioContext)とWAV書き出し(OfflineAudioContext)の両方で同じ作り置きを使うので、聴こえ方は同じ。
import { buildTimeline } from '../core/timeline.js';
import { ticksToSeconds } from '../core/theory.js';
import { getInstrument } from './instruments/index.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('./instruments/index.js').NoteEvent} NoteEvent */
/** @typedef {import('./instruments/index.js').InstrumentVoice} InstrumentVoice */

/** 強さはこの4段階で作り置き、間は音量で合わせる */
const VELOCITY_STEPS = [48, 72, 96, 120];
/** ドラムは同じ音ばかりだと機械的なので2通り作る */
const DRUM_VARIANTS = 2;
/** 音の終わりの後に残す余韻の最大(秒) */
const TAIL = 2.5;
const MAX_ENTRIES = 3000;
const CONCURRENCY = 6;

/** @type {Map<string, AudioBuffer>} */
const cache = new Map();

/** @param {number} v */
function velocityStep(v) {
  return VELOCITY_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
}

/** 長さは10ミリ秒単位にそろえる @param {number} seconds */
const quantize = (seconds) => Math.max(0.01, Math.round(seconds * 100) / 100);

/**
 * @param {string} instrument
 * @param {number} sampleRate
 * @param {number} pitch
 * @param {number} duration 秒(そろえた後)
 * @param {number} velocity 段階
 * @param {number} variant
 */
const keyOf = (instrument, sampleRate, pitch, duration, velocity, variant) =>
  `${instrument}|${sampleRate}|${pitch}|${duration}|${velocity}|${variant}`;

/**
 * 1音を合成して録音する。後ろの無音は切る
 * @param {string} instrument
 * @param {number} sampleRate
 * @param {number} pitch
 * @param {number} duration
 * @param {number} velocity
 */
async function renderNote(instrument, sampleRate, pitch, duration, velocity) {
  const length = Math.ceil((duration + TAIL) * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  getInstrument(instrument).setup(ctx, ctx.destination).play({ time: 0, duration, pitch, velocity });
  const buf = await ctx.startRendering();
  let end = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = d.length - 1; i > end; i--) {
      if (Math.abs(d[i]) > 1e-4) {
        end = i;
        break;
      }
    }
  }
  const frames = Math.min(buf.length, end + Math.ceil(0.01 * sampleRate));
  const trimmed = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, frames), sampleRate });
  for (let c = 0; c < 2; c++) trimmed.copyToChannel(buf.getChannelData(c).subarray(0, frames), c);
  return trimmed;
}

/**
 * 曲に出てくる音をすべて作り置きする(まだないものだけ)
 * @param {Song} song
 * @param {number} sampleRate
 * @param {{ itemIds?: string[], onProgress?: (done: number, total: number) => void }} [opts]
 */
export async function prepareSong(song, sampleRate, opts = {}) {
  const timeline = buildTimeline(song, { itemIds: opts.itemIds });
  const instrumentOf = new Map(song.tracks.map((t) => [t.id, t.instrument]));
  /** @type {Map<string, () => Promise<void>>} */
  const jobs = new Map();
  for (const ev of timeline.events) {
    const instrument = instrumentOf.get(ev.trackId);
    if (!instrument) continue;
    const duration = quantize(ticksToSeconds(ev.length, song.tempo));
    const velocity = velocityStep(ev.velocity);
    const variants = instrument === 'drums' ? DRUM_VARIANTS : 1;
    for (let variant = 0; variant < variants; variant++) {
      const key = keyOf(instrument, sampleRate, ev.pitch, duration, velocity, variant);
      if (cache.has(key) || jobs.has(key)) continue;
      jobs.set(key, async () => {
        cache.set(key, await renderNote(instrument, sampleRate, ev.pitch, duration, velocity));
      });
    }
  }
  const queue = [...jobs.values()];
  const total = queue.length;
  let done = 0;
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await job();
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  // 増えすぎたら古いものから捨てる
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
  return { rendered: total, cached: cache.size };
}

/**
 * 作り置きの音を探す。見つかれば録音と、強さを合わせるための音量を返す
 * @param {string} instrument
 * @param {number} sampleRate
 * @param {NoteEvent} note
 * @param {number} variant
 * @returns {{ buffer: AudioBuffer, gain: number } | null}
 */
export function lookupNote(instrument, sampleRate, note, variant) {
  const step = velocityStep(note.velocity);
  const buffer = cache.get(keyOf(instrument, sampleRate, note.pitch, quantize(note.duration), step, instrument === 'drums' ? variant % DRUM_VARIANTS : 0));
  return buffer ? { buffer, gain: Math.pow(note.velocity / step, 1.4) } : null;
}

/**
 * 作り置きを使う楽器を用意する。作り置きにない音は、その場で合成する
 * @param {string} instrument
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out
 * @returns {InstrumentVoice}
 */
export function cachedVoice(instrument, ctx, out) {
  /** @type {InstrumentVoice | null} */
  let live = null;
  let round = 0;
  return {
    play(note) {
      const hit = lookupNote(instrument, ctx.sampleRate, note, round++);
      if (!hit) {
        live ??= getInstrument(instrument).setup(ctx, out);
        live.play(note);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = hit.buffer;
      const g = ctx.createGain();
      g.gain.value = hit.gain;
      src.connect(g).connect(out);
      src.start(note.time);
    },
  };
}

/** 作り置きを捨てる(楽器を差し替えた時など) */
export function clearNoteCache() {
  cache.clear();
}
