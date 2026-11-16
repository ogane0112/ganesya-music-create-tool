// base64url と、よく使う小さな道具

/** @param {ArrayBuffer | Uint8Array} bytes */
export function base64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text @returns {Uint8Array<ArrayBuffer>} */
export function fromBase64url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** @param {string | Uint8Array<ArrayBuffer>} data */
export async function sha256(data) {
  return base64url(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
