// ブラウザ上で合成する仮の楽器10種。音源の入手元が決まったら、同じ形の楽器を登録し直して差し替える。
// AudioContext と OfflineAudioContext(WAV書き出し)の両方で動くように BaseAudioContext だけを使う。

/**
 * 鳴らす音1つ
 * @typedef {object} NoteEvent
 * @property {number} time 鳴らし始める時刻(コンテキストの時計の秒)
 * @property {number} duration 秒
 * @property {number} pitch MIDIの音番号
 * @property {number} velocity 1〜127
 */

/**
 * パートごとに用意した楽器。play で音を予約する
 * @typedef {object} InstrumentVoice
 * @property {(note: NoteEvent) => void} play
 */

/**
 * 楽器の定義
 * @typedef {object} Instrument
 * @property {import('../../core/types.js').InstrumentId} id
 * @property {(ctx: BaseAudioContext, out: AudioNode) => InstrumentVoice} setup
 */

/** @param {number} pitch */
export const midiToHz = (pitch) => 440 * Math.pow(2, (pitch - 69) / 12);
/** @param {number} v */
const velGain = (v) => Math.pow(v / 127, 1.4);

/** @type {WeakMap<BaseAudioContext, AudioBuffer>} */
const noiseCache = new WeakMap();
/** @param {BaseAudioContext} ctx */
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/**
 * 音量の形(立ち上がり→減衰→持続→余韻)。終わる時刻を返す
 * @param {AudioParam} param
 * @param {number} t
 * @param {number} dur
 * @param {{ a: number, d: number, s: number, r: number }} env
 * @param {number} peak
 */
function adsr(param, t, dur, env, peak) {
  const sustain = Math.max(peak * env.s, 0.0001);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + env.a);
  param.setTargetAtTime(sustain, t + env.a, env.d / 3);
  const end = t + Math.max(dur, env.a);
  param.cancelScheduledValues(end);
  param.setTargetAtTime(0.0001, end, env.r / 4);
  return end + env.r;
}

/**
 * 弦をはじいた音(Karplus-Strong)を作ってためておく
 * @type {WeakMap<BaseAudioContext, Map<string, AudioBuffer>>}
 */
const pluckCache = new WeakMap();
/**
 * @param {BaseAudioContext} ctx
 * @param {number} pitch
 * @param {{ seconds: number, decay: number, brightness: number }} o
 */
