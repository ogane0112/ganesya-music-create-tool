// 録音した楽器の音(サンプル)で鳴らす楽器。音源は FluidR3_GM(MITライセンス)から作った .pack ファイル
// (scripts/build-samples.py)。3半音おきに録ってあり、間の高さは再生の速さを変えて作る。
// 読み込めなかった時は、ブラウザ上で合成する仮の音(synth.js)に戻る。

/** @typedef {import('./synth.js').Instrument} Instrument */
/** @typedef {import('./synth.js').NoteEvent} NoteEvent */

/** 音源の置き場(版を変えたらここを変える。ブラウザに長く覚えさせるため) */
export const SOUNDS_BASE = '/sounds/v1';

/**
 * @typedef {object} SampleOptions
 * @property {number} gain 全体の音量
 * @property {number} release 音を止める時に消えていく速さ(秒)。0 なら最後まで鳴らす(ドラム)
 * @property {boolean} [exact] その高さの録音だけを使い、高さを変えない(ドラム)
 */

/** @type {WeakMap<Instrument, { pitch: number, buffer: AudioBuffer, offset: number }[]>} */
const loaded = new WeakMap();

/**
 * MP3 は頭に短い無音が付くことがあるので、音が始まる位置を探す(リズムが遅れないように)
 * @param {AudioBuffer} buffer
 */
function leadingSilence(buffer) {
  const d = buffer.getChannelData(0);
  const limit = Math.min(d.length, Math.floor(buffer.sampleRate * 0.2));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(d[i]) > 0.004) return Math.max(0, i / buffer.sampleRate - 0.002);
  }
  return 0;
}

/**
 * @param {string} url
 * @returns {Promise<{ pitch: number, buffer: AudioBuffer, offset: number }[]>}
 */
async function loadPack(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`音源を読み込めません: ${url} (${res.status})`);
  const bytes = await res.arrayBuffer();
  const headerLength = new DataView(bytes).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, headerLength)));
  const base = 4 + headerLength;
  const decoder = new OfflineAudioContext(1, 1, 44100);
  return Promise.all(header.notes.map(async (/** @type {{ pitch: number, offset: number, length: number }} */ n) => {
    const buffer = await decoder.decodeAudioData(bytes.slice(base + n.offset, base + n.offset + n.length));
    return { pitch: n.pitch, buffer, offset: leadingSilence(buffer) };
  }));
}

/**
 * @param {Instrument} fallback 読み込めない時・録音がない音に使う合成の楽器
 * @param {SampleOptions} o
 * @returns {Instrument}
 */
export function sampledInstrument(fallback, o) {
  /** @type {Promise<void> | null} */
  let loading = null;
  /** @type {Instrument} */
  const instrument = {
    id: fallback.id,
    load() {
      loading ??= loadPack(`${SOUNDS_BASE}/${fallback.id}.pack`).then(
        (samples) => {
          loaded.set(instrument, samples.sort((a, b) => a.pitch - b.pitch));
        },
        (e) => {
          console.warn(e);
          loading = null; // 次の機会にもう一度試す
        },
      );
      return loading;
    },
    setup(ctx, out) {
      const samples = loaded.get(instrument);
      const spare = fallback.setup(ctx, out);
      if (!samples) return spare;
      const bus = ctx.createGain();
      bus.gain.value = o.gain;
      bus.connect(out);
      return {
        play(note) {
          const s = o.exact
            ? samples.find((x) => x.pitch === note.pitch)
            : samples.reduce((best, x) => (Math.abs(x.pitch - note.pitch) < Math.abs(best.pitch - note.pitch) ? x : best));
          if (!s) return spare.play(note);
          const src = ctx.createBufferSource();
          src.buffer = s.buffer;
          src.playbackRate.value = Math.pow(2, (note.pitch - s.pitch) / 12);
          const g = ctx.createGain();
          g.gain.setValueAtTime(Math.pow(note.velocity / 127, 1.4), note.time);
          src.connect(g).connect(bus);
          src.start(note.time, s.offset);
          if (o.release > 0) {
            const end = note.time + Math.max(0.03, note.duration);
            g.gain.setTargetAtTime(0.0001, end, o.release / 3);
            src.stop(end + o.release * 2);
          }
        },
      };
    },
  };
  return instrument;
}
