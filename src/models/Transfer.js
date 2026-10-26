'use strict';
/**
 * Transfer / Update System — key aur account ownership move karna, audit ke saath.
 *
 *  - Key transfer:   key.created_by ek seller se dusre seller ko. Key ka pending
 *                    seller-level DUE naye seller ke paas chala jaata hai
 *                    (user-approved). Expiry/status/payment preserve.
 *  - Account transfer: user.parent_id badalna (seller→naya super, super→naya admin,
 *                    admin→naya super_master, developer→naya controller). Keys,
 *                    payment history, due records sab preserve (sirf parent badalta).
 *
 * Har transfer `transfers` table me audit hota hai + panel_transactions me log.
 * Permission checks controller layer (transferController) me hain.
 */
const db          = require('../db/pool');
const Transaction = require('./Transaction');
const cfg         = require('../config');

// Node role → uska parent kis role ka hona chahiye
const PARENT_ROLE = {
  developer:    'controller',
  super_master: 'developer',
  admin:        'super_master',
  super:        'admin',
  seller:       'super',
};

const Transfer = {
  PARENT_ROLE,

  async audit({ transfer_type, subject_id, subject_label, from_user_id, to_user_id, moved_by, due_moved = 0, meta = null }, client) {
    const q = client || db;
    await q.query(
      `INSERT INTO transfers
         (transfer_type, subject_id, subject_label, from_user_id, to_user_id, moved_by, due_moved, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [transfer_type, subject_id, subject_label || null, from_user_id || null,
       to_user_id || null, moved_by, due_moved, meta ? JSON.stringify(meta) : null]
    );
  },

  /**
   * KEY ownership transfer. Due naye seller ke paas jaata hai.
   * @returns {{ ok:boolean, error?:string, dueMoved?:number, keyValue?:string, from?:number }}
   */
  async transferKey({ keyId, toSellerId, movedBy }, client) {
    const q = client || db;

    const kr = await q.query(
      'SELECT id, key_value, created_by, is_bonus FROM keys WHERE id = $1 FOR UPDATE',
      [keyId]
    );
    const key = kr.rows[0];
    if (!key) return { ok: false, error: 'Key not found.' };
    if (key.is_bonus) return { ok: false, error: 'Bonus keys transfer nahi ho saktin.' };

    const from = parseInt(key.created_by, 10);
    if (from === toSellerId) return { ok: false, error: 'Key already belongs to that seller.' };

    const tr = await q.query('SELECT id, role FROM users WHERE id = $1', [toSellerId]);
    if (!tr.rows[0] || tr.rows[0].role !== 'seller') {
      return { ok: false, error: 'Target must be a valid seller.' };
    }

    // Seller-level open due for this key → naye seller ko move
    const dueRes = await q.query(
      `SELECT COALESCE(SUM(amount),0) AS amt
       FROM key_due_ledger
       WHERE key_id = $1 AND panel_user_id = $2 AND cleared_at IS NULL`,
      [keyId, from]
    );
    const dueMoved = parseInt(dueRes.rows[0].amt, 10) || 0;

    if (dueMoved > 0) {
      await q.query(
        `UPDATE key_due_ledger SET panel_user_id = $1
         WHERE key_id = $2 AND panel_user_id = $3 AND cleared_at IS NULL`,
        [toSellerId, keyId, from]
      );
      // old seller ka due ghatao, naye seller ka badhao
      await q.query('UPDATE users SET due_amount = GREATEST(0, due_amount - $1) WHERE id = $2', [dueMoved, from]);
      await q.query(
        `UPDATE users SET
           due_amount = due_amount + $1,
           due_deadline = COALESCE(due_deadline, NOW() + make_interval(hours => 26))
         WHERE id = $2`,
        [dueMoved, toSellerId]
      );
    }

    await q.query('UPDATE keys SET created_by = $1 WHERE id = $2', [toSellerId, keyId]);

    await this.audit({
      transfer_type: 'key',
      subject_id:    keyId,
      subject_label: key.key_value,
      from_user_id:  from,
      to_user_id:    toSellerId,
      moved_by:      movedBy,
      due_moved:     dueMoved,
    }, client);

    await Transaction.log({
      txn_type:     'key_transfer',
      from_user_id: from,
      to_user_id:   toSellerId,
      key_id:       keyId,
      key_value:    key.key_value,
      amount:       dueMoved,
      created_by:   movedBy,
      note:         `Key transferred (due moved: ${dueMoved})`,
    }, client);

    return { ok: true, dueMoved, keyValue: key.key_value, from };
  },

  /**
   * ACCOUNT parent transfer. Keys/history/due preserve — sirf parent badalta.
   * @returns {{ ok:boolean, error?:string, email?:string, from?:number }}
   */
  async transferAccount({ userId, newParentId, movedBy, descendantIdsOfUser }, client) {
    const q = client || db;

    const ur = await q.query(
      'SELECT id, email, role, parent_id FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const node = ur.rows[0];
    if (!node) return { ok: false, error: 'User not found.' };

    const needRole = PARENT_ROLE[node.role];
    if (!needRole) return { ok: false, error: `${node.role} accounts cannot be transferred.` };

    if (newParentId === userId) return { ok: false, error: 'Cannot set an account as its own parent.' };
    if (Array.isArray(descendantIdsOfUser) && descendantIdsOfUser.includes(newParentId)) {
      return { ok: false, error: 'Cannot move an account under its own descendant.' };
    }

    const pr = await q.query('SELECT id, role FROM users WHERE id = $1', [newParentId]);
    if (!pr.rows[0]) return { ok: false, error: 'New parent not found.' };
    // Any role above the node may be its parent (higher roles can create lower IDs directly)
    const order = cfg.roleOrder;
    if (order.indexOf(pr.rows[0].role) >= order.indexOf(node.role)) {
      return { ok: false, error: `New parent must be a role above ${node.role.replace('_', ' ')}.` };
    }

    const from = node.parent_id;
    if (from === newParentId) return { ok: false, error: 'Account already under that parent.' };

    await q.query('UPDATE users SET parent_id = $1 WHERE id = $2', [newParentId, userId]);

    await this.audit({
      transfer_type: 'account',
      subject_id:    userId,
      subject_label: node.email,
      from_user_id:  from,
      to_user_id:    newParentId,
      moved_by:      movedBy,
      meta:          { role: node.role },
    }, client);

    await Transaction.log({
      txn_type:     'account_transfer',
      from_user_id: from,
      to_user_id:   newParentId,
      created_by:   movedBy,
      note:         `${node.role} ${node.email} transferred to new parent`,
    }, client);

    return { ok: true, email: node.email, from };
  },

  /** Branch-scoped audit list. */
  async list(viewerId, role) {
    if (role === 'controller') {
      const r = await db.query(
        `SELECT t.*, mb.email AS moved_by_email,
                fu.email AS from_email, tu.email AS to_email
         FROM transfers t
         LEFT JOIN users mb ON mb.id = t.moved_by
         LEFT JOIN users fu ON fu.id = t.from_user_id
         LEFT JOIN users tu ON tu.id = t.to_user_id
         ORDER BY t.created_at DESC LIMIT 500`
      );
      return r.rows;
    }
    const User = require('./User');
    const descIds = await User.getDescendantIds(viewerId);
    const ids = [viewerId, ...descIds];
    const ph  = ids.map((_, i) => `$${i + 1}`).join(', ');
    const r = await db.query(
      `SELECT t.*, mb.email AS moved_by_email,
              fu.email AS from_email, tu.email AS to_email
       FROM transfers t
       LEFT JOIN users mb ON mb.id = t.moved_by
       LEFT JOIN users fu ON fu.id = t.from_user_id
       LEFT JOIN users tu ON tu.id = t.to_user_id
       WHERE t.moved_by IN (${ph})
          OR t.from_user_id IN (${ph})
          OR t.to_user_id IN (${ph})
       ORDER BY t.created_at DESC LIMIT 500`,
      ids
    );
    return r.rows;
  },
};

module.exports = Transfer;
