// 再生の仕組み(C1)。Web Audio の時計で少し先までを予約していく方式で、テンポどおりにずれずに鳴らす。
import { performSong } from '../core/performance.js';
import { ticksToSeconds } from '../core/theory.js';
import { createMix, playNote, updateMix } from './render.js';
import { prepareSong } from './note-cache.js';

/** @typedef {import('../core/types.js').Song} Song */

const LOOKAHEAD = 0.12; // 何秒先まで予約するか
const INTERVAL = 25; // 何ミリ秒ごとに予約するか
const START_DELAY = 0.06;

/**
 * @typedef {object} PlayOptions
 * @property {string[]} [itemIds] この部品だけを鳴らす
 * @property {boolean} [loop]
 */

/**
 * @typedef {object} PlayerState
 * @property {boolean} playing
 * @property {boolean} [preparing] 音を用意している途中
 * @property {number} positionSeconds 再生範囲の頭からの秒
 * @property {string | null} itemId 今鳴っている部品
 * @property {number} [itemProgress] その部品の中の進み具合(0〜1)
 */

export class Player {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {Song | null} */
    this.song = null;
    /** @type {ReturnType<typeof createMix> | null} */
    this.mix = null;
    /** @type {import('../core/timeline.js').Timeline | null} */
    this.timeline = null;
    /** @type {import('../core/performance.js').PerformedNote[]} 鳴らす順に並んだ音 */
    this.notes = [];
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timer = null;
    this.loop = false;
    this.startTime = 0; // 再生範囲の頭が鳴る時刻(ループのたびに進む)
    this.cursor = 0; // 次に予約する音の番号
    /** @type {Set<(s: PlayerState) => void>} */
    this.listeners = new Set();
    /** @type {number | null} */
    this.raf = null;
    this.preparing = false;
    this.playId = 0;
  }

  /** ユーザーの操作の中で呼ぶ(iPad の Safari は操作なしでは音を出せない) */
  async ensureContext() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  get playing() {
    return this.timer !== null;
  }

  /**
   * @param {Song} song
   * @param {PlayOptions} [opts]
   */
  async play(song, opts = {}) {
    this.stop();
    const id = ++this.playId;
    const ctx = await this.ensureContext();
    // 初めて鳴らす音を作り置きしてから始める(重い合成を再生中にしないため)
    this.preparing = true;
    this.emit();
    try {
      await prepareSong(song, ctx.sampleRate, { itemIds: opts.itemIds });
    } finally {
      this.preparing = false;
    }
    if (id !== this.playId) return; // 用意している間に止められた・別の再生が始まった
    this.song = song;
    this.loop = !!opts.loop;
    const performed = performSong(song, { itemIds: opts.itemIds });
    this.timeline = performed.timeline;
    this.notes = performed.notes;
    if (this.timeline.totalTicks === 0) return;
    this.mix = createMix(ctx, song, ctx.destination);
    this.startTime = ctx.currentTime + START_DELAY;
    this.cursor = 0;
    this.timer = setInterval(() => this.schedule(), INTERVAL);
    this.schedule();
    this.tick();
  }

  /** 再生中に曲が変わった時(音量・消音・楽器)。音符の変化は次の再生から */
  update(/** @type {Song} */ song) {
    this.song = song;
    if (this.ctx && this.mix) updateMix(this.ctx, this.mix, song);
  }

  stop() {
    this.playId++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.mix && this.ctx) {
      // 予約済みの音ごと止めるため、出口を絞ってから切り離す
      const { master } = this.mix;
      master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
      setTimeout(() => master.disconnect(), 100);
    }
    this.mix = null;
    this.emit();
  }

  /** 少し先までの音を予約する */
  schedule() {
    const { ctx, timeline, song, mix } = this;
    if (!ctx || !timeline || !song || !mix) return;
    const loopSeconds = ticksToSeconds(timeline.totalTicks, song.tempo);
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (;;) {
      if (this.cursor >= this.notes.length) {
        const endTime = this.startTime + loopSeconds;
        if (!this.loop) {
          if (ctx.currentTime > endTime + 0.3) this.stop();
          return;
        }
        if (endTime > horizon) return;
        this.startTime = endTime;
        this.cursor = 0;
      }
      const ev = this.notes[this.cursor];
      const time = this.startTime + ev.time;
      if (time > horizon) return;
      this.cursor++;
      if (time < ctx.currentTime - 0.02) continue; // 間に合わなかった音は飛ばす
      playNote(mix, ev.trackId, { time, duration: ev.duration, pitch: ev.pitch, velocity: ev.velocity });
    }
  }

  /** @returns {PlayerState} */
  state() {
    const { ctx, timeline, song } = this;
    if (!this.playing || !ctx || !timeline || !song) return { playing: false, preparing: this.preparing, positionSeconds: 0, itemId: null };
    const loopSeconds = ticksToSeconds(timeline.totalTicks, song.tempo);
    let pos = ctx.currentTime - this.startTime;
    if (pos < 0) pos += this.loop ? loopSeconds : 0;
    pos = Math.max(0, Math.min(pos, loopSeconds));
    const tick = (pos / loopSeconds) * timeline.totalTicks;
    const item = timeline.items.find((i) => tick >= i.startTick && tick < i.endTick);
    const itemProgress = item ? (tick - item.startTick) / (item.endTick - item.startTick) : 0;
    return { playing: true, positionSeconds: pos, itemId: item?.itemId ?? null, itemProgress };
  }

  /** @param {(s: PlayerState) => void} fn */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }

  tick() {
    this.emit();
    if (this.playing) this.raf = requestAnimationFrame(() => this.tick());
  }
}
