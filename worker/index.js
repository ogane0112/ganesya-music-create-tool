// Cloudflare Worker の入口。画面のファイル、保存用API(/api)、MCP(/mcp)を配る。
//
// 本人確認:
// - MCP(/mcp)は OAuth。Claude のコネクタに https://…/mcp を登録すると、許可の画面が開く(worker/oauth.js)
// - 保存用API(/api)と、OAuth の許可画面での本人確認は、いまは仮の合言葉(Worker の秘密の値 ACCESS_KEY)。
//   パスキーのログイン(E2)ができたら置き換える。
import { handleApi, json } from './api.js';
import { HttpError, songStore } from './db.js';
import { ASSETS } from './generated-assets.js';
import { handleMcp } from './mcp.js';
import { handleOAuth, ownerFromBearer, unauthorizedMcp } from './oauth.js';
import { oauthStore } from './oauth-store.js';

/** いまは持ち主は1人 */
const OWNER = 'owner';

/** @param {string} b64 */
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 長さから中身が漏れないよう、ハッシュ同士を同じ手間で比べる
 * @param {string} a
 * @param {string} b
 */
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

const unauthorized = () => new HttpError(401, { code: 'unauthorized', message: 'ログインしていません', hint: '合言葉を入れてください' });

/** @param {string} path */
function serveAsset(path) {
  /** @type {Record<string, { type: string, body: string, base64: boolean }>} */
  const assets = ASSETS;
  // 知らない道は画面(index.html)を返す(画面の切り替えは画面側で行う)
  const file = assets[path === '/' ? '/index.html' : path] ?? assets['/index.html'];
  return new Response(file.base64 ? fromBase64(file.body) : file.body, {
    headers: {
      'content-type': file.type,
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {{ DB: any, ACCESS_KEY?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        const given = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
        if (!env.ACCESS_KEY || !(await sameSecret(given, env.ACCESS_KEY))) throw unauthorized();
        return await handleApi(request, url.pathname.slice(5), songStore(env.DB, OWNER));
      }
      const oauth = oauthStore(env.DB);
      const handled = await handleOAuth(request, url, oauth, async (key) => (env.ACCESS_KEY && (await sameSecret(key, env.ACCESS_KEY)) ? OWNER : null));
      if (handled) return handled;
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
        // URL に合言葉を入れる以前の方式は廃止した。許可証(OAuth)だけを受け付ける
        const owner = url.pathname === '/mcp' ? await ownerFromBearer(request, oauth) : null;
        if (!owner) return unauthorizedMcp(url.origin);
        return await handleMcp(request, { store: songStore(env.DB, owner) });
      }
      if (url.pathname.startsWith('/.well-known/')) return new Response(null, { status: 404 });
      return serveAsset(url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return json(e.error, e.status);
      console.error(e);
      return json({ code: 'server_error', message: 'サーバーで問題が起きました', hint: '少し待ってからもう一度試してください' }, 500);
    }
  },
};
