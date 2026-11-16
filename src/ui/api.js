// 保存用APIの呼び出し。失敗は { code, message, hint } の形にそろえて投げる。
// いまの本人確認は仮の「合言葉」。端末に覚えておき、毎回付けて送る(パスキーのログインに置き換える予定)。

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').AppError} AppError */

const KEY_STORAGE = 'ganesya.accessKey';

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

export function getAccessKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

/** @param {string} key */
export function setAccessKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // 覚えられなくても続ける
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
      headers: { authorization: `Bearer ${getAccessKey()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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
  /** 合言葉が合っているか */
  check: () => request('GET', 'auth/me'),
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
