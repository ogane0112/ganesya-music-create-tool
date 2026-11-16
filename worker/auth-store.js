// ログインの保存先(Cloudflare D1)。テストでは同じ形のメモリ版に差し替える。

/**
 * @typedef {object} Passkey
 * @property {string} id
 * @property {string} ownerId
 * @property {string} publicKey
 * @property {number} alg
 * @property {number} signCount
 * @property {string} name
 * @property {string} createdAt
 */

/**
 * @typedef {object} AuthStore
 * @property {(row: { id: string, challenge: string, kind: 'register' | 'login', ownerId: string | null, expiresAt: number }) => Promise<void>} addChallenge
 * @property {(id: string) => Promise<{ challenge: string, kind: string, ownerId: string | null, expiresAt: number } | null>} takeChallenge 取り出して消す
 * @property {(p: Passkey) => Promise<void>} addPasskey
 * @property {(id: string) => Promise<Passkey | null>} getPasskey
 * @property {(ownerId: string) => Promise<Passkey[]>} listPasskeys
 * @property {(id: string, signCount: number) => Promise<void>} setSignCount
 * @property {(id: string, ownerId: string) => Promise<void>} removePasskey
 * @property {(row: { tokenHash: string, ownerId: string, expiresAt: number }) => Promise<void>} addSession
 * @property {(tokenHash: string) => Promise<{ ownerId: string, expiresAt: number } | null>} getSession
 * @property {(tokenHash: string) => Promise<void>} removeSession
 */

/** @param {any} r @returns {Passkey} */
const toPasskey = (r) => ({ id: r.id, ownerId: r.owner_id, publicKey: r.public_key, alg: r.alg, signCount: r.sign_count, name: r.name, createdAt: r.created_at });

/**
 * @param {any} db D1
 * @returns {AuthStore}
 */
export function authStore(db) {
  return {
    async addChallenge(row) {
      await db.prepare('INSERT INTO auth_challenges (id, challenge, kind, owner_id, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(row.id, row.challenge, row.kind, row.ownerId, row.expiresAt).run();
    },
    async takeChallenge(id) {
      const r = await db.prepare('DELETE FROM auth_challenges WHERE id = ? RETURNING challenge, kind, owner_id, expires_at').bind(id).first();
      return r ? { challenge: r.challenge, kind: r.kind, ownerId: r.owner_id, expiresAt: r.expires_at } : null;
    },
    async addPasskey(p) {
      await db.prepare('INSERT INTO passkeys (id, owner_id, public_key, alg, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(p.id, p.ownerId, p.publicKey, p.alg, p.signCount, p.name, p.createdAt).run();
    },
    async getPasskey(id) {
      const r = await db.prepare('SELECT * FROM passkeys WHERE id = ?').bind(id).first();
      return r ? toPasskey(r) : null;
    },
    async listPasskeys(ownerId) {
      const { results } = await db.prepare('SELECT * FROM passkeys WHERE owner_id = ? ORDER BY created_at').bind(ownerId).all();
      return results.map(toPasskey);
    },
    async setSignCount(id, signCount) {
      await db.prepare('UPDATE passkeys SET sign_count = ? WHERE id = ?').bind(signCount, id).run();
    },
    async removePasskey(id, ownerId) {
      await db.prepare('DELETE FROM passkeys WHERE id = ? AND owner_id = ?').bind(id, ownerId).run();
    },
    async addSession(row) {
      await db.prepare('INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)').bind(row.tokenHash, row.ownerId, row.expiresAt).run();
    },
    async getSession(tokenHash) {
      const r = await db.prepare('SELECT owner_id, expires_at FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
      return r ? { ownerId: r.owner_id, expiresAt: r.expires_at } : null;
    },
    async removeSession(tokenHash) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    },
  };
}
