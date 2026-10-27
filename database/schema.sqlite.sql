-- =============================================================================
-- WEB_TS Panel — SQLite schema (DB_CLIENT=sqlite)
-- Same tables/columns/indexes as database/schema.sql (PostgreSQL).
-- Applied automatically on startup by src/db/migrate.js; safe to re-run.
-- Timestamps: ISO-8601 UTC text. Dates: 'YYYY-MM-DD' text.
-- =============================================================================

-- ── session (express-session store) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session (
  sid    TEXT    PRIMARY KEY,
  sess   TEXT    NOT NULL,
  expire INTEGER NOT NULL                      -- epoch ms
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- ── settings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(80)  PRIMARY KEY,
  setting_value VARCHAR(512) NOT NULL DEFAULT ''
);

INSERT INTO settings (setting_key, setting_value) VALUES
  ('demo_creation_enabled',  '0'),
  ('download_zip_url',       'https://gofile.io/d/EZ3vGf'),
  ('gift_offer_enabled',     '0'),
  ('gift_offer_message',     'SPECIAL OFFER: 2 Keys Paid karo = 1 FREE Gift Credit!'),
  ('gift_window_days',       '7'),
  ('gift_target',            '2'),
  ('bonus_offer_enabled',    '0'),
  ('bonus_monthly_target',   '10'),
  ('bonus_running_required', '10'),
  ('bonus_validity_days',    '365')
ON CONFLICT (setting_key) DO NOTHING;

-- ── users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY,
  name              VARCHAR(100)  NOT NULL DEFAULT '',
  email             VARCHAR(191)  NOT NULL UNIQUE,
  password          VARCHAR(255)  NOT NULL,
  role              VARCHAR(30)   NOT NULL DEFAULT 'seller'
                      CHECK (role IN ('controller','developer','super_master','admin','super','seller')),
  parent_id         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  status            VARCHAR(20)   NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','suspended_due')),
  credits           INTEGER       NOT NULL DEFAULT 0,
  due_amount        INTEGER       NOT NULL DEFAULT 0,
  due_deadline      TEXT          DEFAULT NULL,
  gift_credits      INTEGER       NOT NULL DEFAULT 0,
  gift_pay_progress INTEGER       NOT NULL DEFAULT 0,
  created_at        TEXT          NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  gift_window_start TEXT          DEFAULT NULL,
  cascade_from      INTEGER       DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- ── keys ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keys (
  id             INTEGER PRIMARY KEY,
  key_value      VARCHAR(64)  NOT NULL UNIQUE,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive','expired')),
  payment_status VARCHAR(20)  NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('paid','unpaid')),
  created_by     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mac_id         VARCHAR(100) DEFAULT NULL,
  mac_bound_at   TEXT         DEFAULT NULL,
  expiry_date    TEXT         DEFAULT NULL,
  due_lock       INTEGER      NOT NULL DEFAULT 0,
  created_at     TEXT         NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_bonus       INTEGER      NOT NULL DEFAULT 0,
  cascade_from   INTEGER      DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_keys_creator ON keys(created_by);
CREATE INDEX IF NOT EXISTS idx_keys_status  ON keys(status);
CREATE INDEX IF NOT EXISTS idx_keys_bonus   ON keys(is_bonus);
CREATE INDEX IF NOT EXISTS idx_keys_upper   ON keys(UPPER(key_value));

-- ── system_news ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_news (
  id          INTEGER PRIMARY KEY,
  target_role VARCHAR(30) NOT NULL DEFAULT 'all',
  message     TEXT        NOT NULL,
  created_at  TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── software_news ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS software_news (
  id         INTEGER PRIMARY KEY,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── tickets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY,
  src_dest    VARCHAR(255) DEFAULT NULL,
  train_no    VARCHAR(50)  DEFAULT NULL,
  pay_mode    VARCHAR(50)  DEFAULT NULL,
  mac_id      VARCHAR(100) DEFAULT NULL,
  user_id     VARCHAR(100) DEFAULT NULL,
  ip_address  VARCHAR(50)  DEFAULT NULL,
  t_date      TEXT         DEFAULT NULL,
  pnr         VARCHAR(100) DEFAULT NULL,
  img_base64  TEXT         DEFAULT NULL,
  img_path    VARCHAR(255) DEFAULT NULL,
  license_key VARCHAR(64)  DEFAULT NULL,
  created_at  TEXT         NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_date    ON tickets(t_date);
CREATE INDEX IF NOT EXISTS idx_tickets_license ON tickets(license_key);

-- ── panel_transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS panel_transactions (
  id           INTEGER PRIMARY KEY,
  txn_type     VARCHAR(40)  NOT NULL,
  from_user_id INTEGER      DEFAULT NULL,
  to_user_id   INTEGER      DEFAULT NULL,
  amount       INTEGER      NOT NULL DEFAULT 0,
  credits      INTEGER      NOT NULL DEFAULT 0,
  key_id       INTEGER      DEFAULT NULL,
  key_value    VARCHAR(64)  DEFAULT NULL,
  note         VARCHAR(255) DEFAULT NULL,
  created_by   INTEGER      NOT NULL,
  created_at   TEXT         NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ptxn_from    ON panel_transactions(from_user_id);
CREATE INDEX IF NOT EXISTS idx_ptxn_to      ON panel_transactions(to_user_id);
CREATE INDEX IF NOT EXISTS idx_ptxn_created ON panel_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_ptxn_key     ON panel_transactions(key_id);

-- ── key_due_ledger ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS key_due_ledger (
  id            INTEGER PRIMARY KEY,
  key_id        INTEGER     NOT NULL,
  key_value     VARCHAR(64) NOT NULL,
  panel_user_id INTEGER     NOT NULL,
  amount        INTEGER     NOT NULL DEFAULT 0,
  deadline      TEXT        NOT NULL,
  cleared_at    TEXT        DEFAULT NULL,
  created_at    TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (key_id, panel_user_id)
);
CREATE INDEX IF NOT EXISTS idx_kdl_key   ON key_due_ledger(key_id);
CREATE INDEX IF NOT EXISTS idx_kdl_panel ON key_due_ledger(panel_user_id);
CREATE INDEX IF NOT EXISTS idx_kdl_open  ON key_due_ledger(cleared_at, deadline);

-- ── transfers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id            INTEGER PRIMARY KEY,
  transfer_type VARCHAR(20)  NOT NULL CHECK (transfer_type IN ('key','account')),
  subject_id    INTEGER      NOT NULL,
  subject_label VARCHAR(191) DEFAULT NULL,
  from_user_id  INTEGER      DEFAULT NULL,
  to_user_id    INTEGER      DEFAULT NULL,
  moved_by      INTEGER      NOT NULL,
  due_moved     INTEGER      NOT NULL DEFAULT 0,
  meta          TEXT         DEFAULT NULL,       -- JSON
  created_at    TEXT         NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_transfers_subject ON transfers(transfer_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_transfers_moved   ON transfers(moved_by);
CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at);
