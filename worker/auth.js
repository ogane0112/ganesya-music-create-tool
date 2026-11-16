// アプリのログイン(パスキー)。外部設計の /api/auth/* を受ける。
//   POST register/start・finish  パスキーの登録
//   POST login/start・finish     パスキーでログイン
//   POST logout                  ログアウト
//   GET  me                      ログイン中かどうか
//   GET  passkeys / DELETE passkeys/:id   登録済みのパスキーの一覧と削除(設定画面用)
//
// 登録できるのは、(1) ログイン中の人(パスキーの追加)、(2) 登録用の合言葉を知っている人(初めての端末)。
// 設計では (2) は「Cloudflare Access の内側からだけ」。Access(E5)を入れたら合言葉を外す。
import { base64url, fromBase64url, nowSeconds, randomToken, sha256 } from './b64.js';
import { HttpError } from './db.js';
import { ALGORITHMS, checkAuthenticatorData, checkClientData, importPublicKey, PasskeyError, verifySignature } from './passkey.js';

/** @typedef {import('./auth-store.js').AuthStore} AuthStore */

const SESSION_COOKIE = 'gm_session';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30日
const CHALLENGE_TTL = 60 * 5;
const MAX_PASSKEYS = 10;

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

/** @param {string} message @param {string} hint @param {number} [status] @param {string} [code] */
const fail = (message, hint, status = 400, code = 'auth_failed') => new HttpError(status, { code, message, hint });

/** @param {Request} request */
function readCookie(request) {
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(request.headers.get('cookie') ?? '');
  return m ? m[1] : null;
}

/**
 * ログイン中の人(いなければ null)
 * @param {Request} request
 * @param {AuthStore} store
 */
export async function sessionOwner(request, store) {
  const token = readCookie(request);
  if (!token) return null;
  const s = await store.getSession(await sha256(token));
  return s && s.expiresAt > nowSeconds() ? s.ownerId : null;
}

/**
 * このサイトからの操作だと認める出どころ。手元(localhost)では画面と Worker のポートが違ってもよい
 * @param {Request} request
 * @param {URL} url
 * @returns {string | null}
 */
export function trustedOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    const o = new URL(origin);
    if (o.origin === url.origin) return o.origin;
    if (o.hostname === 'localhost' && url.hostname === 'localhost') return o.origin;
  } catch {
    // 下で null
  }
  return null;
}

/** @param {URL} url @param {string} value @param {number} maxAge */
function cookie(url, value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
}

