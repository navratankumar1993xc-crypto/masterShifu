'use strict';
const db  = require('../db/pool');
const cfg = require('../config');

const Transaction = {
  async log({ txn_type, from_user_id, to_user_id, amount = 0, credits = 0,
               key_id, key_value, note, created_by }, client) {
    const q = client || db;
    await q.query(
      `INSERT INTO panel_transactions
         (txn_type, from_user_id, to_user_id, amount, credits, key_id, key_value, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [txn_type, from_user_id || null, to_user_id || null, amount, credits,
       key_id || null, key_value || null, note || null, created_by]
    );
  },

  async forUser(userId, { fromDate, toDate } = {}) {
    let sql = `
      SELECT pt.*,
        fu.email AS from_email, fu.name AS from_name,
        tu.email AS to_email,   tu.name AS to_name
      FROM panel_transactions pt
      LEFT JOIN users fu ON fu.id = pt.from_user_id
      LEFT JOIN users tu ON tu.id = pt.to_user_id
      WHERE (pt.from_user_id = $1 OR pt.to_user_id = $1)
    `;
    const params = [userId];
    if (fromDate) { params.push(fromDate); sql += ` AND pt.created_at >= $${params.length}`; }
    if (toDate)   { params.push(toDate);   sql += ` AND pt.created_at <= $${params.length}`; }
    sql += ' ORDER BY pt.created_at DESC LIMIT 500';
    const r = await db.query(sql, params);
    return r.rows;
  },

  async forBranch(userIds, { fromDate, toDate } = {}) {
    if (!userIds.length) return [];
    const ph = userIds.map((_, i) => `$${i + 1}`).join(', ');
    let sql = `
      SELECT pt.*,
        fu.email AS from_email, fu.name AS from_name,
        tu.email AS to_email,   tu.name AS to_name
      FROM panel_transactions pt
      LEFT JOIN users fu ON fu.id = pt.from_user_id
      LEFT JOIN users tu ON tu.id = pt.to_user_id
      WHERE (pt.from_user_id IN (${ph}) OR pt.to_user_id IN (${ph}))
    `;
    const params = [...userIds];
    if (fromDate) { params.push(fromDate); sql += ` AND pt.created_at >= $${params.length}`; }
    if (toDate)   { params.push(toDate);   sql += ` AND pt.created_at <= $${params.length}`; }
    sql += ' ORDER BY pt.created_at DESC LIMIT 500';
    const r = await db.query(sql, params);
    return r.rows;
  },

  // ── Due propagation ──────────────────────────────────────────────────────────

  /**
   * Walk up the parent chain from userId, adding due at each level according to role rates.
   */
  async propagateDues(userId, { key_id, key_value, paid_by }, client) {
    const q = client || db;

    // Fetch user + full upline in one CTE
    const chain = await db.query(`
      WITH RECURSIVE chain AS (
        SELECT id, role, parent_id, due_amount FROM users WHERE id = $1
        UNION ALL
        SELECT u.id, u.role, u.parent_id, u.due_amount
        FROM users u INNER JOIN chain c ON u.id = c.parent_id
      )
      SELECT * FROM chain
    `, [userId]);

    for (const row of chain.rows) {
      const addAmt  = cfg.dueRates[row.role] || 0;
      if (addAmt <= 0) continue;

      const hours   = cfg.deadlineHours[row.role] || 72;
      const noDue   = parseInt(row.due_amount, 10) === 0;

      if (noDue) {
        await q.query(
          `UPDATE users SET
             due_amount = due_amount + $1,
             due_deadline = NOW() + make_interval(hours => $2)
           WHERE id = $3`,
          [addAmt, hours, row.id]
        );
      } else {
        await q.query(
          `UPDATE users SET
             due_amount = due_amount + $1,
             due_deadline = COALESCE(due_deadline, NOW() + make_interval(hours => $2))
           WHERE id = $3`,
          [addAmt, hours, row.id]
        );
      }

      await this.log({
        txn_type:     'due_add',
        to_user_id:   row.id,
        from_user_id: userId,
        amount:       addAmt,
        key_id,
        key_value,
        created_by:   paid_by,
        note:         'Key payment due propagated',
      }, client);

      // Record in key_due_ledger
      const deadlineRes = await q.query('SELECT due_deadline FROM users WHERE id = $1', [row.id]);
      const deadline    = deadlineRes.rows[0]?.due_deadline;
      if (key_id && deadline) {
        await q.query(
          `INSERT INTO key_due_ledger (key_id, key_value, panel_user_id, amount, deadline)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (key_id, panel_user_id) DO UPDATE
             SET amount = key_due_ledger.amount + EXCLUDED.amount,
                 deadline = EXCLUDED.deadline`,
          [key_id, key_value, row.id, addAmt, deadline]
        );
      }
    }
  },

  // ── Due enforcement ──────────────────────────────────────────────────────────

  async enforceDueDeadlines(client) {
    const q = client || db;

    // Fix stale suspensions where due is already 0
    await q.query(`
      UPDATE users SET status = 'active', due_deadline = NULL
      WHERE status = 'suspended_due' AND due_amount = 0
    `);

    // Due but no deadline set — suspend immediately
    await q.query(`
      UPDATE users SET status = 'suspended_due'
      WHERE due_amount > 0 AND due_deadline IS NULL AND status = 'active'
    `);

    // Deadline passed — suspend
    await q.query(`
      UPDATE users SET status = 'suspended_due'
      WHERE due_amount > 0 AND due_deadline IS NOT NULL
        AND due_deadline <= NOW() AND status = 'active'
    `);

    // Sync key due_lock: lock keys where any open ledger entry is overdue
    await q.query(`
      UPDATE keys k
      SET due_lock = 1, status = 'inactive'
      WHERE EXISTS (
        SELECT 1 FROM key_due_ledger l
        WHERE l.key_id = k.id
          AND l.cleared_at IS NULL
          AND l.deadline <= NOW()
      ) AND k.status != 'expired'
    `);
  },

  // ── Due receive ──────────────────────────────────────────────────────────────

  async receiveAndAllocate(childId, receiveAmount, parentId, client) {
    const q = client || db;

    await q.query(
      `UPDATE users SET due_amount = GREATEST(0, due_amount - $1) WHERE id = $2`,
      [receiveAmount, childId]
    );

    await this.log({
      txn_type:     'due_receive',
      from_user_id: childId,
      to_user_id:   parentId,
      amount:       receiveAmount,
      created_by:   parentId,
      note:         'Due received from child',
    }, client);

    // Clear oldest open key_due_ledger entries for this child
    await q.query(`
      WITH ranked AS (
        SELECT id, amount,
               SUM(amount) OVER (ORDER BY deadline ASC) AS running_total
        FROM key_due_ledger
        WHERE panel_user_id = $1 AND cleared_at IS NULL
      )
      UPDATE key_due_ledger SET cleared_at = NOW()
      WHERE id IN (SELECT id FROM ranked WHERE running_total <= $2)
    `, [childId, receiveAmount]);

    // If due is now 0, clear deadline + reactivate
    const check = await q.query('SELECT due_amount FROM users WHERE id = $1', [childId]);
    if (parseInt(check.rows[0]?.due_amount, 10) === 0) {
      await q.query(
        `UPDATE users SET status = 'active', due_deadline = NULL WHERE id = $1`,
        [childId]
      );
    }
  },
};

module.exports = Transaction;
