// パスキー(端末の指紋・顔・暗証番号でのログイン)のブラウザ側。サーバーとのやりとりは worker/auth.js と対になる。
import { api, ApiError } from './api.js';

/** @param {ArrayBuffer} buf */
function b64(buf) {
  let s = '';
  for (const x of new Uint8Array(buf)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @param {string} text */
function bytes(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const passkeysSupported = () => typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;

/** この端末の呼び名(パスキーの一覧に出す) */
export function deviceName() {
  const ua = navigator.userAgent;
  const device = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '端末';
  const d = new Date();
  return `${device}(${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 登録)`;
}

/**
 * 端末の確認画面で起きた失敗を、画面に出せる形にする
 * @param {unknown} e
 */
function toApiError(e) {
  if (e instanceof ApiError) return e;
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return new ApiError({ code: 'cancelled', message: 'パスキーが見つからないか、確認が中止されました', hint: 'この端末を初めて使う時は、下の「この端末を初めて使う」からパスキーを登録してください' }, 0);
  if (name === 'InvalidStateError') return new ApiError({ code: 'exists', message: 'この端末のパスキーは登録済みです', hint: '「パスキーでログイン」を押してください' }, 0);
  return new ApiError({ code: 'passkey_failed', message: 'パスキーを使えませんでした', hint: 'この端末・ブラウザがパスキーに対応しているか確かめてください' }, 0);
}

/**
 * パスキーを登録する。ログイン中でなければ登録用の合言葉が要る。成功するとログイン中になる
 * @param {string} [setupKey]
 */
export async function registerPasskey(setupKey) {
  try {
    const start = await api.auth('register/start', { setupKey });
    const pk = start.publicKey;
    const cred = /** @type {PublicKeyCredential | null} */ (await navigator.credentials.create({
      publicKey: {
        ...pk,
        challenge: bytes(pk.challenge),
        user: { ...pk.user, id: bytes(pk.user.id) },
        excludeCredentials: pk.excludeCredentials.map((/** @type {any} */ c) => ({ ...c, id: bytes(c.id) })),
      },
    }));
    if (!cred) throw new Error('no credential');
    const r = /** @type {AuthenticatorAttestationResponse} */ (cred.response);
    const publicKey = r.getPublicKey();
    if (!publicKey) throw new Error('no public key');
    await api.auth('register/finish', {
      challengeId: start.challengeId,
      id: cred.id,
      alg: r.getPublicKeyAlgorithm(),
      publicKey: b64(publicKey),
      authenticatorData: b64(r.getAuthenticatorData()),
      clientDataJSON: b64(r.clientDataJSON),
      name: deviceName(),
    });
  } catch (e) {
    throw toApiError(e);
  }
}

/** パスキーでログインする */
export async function loginWithPasskey() {
  try {
    const start = await api.auth('login/start', {});
    const cred = /** @type {PublicKeyCredential | null} */ (await navigator.credentials.get({
      publicKey: { ...start.publicKey, challenge: bytes(start.publicKey.challenge) },
    }));
    if (!cred) throw new Error('no credential');
    const r = /** @type {AuthenticatorAssertionResponse} */ (cred.response);
    await api.auth('login/finish', {
      challengeId: start.challengeId,
      id: cred.id,
      authenticatorData: b64(r.authenticatorData),
      clientDataJSON: b64(r.clientDataJSON),
      signature: b64(r.signature),
    });
  } catch (e) {
    throw toApiError(e);
  }
}
