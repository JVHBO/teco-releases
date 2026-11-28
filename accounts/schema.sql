CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, verifier TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, progress TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id), expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS pairing (
  player TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  hash TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  hash TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS leaderboard (
  player TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cash INTEGER NOT NULL DEFAULT 0,
  marbles INTEGER NOT NULL DEFAULT 0,
  unique_marbles INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS leaderboard_cash ON leaderboard(cash DESC, marbles DESC, name ASC);
CREATE INDEX IF NOT EXISTS leaderboard_marbles ON leaderboard(marbles DESC, cash DESC, name ASC);
CREATE INDEX IF NOT EXISTS leaderboard_unique ON leaderboard(unique_marbles DESC, marbles DESC, cash DESC, name ASC);
