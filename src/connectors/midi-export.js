// 接続口:MIDIファイルの書き出し
import { songToMidi } from './midi/encode.js';

/** @type {import('../core/types.js').ExportConnector} */
export const midiExport = {
  id: 'midi-export',
  name: 'MIDIファイル(他の作曲ソフト用)',
  kind: 'export',
  async isAvailable() {
    return { ok: true };
  },
  async run(song) {
    const { bytes, warnings } = songToMidi(song);
    return { ok: true, value: { name: `${song.meta.title}.mid`, type: 'audio/midi', bytes }, warnings };
  },
};
