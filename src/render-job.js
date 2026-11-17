// サーバーでの音声の書き出し用のページ(/render)。Browser Rendering のヘッドレス Chrome が開く。
// 曲データは、ページが開く前に window.__renderJob として渡される。画面の書き出しと同じ処理で WAV を作り、
// 8MBずつ /render/part/<token>/<番号> に送り、終わったら /render/done/<token> に結果(または失敗)を書く。
// Worker が待っていなくても、あとから受け取れる。待っている時のために window.__renderDone も立てる。
import { renderSongToWav } from './audio/offline.js';

const PART = 8 * 1024 * 1024;

export async function runRenderJob() {
  /** @type {any} */
  const w = window;
  const job = w.__renderJob;
  document.body.textContent = '音声を作っています…';
  try {
    const t0 = performance.now(); // ページを開いてからここまで(ミリ秒)
    const bytes = await renderSongToWav(job.song, { itemIds: job.itemIds ?? undefined });
    const t1 = performance.now();
    const parts = Math.ceil(bytes.length / PART);
    // 分けた部分は、同時に送る
    await Promise.all(Array.from({ length: parts }, async (_, i) => {
      const res = await fetch(`/render/part/${job.token}/${i}`, { method: 'PUT', body: bytes.subarray(i * PART, (i + 1) * PART) });
      if (!res.ok) throw new Error(`送れませんでした(${res.status})`);
    }));
    const t2 = performance.now();
    // 44バイトのヘッダのあとが音。2チャンネル・16ビット
    const sampleRate = new DataView(bytes.buffer).getUint32(24, true);
    const result = { parts, bytes: bytes.length, seconds: Math.round(((bytes.length - 44) / 4 / sampleRate) * 10) / 10, loadMs: Math.round(t0), renderMs: Math.round(t1 - t0), uploadMs: Math.round(t2 - t1) };
    await finish(job.token, { ...result, fileName: job.fileName });
    w.__renderResult = result;
    document.body.textContent = '書き出しました';
  } catch (e) {
    w.__renderError = e instanceof Error ? e.message : String(e);
    await finish(job.token, { error: w.__renderError }).catch(() => {});
  }
  w.__renderDone = true;
}

/**
 * 結果(できたファイルの情報、または失敗)をサーバーに書く
 * @param {string} token
 * @param {Record<string, unknown>} body
 */
async function finish(token, body) {
  const res = await fetch(`/render/done/${token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`結果を送れませんでした(${res.status})`);
}
