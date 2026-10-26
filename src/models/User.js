'use strict';
const db   = require('../db/pool');
const cfg  = require('../config');

const COLS = 'id, name, email, role, parent_id, status, credits, due_amount, due_deadline, gift_credits, gift_pay_progress, created_at';

const User = {
  async findById(id) {
    const r = await db.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  async findByIdWithPassword(id) {
    const r = await db.query(`SELECT ${COLS}, password FROM users WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  async findByEmail(email) {
    const r = await db.query(`SELECT ${COLS}, password FROM users WHERE email = $1`, [email]);
    return r.rows[0] || null;
  },

  async emailExists(email, excludeId = null) {
    if (excludeId) {
      const r = await db.query('SELECT 1 FROM users WHERE email = $1 AND id != $2 LIMIT 1', [email, excludeId]);
      return r.rows.length > 0;
    }
    const r = await db.query('SELECT 1 FROM users WHERE email = $1 LIMIT 1', [email]);
    return r.rows.length > 0;
  },

  async create({ name, email, password, role, parent_id, credits = 0 }, client) {
    const q = client || db;
    const r = await q.query(
      `INSERT INTO users (name, email, password, role, parent_id, credits)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, email, password, role, parent_id || null, credits]
    );
    return r.rows[0].id;
  },

  async update(id, fields, client) {
    const q = client || db;
    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const set  = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await q.query(`UPDATE users SET ${set} WHERE id = $1`, [id, ...vals]);
  },

  async findDirectChildren(parentId, role) {
    const r = await db.query(
      `SELECT ${COLS} FROM users WHERE parent_id = $1 AND role = $2 ORDER BY created_at DESC`,
      [parentId, role]
    );
    return r.rows;
  },

  /** IDs created directly by this user (any role) */
  async findCreatedBy(parentId) {
    const r = await db.query(
      `SELECT ${COLS} FROM users WHERE parent_id = $1 ORDER BY created_at DESC`,
      [parentId]
    );
    return r.rows;
  },

  /** Every ID below this user in the tree (any depth), with parent email */
  async findDescendants(parentId) {
    const r = await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM users WHERE parent_id = $1
        UNION ALL
        SELECT u.id FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )
      SELECT ${COLS.split(', ').map(c => 'u.' + c).join(', ')}, p.email AS parent_email
      FROM users u
      INNER JOIN tree t ON t.id = u.id
      LEFT JOIN users p ON p.id = u.parent_id
      ORDER BY u.created_at DESC
    `, [parentId]);
    return r.rows;
  },

  /** Recursively get all descendant user IDs */
  async getDescendantIds(parentId) {
    // Use a recursive CTE for efficiency
    const r = await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM users WHERE parent_id = $1
        UNION ALL
        SELECT u.id FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )
      SELECT id FROM tree
    `, [parentId]);
    return r.rows.map(row => row.id);
  },

  /** Walk up the parent chain, return true if any ancestor is inactive or suspended_due */
  async isAncestorSuspended(userId) {
    const r = await db.query(`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, status, due_amount FROM users WHERE id = $1
        UNION ALL
        SELECT u.id, u.parent_id, u.status, u.due_amount
        FROM users u INNER JOIN chain c ON u.id = c.parent_id
      )
      SELECT 1 FROM chain
      WHERE id != $1
        AND (status = 'inactive' OR (status = 'suspended_due' AND due_amount > 0))
      LIMIT 1
    `, [userId]);
    return r.rows.length > 0;
  },

  /** Nearest ancestor that blocks this user (inactive or suspended with due), or null */
  async findBlockingAncestor(userId, client) {
    const q = client || db;
    const r = await q.query(`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, 0 AS depth FROM users WHERE id = $1
        UNION ALL
        SELECT u.id, u.parent_id, c.depth + 1
        FROM users u INNER JOIN chain c ON u.id = c.parent_id
      )
      SELECT u.name, u.email, u.role, u.status, u.due_amount
      FROM chain c INNER JOIN users u ON u.id = c.id
      WHERE c.id != $1
        AND (u.status = 'inactive' OR (u.status = 'suspended_due' AND u.due_amount > 0))
      ORDER BY c.depth ASC
      LIMIT 1
    `, [userId]);
    return r.rows[0] || null;
  },

  /** Every account (controller view), with parent email */
  async findAll() {
    const r = await db.query(`
      SELECT u.id, u.name, u.email, u.role, u.status, u.credits, u.due_amount, u.due_deadline, u.created_at,
             p.email AS parent_email
      FROM users u LEFT JOIN users p ON p.id = u.parent_id
      ORDER BY u.created_at DESC
    `);
    return r.rows;
  },

  /**
   * Deactivate a user and its whole branch: every ID below it and every key
   * created in the branch. Rows turned off here are tagged cascade_from = userId
   * so activateBranch can restore exactly them.
   */
  async deactivateBranch(userId, client) {
    const q = client || db;
    await q.query(`UPDATE users SET status = 'inactive', cascade_from = NULL WHERE id = $1`, [userId]);
    await q.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM users WHERE parent_id = $1
        UNION ALL
        SELECT u.id FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )
      UPDATE users SET status = 'inactive', cascade_from = $1
      WHERE id IN (SELECT id FROM tree) AND status != 'inactive'
    `, [userId]);
    await q.query(`
      WITH RECURSIVE tree AS (
        SELECT $1::int AS id
        UNION ALL
        SELECT u.id FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )
      UPDATE keys SET status = 'inactive', cascade_from = $1
      WHERE created_by IN (SELECT id FROM tree) AND status = 'active'
    `, [userId]);
  },

  /**
   * Re-activate a user and restore everything in its branch that was turned off
   * by a cascade from it or from above it (cascades started lower in the branch stay).
   * Due suspensions are re-applied by Transaction.enforceDueDeadlines.
   */
  async activateBranch(userId, client) {
    const q = client || db;
    await q.query(`UPDATE users SET status = 'active', cascade_from = NULL WHERE id = $1`, [userId]);
    const treeSql = `
      WITH RECURSIVE tree AS (
        SELECT id FROM users WHERE parent_id = $1
        UNION ALL
        SELECT u.id FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )`;
    await q.query(`${treeSql}
      UPDATE users SET status = 'active', cascade_from = NULL
      WHERE id IN (SELECT id FROM tree)
        AND cascade_from IS NOT NULL
        AND cascade_from NOT IN (SELECT id FROM tree)
    `, [userId]);
    await q.query(`${treeSql}
      UPDATE keys SET status = 'active', cascade_from = NULL
      WHERE (created_by = $1 OR created_by IN (SELECT id FROM tree))
        AND status = 'inactive' AND due_lock = 0
        AND cascade_from IS NOT NULL
        AND cascade_from NOT IN (SELECT id FROM tree)
    `, [userId]);
  },

  async suspendDescendants(parentId, client) {
    const q = client || db;
    // Suspend all active descendants recursively
    await q.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM users WHERE parent_id = $1
        UNION ALL
        SELECT u.id FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )
      UPDATE users SET status = 'suspended_due'
      WHERE id IN (SELECT id FROM tree) AND status = 'active'
    `, [parentId]);
  },

  async reactivateDescendants(parentId, client) {
    const q = client || db;
    // Reactivate suspended_due descendants that have no due of their own
    await q.query(`
      WITH RECURSIVE tree AS (
        SELECT id, due_amount, role FROM users WHERE parent_id = $1
        UNION ALL
        SELECT u.id, u.due_amount, u.role FROM users u INNER JOIN tree t ON u.parent_id = t.id
      )
      UPDATE users SET
        status = 'active',
        due_deadline = CASE WHEN due_amount > 0
          THEN NOW() + make_interval(hours => CASE role
            WHEN 'seller'       THEN 26
            WHEN 'super'        THEN 60
            WHEN 'admin'        THEN 80
            WHEN 'super_master' THEN 110
            WHEN 'developer'    THEN 140
            ELSE 72
          END)
          ELSE NULL END
      WHERE id IN (SELECT id FROM tree) AND status = 'suspended_due'
    `, [parentId]);
  },

  async countByRole() {
    const r = await db.query('SELECT role, COUNT(*) AS cnt FROM users GROUP BY role');
    const out = {};
    for (const row of r.rows) out[row.role] = parseInt(row.cnt, 10);
    return out;
  },

  async getControllerUser() {
    const r = await db.query(`SELECT ${COLS} FROM users WHERE role = 'controller' ORDER BY id ASC LIMIT 1`);
    return r.rows[0] || null;
  },

  // Role sort order (lower = higher up in hierarchy)
  roleSortOrder(role) {
    const order = { controller: 0, developer: 1, super_master: 2, admin: 3, super: 4, seller: 5 };
    return order[role] ?? 99;
  },

  roleLabel(role) {
    return (role || '').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  },
};

module.exports = User;
