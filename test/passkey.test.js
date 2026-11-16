import { describe, expect, it } from 'vitest';
import { handleAuth, sessionOwner } from '../worker/auth.js';
import { base64url, fromBase64url } from '../worker/b64.js';
import { derToRaw } from '../worker/passkey.js';

const ORIGIN = 'https://music.example';

/** D1 の代わりのメモリ版 @returns {import('../worker/auth-store.js').AuthStore} */
function memoryStore() {
  const challenges = new Map();
  /** @type {Map<string, import('../worker/auth-store.js').Passkey>} */
  const passkeys = new Map();
  const sessions = new Map();
  return {
    async addChallenge(r) { challenges.set(r.id, r); },
    async takeChallenge(id) { const r = challenges.get(id) ?? null; challenges.delete(id); return r; },
    async addPasskey(p) { passkeys.set(p.id, p); },
    async getPasskey(id) { return passkeys.get(id) ?? null; },
    async listPasskeys(owner) { return [...passkeys.values()].filter((p) => p.ownerId === owner); },
    async setSignCount(id, n) { const p = passkeys.get(id); if (p) p.signCount = n; },
    async removePasskey(id) { passkeys.delete(id); },
    async addSession(r) { sessions.set(r.tokenHash, r); },
    async getSession(h) { return sessions.get(h) ?? null; },
    async removeSession(h) { sessions.delete(h); },
  };
}

/** r と s を並べた署名を、認証器が出す ASN.1(DER)の形にする @param {Uint8Array} raw */
function rawToDer(raw) {
  /** @param {Uint8Array} x */
  const int = (x) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    let v = [...x.subarray(i)];
    if (v[0] & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

/** テスト用の認証器(パスキーを持つ端末の代わり) */
async function authenticator(rpId = 'music.example') {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']));
  const id = base64url(crypto.getRandomValues(new Uint8Array(16)));
  let count = 0;
  const authData = async () => {
    const d = new Uint8Array(37);
    d.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))));
    d[32] = 0x05;
    new DataView(d.buffer).setUint32(33, ++count);
    return d;
  };
  /** @param {string} type @param {string} challenge @param {string} [origin] */
  const clientData = (type, challenge, origin = ORIGIN) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
  return {
    id,
    /** @param {string} challenge @param {string} [origin] */
    async create(challenge, origin) {
      return {
        id, alg: -7, publicKey: base64url(await crypto.subtle.exportKey('spki', pair.publicKey)),
        authenticatorData: base64url(await authData()), clientDataJSON: base64url(clientData('webauthn.create', challenge, origin)),
      };
    },
    /** @param {string} challenge @param {string} [origin] */
    async get(challenge, origin) {
      const ad = await authData();
      const cd = clientData('webauthn.get', challenge, origin);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', cd));
      const signed = new Uint8Array([...ad, ...hash]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed));
      return { id, authenticatorData: base64url(ad), clientDataJSON: base64url(cd), signature: base64url(rawToDer(raw)) };
    },
  };
}

function setup() {
  const store = memoryStore();
  let cookie = '';
  /** @param {string} path @param {any} [payload] @param {{ method?: string, origin?: string | null }} [o] */
  const call = async (path, payload, o = {}) => {
    const method = o.method ?? (payload === undefined ? 'GET' : 'POST');
    const url = new URL(`${ORIGIN}/api/auth/${path}`);
    /** @type {Record<string, string>} */
    const headers = { cookie };
    if (method !== 'GET' && o.origin !== null) headers.origin = o.origin ?? ORIGIN;
    const req = new Request(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    try {
      const res = await handleAuth(req, url, path, store, { defaultOwner: 'owner', checkSetupKey: async (k) => k === 'aikotoba' });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: /** @type {any} */ (res.status === 204 ? null : await res.json()) };
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (!err.error) throw e;
      return { status: err.status, data: err.error };
    }
  };
  const owner = () => sessionOwner(new Request(ORIGIN, { headers: { cookie } }), store);
  return { store, call, owner, clearCookie: () => { cookie = ''; } };
}

