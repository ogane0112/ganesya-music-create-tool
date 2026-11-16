// 保存用API。画面が呼ぶ。失敗はすべて { code, message, hint } の形で返す。
import { validateSong } from '../src/core/validate.js';
import { HttpError } from './db.js';

/** @param {unknown} body @param {number} [status] */
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * 曲データの形を確かめる。キーから外れた音は、ここでは断らない
 * (操作の中で確かめている。MIDIから取り込んだ曲は外れた音を含んだまま保存できる必要がある)
 * @param {unknown} body
 */
function checkSong(body) {
  const r = validateSong(body, { allowOutOfKey: true });
  if (!r.ok) throw new HttpError(422, r.error);
  return r.value;
}

/** @param {Request} request */
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(422, { code: 'invalid_song', message: '送られたデータを読めません', hint: 'JSONの形で送ってください' });
  }
}

/**
 * @param {Request} request
 * @param {string} path /api/ より後ろ
 * @param {import('./db.js').SongStore} store
 */
export async function handleApi(request, path, store) {
  const method = request.method;
  if (path === 'songs') {
    if (method === 'GET') return json(await store.list());
    if (method === 'POST') {
      const { id, song } = await store.create(checkSong(await readJson(request)));
      return json({ id, song }, 201);
    }
  }
  const m = /^songs\/([\w-]+)$/.exec(path);
  if (m) {
    const id = m[1];
    if (method === 'GET') return json({ id, song: await store.get(id) });
    if (method === 'PUT') {
      const song = checkSong(await readJson(request));
      return json({ id, song: await store.update(id, song, song.revision) });
    }
    if (method === 'DELETE') {
      await store.remove(id);
      return new Response(null, { status: 204 });
    }
  }
  throw new HttpError(404, { code: 'not_found', message: 'そのAPIはありません', hint: '呼び方を確かめてください' });
}
