// Cloudflare Worker の入口。今は画面のファイルを配るだけ。保存用API・MCP・ログインは E1〜E4 でここに足す。
import { ASSETS } from './generated-assets.js';

/** @param {string} b64 */
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    /** @type {Record<string, { type: string, body: string, base64: boolean }>} */
    const assets = ASSETS;
    // 知らない道は画面(index.html)を返す(画面の切り替えは画面側で行う)
    const file = assets[path] ?? assets['/index.html'];
    const hashed = path.startsWith('/assets/');
    return new Response(file.base64 ? fromBase64(file.body) : file.body, {
      headers: {
        'content-type': file.type,
        'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
