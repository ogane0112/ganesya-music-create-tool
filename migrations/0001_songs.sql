-- 曲は1曲1行。data に曲データ(JSON)全体を入れる。owner_id は持ち主(ログインを入れたら人ごとに分かれる)
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_owner_updated ON songs (owner_id, updated_at DESC);
