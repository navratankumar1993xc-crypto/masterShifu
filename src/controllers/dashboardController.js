'use strict';
const db          = require('../db/pool');
const User        = require('../models/User');
const Key         = require('../models/Key');
const Ticket      = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const Setting     = require('../models/Setting');
const cfg         = require('../config');

exports.getDashboard = async (req, res, next) => {
  try {
    const user = req.user;
    await Key.autoExpire();

    // Gather stats depending on role
    let stats = {};

    if (user.role === 'controller') {
      const userCounts  = await User.countByRole();
      const keyCounts   = await Key.countByStatus();
      const ticketToday = await Ticket.countToday();
      const totalTickets = await Ticket.count();
      const settings    = await Setting.getMany([
        'demo_creation_enabled', 'download_zip_url',
        'gift_offer_enabled', 'gift_offer_message',
        'bonus_offer_enabled',
      ]);
      stats = { userCounts, keyCounts, ticketToday, totalTickets, settings };
    } else {
      const descIds = await User.getDescendantIds(user.id);
      const allIds  = [user.id, ...descIds];

      const keysRes = await db.query(
        `SELECT status, COUNT(*) AS cnt FROM keys
         WHERE created_by = ANY($1::int[]) GROUP BY status`,
        [allIds]
      );
      const keyCounts = {};
      for (const row of keysRes.rows) keyCounts[row.status] = parseInt(row.cnt, 10);

      // Direct children count
      const targetRole = cfg.roleMap[user.role] || null;
      let childrenCount = 0;
      if (targetRole) {
        const r = await db.query(
          'SELECT COUNT(*) AS cnt FROM users WHERE parent_id = $1',
          [user.id]
        );
        childrenCount = parseInt(r.rows[0].cnt, 10);
      }

      stats = { keyCounts, childrenCount, targetRole };
    }

    // Recent transactions
    const recentTxns = await Transaction.forUser(user.id, {});

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats,
      recentTxns: recentTxns.slice(0, 10),
      cfg,
    });
  } catch (err) {
    next(err);
  }
};

exports.postSettings = async (req, res, next) => {
  if (req.user.role !== 'controller') return res.redirect('/dashboard');
  try {
    const { demo_enabled, download_zip_url, gift_offer_enabled, gift_offer_message, bonus_offer_enabled } = req.body;
    await Setting.set('demo_creation_enabled', demo_enabled === '1' ? '1' : '0');
    if (download_zip_url) await Setting.set('download_zip_url', download_zip_url.trim());
    await Setting.set('gift_offer_enabled', gift_offer_enabled === '1' ? '1' : '0');
    if (gift_offer_message) await Setting.set('gift_offer_message', gift_offer_message.trim());
    await Setting.set('bonus_offer_enabled', bonus_offer_enabled === '1' ? '1' : '0');
    req.flash('success', 'Settings updated successfully.');
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.postQuickCredit = async (req, res, next) => {
  const user = req.user;
  const targetId = parseInt(req.body.target_user_id, 10);
  const amount   = parseInt(req.body.credits_amount, 10);

  if (!targetId || amount <= 0) {
    req.flash('error', 'Please enter a valid credit amount.');
    return res.redirect('/dashboard');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const tgt = await client.query(
      'SELECT id, name, role, parent_id FROM users WHERE id = $1 AND parent_id = $2',
      [targetId, user.id]
    );
    if (!tgt.rows.length) {
      req.flash('error', 'Target user not found or not your direct child.');
      await client.query('ROLLBACK');
      return res.redirect('/dashboard');
    }

    if (user.role !== 'controller') {
      const meRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const myCredits = parseInt(meRes.rows[0].credits, 10);
      if (myCredits < amount) {
        req.flash('error', `Insufficient credits. You have ${myCredits}.`);
        await client.query('ROLLBACK');
        return res.redirect('/dashboard');
      }
      await client.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [amount, user.id]);
    }

    await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [amount, targetId]);
    await Transaction.log({
      txn_type:     user.role === 'controller' ? 'credit_add' : 'credit_transfer',
      from_user_id: user.role === 'controller' ? null : user.id,
      to_user_id:   targetId,
      credits:      amount,
      created_by:   user.id,
      note:         'Quick credit from dashboard',
    }, client);

    await client.query('COMMIT');
    req.flash('success', `${amount} credits sent to ${tgt.rows[0].name}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
  res.redirect('/dashboard');
};
