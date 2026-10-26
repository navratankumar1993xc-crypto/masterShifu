'use strict';
/**
 * Bootstrap / migrate the PostgreSQL schema.
 * Safe to call on every startup — all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
 */
const db = require('./pool');

async function migrate() {
  console.log('[DB] Running migrations…');

  // ── settings ────────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      setting_key   VARCHAR(80)  PRIMARY KEY,
      setting_value VARCHAR(512) NOT NULL DEFAULT ''
    )
  `);

  await db.query(`
    INSERT INTO settings (setting_key, setting_value) VALUES
      ('demo_creation_enabled', '0'),
      ('download_zip_url',      'https://gofile.io/d/EZ3vGf'),
      ('gift_offer_enabled',    '0'),
      ('gift_offer_message',    'SPECIAL OFFER: 2 Keys Paid karo = 1 FREE Gift Credit!')
    ON CONFLICT (setting_key) DO NOTHING
  `);

  // ── users ────────────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      name            VARCHAR(100)  NOT NULL DEFAULT '',
      email           VARCHAR(191)  NOT NULL,
      password        VARCHAR(255)  NOT NULL,
      role            VARCHAR(30)   NOT NULL DEFAULT 'seller'
                        CHECK (role IN ('controller','developer','super_master','admin','super','seller')),
      parent_id       INTEGER       REFERENCES users(id) ON DELETE SET NULL,
      status          VARCHAR(20)   NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive','suspended_due')),
      credits         INTEGER       NOT NULL DEFAULT 0,
      due_amount      INTEGER       NOT NULL DEFAULT 0,
      due_deadline    TIMESTAMPTZ   DEFAULT NULL,
      gift_credits    INTEGER       NOT NULL DEFAULT 0,
      gift_pay_progress INTEGER     NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (email)
    )
  `);

  // ── keys ─────────────────────────────────────────────────────────────────────
  await db.query(`
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
      UNIQUE (key_value)
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_keys_creator ON keys(created_by)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_keys_status  ON keys(status)`);

  // ── system_news ───────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_news (
      id          SERIAL PRIMARY KEY,
      target_role VARCHAR(30)  NOT NULL DEFAULT 'all',
      message     TEXT         NOT NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // ── software_news ─────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS software_news (
      id         SERIAL PRIMARY KEY,
      message    TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── tickets ───────────────────────────────────────────────────────────────────
  await db.query(`
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
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_tickets_date    ON tickets(t_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tickets_license ON tickets(license_key)`);

  // ── panel_transactions ────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS panel_transactions (
      id          SERIAL PRIMARY KEY,
      txn_type    VARCHAR(40)  NOT NULL,
      from_user_id INTEGER     DEFAULT NULL,
      to_user_id   INTEGER     DEFAULT NULL,
      amount      INTEGER      NOT NULL DEFAULT 0,
      credits     INTEGER      NOT NULL DEFAULT 0,
      key_id      INTEGER      DEFAULT NULL,
      key_value   VARCHAR(64)  DEFAULT NULL,
      note        VARCHAR(255) DEFAULT NULL,
      created_by  INTEGER      NOT NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_from    ON panel_transactions(from_user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_to      ON panel_transactions(to_user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_created ON panel_transactions(created_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ptxn_key     ON panel_transactions(key_id)`);

  // ── key_due_ledger ────────────────────────────────────────────────────────────
  await db.query(`
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
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_kdl_key   ON key_due_ledger(key_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_kdl_panel ON key_due_ledger(panel_user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_kdl_open  ON key_due_ledger(cleared_at, deadline)`);

  // ── Feature columns (365 bonus key, 7-day gift window) ───────────────────────
  await db.query(`ALTER TABLE keys  ADD COLUMN IF NOT EXISTS is_bonus          SMALLINT    NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_window_start TIMESTAMPTZ DEFAULT NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_keys_bonus ON keys(is_bonus)`);

  // ── Branch deactivation: which deactivated user's cascade turned this row off ──
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cascade_from INTEGER DEFAULT NULL`);
  await db.query(`ALTER TABLE keys  ADD COLUMN IF NOT EXISTS cascade_from INTEGER DEFAULT NULL`);

  // ── Transfers audit (key / account ownership moves) ──────────────────────────
  await db.query(`
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
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_transfers_subject ON transfers(transfer_type, subject_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_transfers_moved   ON transfers(moved_by)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at)`);

  // ── Offer / bonus settings defaults ──────────────────────────────────────────
  await db.query(`
    INSERT INTO settings (setting_key, setting_value) VALUES
      ('gift_window_days',        '7'),
      ('gift_target',             '2'),
      ('bonus_offer_enabled',     '0'),
      ('bonus_monthly_target',    '10'),
      ('bonus_running_required',  '10'),
      ('bonus_validity_days',     '365')
    ON CONFLICT (setting_key) DO NOTHING
  `);

  console.log('[DB] Migrations complete.');
}

module.exports = migrate;
