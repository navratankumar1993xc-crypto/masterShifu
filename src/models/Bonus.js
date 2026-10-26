'use strict';
/**
 * 365-Day Free Bonus Key System (seller-only).
 *
 * Rules (user-approved):
 *  - Seller ne last 30 din me >= bonus_monthly_target (10) real keys banayi
 *    AUR uske >= bonus_running_required (10) keys "running" (status=active) hain
 *    → ek 365-din ki FREE bonus key auto-create (paid, is_bonus=1).
 *  - Running keys < required ho jaayein → bonus key sirf DEACTIVATE hoti hai,
 *    365-din ka countdown CHALTA RAHTA hai (expiry_date change nahi hoti).
 *  - Running keys wapas >= required → bonus key dobara active (agar expire nahi hui).
 *
 * Settings: bonus_offer_enabled, bonus_monthly_target, bonus_running_required,
 *           bonus_validity_days.
 */
const db          = require('../db/pool');
const Setting     = require('./Setting');
const Key         = require('./Key');
const Transaction = require('./Transaction');

const Bonus = {
  async config() {
    const s = await Setting.getMany([
      'bonus_offer_enabled', 'bonus_monthly_target',
      'bonus_running_required', 'bonus_validity_days',
    ]);
    return {
      enabled:         s.bonus_offer_enabled === '1',
      monthlyTarget:   parseInt(s.bonus_monthly_target, 10)   || 10,
      runningRequired: parseInt(s.bonus_running_required, 10) || 10,
      validityDays:    parseInt(s.bonus_validity_days, 10)    || 365,
    };
  },

  async genBonusKeyValue(q) {
    let n = parseInt(
      (await q.query("SELECT COUNT(*) AS c FROM keys WHERE key_value LIKE 'BONUS%'")).rows[0].c,
      10
    );
    // eslint-disable-next-line no-constant-condition
    while (true) {
      n += 1;
      const kv = `BONUS${n}`;
      const exists = await q.query('SELECT 1 FROM keys WHERE key_value = $1 LIMIT 1', [kv]);
      if (!exists.rows.length) return kv;
    }
  },

  /** Ek seller ke liye bonus key award / activate / deactivate sync karo. */
  async syncSeller(sellerId, client) {
    const q = client || db;
    const cfgB = await this.config();
    if (!cfgB.enabled) return null;

    const ur = await q.query('SELECT role FROM users WHERE id = $1', [sellerId]);
    if (ur.rows[0]?.role !== 'seller') return null;

    // Last 30 din me banayi gayi real (non-bonus) keys
    const monthRes = await q.query(
      `SELECT COUNT(*) AS c FROM keys
       WHERE created_by = $1 AND is_bonus = 0 AND created_at >= NOW() - INTERVAL '30 days'`,
      [sellerId]
    );
    const monthlyCreated = parseInt(monthRes.rows[0].c, 10);

    // Running = active, non-bonus keys
    const runRes = await q.query(
      `SELECT COUNT(*) AS c FROM keys
       WHERE created_by = $1 AND is_bonus = 0 AND status = 'active'`,
      [sellerId]
    );
    const running = parseInt(runRes.rows[0].c, 10);

    // Maujooda (non-expired) bonus key
    const bRes = await q.query(
      `SELECT id, status FROM keys
       WHERE created_by = $1 AND is_bonus = 1 AND status != 'expired'
       ORDER BY id DESC LIMIT 1`,
      [sellerId]
    );
    const bonus = bRes.rows[0];

    if (!bonus) {
      // Eligible? → nayi 365-din bonus key banao
      if (monthlyCreated >= cfgB.monthlyTarget && running >= cfgB.runningRequired) {
        const kv     = await this.genBonusKeyValue(q);
        const expiry = Key.newExpiryDate(cfgB.validityDays);
        await q.query(
          `INSERT INTO keys (key_value, status, created_by, expiry_date, payment_status, is_bonus)
           VALUES ($1, 'active', $2, $3, 'paid', 1)`,
          [kv, sellerId, expiry]
        );
        await Transaction.log({
          txn_type:   'bonus_key_award',
          to_user_id: sellerId,
          created_by: sellerId,
          note:       `365-day Bonus Key ${kv} awarded (${monthlyCreated} keys/30d, ${running} running)`,
        }, client);
        return { action: 'awarded', key: kv };
      }
      return null;
    }

    // Bonus key exists → running count ke hisaab se on/off (countdown nahi rukta)
    if (running < cfgB.runningRequired && bonus.status === 'active') {
      await q.query("UPDATE keys SET status = 'inactive' WHERE id = $1", [bonus.id]);
      return { action: 'deactivated' };
    }
    if (running >= cfgB.runningRequired && bonus.status === 'inactive') {
      await q.query("UPDATE keys SET status = 'active' WHERE id = $1", [bonus.id]);
      return { action: 'reactivated' };
    }
    return null;
  },

  /** Sabhi sellers ke liye sync (keys list load par self-heal). */
  async syncAll(client) {
    const q = client || db;
    const cfgB = await this.config();
    if (!cfgB.enabled) return;
    const sellers = await q.query(
      "SELECT id FROM users WHERE role = 'seller'"
    );
    for (const row of sellers.rows) {
      try { await this.syncSeller(row.id, client); }
      catch (e) { console.error('[Bonus.syncAll]', row.id, e.message); }
    }
  },
};

module.exports = Bonus;
