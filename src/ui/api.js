// 保存用APIの呼び出し。失敗は { code, message, hint } の形にそろえて投げる。
// 本人確認はパスキーのログイン。ログイン中の印はクッキーで、ブラウザが自動で付けて送る。

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').AppError} AppError */

export class ApiError extends Error {
  /**
   * @param {AppError} error
   * @param {number} status 0 は通信できなかった
   */
  constructor(error, status) {
    super(error.message);
    this.error = error;
    this.status = status;
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError({ code: 'offline', message: '通信できません', hint: 'ネットワークの接続を確かめてください' }, 0);
  }
  if (res.status === 204) return null;
  /** @type {any} */
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 下で扱う
  }
  if (!res.ok) {
    throw new ApiError(data?.code ? data : { code: 'server_error', message: 'サーバーで問題が起きました', hint: '少し待ってからもう一度試してください' }, res.status);
  }
  return data;
}

export const api = {
  /** ログイン中か @returns {Promise<{ loggedIn: boolean }>} */
  me: () => request('GET', 'auth/me'),
  /** ログインまわりの呼び出し(passkey.js が使う) @param {string} path @param {unknown} body @returns {Promise<any>} */
  auth: (path, body) => request('POST', `auth/${path}`, body),
  logout: () => request('POST', 'auth/logout', {}),
  /** @returns {Promise<{ id: string, name: string, createdAt: string }[]>} */
  passkeys: () => request('GET', 'auth/passkeys'),
  /** @param {string} id */
  removePasskey: (id) => request('DELETE', `auth/passkeys/${id}`),
  /** @returns {Promise<{ id: string, title: string, updatedAt: string, revision: number }[]>} */
  list: () => request('GET', 'songs'),
  /** @param {string} id @returns {Promise<{ id: string, song: Song }>} */
  get: (id) => request('GET', `songs/${id}`),
  /** @param {Song} song @returns {Promise<{ id: string, song: Song }>} */
  create: (song) => request('POST', 'songs', song),
  /** @param {string} id @param {Song} song @returns {Promise<{ id: string, song: Song }>} */
  update: (id, song) => request('PUT', `songs/${id}`, song),
  /** @param {string} id */
  remove: (id) => request('DELETE', `songs/${id}`),
};