describe('パスキー', () => {
  it('署名の形の変換(DER → r と s)', () => {
    const raw = new Uint8Array(64).map((_, i) => (i * 37 + 200) % 256);
    raw[0] = 0x00; raw[1] = 0x01; // 先頭が0の時
    raw[32] = 0xff; // 先頭のビットが立っている時(DERでは0が足される)
    expect([...derToRaw(rawToDer(raw))]).toEqual([...raw]);
    expect(() => derToRaw(fromBase64url('AAAA'))).toThrow();
  });

  it('登録 → ログアウト → ログイン', async () => {
    const { call, owner, clearCookie } = setup();
    const device = await authenticator();
    expect((await call('me')).data).toEqual({ loggedIn: false });

    // 登録用の合言葉が違うと始められない
    expect((await call('register/start', { setupKey: 'chigau' })).status).toBe(401);

    const start = await call('register/start', { setupKey: 'aikotoba' });
    expect(start.data.publicKey.rp.id).toBe('music.example');
    expect(start.data.publicKey.authenticatorSelection.residentKey).toBe('required');
    const fin = await call('register/finish', { challengeId: start.data.challengeId, name: 'iPad', ...(await device.create(start.data.publicKey.challenge)) });
    expect(fin.status).toBe(200);
    expect(await owner()).toBe('owner'); // 登録したらそのままログイン中
    expect((await call('passkeys')).data.map((/** @type {any} */ p) => p.name)).toEqual(['iPad']);

    expect((await call('logout', {})).status).toBe(200);
    clearCookie();
    expect(await owner()).toBeNull();

    const ls = await call('login/start', {});
    const lf = await call('login/finish', { challengeId: ls.data.challengeId, ...(await device.get(ls.data.publicKey.challenge)) });
    expect(lf.status).toBe(200);
    expect(await owner()).toBe('owner');
    expect((await call('me')).data).toEqual({ loggedIn: true });

    // ログイン中なら、合言葉なしでパスキーを追加できる。最後の1つは消せない
    const second = await authenticator();
    const s2 = await call('register/start', {});
    expect(s2.data.publicKey.excludeCredentials).toEqual([{ type: 'public-key', id: device.id }]);
    expect((await call('register/finish', { challengeId: s2.data.challengeId, name: 'PC', ...(await second.create(s2.data.publicKey.challenge)) })).status).toBe(200);
    expect((await call(`passkeys/${second.id}`, undefined, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`passkeys/${device.id}`, undefined, { method: 'DELETE' })).status).toBe(400);
  });

  it('通さないもの:別の鍵の署名、使い回し、よそのサイト向け、未登録、よそのページからの操作', async () => {
    const { call, owner, clearCookie } = setup();
    const device = await authenticator();
    const start = await call('register/start', { setupKey: 'aikotoba' });
    await call('register/finish', { challengeId: start.data.challengeId, ...(await device.create(start.data.publicKey.challenge)) });
    await call('logout', {});
    clearCookie();

    // 登録したIDを名乗るが、鍵が違う
    const thief = await authenticator();
    let ls = await call('login/start', {});
    const forged = await thief.get(ls.data.publicKey.challenge);
    expect((await call('login/finish', { challengeId: ls.data.challengeId, ...forged, id: device.id })).status).toBe(401);

    // 同じ問いかけは2回使えない
    ls = await call('login/start', {});
    const ok = await device.get(ls.data.publicKey.challenge);
    expect((await call('login/finish', { challengeId: ls.data.challengeId, ...ok })).status).toBe(200);
    await call('logout', {});
    clearCookie();
    expect((await call('login/finish', { challengeId: ls.data.challengeId, ...ok })).status).toBe(400);

    // よそのサイト(偽サイト)で作らせた署名
    ls = await call('login/start', {});
    expect((await call('login/finish', { challengeId: ls.data.challengeId, ...(await device.get(ls.data.publicKey.challenge, 'https://evil.example')) })).status).toBe(401);

    // 別のサイト用のパスキー
    const other = await authenticator('other.example');
    const rs = await call('register/start', { setupKey: 'aikotoba' });
    expect((await call('register/finish', { challengeId: rs.data.challengeId, ...(await other.create(rs.data.publicKey.challenge)) })).status).toBe(401);

    // 登録していないパスキー
    ls = await call('login/start', {});
    expect((await call('login/finish', { challengeId: ls.data.challengeId, ...(await thief.get(ls.data.publicKey.challenge)) })).status).toBe(401);

    // よそのページからの操作(Origin が違う・ない)
    expect((await call('login/start', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('login/start', {}, { origin: null })).status).toBe(403);
    expect(await owner()).toBeNull();
  });
});
