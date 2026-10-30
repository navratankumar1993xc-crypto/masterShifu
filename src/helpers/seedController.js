'use strict';
const bcrypt = require('bcrypt');
const db     = require('../db/pool');

/**
 * Seed the default controller account if no controller exists.
 * Default: admin@webts.com / admin123
 */
async function seedController() {
  try {
    const r = await db.query(`SELECT 1 FROM users WHERE role = 'controller' LIMIT 1`);
    if (r.rows.length) return;

    const hashed = await bcrypt.hash('admin123', 12);
    await db.query(
      `INSERT INTO users (name, username, email, password, role, status, credits)
       VALUES ($1, $2, $3, $4, 'controller', 'active', 9999)`,
      ['Admin', 'admin', 'admin@webts.com', hashed]
    );
    console.log('[Seed] Default controller created: admin (admin@webts.com) / admin123');
    console.log('[Seed] !! CHANGE THE PASSWORD AFTER FIRST LOGIN !!');
  } catch (err) {
    console.error('[Seed] Failed:', err.message);
  }
}

module.exports = seedController;
