// パスキー(WebAuthn)の検証。外部ライブラリを使わず、Web Crypto で署名を確かめる。
// 登録では、ブラウザが取り出した公開鍵(SPKI)を受け取る(証明書による機種の確認はしない = attestation "none")。
import { base64url, fromBase64url } from './b64.js';

export class PasskeyError extends Error {}

/** 使える署名の方式(COSEの番号) */
export const ALGORITHMS = /** @type {Record<number, { import: any, verify: any }>} */ ({
  [-7]: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
  [-257]: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
});

/**
 * ブラウザが署名に含めた情報(clientDataJSON)を確かめる
 * @param {Uint8Array<ArrayBuffer>} clientDataJSON
 * @param {{ type: 'webauthn.create' | 'webauthn.get', challenge: string, origins: string[] }} expect
 */
export function checkClientData(clientDataJSON, expect) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    throw new PasskeyError('ブラウザからの情報を読めません');
  }
  if (data.type !== expect.type) throw new PasskeyError('操作の種類が違います');
  if (data.challenge !== expect.challenge) throw new PasskeyError('問いかけが一致しません');
  if (!expect.origins.includes(data.origin)) throw new PasskeyError(`このサイト向けの署名ではありません(${data.origin})`);
}

/**
 * 認証器のデータ(authenticatorData)を確かめ、利用回数を返す
 * @param {Uint8Array<ArrayBuffer>} authData
 * @param {string} rpId このサイトの名前(ホスト名)
 */
export async function checkAuthenticatorData(authData, rpId) {
  if (authData.length < 37) throw new PasskeyError('認証器のデータが短すぎます');
  const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
  for (let i = 0; i < 32; i++) if (authData[i] !== expected[i]) throw new PasskeyError('このサイト向けのパスキーではありません');
  const flags = authData[32];
  if (!(flags & 0x01)) throw new PasskeyError('本人の操作が確認できません');
  return { signCount: new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0), userVerified: !!(flags & 0x04) };
}

/**
 * ECDSA の署名を、ASN.1(DER)の形から r と s を並べた形(64バイト)に直す。Web Crypto は後者を受け取る
 * @param {Uint8Array<ArrayBuffer>} der
 */
export function derToRaw(der) {
  let p = 0;
  const fail = () => new PasskeyError('署名の形が正しくありません');
  if (der[p++] !== 0x30) throw fail();
  if (der[p] & 0x80) p += 1 + (der[p] & 0x7f);
  else p += 1;
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[p++] !== 0x02) throw fail();
    let len = der[p++];
    let start = p;
    p += len;
    while (len > 32 && der[start] === 0) { start++; len--; }
    if (len > 32 || p > der.length) throw fail();
    out.set(der.subarray(start, start + len), part * 32 + (32 - len));
  }
  return out;
}

/**
 * 公開鍵が読めるかを確かめる(登録時)
 * @param {string} publicKey SPKI(base64url)
 * @param {number} alg
 */
export async function importPublicKey(publicKey, alg) {
  const a = ALGORITHMS[alg];
  if (!a) throw new PasskeyError('このパスキーの署名の方式には対応していません');
  try {
    return await crypto.subtle.importKey('spki', fromBase64url(publicKey), a.import, false, ['verify']);
  } catch {
    throw new PasskeyError('公開鍵を読めません');
  }
}

/**
 * ログイン時の署名を確かめる。署名の対象は「認証器のデータ + clientDataJSON のハッシュ」
 * @param {{ publicKey: string, alg: number }} credential
 * @param {Uint8Array<ArrayBuffer>} authData
 * @param {Uint8Array<ArrayBuffer>} clientDataJSON
 * @param {Uint8Array<ArrayBuffer>} signature
 */
export async function verifySignature(credential, authData, clientDataJSON, signature) {
  const key = await importPublicKey(credential.publicKey, credential.alg);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signed = new Uint8Array(authData.length + hash.length);
  signed.set(authData);
  signed.set(hash, authData.length);
  const sig = credential.alg === -7 ? derToRaw(signature) : signature;
  if (!(await crypto.subtle.verify(ALGORITHMS[credential.alg].verify, key, sig, signed))) throw new PasskeyError('署名が正しくありません');
}

export { base64url, fromBase64url };
