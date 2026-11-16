// 曲の保存(Cloudflare D1)。revision が合う時だけ上書きし、同時に書いた時の上書き事故を防ぐ。

/** @typedef {import('../src/core/types.js').Song} Song */
/** @typedef {import('../src/core/types.js').AppError} AppError */

/** 失敗を HTTP の番号付きで投げる */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {AppError} error
   */
  constructor(status, error) {
    super(error.message);
    this.status = status;
    this.error = error;
  }
}

export const notFound = () => new HttpError(404, { code: 'not_found', message: '曲が見つかりません', hint: '曲の一覧を読み込み直してください' });
export const conflict = () => new HttpError(409, { code: 'revision_conflict', message: '他で更新されています', hint: '最新を読み込んでからやり直してください' });

/**
 * @param {any} db D1
 * @param {string} owner
 */
export function songStore(db, owner) {
  return {
    /** @returns {Promise<{ id: string, title: string, updatedAt: string, revision: number }[]>} */
    async list() {
      const { results } = await db.prepare('SELECT id, title, updated_at, revision FROM songs WHERE owner_id = ? ORDER BY updated_at DESC').bind(owner).all();
      return results.map((/** @type {any} */ r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, revision: r.revision }));
    },

    /**
     * @param {string} id
     * @returns {Promise<Song>}
     */
    async get(id) {
      const row = await db.prepare('SELECT data, revision FROM songs WHERE id = ? AND owner_id = ?').bind(id, owner).first();
      if (!row) throw notFound();
      const song = JSON.parse(row.data);
      song.revision = row.revision;
      return song;
    },

    /**
     * 新しく保存する。revision は1から
     * @param {Song} song
     * @returns {Promise<{ id: string, song: Song }>}
     */
    async create(song) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const saved = { ...song, revision: 1, meta: { ...song.meta, createdAt: song.meta.createdAt || now, updatedAt: now } };
      await db.prepare('INSERT INTO songs (id, owner_id, title, updated_at, revision, data) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, owner, saved.meta.title, now, 1, JSON.stringify(saved)).run();
      return { id, song: saved };
    },

    /**
     * 上書き保存する。手元の revision がサーバーと同じ時だけ通り、1増える
     * @param {string} id
     * @param {Song} song
     * @param {number} revision 手元の revision
     * @returns {Promise<Song>}
     */
    async update(id, song, revision) {
      const now = new Date().toISOString();
      const saved = { ...song, revision: revision + 1, meta: { ...song.meta, updatedAt: now } };
      const res = await db.prepare('UPDATE songs SET title = ?, updated_at = ?, revision = ?, data = ? WHERE id = ? AND owner_id = ? AND revision = ?')
        .bind(saved.meta.title, now, saved.revision, JSON.stringify(saved), id, owner, revision).run();
      if (res.meta.changes === 0) {
        const exists = await db.prepare('SELECT 1 FROM songs WHERE id = ? AND owner_id = ?').bind(id, owner).first();
        throw exists ? conflict() : notFound();
      }
      return saved;
    },

    /** @param {string} id */
    async remove(id) {
      const res = await db.prepare('DELETE FROM songs WHERE id = ? AND owner_id = ?').bind(id, owner).run();
      if (res.meta.changes === 0) throw notFound();
    },
  };
}

/** @typedef {ReturnType<typeof songStore>} SongStore */
