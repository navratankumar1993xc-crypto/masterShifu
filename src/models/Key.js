'use strict';
const db  = require('../db/pool');
const cfg = require('../config');
const User = require('./User');

const COLS     = 'id, key_value, status, payment_status, created_by, mac_id, mac_bound_at, expiry_date, due_lock, is_bonus, created_at';
const COLS_K   = 'k.id, k.key_value, k.status, k.payment_status, k.created_by, k.mac_id, k.mac_bound_at, k.expiry_date, k.due_lock, k.is_bonus, k.created_at';

const Key = {
  async findById(id, client) {
    const q = client || db;
    const r = await q.query(`SELECT ${COLS} FROM keys WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  async findByValue(keyValue, client) {
    const q = client || db;
    const r = await q.query(`SELECT ${COLS} FROM keys WHERE UPPER(key_value) = UPPER($1)`, [keyValue]);
    return r.rows[0] || null;
  },

  async valueExists(keyValue) {
    const r = await db.query('SELECT 1 FROM keys WHERE UPPER(key_value) = UPPER($1) LIMIT 1', [keyValue]);
    return r.rows.length > 0;
  },

  async create({ key_value, created_by, expiry_date, payment_status = 'unpaid', status = 'active' }, client) {
    const q = client || db;
    const r = await q.query(
      `INSERT INTO keys (key_value, status, created_by, expiry_date, payment_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [key_value, status, created_by, expiry_date || null, payment_status]
    );
    return r.rows[0].id;
  },

  async update(id, fields, client) {
    const q = client || db;
    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const set  = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await q.query(`UPDATE keys SET ${set} WHERE id = $1`, [id, ...vals]);
  },

  async delete(id, client) {
    const q = client || db;
    await q.query('DELETE FROM keys WHERE id = $1', [id]);
  },

  /** All keys visible to a user (own + all descendants) */
  async findForUser(userId, role, descendantIds = []) {
    if (role === 'controller') {
      const r = await db.query(
        `SELECT ${COLS_K}, u.email AS creator_email, u.name AS creator_name
         FROM keys k
         JOIN users u ON u.id = k.created_by
         ORDER BY k.created_at DESC`
      );
      return r.rows;
    }
    const ids = [userId, ...descendantIds];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const r = await db.query(
      `SELECT ${COLS_K}, u.email AS creator_email, u.name AS creator_name
       FROM keys k
       JOIN users u ON u.id = k.created_by
       WHERE k.created_by IN (${placeholders})
       ORDER BY k.created_at DESC`,
      ids
    );
    return r.rows;
  },

  /** All keys created by a specific seller */
  async findByCreator(createdBy) {
    const r = await db.query(
      `SELECT ${COLS} FROM keys WHERE created_by = $1 ORDER BY created_at DESC`,
      [createdBy]
    );
    return r.rows;
  },

  /** Keys created by any of the given user IDs */
  async findByCreators(userIds) {
    if (!userIds.length) return [];
    const ph = userIds.map((_, i) => `$${i + 1}`).join(', ');
    const r  = await db.query(
      `SELECT ${COLS} FROM keys WHERE created_by IN (${ph})`,
      userIds
    );
    return r.rows;
  },

  /** Mark expired keys — use IST date for comparison */
  async autoExpire() {
    await db.query(
      `UPDATE keys SET status = 'expired'
       WHERE expiry_date IS NOT NULL
         AND expiry_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
         AND status != 'expired'`
    );
  },

  /** Set all keys of a seller active/inactive */
  async setSellerKeysStatus(sellerId, status, client) {
    const q = client || db;
    if (status === 'inactive') {
      await q.query(
        `UPDATE keys SET status = 'inactive', due_lock = 0
         WHERE created_by = $1 AND status = 'active'`,
        [sellerId]
      );
    } else {
      await q.query(
        `UPDATE keys SET status = 'active', due_lock = 0
         WHERE created_by = $1 AND status = 'inactive' AND due_lock = 0`,
        [sellerId]
      );
    }
  },

  async count() {
    const r = await db.query('SELECT COUNT(*) AS cnt FROM keys');
    return parseInt(r.rows[0].cnt, 10);
  },

  async countByStatus() {
    const r = await db.query('SELECT status, COUNT(*) AS cnt FROM keys GROUP BY status');
    const out = {};
    for (const row of r.rows) out[row.status] = parseInt(row.cnt, 10);
    return out;
  },

  /** New expiry date: today (IST) + keyValidityDays */
  newExpiryDate(daysFromNow = null) {
    const days = daysFromNow !== null ? daysFromNow : cfg.keyValidityDays;
    // Use IST date to avoid UTC midnight shifting date back
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    now.setDate(now.getDate() + days);
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const dd   = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  /** Same as webPanel license_key_calc_left_days: expiry day itself counts as 1 day left */
  calcLeftDays(expiryDate) {
    if (!expiryDate) return 0;
    // Parse just the date part to avoid timezone issues
    const dateStr = typeof expiryDate === 'string'
      ? expiryDate.split('T')[0]
      : new Date(expiryDate).toLocaleDateString('en-CA'); // en-CA = YYYY-MM-DD
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const days = Math.round((Date.parse(dateStr) - Date.parse(todayStr)) / 86400000);
    if (!Number.isFinite(days) || days < 0) return 0;
    return Math.max(1, days);
  },

  /**
   * Bind MAC address to a key on first use (webPanel license_key_bind_mac).
   * Missing expiry gets today + keyValidityDays; an already-bound matching
   * key with no mac_bound_at gets it stamped.
   */
  async bindMac(keyId, macAddress, client) {
    const q = client || db;
    await q.query(
      `UPDATE keys SET mac_id = $1, mac_bound_at = NOW(),
              expiry_date = COALESCE(expiry_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date + $3::int)
       WHERE id = $2 AND (mac_id IS NULL OR mac_id = '')`,
      [macAddress, keyId, cfg.keyValidityDays]
    );
    await q.query(
      `UPDATE keys SET mac_bound_at = NOW()
       WHERE id = $2 AND mac_bound_at IS NULL AND LOWER(mac_id) = LOWER($1)`,
      [macAddress, keyId]
    );
  },

  /** Client-facing reason for an inactive key (webPanel panel_key_inactive_reason_message) */
  async inactiveReason(key, client) {
    const q = client || db;
    const label = (u) => `${User.roleLabel(u.role)}: User ID ${u.email || u.name || '-'}`;
    const due   = (u) => `₹${Number(u.due_amount || 0).toLocaleString('en-IN')}`;
    const dueMsg = (u) => u.status === 'inactive'
      ? `DEACTIVATED — Your access is blocked because your parent (${label(u)}) is deactivated. Please contact them to restore access.`
      : `DEACTIVATED — Your access is blocked because your parent (${label(u)}) is blocked because of due payment of ${due(u)}. Please contact them to restore access.`;

    const ledger = await q.query(
      `SELECT u.name, u.email, u.role, u.status, u.due_amount
       FROM key_due_ledger l
       INNER JOIN users u ON u.id = l.panel_user_id
       WHERE l.key_id = $1 AND l.cleared_at IS NULL AND l.deadline <= NOW()
       ORDER BY l.deadline ASC, l.id ASC
       LIMIT 1`,
      [key.id]
    );
    if (ledger.rows[0]) return dueMsg(ledger.rows[0]);

    const r = await q.query('SELECT id, name, email, role, status, due_amount FROM users WHERE id = $1', [key.created_by]);
    const seller = r.rows[0];
    if (!seller) return 'Aapki key band hai. Admin se contact karein.';
    if (seller.status === 'inactive') return dueMsg(seller);
    if (Number(seller.due_amount) > 0 && seller.status === 'suspended_due') return dueMsg(seller);
    // Seller is fine but someone up the chain is blocking
    const blocker = await User.findBlockingAncestor(seller.id, q);
    if (blocker) return dueMsg(blocker);
    return 'Aapki key abhi inactive hai. Apne seller / admin se contact karein.';
  },

  /** Reset MAC binding */
  async resetMac(keyId, client) {
    const q = client || db;
    await q.query(
      'UPDATE keys SET mac_id = NULL, mac_bound_at = NULL WHERE id = $1',
      [keyId]
    );
  },
};

module.exports = Key;