/** @param {Request} request */
async function body(request) {
  try {
    return /** @type {any} */ (await request.json());
  } catch {
    throw fail('送られたデータを読めません', 'もう一度試してください');
  }
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {string} path /api/auth/ より後ろ
 * @param {AuthStore} store
 * @param {{ defaultOwner: string, checkSetupKey: (key: string) => Promise<boolean> }} opts
 */
export async function handleAuth(request, url, path, store, opts) {
  const method = request.method;
  const owner = await sessionOwner(request, store);
  const rpId = url.hostname;

  if (path === 'me' && method === 'GET') return json({ loggedIn: !!owner });

  // ここから下は状態を変えるので、このサイトの画面からの操作だけを受ける
  const origin = trustedOrigin(request, url) ?? '';
  if (method !== 'GET' && !origin) throw fail('このサイトの画面から操作してください', 'ページを開き直してください', 403, 'forbidden');

  try {
    if (path === 'register/start' && method === 'POST') {
      const b = await body(request);
      // ログイン中ならそのまま追加できる。そうでなければ登録用の合言葉が要る
      const ownerId = owner ?? ((await opts.checkSetupKey(String(b.setupKey ?? ''))) ? opts.defaultOwner : null);
      if (!ownerId) throw fail('登録用の合言葉が違います', '合言葉を確かめて、もう一度入れてください', 401, 'unauthorized');
      const existing = await store.listPasskeys(ownerId);
      if (existing.length >= MAX_PASSKEYS) throw fail(`パスキーは${MAX_PASSKEYS}個まで登録できます`, '使っていないパスキーを削除してください');
      const challenge = randomToken();
      const challengeId = randomToken();
      await store.addChallenge({ id: challengeId, challenge, kind: 'register', ownerId, expiresAt: nowSeconds() + CHALLENGE_TTL });
      return json({
        challengeId,
        publicKey: {
          challenge,
          rp: { id: rpId, name: 'がねしゃ作曲ツール' },
          user: { id: base64url(new TextEncoder().encode(ownerId)), name: 'がねしゃ作曲ツール', displayName: 'がねしゃ作曲ツール' },
          pubKeyCredParams: Object.keys(ALGORITHMS).map((alg) => ({ type: 'public-key', alg: Number(alg) })),
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
          attestation: 'none',
          excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.id })),
          timeout: 120000,
        },
      });
    }

    if (path === 'register/finish' && method === 'POST') {
      const b = await body(request);
      const ch = await store.takeChallenge(String(b.challengeId ?? ''));
      if (!ch || ch.kind !== 'register' || !ch.ownerId || ch.expiresAt < nowSeconds()) throw fail('登録の手続きが期限切れです', 'もう一度はじめからやり直してください');
      checkClientData(fromBase64url(String(b.clientDataJSON ?? '')), { type: 'webauthn.create', challenge: ch.challenge, origins: [origin] });
      const { signCount } = await checkAuthenticatorData(fromBase64url(String(b.authenticatorData ?? '')), rpId);
      const alg = Number(b.alg);
      await importPublicKey(String(b.publicKey ?? ''), alg);
      const id = String(b.id ?? '');
      if (!id || id.length > 1400) throw fail('パスキーのIDが正しくありません', 'もう一度試してください');
      if (await store.getPasskey(id)) throw fail('このパスキーは登録済みです', 'そのままログインできます');
      await store.addPasskey({
        id, ownerId: ch.ownerId, publicKey: String(b.publicKey), alg, signCount,
        name: String(b.name ?? '').slice(0, 60) || 'パスキー', createdAt: new Date().toISOString(),
      });
      // 登録できたらそのままログイン状態にする
      return login(url, store, ch.ownerId);
    }

    if (path === 'login/start' && method === 'POST') {
      const challenge = randomToken();
      const challengeId = randomToken();
      await store.addChallenge({ id: challengeId, challenge, kind: 'login', ownerId: null, expiresAt: nowSeconds() + CHALLENGE_TTL });
      return json({ challengeId, publicKey: { challenge, rpId, userVerification: 'preferred', timeout: 120000 } });
    }

    if (path === 'login/finish' && method === 'POST') {
      const b = await body(request);
      const ch = await store.takeChallenge(String(b.challengeId ?? ''));
      if (!ch || ch.kind !== 'login' || ch.expiresAt < nowSeconds()) throw fail('ログインの手続きが期限切れです', 'もう一度やり直してください');
      const passkey = await store.getPasskey(String(b.id ?? ''));
      if (!passkey) throw fail('このパスキーは登録されていません', '登録したパスキーを選ぶか、パスキーを登録してください', 401, 'unauthorized');
      const clientDataJSON = fromBase64url(String(b.clientDataJSON ?? ''));
      const authData = fromBase64url(String(b.authenticatorData ?? ''));
      checkClientData(clientDataJSON, { type: 'webauthn.get', challenge: ch.challenge, origins: [origin] });
      const { signCount } = await checkAuthenticatorData(authData, rpId);
      await verifySignature(passkey, authData, clientDataJSON, fromBase64url(String(b.signature ?? '')));
      // 利用回数が戻っていたら、複製されたおそれがある(同期されるパスキーは 0 のままなので除く)
      if (passkey.signCount > 0 && signCount > 0 && signCount <= passkey.signCount) throw fail('このパスキーは使えません', '別のパスキーでログインしてください', 401, 'unauthorized');
      if (signCount > passkey.signCount) await store.setSignCount(passkey.id, signCount);
      return login(url, store, passkey.ownerId);
    }
  } catch (e) {
    if (e instanceof PasskeyError) throw fail(`パスキーを確かめられませんでした(${e.message})`, 'もう一度試してください', 401, 'unauthorized');
    throw e;
  }

  if (path === 'logout' && method === 'POST') {
    const token = readCookie(request);
    if (token) await store.removeSession(await sha256(token));
    return json({ ok: true }, 200, { 'set-cookie': cookie(url, '', 0) });
  }

  if (path === 'passkeys' && method === 'GET') {
    if (!owner) throw new HttpError(401, { code: 'unauthorized', message: 'ログインしていません', hint: 'パスキーでログインしてください' });
    return json((await store.listPasskeys(owner)).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })));
  }
  const del = /^passkeys\/([\w-]+)$/.exec(path);
  if (del && method === 'DELETE') {
    if (!owner) throw new HttpError(401, { code: 'unauthorized', message: 'ログインしていません', hint: 'パスキーでログインしてください' });
    const list = await store.listPasskeys(owner);
    if (list.length <= 1) throw fail('最後の1つのパスキーは削除できません', '先に別のパスキーを追加してください');
    await store.removePasskey(del[1], owner);
    return new Response(null, { status: 204 });
  }

  throw new HttpError(404, { code: 'not_found', message: 'そのAPIはありません', hint: '呼び方を確かめてください' });
}

/**
 * ログイン中の印を発行する
 * @param {URL} url
 * @param {AuthStore} store
 * @param {string} ownerId
 */
async function login(url, store, ownerId) {
  const token = randomToken();
  await store.addSession({ tokenHash: await sha256(token), ownerId, expiresAt: nowSeconds() + SESSION_TTL });
  return json({ loggedIn: true }, 200, { 'set-cookie': cookie(url, token, SESSION_TTL) });
}
