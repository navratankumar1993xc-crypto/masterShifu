'use strict';
const db = require('../db/pool');

const Setting = {
  async get(key, defaultValue = '') {
    const r = await db.query(
      'SELECT setting_value FROM settings WHERE setting_key = $1 LIMIT 1',
      [key]
    );
    return r.rows[0]?.setting_value ?? defaultValue;
  },

  async set(key, value) {
    await db.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
      [key, value]
    );
  },

  async getMany(keys) {
    const ph  = keys.map((_, i) => `$${i + 1}`).join(', ');
    const r   = await db.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${ph})`,
      keys
    );
    const out = {};
    for (const key of keys) out[key] = '';
    for (const row of r.rows) out[row.setting_key] = row.setting_value;
    return out;
  },
};

module.exports = Setting;
