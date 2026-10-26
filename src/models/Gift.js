'use strict';
/**
 * Gift Offer — "2 paid keys within a 7-day window = 1 free gift credit".
 * Window ko miss karne par counter reset ho jaata hai (nayi window shuru).
 * Gift credit sirf SELLER ko milta hai (chahe pay kisi parent panel ne kiya ho).
 *
 * Settings: gift_offer_enabled, gift_window_days (7), gift_target (2).
 */
const db          = require('../db/pool');
const Setting     = require('./Setting');
const Transaction = require('./Transaction');

const Gift = {
  async enabled() {
    return (await Setting.get('gift_offer_enabled', '0')) === '1';
  },

  /**
   * Seller ki key credit se pay/renew hone ke baad call karo.
   * @returns {Promise<string>} success me append karne layak extra text
   */
  async awardAfterCreditPay(sellerId, paidBy, client) {
    const q = client || db;
    if (!(await this.enabled())) return '';

    const windowDays = parseInt(await Setting.get('gift_window_days', '7'), 10) || 7;
    const target     = parseInt(await Setting.get('gift_target', '2'), 10) || 2;

    const r = await q.query(
      'SELECT role, gift_window_start, gift_pay_progress FROM users WHERE id = $1 FOR UPDATE',
      [sellerId]
    );
    const u = r.rows[0];
    if (!u || u.role !== 'seller') return '';

    const now       = Date.now();
    const startMs   = u.gift_window_start ? new Date(u.gift_window_start).getTime() : null;
    const windowOld = startMs === null || (now - startMs) > windowDays * 86400000;

    let progress;
    if (windowOld) {
      // Nayi 7-din window shuru, progress = 1
      progress = 1;
      await q.query(
        'UPDATE users SET gift_window_start = NOW(), gift_pay_progress = 1 WHERE id = $1',
        [sellerId]
      );
    } else {
      progress = parseInt(u.gift_pay_progress, 10) + 1;
      await q.query(
        'UPDATE users SET gift_pay_progress = $2 WHERE id = $1',
        [sellerId, progress]
      );
    }

    if (progress >= target) {
      // Gift credit award + window reset
      await q.query(
        'UPDATE users SET gift_credits = gift_credits + 1, gift_window_start = NULL, gift_pay_progress = 0 WHERE id = $1',
        [sellerId]
      );
      await Transaction.log({
        txn_type:   'key_pay_gift',
        to_user_id: sellerId,
        credits:    1,
        created_by: paidBy || sellerId,
        note:       `Gift credit earned (${target} keys in ${windowDays}-day window)`,
      }, client);
      return ` 🎁 Offer bonus: 1 Gift Credit mila! (Due me nahi dikhega)`;
    }

    return ` 🎁 Gift progress: ${progress}/${target} (${windowDays}-day window).`;
  },
};

module.exports = Gift;
