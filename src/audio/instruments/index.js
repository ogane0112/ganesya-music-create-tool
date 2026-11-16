// 楽器の登録簿。録音した音源などに差し替える時は、同じ id で register し直す。
import { SYNTH_INSTRUMENTS } from './synth.js';

/** @typedef {import('./synth.js').Instrument} Instrument */
/** @typedef {import('./synth.js').InstrumentVoice} InstrumentVoice */
/** @typedef {import('./synth.js').NoteEvent} NoteEvent */

/** @type {Map<string, Instrument>} */
const registry = new Map(SYNTH_INSTRUMENTS.map((i) => [i.id, i]));

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
