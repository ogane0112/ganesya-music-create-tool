// MCP の OAuth 2.1(認可コード+PKCE、クライアントの自動登録)。
// Claude などがコネクタとして接続する時の流れ:
//   1. /mcp に許可証なしで来る → 401 と「ここで許可を取って」という案内(resource_metadata)を返す
//   2. 相手が /.well-known/... を読み、/oauth/register で自分を登録する
//   3. 利用者のブラウザで /oauth/authorize が開く。本人確認をして「許可する」を押す
//   4. 相手が /oauth/token で認可コードを許可証(アクセストークン)に替える
//   5. 以後は Authorization: Bearer <許可証> で /mcp を呼ぶ。切れたら更新用の許可証で取り直す
// 本人確認はアプリのログイン(パスキー)を使う。ログインしていなければ、先にログイン画面へ送る。

import { nowSeconds, randomToken, sha256 } from './b64.js';

/** @typedef {import('./oauth-store.js').OAuthStore} OAuthStore */

const ACCESS_TTL = 60 * 60; // 許可証は1時間
const REFRESH_TTL = 60 * 60 * 24 * 60; // 更新用は60日
const CODE_TTL = 60 * 5; // 認可コードは5分

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
/** @param {string} error @param {string} description @param {number} [status] */
const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);

const now = nowSeconds;
export { sha256 };

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** 戻り先として認めるURL(https か、手元のPC) @param {string} uri */
function validRedirect(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

/**
 * /mcp に許可証なしで来た相手への返事
 * @param {string} origin
 */
export function unauthorizedMcp(origin) {
  return new Response(JSON.stringify({ error: 'unauthorized', error_description: '許可証が必要です' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      ...CORS,
    },
  });
}

/**
 * 許可証から持ち主を調べる
 * @param {Request} request
 * @param {OAuthStore} store
 * @returns {Promise<string | null>}
 */
export async function ownerFromBearer(request, store) {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const row = await store.getToken(await sha256(token), 'access');
  return row && row.expiresAt > now() ? row.ownerId : null;
}

/**
 * @param {OAuthStore} store
 * @param {string} clientId
 * @param {string} ownerId
 */
async function issueTokens(store, clientId, ownerId) {
  const access = randomToken();
  const refresh = randomToken();
  await store.addToken({ tokenHash: await sha256(access), kind: 'access', clientId, ownerId, expiresAt: now() + ACCESS_TTL });
  await store.addToken({ tokenHash: await sha256(refresh), kind: 'refresh', clientId, ownerId, expiresAt: now() + REFRESH_TTL });
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: 'songs' });
}

/**
 * 許可の画面
 * @param {{ clientName: string, redirectHost: string, params: Record<string, string>, error?: string }} o
 */
