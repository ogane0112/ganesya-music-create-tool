// OAuth の保存先(Cloudflare D1)。テストでは同じ形のメモリ版に差し替える。

/**
 * @typedef {object} OAuthClient
 * @property {string} clientId
 * @property {string} clientName
 * @property {string[]} redirectUris
 */

/**
 * @typedef {object} OAuthStore
 * @property {(c: OAuthClient) => Promise<void>} addClient
 * @property {(clientId: string) => Promise<OAuthClient | null>} getClient
 * @property {(row: { codeHash: string, clientId: string, redirectUri: string, codeChallenge: string, ownerId: string, expiresAt: number }) => Promise<void>} addCode
 * @property {(codeHash: string) => Promise<{ clientId: string, redirectUri: string, codeChallenge: string, ownerId: string, expiresAt: number } | null>} takeCode 取り出して消す(1回しか使えない)
 * @property {(row: { tokenHash: string, kind: 'access' | 'refresh', clientId: string, ownerId: string, expiresAt: number }) => Promise<void>} addToken
 * @property {(tokenHash: string, kind: 'access' | 'refresh') => Promise<{ clientId: string, ownerId: string, expiresAt: number } | null>} getToken
 * @property {(tokenHash: string) => Promise<void>} removeToken
 */

/**
 * @param {any} db D1
 * @returns {OAuthStore}
 */
export function oauthStore(db) {
  return {
    async addClient(c) {
      await db.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
        .bind(c.clientId, c.clientName, JSON.stringify(c.redirectUris), new Date().toISOString()).run();
    },
    async getClient(clientId) {
      const r = await db.prepare('SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?').bind(clientId).first();
      return r ? { clientId: r.client_id, clientName: r.client_name, redirectUris: JSON.parse(r.redirect_uris) } : null;
    },
    async addCode(row) {
      await db.prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, owner_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.codeHash, row.clientId, row.redirectUri, row.codeChallenge, row.ownerId, row.expiresAt).run();
    },
    async takeCode(codeHash) {
      const r = await db.prepare('DELETE FROM oauth_codes WHERE code_hash = ? RETURNING client_id, redirect_uri, code_challenge, owner_id, expires_at').bind(codeHash).first();
      return r ? { clientId: r.client_id, redirectUri: r.redirect_uri, codeChallenge: r.code_challenge, ownerId: r.owner_id, expiresAt: r.expires_at } : null;
    },
    async addToken(row) {
      await db.prepare('INSERT INTO oauth_tokens (token_hash, kind, client_id, owner_id, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(row.tokenHash, row.kind, row.clientId, row.ownerId, row.expiresAt).run();
    },
    async getToken(tokenHash, kind) {
      const r = await db.prepare('SELECT client_id, owner_id, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = ?').bind(tokenHash, kind).first();
      return r ? { clientId: r.client_id, ownerId: r.owner_id, expiresAt: r.expires_at } : null;
    },
    async removeToken(tokenHash) {
      await db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').bind(tokenHash).run();
    },
  };
}
