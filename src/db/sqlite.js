'use strict';
/**
 * SQLite driver with the same interface as pool.js (query / getClient).
 * Models keep writing PostgreSQL SQL; toSqlite() rewrites the few
 * pg-only constructs they use so both backends run the same code.
 *
 * Uses Node's built-in node:sqlite (Node >= 22.13) — no native install.
 * Timestamps are stored as ISO-8601 UTC text ('2026-10-28T10:15:00.000Z'),
 * dates as 'YYYY-MM-DD', so plain string comparison orders them correctly.
 */
const fs   = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg  = require('../config');

// Relative paths resolve from the project root, not the shell's cwd
const file = path.resolve(__dirname, '..', '..', cfg.db.sqliteFile);
fs.mkdirSync(path.dirname(file), { recursive: true });

const sqlite = new DatabaseSync(file);
sqlite.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const TS  = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const IST = `date('now','+330 minutes')`;

/** PostgreSQL dialect → SQLite dialect. Returns the param indexes that must be JSON arrays. */
function toSqlite(text) {
  const jsonParams = new Set();
  let sql = text
    // created_by = ANY($1::int[])  →  created_by IN (SELECT value FROM json_each(?1))
    .replace(/=\s*ANY\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/gi, (_, n) => {
      jsonParams.add(Number(n));
      return `IN (SELECT value FROM json_each($${n}))`;
    })
    // NOW() + make_interval(hours => X)
    .replace(/NOW\(\)\s*\+\s*make_interval\(\s*hours\s*=>\s*([^()]*?)\s*\)/gi,
      (_, x) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','+' || (${x}) || ' hours')`)
    // NOW() - INTERVAL '30 days'
    .replace(/NOW\(\)\s*([+-])\s*INTERVAL\s*'([^']+)'/gi,
      (_, sign, iv) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','${sign}${iv}')`)
    // (NOW() AT TIME ZONE 'Asia/Kolkata')::date [+ $3::int]
    .replace(/\(NOW\(\)\s+AT\s+TIME\s+ZONE\s+'Asia\/Kolkata'\)::date(?:\s*\+\s*(\$\d+)(?:::int)?)?/gi,
      (_, days) => days ? `date('now','+330 minutes','+' || (${days}) || ' days')` : IST)
    .replace(/\bNOW\(\)/gi, TS)
    .replace(/\bCURRENT_DATE\b/gi, `date('now','localtime')`)
    .replace(/::\w+(\[\])?/g, '')
    .replace(/\bGREATEST\(/gi, 'MAX(')
    .replace(/\bLEAST\(/gi, 'MIN(')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\s+FOR\s+UPDATE\b/gi, '')
    .replace(/\bTRUNCATE\s+TABLE\s+(\w+)/gi, 'DELETE FROM $1')
    // UPDATE keys k SET  →  UPDATE keys AS k SET
    .replace(/\bUPDATE\s+(\w+)\s+(?!SET\b)(\w+)\s+SET\b/gi, 'UPDATE $1 AS $2 SET')
    .replace(/\$(\d+)/g, '?$1');
  return { sql, jsonParams };
}

function toParam(v, i, jsonParams) {
  if (jsonParams.has(i + 1)) return JSON.stringify(v);
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

const stmtCache = new Map();
function prepare(sql) {
  let st = stmtCache.get(sql);
  if (!st) {
    st = sqlite.prepare(sql);
    stmtCache.set(sql, st);
    if (stmtCache.size > 500) stmtCache.delete(stmtCache.keys().next().value);
  }
  return st;
}

function run(text, params = []) {
  const { sql, jsonParams } = toSqlite(text);
  const args = params.map((v, i) => toParam(v, i, jsonParams));
  try {
    const st = prepare(sql);
    if (st.columns().length) {
      const rows = st.all(...args).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    }
    const info = st.run(...args);
    return { rows: [], rowCount: Number(info.changes) };
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nSQL:', sql.slice(0, 120));
    throw err;
  }
}

async function query(text, params) {
  return run(text, params);
}

// ── Transactions ──────────────────────────────────────────────────────────────
// One connection, so transactions are serialised: getClient() waits until the
// previous client is released. Plain query() calls are not blocked.
let lock = Promise.resolve();

async function getClient() {
  let release;
  const prev = lock;
  lock = new Promise(r => { release = r; });
  await prev;

  let inTxn = false;
  let released = false;
  return {
    async query(text, params) {
      const cmd = String(text).trim().toUpperCase();
      if (cmd === 'BEGIN') {
        sqlite.exec('BEGIN IMMEDIATE');
        inTxn = true;
        return { rows: [], rowCount: 0 };
      }
      if (cmd === 'COMMIT' || cmd === 'ROLLBACK') {
        if (inTxn) sqlite.exec(cmd);
        inTxn = false;
        return { rows: [], rowCount: 0 };
      }
      return run(text, params);
    },
    release() {
      if (released) return;
      released = true;
      if (inTxn) { try { sqlite.exec('ROLLBACK'); } catch (_) { /* already closed */ } }
      release();
    },
  };
}

module.exports = { query, getClient, sqlite, client: 'sqlite', toSqlite };
