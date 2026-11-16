import { readFileSync } from 'node:fs';

/** @returns {import('../src/core/types.js').Song} */
export function loadMinimalSong() {
  const url = new URL('./fixtures/minimal-song.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * 結果が成功であることを確かめて中身を返す
 * @template T
 * @param {import('../src/core/types.js').Result<T>} r
 * @returns {T}
 */
export function unwrap(r) {
  if (!r.ok) throw new Error(`失敗しました: ${r.error.message}`);
  return r.value;
}
