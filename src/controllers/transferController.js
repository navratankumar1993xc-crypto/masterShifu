'use strict';
/**
 * Transfer / Update System HTTP handlers + permission checks.
 *
 * Permission model:
 *  - Key transfer: performer = controller, ya key ke current owner ka koi upline
 *    (owner performer ke descendants me ho), ya khud owner (seller). Target seller
 *    performer ke branch me hona chahiye (controller ke liye koi bhi seller).
 *  - Account transfer: performer = controller, ya performer dono (node + naya parent)
 *    ka upline ho (dono performer ke descendants me). Role-compatibility Transfer
 *    model enforce karta hai.
 */
const db       = require('../db/pool');
const User     = require('../models/User');
const Transfer = require('../models/Transfer');

exports.index = async (req, res, next) => {
  try {
    const rows = await Transfer.list(req.user.id, req.user.role);
    res.render('transfers/index', { title: 'Transfer Audit', transfers: rows });
  } catch (err) { next(err); }
};

// ── Key transfer ─────────────────────────────────────────────────────────────
exports.transferKey = async (req, res, next) => {
  const user   = req.user;
  const keyId  = parseInt(req.body.key_id, 10);
  const email  = (req.body.target_email || '').trim().toLowerCase();
  if (!keyId || !email) {
    req.flash('error', 'Key and target seller email are required.');
    return res.redirect('/keys');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const kr = await client.query('SELECT created_by FROM keys WHERE id = $1', [keyId]);
    if (!kr.rows[0]) { await client.query('ROLLBACK'); req.flash('error', 'Key not found.'); return res.redirect('/keys'); }
    const ownerId = parseInt(kr.rows[0].created_by, 10);

    // Permission: controller, owner self, ya owner performer ke branch me
    const descIds = await User.getDescendantIds(user.id);
    const canMove = user.role === 'controller' || ownerId === user.id || descIds.includes(ownerId);
    if (!canMove) { await client.query('ROLLBACK'); req.flash('error', 'Permission denied.'); return res.redirect('/keys'); }

    const target = await User.findByEmail(email);
    if (!target || target.role !== 'seller') {
      await client.query('ROLLBACK'); req.flash('error', 'Target seller not found.'); return res.redirect('/keys');
    }
    // Target branch check (controller exempt)
    if (user.role !== 'controller' && target.id !== user.id && !descIds.includes(target.id)) {
      await client.query('ROLLBACK'); req.flash('error', 'Target seller is outside your branch.'); return res.redirect('/keys');
    }

    const result = await Transfer.transferKey({ keyId, toSellerId: target.id, movedBy: user.id }, client);
    if (!result.ok) { await client.query('ROLLBACK'); req.flash('error', result.error); return res.redirect('/keys'); }

    await client.query('COMMIT');
    req.flash('success', `Key ${result.keyValue} transferred to ${email}. Due moved: ${result.dueMoved}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/keys');
};

// ── Account transfer ─────────────────────────────────────────────────────────
exports.transferAccount = async (req, res, next) => {
  const user        = req.user;
  const userId      = parseInt(req.body.user_id, 10);
  const parentEmail = (req.body.new_parent_email || '').trim().toLowerCase();
  if (!userId || !parentEmail) {
    req.flash('error', 'Account and new parent email are required.');
    return res.redirect('/users');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const descIds = await User.getDescendantIds(user.id);
    // Node performer ke branch me hona chahiye (controller exempt)
    if (user.role !== 'controller' && !descIds.includes(userId)) {
      await client.query('ROLLBACK'); req.flash('error', 'Permission denied.'); return res.redirect('/users');
    }

    const newParent = await User.findByEmail(parentEmail);
    if (!newParent) { await client.query('ROLLBACK'); req.flash('error', 'New parent not found.'); return res.redirect('/users'); }

    // New parent bhi performer ke branch me (controller exempt)
    if (user.role !== 'controller' && newParent.id !== user.id && !descIds.includes(newParent.id)) {
      await client.query('ROLLBACK'); req.flash('error', 'New parent is outside your branch.'); return res.redirect('/users');
    }

    const nodeDescIds = await User.getDescendantIds(userId);
    const result = await Transfer.transferAccount(
      { userId, newParentId: newParent.id, movedBy: user.id, descendantIdsOfUser: nodeDescIds },
      client
    );
    if (!result.ok) { await client.query('ROLLBACK'); req.flash('error', result.error); return res.redirect('/users'); }

    await client.query('COMMIT');
    req.flash('success', `Account ${result.email} transferred to ${parentEmail}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/users');
};
