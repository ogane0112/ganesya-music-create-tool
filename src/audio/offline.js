// 曲全体を音のデータにする(C3)。再生と同じ楽器・同じ音量つまみを OfflineAudioContext で鳴らす。
import { buildTimeline } from '../core/timeline.js';
import { ticksToSeconds } from '../core/theory.js';
import { createMix } from './render.js';
import { encodeWav } from './wav-encode.js';

/** @typedef {import('../core/types.js').Song} Song */

const TAIL_SECONDS = 2; // 最後の音の余韻
const LEAD_SECONDS = 0.05;

/**
 * @param {Song} song
 * @param {{ sampleRate?: number, itemIds?: string[] }} [opts]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSong(song, opts = {}) {
  const sampleRate = opts.sampleRate ?? 44100;
  const timeline = buildTimeline(song, { itemIds: opts.itemIds });
  const seconds = LEAD_SECONDS + ticksToSeconds(timeline.totalTicks, song.tempo) + TAIL_SECONDS;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const mix = createMix(ctx, song, ctx.destination);
  for (const ev of timeline.events) {
    const track = mix.tracks.get(ev.trackId);
    if (!track) continue;
    track.voice.play({
      time: LEAD_SECONDS + ticksToSeconds(ev.tick, song.tempo),
      duration: ticksToSeconds(ev.length, song.tempo),
      pitch: ev.pitch,
      velocity: ev.velocity,
    });
  }
  return ctx.startRendering();
}

/**
 * 曲全体を WAV のバイト列にする
 * @param {Song} song
 * @param {{ sampleRate?: number, itemIds?: string[] }} [opts]
 */
export async function renderSongToWav(song, opts = {}) {
  const buffer = await renderSong(song, opts);
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return encodeWav(channels, buffer.sampleRate);
}
