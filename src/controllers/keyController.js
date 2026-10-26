'use strict';
const db          = require('../db/pool');
const User        = require('../models/User');
const Key         = require('../models/Key');
const Transaction = require('../models/Transaction');
const Gift        = require('../models/Gift');
const Bonus       = require('../models/Bonus');
const cfg         = require('../config');

exports.index = async (req, res, next) => {
  try {
    const user = req.user;
    await Key.autoExpire();

    // Self-heal bonus keys (award / activate / deactivate) before listing
    try { await Bonus.syncAll(); } catch (e) { console.error('[keys.index Bonus]', e.message); }

    const descIds = await User.getDescendantIds(user.id);
    const keys    = await Key.findForUser(user.id, user.role, descIds);

    // Search / filter
    const search = (req.query.search || '').trim();
    const statusFilter = req.query.status || '';
    let filtered = keys;
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(k =>
        k.key_value.toLowerCase().includes(s) ||
        (k.creator_email || '').toLowerCase().includes(s)
      );
    }
    if (statusFilter) {
      filtered = filtered.filter(k => k.status === statusFilter);
    }

    res.render('keys/index', {
      title: 'Key Management',
      keys: filtered,
      search,
      statusFilter,
      cfg,
      Key,
    });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  const user = req.user;
  // Key creation sirf SELLER ke liye (Controller master-override ke taur par allowed).
  // Beech ke roles (super/admin/super_master/developer) keys nahi bana sakte.
  if (user.role !== 'seller' && user.role !== 'controller') {
    req.flash('error', 'Only sellers can create license keys.');
    return res.redirect('/keys');
  }
  const keyValue = (req.body.key_value || '').trim().toUpperCase();
  if (!keyValue) {
    req.flash('error', 'Key name is required.');
    return res.redirect('/keys');
  }
  if (!/^[\x21-\x7E]{1,7}$/.test(keyValue)) {
    req.flash('error', 'Key must be 1–7 printable characters, no spaces.');
    return res.redirect('/keys');
  }

  try {
    if (await Key.valueExists(keyValue)) {
      req.flash('error', `Key "${keyValue}" already exists.`);
      return res.redirect('/keys');
    }
    await Key.create({
      key_value:      keyValue,
      created_by:     user.id,
      expiry_date:    Key.newExpiryDate(),
      payment_status: user.role === 'controller' ? 'paid' : 'unpaid',
      status:         'active',
    });
    // Bonus key eligibility re-check (seller ne nayi key banayi)
    if (user.role === 'seller') {
      try { await Bonus.syncSeller(user.id); } catch (e) { console.error('[create Bonus]', e.message); }
    }
    req.flash('success', `Key <strong class="font-monospace">${keyValue}</strong> created successfully.`);
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

exports.toggleStatus = async (req, res, next) => {
  const user   = req.user;
  const keyId  = parseInt(req.body.id, 10);
  const newSts = req.body.status === 'active' ? 'active' : 'inactive';

  try {
    const key = await Key.findById(keyId);
    if (!key) { req.flash('error', 'Key not found.'); return res.redirect('/keys'); }
    if (key.status === 'expired') { req.flash('error', 'Cannot toggle an expired key.'); return res.redirect('/keys'); }

    const descIds = await User.getDescendantIds(user.id);
    const authorized = key.created_by === user.id || descIds.includes(key.created_by);
    if (!authorized) { req.flash('error', 'Permission denied.'); return res.redirect('/keys'); }

    await Key.update(keyId, { status: newSts });
    // Running-count badla → bonus key activate/deactivate sync
    try { await Bonus.syncSeller(key.created_by); } catch (e) { console.error('[toggle Bonus]', e.message); }
    req.flash('success', 'Key status updated.');
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

exports.togglePayment = async (req, res, next) => {
  if (req.user.role !== 'controller') {
    req.flash('error', 'Only the Controller can directly toggle payment status.');
    return res.redirect('/keys');
  }
  const keyId  = parseInt(req.body.id, 10);
  const newPay = req.body.payment_status === 'paid' ? 'paid' : 'unpaid';
  try {
    await Key.update(keyId, { payment_status: newPay });
    req.flash('success', 'Payment status updated.');
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

exports.resetMac = async (req, res, next) => {
  const user  = req.user;
  const keyId = parseInt(req.body.id, 10);
  try {
    const key = await Key.findById(keyId);
    if (!key) { req.flash('error', 'Key not found.'); return res.redirect('/keys'); }
    if (!key.mac_id) { req.flash('error', 'Key has no MAC address bound.'); return res.redirect('/keys'); }

    const descIds    = await User.getDescendantIds(user.id);
    const authorized = key.created_by === user.id || descIds.includes(key.created_by);
    if (!authorized) { req.flash('error', 'Permission denied.'); return res.redirect('/keys'); }

    await Key.resetMac(keyId);
    req.flash('success', 'MAC address reset successfully.');
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

exports.deleteKey = async (req, res, next) => {
  if (req.user.role !== 'controller') {
    req.flash('error', 'Only the Controller can delete keys.');
    return res.redirect('/keys');
  }
  const keyId = parseInt(req.body.id, 10);
  try {
    await Key.delete(keyId);
    req.flash('success', 'Key deleted.');
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

exports.payWithCredit = async (req, res, next) => {
  const user  = req.user;
  const keyId = parseInt(req.body.key_id, 10);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const keyRes = await client.query(
      'SELECT id, key_value, created_by, payment_status FROM keys WHERE id = $1 FOR UPDATE',
      [keyId]
    );
    const key = keyRes.rows[0];
    if (!key) { req.flash('error', 'Key not found.'); await client.query('ROLLBACK'); return res.redirect('/keys'); }

    const descIds    = await User.getDescendantIds(user.id);
    const authorized = key.created_by === user.id || descIds.includes(parseInt(key.created_by, 10));
    if (!authorized) { req.flash('error', 'Permission denied.'); await client.query('ROLLBACK'); return res.redirect('/keys'); }

    if (key.payment_status === 'paid') {
      req.flash('error', 'Key is already paid.'); await client.query('ROLLBACK'); return res.redirect('/keys');
    }

    const meRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    if (parseInt(meRes.rows[0].credits, 10) < 1) {
      req.flash('error', 'Insufficient credits.'); await client.query('ROLLBACK'); return res.redirect('/keys');
    }

    await client.query('UPDATE users SET credits = credits - 1 WHERE id = $1', [user.id]);
    await client.query("UPDATE keys SET payment_status = 'paid' WHERE id = $1", [keyId]);

    await Transaction.log({
      txn_type:     'key_pay_credit',
      from_user_id: user.id,
      to_user_id:   key.created_by,
      credits:      1,
      key_id:       keyId,
      key_value:    key.key_value,
      created_by:   user.id,
      note:         'Key paid using 1 credit',
    }, client);

    await Transaction.propagateDues(key.created_by, {
      key_id:    keyId,
      key_value: key.key_value,
      paid_by:   user.id,
    }, client);

    // Gift offer: 2 paid keys within a 7-day window = 1 gift credit (seller only)
    const giftMsg = await Gift.awardAfterCreditPay(key.created_by, user.id, client);

    // Bonus key eligibility (paid/running count changed)
    await Bonus.syncSeller(key.created_by, client);

    await client.query('COMMIT');
    req.flash('success', `Key paid. 1 credit deducted and dues propagated.${giftMsg}`);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/keys');
};

exports.renewWithCredit = async (req, res, next) => {
  const user  = req.user;
  if (user.role === 'controller') {
    req.flash('error', 'Controller can renew keys directly via edit.');
    return res.redirect('/keys');
  }

  const keyId = parseInt(req.body.key_id, 10);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const keyRes = await client.query(
      'SELECT id, key_value, created_by, payment_status, status, expiry_date FROM keys WHERE id = $1 FOR UPDATE',
      [keyId]
    );
    const key = keyRes.rows[0];
    if (!key) { req.flash('error', 'Key not found.'); await client.query('ROLLBACK'); return res.redirect('/keys'); }

    const descIds    = await User.getDescendantIds(user.id);
    const authorized = key.created_by === user.id || descIds.includes(parseInt(key.created_by, 10));
    if (!authorized) { req.flash('error', 'Permission denied.'); await client.query('ROLLBACK'); return res.redirect('/keys'); }

    if (key.payment_status !== 'paid') {
      req.flash('error', 'Key must be paid before renewing.'); await client.query('ROLLBACK'); return res.redirect('/keys');
    }

    const leftDays = Key.calcLeftDays(key.expiry_date);
    if (leftDays > 0 && key.status !== 'expired') {
      req.flash('error', 'Key is still active. Renew only expired keys.'); await client.query('ROLLBACK'); return res.redirect('/keys');
    }

    const meRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    if (parseInt(meRes.rows[0].credits, 10) < 1) {
      req.flash('error', 'Insufficient credits.'); await client.query('ROLLBACK'); return res.redirect('/keys');
    }

    const newExpiry = Key.newExpiryDate();
    await client.query('UPDATE users SET credits = credits - 1 WHERE id = $1', [user.id]);
    await client.query(
      "UPDATE keys SET expiry_date = $1, status = 'active' WHERE id = $2",
      [newExpiry, keyId]
    );

    await Transaction.log({
      txn_type:     'key_renew_credit',
      from_user_id: user.id,
      to_user_id:   key.created_by,
      credits:      1,
      key_id:       keyId,
      key_value:    key.key_value,
      created_by:   user.id,
      note:         `Key renewed to ${newExpiry}`,
    }, client);

    await Transaction.propagateDues(key.created_by, {
      key_id:    keyId,
      key_value: key.key_value,
      paid_by:   user.id,
    }, client);

    // Gift offer + bonus re-check (renew = ek paid event)
    const giftMsg = await Gift.awardAfterCreditPay(key.created_by, user.id, client);
    await Bonus.syncSeller(key.created_by, client);

    await client.query('COMMIT');
    req.flash('success', `Key renewed until ${newExpiry}.${giftMsg}`);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/keys');
};

exports.editKey = async (req, res, next) => {
  const user  = req.user;
  const keyId = parseInt(req.body.id, 10);
  const { status, expiry_date } = req.body;

  try {
    const key = await Key.findById(keyId);
    if (!key) { req.flash('error', 'Key not found.'); return res.redirect('/keys'); }

    const descIds    = await User.getDescendantIds(user.id);
    const authorized = key.created_by === user.id || descIds.includes(key.created_by) || user.role === 'controller';
    if (!authorized) { req.flash('error', 'Permission denied.'); return res.redirect('/keys'); }

    const updates = {};
    if (status) updates.status = status;
    if (expiry_date && user.role === 'controller') updates.expiry_date = expiry_date;

    await Key.update(keyId, updates);
    req.flash('success', 'Key updated.');
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

exports.exportKeys = async (req, res, next) => {
  const user = req.user;
  try {
    await Key.autoExpire();
    const descIds = await User.getDescendantIds(user.id);
    let keys;
    if (user.role === 'controller') {
      const r = await db.query('SELECT key_value FROM keys ORDER BY created_at DESC');
      keys = r.rows;
    } else {
      const ids = [user.id, ...descIds];
      const ph  = ids.map((_, i) => `$${i + 1}`).join(', ');
      const r   = await db.query(
        `SELECT key_value FROM keys WHERE created_by IN (${ph}) ORDER BY created_at DESC`,
        ids
      );
      keys = r.rows;
    }
    const text = keys.map(k => k.key_value).join('\n');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="web_ts_keys_${Date.now()}.txt"`);
    res.send(text);
  } catch (err) { return next(err); }
};

// ── Demo Key (controller only) ───────────────────────────────────────────────
exports.createDemo = async (req, res, next) => {
  if (req.user.role !== 'controller') {
    req.flash('error', 'Only Controller can create demo keys.');
    return res.redirect('/keys');
  }

  const Setting = require('../models/Setting');
  const enabled = await Setting.get('demo_creation_enabled', '0');
  if (enabled !== '1') {
    req.flash('error', 'Demo key creation is disabled. Enable it from Dashboard → Settings.');
    return res.redirect('/keys');
  }

  try {
    // Generate demo{N} style key
    const r = await db.query(
      `SELECT COUNT(*) AS cnt FROM keys WHERE key_value LIKE 'DEMO%'`
    );
    const n        = parseInt(r.rows[0].cnt, 10) + 1;
    const keyValue = `DEMO${n}`;

    // Demo keys expire in 2 days
    const expiryDate = Key.newExpiryDate(2);

    await Key.create({
      key_value:      keyValue,
      created_by:     req.user.id,
      expiry_date:    expiryDate,
      payment_status: 'paid',
      status:         'active',
    });

    req.flash('success', `Demo key <strong class="font-monospace">${keyValue}</strong> created (expires ${expiryDate}).`);
  } catch (err) { return next(err); }
  res.redirect('/keys');
};

// ── Mark Paid directly (controller only) ────────────────────────────────────
exports.markPaid = async (req, res, next) => {
  if (req.user.role !== 'controller') {
    req.flash('error', 'Only Controller can directly mark keys as paid.');
    return res.redirect('/keys');
  }
  const keyId = parseInt(req.body.id, 10);
  try {
    const key = await Key.findById(keyId);
    if (!key) { req.flash('error', 'Key not found.'); return res.redirect('/keys'); }
    await Key.update(keyId, { payment_status: 'paid' });
    req.flash('success', `Key <strong class="font-monospace">${key.key_value}</strong> marked as Paid.`);
  } catch (err) { return next(err); }
  res.redirect('/keys');
};
