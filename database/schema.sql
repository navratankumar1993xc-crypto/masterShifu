-- =============================================================================
-- WEB_TS Panel — complete PostgreSQL schema
-- Consolidates src/db/migrate.js + the session table from src/server.js
-- + the default controller from src/helpers/seedController.js.
--
-- Run against an EMPTY database (database/setup_db.sh does this for you):
--   psql -h localhost -U postgres -d web_ts_panel -v ON_ERROR_STOP=1 -f database/schema.sql
-- =============================================================================

BEGIN;

-- ── session (connect-pg-simple) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR      NOT NULL COLLATE "default",
  "sess"   JSON         NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

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
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(100)  NOT NULL DEFAULT '',
  email             VARCHAR(191)  NOT NULL,
  password          VARCHAR(255)  NOT NULL,
  role              VARCHAR(30)   NOT NULL DEFAULT 'seller'
                      CHECK (role IN ('controller','developer','super_master','admin','super','seller')),
  parent_id         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  status            VARCHAR(20)   NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','suspended_due')),
  credits           INTEGER       NOT NULL DEFAULT 0,
  due_amount        INTEGER       NOT NULL DEFAULT 0,
  due_deadline      TIMESTAMPTZ   DEFAULT NULL,
  gift_credits      INTEGER       NOT NULL DEFAULT 0,
  gift_pay_progress INTEGER       NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  gift_window_start TIMESTAMPTZ   DEFAULT NULL,      -- 7-day gift window
  cascade_from      INTEGER       DEFAULT NULL,      -- branch deactivation source
  UNIQUE (email)
);

-- ── keys ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keys (
  id             SERIAL PRIMARY KEY,
  key_value      VARCHAR(64)  NOT NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive','expired')),
  payment_status VARCHAR(20)  NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('paid','unpaid')),
  created_by     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mac_id         VARCHAR(100) DEFAULT NULL,
  mac_bound_at   TIMESTAMPTZ  DEFAULT NULL,
  expiry_date    DATE         DEFAULT NULL,
  due_lock       SMALLINT     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_bonus       SMALLINT     NOT NULL DEFAULT 0,    -- 365-day bonus key
  cascade_from   INTEGER      DEFAULT NULL,          -- branch deactivation source
  UNIQUE (key_value)
);
CREATE INDEX IF NOT EXISTS idx_keys_creator ON keys(created_by);
CREATE INDEX IF NOT EXISTS idx_keys_status  ON keys(status);
CREATE INDEX IF NOT EXISTS idx_keys_bonus   ON keys(is_bonus);

-- ── system_news ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_news (
  id          SERIAL PRIMARY KEY,
  target_role VARCHAR(30)  NOT NULL DEFAULT 'all',
  message     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── software_news ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS software_news (
  id         SERIAL PRIMARY KEY,
  message    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── tickets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id          SERIAL PRIMARY KEY,
  src_dest    VARCHAR(255) DEFAULT NULL,
  train_no    VARCHAR(50)  DEFAULT NULL,
  pay_mode    VARCHAR(50)  DEFAULT NULL,
  mac_id      VARCHAR(100) DEFAULT NULL,
  user_id     VARCHAR(100) DEFAULT NULL,
  ip_address  VARCHAR(50)  DEFAULT NULL,
  t_date      DATE         DEFAULT NULL,
  pnr         VARCHAR(100) DEFAULT NULL,
  img_base64  TEXT         DEFAULT NULL,
  img_path    VARCHAR(255) DEFAULT NULL,
  license_key VARCHAR(64)  DEFAULT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_date    ON tickets(t_date);
CREATE INDEX IF NOT EXISTS idx_tickets_license ON tickets(license_key);

-- ── panel_transactions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS panel_transactions (
  id           SERIAL PRIMARY KEY,
  txn_type     VARCHAR(40)  NOT NULL,
  from_user_id INTEGER      DEFAULT NULL,
  to_user_id   INTEGER      DEFAULT NULL,
  amount       INTEGER      NOT NULL DEFAULT 0,
  credits      INTEGER      NOT NULL DEFAULT 0,
  key_id       INTEGER      DEFAULT NULL,
  key_value    VARCHAR(64)  DEFAULT NULL,
  note         VARCHAR(255) DEFAULT NULL,
  created_by   INTEGER      NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ptxn_from    ON panel_transactions(from_user_id);
CREATE INDEX IF NOT EXISTS idx_ptxn_to      ON panel_transactions(to_user_id);
CREATE INDEX IF NOT EXISTS idx_ptxn_created ON panel_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_ptxn_key     ON panel_transactions(key_id);

-- ── key_due_ledger ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS key_due_ledger (
  id            SERIAL PRIMARY KEY,
  key_id        INTEGER     NOT NULL,
  key_value     VARCHAR(64) NOT NULL,
  panel_user_id INTEGER     NOT NULL,
  amount        INTEGER     NOT NULL DEFAULT 0,
  deadline      TIMESTAMPTZ NOT NULL,
  cleared_at    TIMESTAMPTZ DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_id, panel_user_id)
);
CREATE INDEX IF NOT EXISTS idx_kdl_key   ON key_due_ledger(key_id);
CREATE INDEX IF NOT EXISTS idx_kdl_panel ON key_due_ledger(panel_user_id);
CREATE INDEX IF NOT EXISTS idx_kdl_open  ON key_due_ledger(cleared_at, deadline);

-- ── transfers (key / account ownership moves) ───────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id            SERIAL PRIMARY KEY,
  transfer_type VARCHAR(20)  NOT NULL CHECK (transfer_type IN ('key','account')),
  subject_id    INTEGER      NOT NULL,          -- key id (key) or user id (account)
  subject_label VARCHAR(191) DEFAULT NULL,      -- key_value or email
  from_user_id  INTEGER      DEFAULT NULL,      -- old owner (key) / old parent (account)
  to_user_id    INTEGER      DEFAULT NULL,      -- new owner (key) / new parent (account)
  moved_by      INTEGER      NOT NULL,
  due_moved     INTEGER      NOT NULL DEFAULT 0,
  meta          JSONB        DEFAULT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfers_subject ON transfers(transfer_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_transfers_moved   ON transfers(moved_by);
CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at);

-- ── default controller: admin@webts.com / admin123 (CHANGE AFTER FIRST LOGIN) ──
-- bcrypt hash via pgcrypto; node's bcrypt.compare accepts the $2a$ prefix.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO users (name, email, password, role, status, credits)
SELECT 'Admin', 'admin@webts.com', crypt('admin123', gen_salt('bf', 12)), 'controller', 'active', 9999
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'controller');

COMMIT;
