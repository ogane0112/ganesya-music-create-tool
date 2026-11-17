// 曲をオーディオの部品につなぐ共通処理。再生(AudioContext)とWAV書き出し(OfflineAudioContext)で使う。
// パートごとに: 楽器 → うねり(sidechain) → 音量 → 左右 → 全体。さらに残響(リバーブ)へ少し送る。
import { cachedVoice } from './note-cache.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').TrackRole} TrackRole */

/** 役割ごとの左右の位置と残響の量 */
// 奥行きは「響きの量」で描き分ける。
//   room  : 同じ部屋で鳴っている感じ(短い響き)。生の楽器に多め → ばらばらの音が1つの演奏にまとまる
//   reverb: 遠くまで広がる長い響き。多いほど奥に聞こえる(背景は奥、歌とドラムは手前)
//   lowCut: これより低い音を削る(Hz)。ベースとバスドラムの居場所を空けて、濁りを取る
//   eq    : 声の帯域(約3kHz)の出し入れ(dB)。歌は持ち上げ、ギターなどは下げて、歌の居場所を空ける
const ROLE_MIX = /** @type {Record<TrackRole, { pan: number, room: number, reverb: number, delay: number, lowCut: number, eq?: { freq: number, gain: number } }>} */ ({
  vocal: { pan: 0, room: 0.1, reverb: 0.16, delay: 0.12, lowCut: 120, eq: { freq: 3200, gain: 3 } },
  chords: { pan: -0.35, room: 0.2, reverb: 0.12, delay: 0, lowCut: 110, eq: { freq: 2800, gain: -2.5 } },
  bass: { pan: 0, room: 0.06, reverb: 0, delay: 0, lowCut: 0 },
  drums: { pan: 0, room: 0.24, reverb: 0.05, delay: 0, lowCut: 0 },
  pad: { pan: 0.3, room: 0, reverb: 0.4, delay: 0, lowCut: 180, eq: { freq: 2800, gain: -2 } },
  lead: { pan: 0.35, room: 0.12, reverb: 0.2, delay: 0.1, lowCut: 150, eq: { freq: 2800, gain: -2 } },
  other: { pan: -0.25, room: 0.1, reverb: 0.3, delay: 0.16, lowCut: 200, eq: { freq: 2800, gain: -1.5 } },
});

/** 役割ごとの左右・残響の既定(画面の初期値に使う) @param {TrackRole} role */
export const roleDefaults = (role) => ROLE_MIX[role] ?? ROLE_MIX.other;

export const KICKS = new Set([35, 36]);
/** うねり:バスドラムの瞬間にこの音量まで下げ、少し待ってから戻す */
export const DUCK = { depth: 0.25, hold: 0.03, recover: 0.07 };

/**
 * @typedef {object} TrackBus
 * @property {GainNode} gain 音量
 * @property {GainNode} duck うねり用
 * @property {import('./instruments/index.js').InstrumentVoice} voice
 * @property {StereoPannerNode} pan
 * @property {GainNode} reverbSend 長い残響への送り
 * @property {string} instrument
 * @property {boolean} sidechain
 * @property {Map<string, import('./instruments/index.js').InstrumentVoice>} extra この場所だけ別の楽器にした時の楽器
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
  const seconds = 2.6;
  const preDelay = 0.018; // 元の音と響きの間を少し空けると、音が前に出る
  const len = Math.floor(ctx.sampleRate * seconds);
  b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = Math.floor(preDelay * ctx.sampleRate); i < len; i++) {
      const t = i / ctx.sampleRate - preDelay;
      // 響きの後ろほど高い音が先に消える(本物の部屋と同じ)
      const bright = 0.55 * Math.exp(-t * 1.6) + 0.06;
      lp += bright * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t * 2.8) * (t < 0.004 ? t / 0.004 : 1);
    }
    // 最初の跳ね返り(壁の近さの感じ)
    for (const [ms, amp] of [[23, 0.5], [31, -0.4], [43, 0.35], [59, -0.28], [71, 0.22]]) {
      const i = Math.floor(((ms + c * 3) / 1000) * ctx.sampleRate);
      if (i < len) d[i] += amp;
    }
  }
  irCache.set(ctx, b);
  return b;
}

/** @type {WeakMap<BaseAudioContext, AudioBuffer>} */
const roomCache = new WeakMap();
/**
 * 小さな部屋の響き(0.4秒ほど。壁からの跳ね返りが中心)
 * @param {BaseAudioContext} ctx
 */
function roomResponse(ctx) {
  let b = roomCache.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * 0.45);
  b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = Math.floor(0.004 * ctx.sampleRate); i < len; i++) {
      const t = i / ctx.sampleRate;
      lp += 0.5 * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t * 13);
    }
    for (const [ms, amp] of [[7, 0.7], [11, -0.55], [17, 0.45], [23, -0.38], [29, 0.3], [37, -0.22]]) {
      const i = Math.floor(((ms + c * 2.3) / 1000) * ctx.sampleRate);
      d[i] += amp;
    }
  }
  roomCache.set(ctx, b);
  return b;
}

/**
 * パートごとの音量つまみと楽器を用意する
 * @param {BaseAudioContext} ctx
 * @param {Song} song
 * @param {AudioNode} destination
 * @param {{ voices?: boolean, dynamics?: boolean }} [opts] voices=false なら楽器を用意しない(音を外で足し合わせる時)。dynamics=false ならコンプレッサー・リミッターを通さない(音量バランスの測定用)
 * @returns {MixBus}
 */
