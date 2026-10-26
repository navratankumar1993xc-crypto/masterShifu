'use strict';
const db          = require('../db/pool');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const cfg         = require('../config');

exports.index = async (req, res, next) => {
  try {
    const user       = req.user;
    const targetRole = cfg.roleMap[user.role];
    if (!targetRole) return res.redirect('/dashboard');

    const children = await User.findCreatedBy(user.id);
    res.render('credits/index', {
      title:       'Credit Management',
      children,
      targetRole,
      targetLabel: User.roleLabel(targetRole),
    });
  } catch (err) { next(err); }
};

exports.add = async (req, res, next) => {
  const user       = req.user;
  const targetRole = cfg.roleMap[user.role];
  if (!targetRole) return res.redirect('/dashboard');

  const targetId = parseInt(req.body.user_id, 10);
  const amount   = parseInt(req.body.credits_to_add, 10);

  if (!amount || amount <= 0) {
    req.flash('error', 'Please enter a valid credit amount.');
    return res.redirect('/credits');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const tgtRes = await client.query(
      'SELECT id, name, role FROM users WHERE id = $1 AND parent_id = $2',
      [targetId, user.id]
    );
    if (!tgtRes.rows.length) {
      req.flash('error', 'Target user not found.');
      await client.query('ROLLBACK');
      return res.redirect('/credits');
    }

    if (user.role !== 'controller') {
      const meRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const mine  = parseInt(meRes.rows[0].credits, 10);
      if (mine < amount) {
        req.flash('error', `Insufficient credits. You have ${mine}.`);
        await client.query('ROLLBACK');
        return res.redirect('/credits');
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
      note:         'Credits added via Credit Manager',
    }, client);

    await client.query('COMMIT');
    req.flash('success', `${amount} credits added to ${tgtRes.rows[0].name}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/credits');
};
