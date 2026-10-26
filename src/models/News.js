'use strict';
const db = require('../db/pool');

const News = {
  // ── System News ─────────────────────────────────────────────────────────────
  async getLatest(role = null) {
    let sql = `SELECT id, target_role, message, created_at
               FROM system_news
               WHERE target_role = 'all'`;
    const params = [];
    if (role) {
      params.push(role);
      sql = `SELECT id, target_role, message, created_at
             FROM system_news
             WHERE target_role = 'all' OR target_role = $1`;
    }
    sql += ' ORDER BY created_at DESC LIMIT 10';
    const r = await db.query(sql, params);
    return r.rows;
  },

  async add(message, targetRole = 'all') {
    await db.query(
      'INSERT INTO system_news (target_role, message) VALUES ($1, $2)',
      [targetRole, message]
    );
  },

  async clearAll() {
    await db.query('TRUNCATE TABLE system_news');
  },

  async deleteById(id) {
    await db.query('DELETE FROM system_news WHERE id = $1', [id]);
  },

  // ── Software News ────────────────────────────────────────────────────────────
  async getSoftwareLatest() {
    const r = await db.query('SELECT message FROM software_news ORDER BY created_at DESC LIMIT 1');
    return r.rows[0]?.message || null;
  },

  async addSoftwareNews(message) {
    await db.query(
      'INSERT INTO software_news (message) VALUES ($1)',
      [message]
    );
  },

  async clearSoftwareNews() {
    await db.query('TRUNCATE TABLE software_news');
  },
};

module.exports = News;