function authorizePage(o) {
  const hidden = Object.entries(o.params).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return new Response(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>接続の許可 - がねしゃ作曲ツール</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f4f3ef;color:#1c1c1f;padding:16px;box-sizing:border-box}
main{background:#fff;border:1px solid #dedcd4;border-radius:18px;padding:24px;max-width:440px;width:100%;box-sizing:border-box}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 12px;line-height:1.6}ul{margin:0 0 16px;padding-left:1.3em;line-height:1.7}
label{display:grid;gap:6px;font-weight:700;margin-bottom:16px}
input[type=password]{font:inherit;min-height:48px;border-radius:12px;border:1px solid #dedcd4;padding:0 12px;background:inherit;color:inherit}
.row{display:flex;gap:10px}button{font:inherit;min-height:52px;border-radius:12px;border:1px solid #dedcd4;background:transparent;color:inherit;padding:0 18px;cursor:pointer;flex:1}
button.primary{background:#4257d6;border-color:#4257d6;color:#fff;font-weight:700;flex:2}
.error{color:#b3261e;font-weight:700}.muted{color:#696970;font-size:.9rem}
@media(prefers-color-scheme:dark){body{background:#121214;color:#f1f1f3}main{background:#1d1d21;border-color:#35353c}input[type=password],button{border-color:#35353c}button.primary{background:#8fa0ff;border-color:#8fa0ff;color:#10121c}.error{color:#ff8a80}.muted{color:#a3a3ab}}
</style></head><body><main>
<h1>「${esc(o.clientName)}」をつなぎますか?</h1>
<p>許可すると、このAIは次のことができるようになります。</p>
<ul><li>あなたの曲の一覧と中身を読む</li><li>曲を新しく作る、書き換える</li></ul>
<p class="muted">曲の削除はできません。許可のあと ${esc(o.redirectHost)} に戻ります。</p>
${o.error ? `<p class="error" role="alert">${esc(o.error)}</p>` : ''}
<form method="post" action="/oauth/authorize">${hidden}
<div class="row"><button type="submit" name="decision" value="deny" formnovalidate>やめる</button><button class="primary" type="submit" name="decision" value="allow">許可する</button></div>
</form></main></body></html>`, {
    status: o.error ? 401 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action *; frame-ancestors 'none'", 'referrer-policy': 'same-origin' },
  });
}

const AUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

/**
 * OAuth の入口をまとめて受ける。該当しない道なら null
 * @param {Request} request
 * @param {URL} url
 * @param {OAuthStore} store
 * @param {{ ownerId: string | null, sameSite: boolean }} auth ownerId はログイン中の人。sameSite はこのサイトの画面からの操作か
 * @returns {Promise<Response | null>}
 */
export async function handleOAuth(request, url, store, auth) {
  const origin = url.origin;
  const path = url.pathname;
  if (request.method === 'OPTIONS' && (path.startsWith('/oauth/') || path.startsWith('/.well-known/') || path === '/mcp')) {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
    return json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: ['songs'] });
  }
  if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp') {
    return json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['songs'],
    });
  }

  if (path === '/oauth/register' && request.method === 'POST') {
    /** @type {any} */
    let body;
    try {
      body = await request.json();
    } catch {
      return oauthError('invalid_client_metadata', 'JSONを読めません');
    }
    const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((/** @type {unknown} */ u) => typeof u === 'string') : [];
    if (uris.length === 0 || uris.length > 10 || !uris.every(validRedirect)) return oauthError('invalid_redirect_uri', 'redirect_uris は https のURL(または手元のPC)にしてください');
    const client = { clientId: randomToken(), clientName: String(body.client_name ?? 'AIアプリ').slice(0, 80), redirectUris: uris };
    await store.addClient(client);
    return json({
      client_id: client.clientId, client_name: client.clientName, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }, 201);
  }

  if (path === '/oauth/authorize' && (request.method === 'GET' || request.method === 'POST')) {
    /** @type {Record<string, string>} */
    const p = {};
    /** @type {Record<string, string>} */
    let form = {};
    if (request.method === 'POST') {
      form = Object.fromEntries([...(await request.formData())].map(([k, v]) => [k, String(v)]));
      for (const k of AUTH_PARAMS) if (form[k] !== undefined) p[k] = form[k];
    } else {
      for (const k of AUTH_PARAMS) {
        const v = url.searchParams.get(k);
        if (v !== null) p[k] = v;
      }
    }
    // 相手と戻り先が確かめられるまでは、戻り先へ飛ばさず、ここで失敗を見せる
    const client = p.client_id ? await store.getClient(p.client_id) : null;
    if (!client) return new Response('接続しようとしているアプリが登録されていません。AI側でコネクタを追加し直してください。', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri)) return new Response('戻り先のURLが登録と違います。AI側でコネクタを追加し直してください。', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    /** @param {Record<string, string>} q */
    const back = (q) => {
      const u = new URL(p.redirect_uri);
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
      if (p.state) u.searchParams.set('state', p.state);
      return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store' } });
    };
    if (p.response_type !== 'code') return back({ error: 'unsupported_response_type' });
    if (!p.code_challenge || (p.code_challenge_method ?? 'S256') !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE (S256) が必要です' });

    // ログインしていなければ、アプリのログイン画面へ。ログインできたらここへ戻ってくる
    const ownerId = auth.ownerId;
    if (!ownerId) {
      const next = `/oauth/authorize?${new URLSearchParams(p)}`;
      return new Response(null, { status: 302, headers: { location: `/?next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' } });
    }
    const page = { clientName: client.clientName, redirectHost: new URL(p.redirect_uri).host, params: p };
    if (request.method === 'GET') return authorizePage(page);
    // 「許可する」は、このサイトの許可画面で押されたものだけを受ける(よそのページからの送信を断る)
    if (!auth.sameSite) return authorizePage({ ...page, error: '許可の画面からもう一度操作してください' });
    if (form.decision !== 'allow') return back({ error: 'access_denied' });
    const code = randomToken();
    await store.addCode({ codeHash: await sha256(code), clientId: client.clientId, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, ownerId, expiresAt: now() + CODE_TTL });
    return back({ code });
  }

  if (path === '/oauth/token' && request.method === 'POST') {
    /** @type {Record<string, string>} */
    let f;
    try {
      f = Object.fromEntries([...(await request.formData())].map(([k, v]) => [k, String(v)]));
    } catch {
      return oauthError('invalid_request', 'フォームの形で送ってください');
    }
    if (f.grant_type === 'authorization_code') {
      const row = f.code ? await store.takeCode(await sha256(f.code)) : null;
      if (!row || row.expiresAt < now()) return oauthError('invalid_grant', '認可コードが無効か、期限切れです');
      if (row.clientId !== f.client_id || row.redirectUri !== f.redirect_uri) return oauthError('invalid_grant', '認可コードを受け取った相手と違います');
      if (!f.code_verifier || (await sha256(f.code_verifier)) !== row.codeChallenge) return oauthError('invalid_grant', 'PKCE の確認に失敗しました');
      return issueTokens(store, row.clientId, row.ownerId);
    }
    if (f.grant_type === 'refresh_token') {
      const hash = f.refresh_token ? await sha256(f.refresh_token) : '';
      const row = hash ? await store.getToken(hash, 'refresh') : null;
      if (!row || row.expiresAt < now() || (f.client_id && f.client_id !== row.clientId)) return oauthError('invalid_grant', '更新用の許可証が無効か、期限切れです');
      await store.removeToken(hash); // 1回使ったら新しいものに替える
      return issueTokens(store, row.clientId, row.ownerId);
    }
    return oauthError('unsupported_grant_type', 'authorization_code か refresh_token を指定してください');
  }

  return null;
}
