-- パスキーのログイン。合言葉でのログインをやめ、登録したパスキーだけで入れるようにする
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,          -- 認証器が付けたID(base64url)
  owner_id TEXT NOT NULL,
  public_key TEXT NOT NULL,     -- 公開鍵(SPKI、base64url)
  alg INTEGER NOT NULL,         -- -7 = ES256、-257 = RS256
  sign_count INTEGER NOT NULL,
  name TEXT NOT NULL,           -- どの端末のものか(画面に出す)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS passkeys_owner ON passkeys (owner_id);
-- ログイン中の印(クッキーに入れる値のハッシュ)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
-- 登録・ログインの途中で使う、1回限りの問いかけ(チャレンジ)
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner_id TEXT,
  expires_at INTEGER NOT NULL
);
