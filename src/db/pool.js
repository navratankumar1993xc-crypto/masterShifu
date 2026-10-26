'use strict';
const { Pool } = require('pg');
const cfg = require('../config');

const pool = new Pool({
  host:     cfg.db.host,
  port:     cfg.db.port,
  database: cfg.db.database,
  user:     cfg.db.user,
  password: cfg.db.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Run a query and return the result.
 * @param {string} text
 * @param {Array}  params
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV !== 'production') {
      const ms = Date.now() - start;
      if (ms > 500) console.warn(`[DB] Slow query (${ms}ms):`, text.slice(0, 80));
    }
    return res;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nSQL:', text.slice(0, 120));
    throw err;
  }
}

/**
 * Grab a client from the pool for transactions.
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     ...
 *     await client.query('COMMIT');
 *   } catch { await client.query('ROLLBACK'); throw; }
 *   finally { client.release(); }
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
