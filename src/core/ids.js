// 曲データの中で重ならないIDを作る。

/**
 * 曲データ中のすべてのIDを集める
 * @param {import('./types.js').Song} song
 */
export function collectIds(song) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const t of song.tracks) ids.add(t.id);
  for (const s of song.sections) {
    ids.add(s.id);
    for (const notes of Object.values(s.parts)) for (const n of notes) ids.add(n.id);
  }
  for (const a of song.arrangement) ids.add(a.id);
  return ids;
}

/**
 * 接頭辞+連番のIDを作る関数を返す(例: "n1", "n2"…)。使用中のIDは飛ばす
 * @param {Iterable<string>} [used]
 */
export function createIdFactory(used = []) {
  const taken = new Set(used);
  /** @type {Map<string, number>} */
  const counters = new Map();
  /** @param {string} prefix */
  return function nextId(prefix) {
    let n = counters.get(prefix) ?? 0;
    let id;
    do {
      n += 1;
      id = `${prefix}${n}`;
    } while (taken.has(id));
    counters.set(prefix, n);
    taken.add(id);
    return id;
  };
}