export function createMix(ctx, song, destination, opts = {}) {
  const withVoices = opts.voices !== false;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  // 全体をゆるくまとめる(強くかけすぎると打楽器の勢いがなくなる)
  comp.threshold.value = -16;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.02;
  comp.release.value = 0.25;
  // 最後に天井を作り、音が割れないようにする(リミッター)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  // 全体の帯域を整える:聞こえないほど低い音を切り、高い所を少し持ち上げて抜けを良くする
  const rumble = ctx.createBiquadFilter();
  rumble.type = 'highpass';
  rumble.frequency.value = 30;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 9000;
  air.gain.value = 2;
  const mud = ctx.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 300;
  mud.Q.value = 0.8;
  mud.gain.value = -1.5;
  const eqOut = master.connect(rumble).connect(mud).connect(air);
  if (opts.dynamics === false) eqOut.connect(destination);
  else eqOut.connect(comp).connect(limiter).connect(destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulseResponse(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.5;
  // 響きの低い所は濁るので削る
  const reverbCut = ctx.createBiquadFilter();
  reverbCut.type = 'highpass';
  reverbCut.frequency.value = 280;
  reverb.connect(reverbCut).connect(reverbReturn).connect(master);

  const room = ctx.createConvolver();
  room.buffer = roomResponse(ctx);
  const roomReturn = ctx.createGain();
  roomReturn.gain.value = 0.7;
  const roomCut = ctx.createBiquadFilter();
  roomCut.type = 'highpass';
  roomCut.frequency.value = 180;
  room.connect(roomCut).connect(roomReturn).connect(master);

  // 山びこ(ディレイ):付点8分で左右に跳ね返る
  const beat = 60 / song.tempo;
  const delayIn = ctx.createGain();
  const delayL = ctx.createDelay(2);
  const delayR = ctx.createDelay(2);
  delayL.delayTime.value = beat * 0.75;
  delayR.delayTime.value = beat * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 4500;
  const panL = ctx.createStereoPanner();
  panL.pan.value = -0.7;
  const panR = ctx.createStereoPanner();
  panR.pan.value = 0.7;
  delayIn.connect(delayL);
  delayL.connect(panL).connect(master);
  delayL.connect(delayR);
  delayR.connect(panR).connect(master);
  delayR.connect(damp).connect(feedback).connect(delayL);

  /** @type {MixBus['tracks']} */
  const tracks = new Map();
  for (const t of song.tracks) {
    const role = ROLE_MIX[t.role] ?? ROLE_MIX.other;
    const duck = ctx.createGain();
    const gain = ctx.createGain();
    gain.gain.value = trackGain(song, t.id);
    const pan = ctx.createStereoPanner();
    pan.pan.value = t.pan ?? role.pan;
    /** @type {AudioNode} */
    let tail = duck;
    if (role.lowCut > 0) {
      const cut = ctx.createBiquadFilter();
      cut.type = 'highpass';
      cut.frequency.value = role.lowCut;
      tail = tail.connect(cut);
    }
    if (role.eq) {
      const eq = ctx.createBiquadFilter();
      eq.type = 'peaking';
      eq.frequency.value = role.eq.freq;
      eq.Q.value = 0.9;
      eq.gain.value = role.eq.gain;
      tail = tail.connect(eq);
    }
    tail.connect(gain).connect(pan).connect(master);
    if (role.room > 0) {
      const send = ctx.createGain();
      send.gain.value = role.room;
      pan.connect(send).connect(room);
    }
    // 長い残響への送りは、あとから量を変えられるよう、いつも作っておく
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = t.reverb ?? role.reverb;
    pan.connect(reverbSend).connect(reverb);
    if (role.delay > 0) {
      const send = ctx.createGain();
      send.gain.value = role.delay;
      pan.connect(send).connect(delayIn);
    }
    tracks.set(t.id, {
      gain, duck, pan, reverbSend,
      voice: withVoices ? cachedVoice(t.instrument, ctx, duck) : { play() {} },
      instrument: t.instrument,
      sidechain: !!t.sidechain,
      isDrums: t.role === 'drums',
      extra: new Map(),
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
  let voice = track.voice;
  if (note.instrument && note.instrument !== track.instrument) {
    let extra = track.extra.get(note.instrument);
    if (!extra) track.extra.set(note.instrument, (extra = cachedVoice(note.instrument, mix.ctx, track.duck)));
    voice = extra;
  }
  voice.play(note);
  if (track.isDrums && KICKS.has(note.pitch)) {
    for (const t of mix.tracks.values()) {
      if (!t.sidechain) continue;
      const g = t.duck.gain;
      g.cancelScheduledValues(note.time);
      g.setValueAtTime(DUCK.depth, note.time);
      g.setTargetAtTime(1, note.time + DUCK.hold, DUCK.recover);
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
    const role = ROLE_MIX[t.role] ?? ROLE_MIX.other;
    entry.gain.gain.setTargetAtTime(trackGain(song, t.id), ctx.currentTime, 0.02);
    entry.pan.pan.setTargetAtTime(t.pan ?? role.pan, ctx.currentTime, 0.02);
    entry.reverbSend.gain.setTargetAtTime(t.reverb ?? role.reverb, ctx.currentTime, 0.05);
    if (entry.instrument !== t.instrument) {
      entry.voice = cachedVoice(t.instrument, ctx, entry.duck);
      entry.instrument = t.instrument;
    }
  }
}