function pluckBuffer(ctx, pitch, o) {
  let cache = pluckCache.get(ctx);
  if (!cache) pluckCache.set(ctx, (cache = new Map()));
  const key = `${pitch}:${o.seconds}:${o.decay}:${o.brightness}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const period = sr / midiToHz(pitch) - 0.5;
  const n = Math.max(2, Math.floor(period));
  const frac = period - n;
  const len = Math.floor(sr * o.seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  // はじいた瞬間の揺れ(明るさで高い成分の量を変える)
  let last = 0;
  for (let i = 0; i < n + 2; i++) {
    const r = Math.random() * 2 - 1;
    last = last + o.brightness * (r - last);
    d[i] = last;
  }
  // 1周期前の値を平均して戻すと弦の音になる(平均で半サンプル遅れる分を period で引いてある)
  // frac で1サンプルより細かく音程を合わせる
  for (let i = n + 2; i < len; i++) {
    const a0 = d[i - n] * (1 - frac) + d[i - n - 1] * frac;
    const a1 = d[i - n - 1] * (1 - frac) + d[i - n - 2] * frac;
    d[i] = o.decay * 0.5 * (a0 + a1);
  }
  // 頭の値をならす
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
  cache.set(key, buf);
  return buf;
}

/**
 * @param {import('../../core/types.js').InstrumentId} id
 * @param {(ctx: BaseAudioContext, out: AudioNode) => InstrumentVoice} setup
 * @returns {Instrument}
 */
const def = (id, setup) => ({ id, setup });

// ---- ピアノ ----
const piano = def('piano', (ctx, out) => {
  const bus = ctx.createGain();
  bus.gain.value = 0.5;
  bus.connect(out);
  return {
    play({ time, duration, pitch, velocity }) {
      const f = midiToHz(pitch);
      const g = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const bright = 1200 + velocity * 40 + f * 2;
      filter.frequency.setValueAtTime(bright, time);
      filter.frequency.setTargetAtTime(Math.max(400, f * 1.5), time, 0.4);
      const decay = Math.max(0.6, 3.2 - (pitch - 40) * 0.04);
      const end = Math.min(duration, decay * 2);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(velGain(velocity), time + 0.005);
      g.gain.setTargetAtTime(0.0001, time + 0.005, decay / 3);
      g.gain.cancelScheduledValues(time + end);
      g.gain.setTargetAtTime(0.0001, time + end, 0.08);
      const stop = time + end + 0.5;
      /** @type {[OscillatorType, number, number][]} */
      const partials = [['triangle', 1, 0.7], ['sine', 2, 0.25], ['sawtooth', 1, 0.08], ['sine', 3, 0.06]];
      for (const [type, mul, amp] of partials) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mul;
        o.detune.value = mul === 1 && type === 'sawtooth' ? 4 : 0;
        const a = ctx.createGain();
        a.gain.value = amp;
        o.connect(a).connect(filter);
        o.start(time);
        o.stop(stop);
      }
      filter.connect(g).connect(bus);
    },
  };
});

// ---- 弦楽器(はじく) ----
/**
 * @param {import('../../core/types.js').InstrumentId} id
 * @param {{ seconds: number, decay: number, brightness: number, gain: number, cutoff: number, drive?: number, octave?: number }} o
 */
function plucked(id, o) {
  return def(id, (ctx, out) => {
    const bus = ctx.createGain();
    bus.gain.value = o.gain;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = o.cutoff;
    if (o.drive) {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * o.drive) / Math.tanh(o.drive);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      const pre = ctx.createGain();
      pre.gain.value = 1;
      pre.connect(shaper).connect(tone);
      tone.connect(bus);
      bus.connect(out);
      return { play: (n) => playPluck(ctx, pre, n, o) };
    }
    tone.connect(bus);
    bus.connect(out);
    return { play: (n) => playPluck(ctx, tone, n, o) };
  });
}

/**
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {NoteEvent} n
 * @param {{ seconds: number, decay: number, brightness: number }} o
 */
function playPluck(ctx, dest, n, o) {
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, n.pitch, o);
  const g = ctx.createGain();
  g.gain.setValueAtTime(velGain(n.velocity), n.time);
  const end = n.time + Math.min(n.duration, o.seconds);
  g.gain.setTargetAtTime(0.0001, end, 0.05);
  src.connect(g).connect(dest);
  src.start(n.time);
  src.stop(end + 0.3);
}

const acousticGuitar = plucked('acoustic-guitar', { seconds: 2.5, decay: 0.996, brightness: 0.7, gain: 0.55, cutoff: 5000 });
const electricClean = plucked('electric-guitar-clean', { seconds: 3, decay: 0.998, brightness: 0.45, gain: 0.5, cutoff: 3200 });
const electricDist = plucked('electric-guitar-distortion', { seconds: 3, decay: 0.999, brightness: 0.6, gain: 0.22, cutoff: 3000, drive: 8 });

// ---- ベース ----
const bass = def('bass', (ctx, out) => {
  const bus = ctx.createGain();
  bus.gain.value = 0.35;
  bus.connect(out);
  return {
    play({ time, duration, pitch, velocity }) {
      const f = midiToHz(pitch);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(900 + velocity * 6, time);
      filter.frequency.setTargetAtTime(280, time, 0.12);
      const g = ctx.createGain();
      const stop = adsr(g.gain, time, duration, { a: 0.005, d: 0.3, s: 0.6, r: 0.08 }, velGain(velocity));
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = f;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = f;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.8;
      saw.connect(filter);
      sub.connect(subGain).connect(g);
      filter.connect(g).connect(bus);
      for (const o of [saw, sub]) {
        o.start(time);
        o.stop(stop + 0.05);
      }
    },
  };
});

// ---- ドラム ----
const drums = def('drums', (ctx, out) => {
  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  bus.connect(out);
  const noise = noiseBuffer(ctx);

  /** @param {number} t @param {number} v @param {{ type: BiquadFilterType, freq: number, q?: number, decay: number, gain: number }} o */
  const noiseHit = (t, v, o) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.value = o.freq;
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(velGain(v) * o.gain, t);
    g.gain.setTargetAtTime(0.0001, t + 0.002, o.decay / 4);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.decay + 0.1);
  };
  /** @param {number} t @param {number} v @param {{ from: number, to: number, sweep: number, decay: number, gain: number, type?: OscillatorType }} o */
  const toneHit = (t, v, o) => {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(o.to, t + o.sweep);
    const g = ctx.createGain();
    g.gain.setValueAtTime(velGain(v) * o.gain, t);
    g.gain.setTargetAtTime(0.0001, t + 0.002, o.decay / 4);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + o.decay + 0.1);
  };

  return {
    play({ time: t, duration, pitch, velocity: v }) {
      switch (pitch) {
        case 27: { // 上がっていく効果音
          const src = ctx.createBufferSource();
          src.buffer = noise;
          src.loop = true;
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.Q.value = 3;
          f.frequency.setValueAtTime(300, t);
          f.frequency.exponentialRampToValueAtTime(9000, t + duration);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(velGain(v) * 0.9, t + duration);
          g.gain.setTargetAtTime(0.0001, t + duration, 0.02);
          src.connect(f).connect(g).connect(bus);
          src.start(t);
          src.stop(t + duration + 0.15);
          break;
        }
        case 39: // 手拍子:短い雑音を3回重ねる
          for (const d of [0, 0.011, 0.022]) noiseHit(t + d, v, { type: 'bandpass', freq: 1400, q: 1.2, decay: d === 0.022 ? 0.18 : 0.02, gain: 1.1 });
          break;
        case 35:
        case 36: // バスドラム
          toneHit(t, v, { from: 190, to: 48, sweep: 0.09, decay: 0.5, gain: 1.5 });
          toneHit(t, v, { from: 1800, to: 300, sweep: 0.012, decay: 0.012, gain: 0.35, type: 'triangle' });
          noiseHit(t, v, { type: 'lowpass', freq: 4000, decay: 0.012, gain: 0.3 });
          break;
        case 37: // サイドスティック
          noiseHit(t, v, { type: 'bandpass', freq: 2200, q: 4, decay: 0.05, gain: 1.6 });
          toneHit(t, v, { from: 900, to: 700, sweep: 0.02, decay: 0.04, gain: 0.4, type: 'triangle' });
          break;
        case 38:
        case 40: // スネア
          noiseHit(t, v, { type: 'highpass', freq: 1200, decay: 0.22, gain: 0.8 });
          toneHit(t, v, { from: 240, to: 170, sweep: 0.05, decay: 0.12, gain: 0.6, type: 'triangle' });
          break;
        case 42:
        case 44: // 閉じたハイハット
          noiseHit(t, v, { type: 'highpass', freq: 8000, decay: 0.05, gain: 0.45 });
          break;
        case 46: // 開いたハイハット
          noiseHit(t, v, { type: 'highpass', freq: 7500, decay: 0.35, gain: 0.4 });
          break;
        case 41:
        case 43:
        case 45:
        case 47:
        case 48:
        case 50: { // タム
          const base = 70 + (pitch - 41) * 18;
          toneHit(t, v, { from: base * 1.6, to: base, sweep: 0.15, decay: 0.4, gain: 0.9 });
          break;
        }
        case 49:
        case 57: // クラッシュ
          noiseHit(t, v, { type: 'highpass', freq: 4500, decay: 1.6, gain: 0.45 });
          break;
        case 51:
        case 59: // ライド
          noiseHit(t, v, { type: 'bandpass', freq: 9000, q: 1.5, decay: 0.6, gain: 0.35 });
          toneHit(t, v, { from: 3200, to: 3150, sweep: 0.5, decay: 0.5, gain: 0.05, type: 'square' });
          break;
        default:
          noiseHit(t, v, { type: 'bandpass', freq: 3000, decay: 0.1, gain: 0.4 });
      }
    },
  };
});

// ---- 持続する音(ストリングス・パッド・リード) ----
/**
 * @param {import('../../core/types.js').InstrumentId} id
 * @param {{ waves: [OscillatorType, number, number][], env: { a: number, d: number, s: number, r: number }, cutoff: number, q?: number, gain: number, vibrato?: number, vibratoDelay?: number, filterEnv?: number }} o
 *   waves は [波の形, ずらし(セント), 音量]
 */
function sustained(id, o) {
  return def(id, (ctx, out) => {
    const bus = ctx.createGain();
    bus.gain.value = o.gain;
    bus.connect(out);
    return {
      play({ time, duration, pitch, velocity }) {
        const f = midiToHz(pitch);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = o.q ?? 0.7;
        filter.frequency.setValueAtTime(o.cutoff * (o.filterEnv ?? 1), time);
        filter.frequency.setTargetAtTime(o.cutoff, time, 0.15);
        const g = ctx.createGain();
        const stop = adsr(g.gain, time, duration, o.env, velGain(velocity));
        /** @type {OscillatorNode[]} */
        const oscs = [];
        for (const [type, cents, amp] of o.waves) {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = f;
          osc.detune.value = cents;
          const a = ctx.createGain();
          a.gain.value = amp;
          osc.connect(a).connect(filter);
          oscs.push(osc);
        }
        if (o.vibrato) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 5.2;
          const depth = ctx.createGain();
          depth.gain.setValueAtTime(0, time);
          depth.gain.linearRampToValueAtTime(o.vibrato, time + (o.vibratoDelay ?? 0.3));
          lfo.connect(depth);
          for (const osc of oscs) depth.connect(osc.detune);
          lfo.start(time);
          lfo.stop(stop + 0.05);
        }
        filter.connect(g).connect(bus);
        for (const osc of oscs) {
          osc.start(time);
          osc.stop(stop + 0.05);
        }
      },
    };
  });
}

const strings = sustained('strings', {
  waves: [['sawtooth', -9, 0.4], ['sawtooth', 0, 0.4], ['sawtooth', 8, 0.4]],
  env: { a: 0.25, d: 0.5, s: 0.85, r: 0.45 }, cutoff: 2400, gain: 0.32, vibrato: 7, vibratoDelay: 0.4,
});
const synthLead = sustained('synth-lead', {
  waves: [['square', -4, 0.35], ['sawtooth', 4, 0.35]],
  env: { a: 0.01, d: 0.25, s: 0.75, r: 0.12 }, cutoff: 3200, q: 2, gain: 0.32, vibrato: 18, vibratoDelay: 0.35, filterEnv: 1.8,
});
const synthPad = sustained('synth-pad', {
  waves: [['sawtooth', -12, 0.35], ['sawtooth', 12, 0.35], ['triangle', -1200, 0.4]],
  env: { a: 0.6, d: 1, s: 0.8, r: 1.0 }, cutoff: 1300, gain: 0.3,
});

// ---- ベル(FM合成) ----
const bell = def('bell', (ctx, out) => {
  const bus = ctx.createGain();
  bus.gain.value = 0.45;
  bus.connect(out);
  return {
    play({ time, duration, pitch, velocity }) {
      const f = midiToHz(pitch);
      const car = ctx.createOscillator();
      car.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.frequency.value = f * 3.5;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(f * 2.2, time);
      modGain.gain.setTargetAtTime(f * 0.2, time, 0.3);
      mod.connect(modGain).connect(car.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(velGain(velocity), time + 0.003);
      g.gain.setTargetAtTime(0.0001, time + 0.003, 0.7);
      const end = time + Math.max(duration, 0.3);
      g.gain.cancelScheduledValues(end);
      g.gain.setTargetAtTime(0.0001, end, 0.25);
      car.connect(g).connect(bus);
      for (const o of [car, mod]) {
        o.start(time);
        o.stop(end + 1.2);
      }
    },
  };
});

// ---- スーパーソー(EDMの厚いシンセ) ----
// 少しずつ音程をずらしたのこぎり波を7本重ね、左右に広げる。短い音は明るさがすぐ落ちて「はじく」音になる
const supersaw = def('supersaw', (ctx, out) => {
  const bus = ctx.createGain();
  bus.gain.value = 0.16;
  bus.connect(out);
  const spread = [-28, -17, -8, 0, 8, 17, 28];
  return {
    play({ time, duration, pitch, velocity }) {
      const f = midiToHz(pitch);
      const short = duration < 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 1.2;
      const open = Math.min(16000, 2500 + velocity * 60 + f * 2);
      filter.frequency.setValueAtTime(open, time);
      filter.frequency.setTargetAtTime(short ? Math.max(500, f * 2) : open * 0.55, time, short ? 0.06 : 0.3);
      const g = ctx.createGain();
      const stop = adsr(g.gain, time, duration, short ? { a: 0.003, d: 0.12, s: 0.25, r: 0.08 } : { a: 0.01, d: 0.4, s: 0.8, r: 0.25 }, velGain(velocity));
      filter.connect(g).connect(bus);
      spread.forEach((cents, i) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = cents;
        const pan = ctx.createStereoPanner();
        pan.pan.value = (i / (spread.length - 1)) * 1.4 - 0.7;
        o.connect(pan).connect(filter);
        o.start(time + Math.random() * 0.004);
        o.stop(stop + 0.05);
      });
    },
  };
});

/** @type {Instrument[]} */
export const SYNTH_INSTRUMENTS = [piano, acousticGuitar, electricClean, electricDist, bass, drums, strings, synthLead, synthPad, bell, supersaw];
