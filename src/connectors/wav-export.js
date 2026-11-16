// 接続口:音声ファイル(WAV)の書き出し。ブラウザの中で音を作る
import { renderSongToWav } from '../audio/offline.js';

/** @type {import('../core/types.js').ExportConnector} */
export const wavExport = {
  id: 'wav-export',
  name: '音声ファイル(WAV)',
  kind: 'export',
  async isAvailable() {
    return typeof OfflineAudioContext === 'undefined' ? { ok: false, reason: 'このブラウザでは音声ファイルを作れません' } : { ok: true };
  },
  async run(song) {
    try {
      const bytes = await renderSongToWav(song);
      return { ok: true, value: { name: `${song.meta.title}.wav`, type: 'audio/wav', bytes }, warnings: [] };
    } catch {
      return { ok: false, error: { code: 'export_failed', message: '音声ファイルを作れませんでした', hint: 'もう一度試してください。続く場合はページを読み込み直してください' } };
    }
  },
};
