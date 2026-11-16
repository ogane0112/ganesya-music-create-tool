// 楽器の登録簿。録音した音源などに差し替える時は、同じ id で register し直す。
// 生の楽器(ピアノ・ギター・ベース・ストリングス・ベル・ドラム)は録音した音、シンセ類は合成の音で鳴らす。
import { sampledInstrument } from './sampled.js';
import { SYNTH_INSTRUMENTS } from './synth.js';

/** 録音した音で鳴らす楽器と、その音量・消え方 */
const SAMPLED = /** @type {Record<string, import('./sampled.js').SampleOptions>} */ ({
  piano: { gain: 0.6, release: 0.45 },
  'electric-piano': { gain: 0.42, release: 0.25 },
  koto: { gain: 0.7, release: 0.3 },
  'acoustic-guitar': { gain: 0.6, release: 0.2 },
  'electric-guitar-clean': { gain: 0.65, release: 0.2 },
  'electric-guitar-distortion': { gain: 0.3, release: 0.12 },
  bass: { gain: 0.55, release: 0.1 },
  strings: { gain: 0.36, release: 0.45 },
  bell: { gain: 0.42, release: 0.6 },
  drums: { gain: 0.7, release: 0, exact: true },
});

/** @typedef {import('./synth.js').Instrument} Instrument */
/** @typedef {import('./synth.js').InstrumentVoice} InstrumentVoice */
/** @typedef {import('./synth.js').NoteEvent} NoteEvent */

/** @type {Map<string, Instrument>} */
const registry = new Map(SYNTH_INSTRUMENTS.map((i) => [i.id, SAMPLED[i.id] ? sampledInstrument(i, SAMPLED[i.id]) : i]));

/** @param {Instrument} instrument */
export function registerInstrument(instrument) {
  registry.set(instrument.id, instrument);
}

/**
 * @param {string} id
 * @returns {Instrument}
 */
export function getInstrument(id) {
  return registry.get(id) ?? /** @type {Instrument} */ (registry.get('piano'));
}
