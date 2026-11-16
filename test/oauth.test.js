import { describe, expect, it } from 'vitest';
import { handleOAuth, ownerFromBearer, sha256, unauthorizedMcp } from '../worker/oauth.js';

/** D1 の代わりのメモリ版 @returns {import('../worker/oauth-store.js').OAuthStore} */
function memoryStore() {
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  return {
    async addClient(c) { clients.set(c.clientId, c); },
    async getClient(id) { return clients.get(id) ?? null; },
    async addCode(r) { codes.set(r.codeHash, r); },
    async takeCode(h) { const r = codes.get(h) ?? null; codes.delete(h); return r; },
    async addToken(r) { tokens.set(r.tokenHash, r); },
    async getToken(h, kind) { const r = tokens.get(h); return r && r.kind === kind ? r : null; },
    async removeToken(h) { tokens.delete(h); },
  };
}

const ORIGIN = 'https://music.example';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function setup() {
  const store = memoryStore();
  /** @param {string} key */
  const verify = async (key) => (key === 'himitsu' ? 'owner' : null);
  /** @param {string} path @param {RequestInit} [init] */
  const call = async (path, init) => {
    const url = new URL(ORIGIN + path);
    const res = await handleOAuth(new Request(url, init), url, store, verify);
    if (!res) throw new Error('該当なし: ' + path);
    return res;
  };
  /** @param {Record<string, string>} f */
  const form = (f) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() });
  return { store, call, form };
}

/** PKCE の組 */
async function pkce() {
  const verifier = 'v'.repeat(50);
  return { verifier, challenge: await sha256(verifier) };
}

describe('OAuth', () => {
  it('案内(メタデータ)と、許可証なしの時の返事', async () => {
    const { call } = setup();
    const pr = /** @type {any} */ (await (await call('/.well-known/oauth-protected-resource')).json());
    expect(pr).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const as = /** @type {any} */ (await (await call('/.well-known/oauth-authorization-server')).json());
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    const un = unauthorizedMcp(ORIGIN);
    expect(un.status).toBe(401);
    expect(un.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  it('登録→許可→許可証→更新、の一連', async () => {
    const { store, call, form } = setup();
    const reg = await call('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) });
    expect(reg.status).toBe(201);
    const { client_id } = /** @type {any} */ (await reg.json());
    const { verifier, challenge } = await pkce();
    const q = { response_type: 'code', client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };

    // 許可の画面
    const page = await call('/oauth/authorize?' + new URLSearchParams(q));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('「Claude」をつなぎますか');
    expect(html).toContain('claude.ai');

    // 合言葉が違うと進めない
    const wrong = await call('/oauth/authorize', form({ ...q, decision: 'allow', access_key: 'chigau' }));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('合言葉が違う');

    // やめる
    const deny = await call('/oauth/authorize', form({ ...q, decision: 'deny' }));
    expect(new URL(deny.headers.get('location') ?? '').searchParams.get('error')).toBe('access_denied');

    // 許可する
    const allow = await call('/oauth/authorize', form({ ...q, decision: 'allow', access_key: 'himitsu' }));
    expect(allow.status).toBe(302);
    const loc = new URL(allow.headers.get('location') ?? '');
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('xyz');
    const code = loc.searchParams.get('code') ?? '';

    // PKCE が違うと断る(コードはそこで使えなくなる)
    const { call: call2, form: form2, store: s2 } = { call, form, store };
    void s2;
    const bad = await call2('/oauth/token', form2({ grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: 'x'.repeat(50) }));
    expect(bad.status).toBe(400);
    const again = await call('/oauth/token', form({ grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: verifier }));
    expect(again.status).toBe(400); // 1回しか使えない

    // もう一度許可して、正しく交換する
    const allow2 = await call('/oauth/authorize', form({ ...q, decision: 'allow', access_key: 'himitsu' }));
    const code2 = new URL(allow2.headers.get('location') ?? '').searchParams.get('code') ?? '';
    const tok = await call('/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id, redirect_uri: REDIRECT, code_verifier: verifier }));
    expect(tok.status).toBe(200);
    const t = /** @type {any} */ (await tok.json());
    expect(t.token_type).toBe('Bearer');

    // 許可証で持ち主が分かる。でたらめな許可証は通らない
    const req = (/** @type {string} */ token) => new Request(ORIGIN + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(await ownerFromBearer(req(t.access_token), store)).toBe('owner');
    expect(await ownerFromBearer(req('detarame'), store)).toBeNull();
    expect(await ownerFromBearer(req(t.refresh_token), store)).toBeNull(); // 更新用では呼べない
    expect(await ownerFromBearer(new Request(ORIGIN + '/mcp'), store)).toBeNull();

    // 更新:新しい許可証が出て、古い更新用は使えなくなる
    const ref = await call('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id }));
    const t2 = /** @type {any} */ (await ref.json());
    expect(await ownerFromBearer(req(t2.access_token), store)).toBe('owner');
    expect((await call('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id }))).status).toBe(400);
  });

  it('登録していない相手・違う戻り先・PKCEなしは進めない', async () => {
    const { call } = setup();
    const { challenge } = await pkce();
    expect((await call('/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: 'nai', redirect_uri: REDIRECT, code_challenge: challenge }))).status).toBe(400);
    const reg = await call('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) });
    const { client_id } = /** @type {any} */ (await reg.json());
    expect((await call('/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge }))).status).toBe(400);
    const noPkce = await call('/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id, redirect_uri: REDIRECT }));
    expect(new URL(noPkce.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_request');
    expect((await call('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) })).status).toBe(400);
  });
});
