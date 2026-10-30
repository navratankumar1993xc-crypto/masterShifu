'use strict';
const bcrypt      = require('bcrypt');
const db          = require('../db/pool');
const User        = require('../models/User');
const Key         = require('../models/Key');
const Transaction = require('../models/Transaction');
const cfg         = require('../config');

/** Duplicate email/username hit the DB unique index (Postgres 23505 / SQLite UNIQUE) */
function isUniqueViolation(err) {
  return err.code === '23505' || /UNIQUE constraint failed/i.test(err.message || '');
}

/** Roles this user may create: every role below it in the hierarchy */
function creatableRoles(role) {
  const i = cfg.roleOrder.indexOf(role);
  return i < 0 ? [] : cfg.roleOrder.slice(i + 1);
}

exports.index = async (req, res, next) => {
  try {
    const user  = req.user;
    const roles = creatableRoles(user.role);
    if (!roles.length) return res.redirect('/dashboard');

    // All IDs below this user (any depth); actions only on self-created ones
    const roleFilter = roles.includes(req.query.role) ? req.query.role : '';
    const search     = (req.query.search || '').trim().toLowerCase();
    let children = await User.findDescendants(user.id);
    if (roleFilter) children = children.filter(c => c.role === roleFilter);
    if (search) {
      children = children.filter(c =>
        (c.email || '').toLowerCase().includes(search) ||
        (c.username || '').toLowerCase().includes(search) ||
        (c.name || '').toLowerCase().includes(search));
    }
    children.sort((a, b) => User.roleSortOrder(a.role) - User.roleSortOrder(b.role));

    res.render('users/index', {
      title:    'Manage IDs',
      children,
      roles,
      roleFilter,
      search,
      cfg,
    });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  const user       = req.user;
  const roles      = creatableRoles(user.role);
  const targetRole = req.body.role;
  if (!roles.includes(targetRole)) {
    req.flash('error', 'You cannot create this role.');
    return res.redirect('/users');
  }

  const { password, credits } = req.body;
  const username   = (req.body.username || '').trim().toLowerCase();
  const email      = (req.body.email || '').trim().toLowerCase();
  const creditsNum = parseInt(credits, 10) || 0;

  const invalid = !username || !email || !password ? 'All fields are required.'
    : !User.USERNAME_RE.test(username) ? 'Username must be 3-30 characters: letters, numbers, . _ -'
    : password.length < 6 ? 'Password must be at least 6 characters.'
    : null;
  if (invalid) {
    req.flash('error', invalid);
    return res.redirect('/users');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const taken = await User.usernameExists(username) ? 'Username is already in use.'
      : await User.emailExists(email) ? 'Email is already in use.'
      : null;
    if (taken) {
      req.flash('error', taken);
      await client.query('ROLLBACK');
      return res.redirect('/users');
    }

    if (user.role !== 'controller' && creditsNum > 0) {
      const meRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const myCredits = parseInt(meRes.rows[0].credits, 10);
      if (myCredits < creditsNum) {
        req.flash('error', `Insufficient credits. You have ${myCredits}.`);
        await client.query('ROLLBACK');
        return res.redirect('/users');
      }
      await client.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [creditsNum, user.id]);
    }

    const name   = username.replace(/^./, c => c.toUpperCase());
    const hashed = await bcrypt.hash(password, 12);
    const newId  = await User.create({
      name, username, email, password: hashed,
      role: targetRole, parent_id: user.id, credits: creditsNum,
    }, client);

    if (creditsNum > 0) {
      await Transaction.log({
        txn_type:     user.role === 'controller' ? 'credit_add' : 'credit_transfer',
        from_user_id: user.role === 'controller' ? null : user.id,
        to_user_id:   newId,
        credits:      creditsNum,
        created_by:   user.id,
        note:         'Initial credits on new account',
      }, client);
    }

    await client.query('COMMIT');
    req.flash('success', `${User.roleLabel(targetRole)} account created. Login: ${username} (or ${email}) / ${password}`);
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) { req.flash('error', 'Username or email is already in use.'); return res.redirect('/users'); }
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/users');
};

exports.toggleStatus = async (req, res, next) => {
  const user       = req.user;
  const targetId   = parseInt(req.body.id, 10);
  const newStatus  = req.body.status === 'active' ? 'active' : 'inactive';
  const back       = req.body.back === '/users/all' ? '/users/all' : '/users';

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Controller can toggle any ID; others only the IDs they created
    const r = user.role === 'controller'
      ? await client.query(`SELECT id, role FROM users WHERE id = $1 AND role != 'controller'`, [targetId])
      : await client.query('SELECT id, role FROM users WHERE id = $1 AND parent_id = $2', [targetId, user.id]);
    const targetRole = r.rows[0]?.role;
    if (!r.rowCount) {
      req.flash('error', 'User not found or permission denied.');
    } else if (newStatus === 'inactive') {
      // Whole branch goes down: all IDs below + all their keys
      await User.deactivateBranch(targetId, client);
      req.flash('success', `${User.roleLabel(targetRole)} deactivated along with all IDs and keys under it.`);
    } else {
      await User.activateBranch(targetId, client);
      req.flash('success', `${User.roleLabel(targetRole)} activated along with all IDs and keys under it.`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  // Restored IDs that still have overdue dues go back to suspended
  try { await Transaction.enforceDueDeadlines(); } catch (e) { console.error('[toggleStatus enforce]', e.message); }
  res.redirect(back);
};

exports.edit = async (req, res, next) => {
  const user       = req.user;
  const targetId   = parseInt(req.body.user_id, 10);
  const { name, password, credits } = req.body;
  const username   = (req.body.username || '').trim().toLowerCase();
  const email      = (req.body.email || '').trim().toLowerCase();
  const newCredits = parseInt(credits, 10) || 0;

  if (!name || !username || !email) {
    req.flash('error', 'Name, username and email are required.');
    return res.redirect('/users');
  }
  if (!User.USERNAME_RE.test(username)) {
    req.flash('error', 'Username must be 3-30 characters: letters, numbers, . _ -');
    return res.redirect('/users');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const tgtRes = await client.query(
      'SELECT id, credits FROM users WHERE id = $1 AND parent_id = $2 FOR UPDATE',
      [targetId, user.id]
    );
    if (!tgtRes.rows.length) {
      req.flash('error', 'User not found or permission denied.');
      await client.query('ROLLBACK');
      return res.redirect('/users');
    }

    const taken = await User.usernameExists(username, targetId) ? 'Username already in use by another account.'
      : await User.emailExists(email, targetId) ? 'Email already in use by another account.'
      : null;
    if (taken) {
      req.flash('error', taken);
      await client.query('ROLLBACK');
      return res.redirect('/users');
    }

    const oldCredits = parseInt(tgtRes.rows[0].credits, 10);
    const diff       = newCredits - oldCredits;

    if (diff > 0 && user.role !== 'controller') {
      const meRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const myCredits = parseInt(meRes.rows[0].credits, 10);
      if (myCredits < diff) {
        req.flash('error', `Insufficient credits to add ${diff} more.`);
        await client.query('ROLLBACK');
        return res.redirect('/users');
      }
      await client.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [diff, user.id]);
    }

    const updates = { name, username, email, credits: newCredits };
    // Password reset of an ID: controller only
    if (user.role === 'controller' && password && password.length >= 6) {
      updates.password = await bcrypt.hash(password, 12);
    }

    await User.update(targetId, updates, client);

    if (Math.abs(diff) > 0) {
      await Transaction.log({
        txn_type:     'credit_adjust',
        from_user_id: diff < 0 ? targetId : (user.role === 'controller' ? null : user.id),
        to_user_id:   diff > 0 ? targetId : user.id,
        credits:      Math.abs(diff),
        created_by:   user.id,
        note:         'Credits adjusted during user edit',
      }, client);
    }

    await client.query('COMMIT');
    req.flash('success', 'Account updated successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) { req.flash('error', 'Username or email already in use by another account.'); return res.redirect('/users'); }
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/users');
};

// ── All IDs (controller only) ───────────────────────────────────────────────
exports.all = async (req, res, next) => {
  try {
    const search     = (req.query.search || '').trim().toLowerCase();
    const roleFilter = req.query.role || '';
    let users = (await User.findAll()).filter(u => u.role !== 'controller');
    if (search) {
      users = users.filter(u =>
        (u.email || '').toLowerCase().includes(search) ||
        (u.username || '').toLowerCase().includes(search) ||
        (u.name || '').toLowerCase().includes(search));
    }
    if (roleFilter) users = users.filter(u => u.role === roleFilter);
    users.sort((a, b) => User.roleSortOrder(a.role) - User.roleSortOrder(b.role));

    res.render('users/all', {
      title: 'All IDs',
      users,
      search,
      roleFilter,
      roles: ['developer', 'super_master', 'admin', 'super', 'seller'],
    });
  } catch (err) { next(err); }
};

// ── Login as any account (controller only) ──────────────────────────────────
exports.impersonate = async (req, res, next) => {
  const targetId = parseInt(req.body.id, 10);
  try {
    const target = await User.findById(targetId);
    if (!target || target.role === 'controller') {
      req.flash('error', 'User not found.');
      return res.redirect('/users/all');
    }
    req.session.impersonatorId = req.user.id;
    req.session.userId         = target.id;
    req.session.save(() => res.redirect('/dashboard'));
  } catch (err) { next(err); }
};

// Only the controller can delete IDs — any account, with its whole branch
exports.delete = async (req, res, next) => {
  const targetId = parseInt(req.body.id, 10);
  const back     = req.body.back === '/users/all' ? '/users/all' : '/users';

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id FROM users WHERE id = $1 AND role != 'controller'`,
      [targetId]
    );
    if (!r.rows.length) {
      req.flash('error', 'User not found or permission denied.');
      await client.query('ROLLBACK');
      return res.redirect(back);
    }

    const desc   = await User.getDescendantIds(targetId);
    const allIds = [targetId, ...desc];

    // Delete keys first (FK cascade would handle this, but being explicit)
    const ph = allIds.map((_, i) => `$${i + 1}`).join(', ');
    await client.query(`DELETE FROM keys WHERE created_by IN (${ph})`, allIds);
    await client.query(`DELETE FROM users WHERE id IN (${ph})`, allIds);

    await client.query('COMMIT');
    req.flash('success', 'Account and all descendants deleted.');
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect(back);
};

exports.receiveDue = async (req, res, next) => {
  const user       = req.user;
  const targetId   = parseInt(req.body.user_id, 10);
  let   amount     = parseInt(req.body.receive_amount, 10);

  if (!amount || amount <= 0) {
    req.flash('error', 'Please enter a valid amount.');
    return res.redirect('/users');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const tgtRes = await client.query(
      'SELECT due_amount FROM users WHERE id = $1 AND parent_id = $2 FOR UPDATE',
      [targetId, user.id]
    );
    if (!tgtRes.rows.length) {
      req.flash('error', 'User not found.');
      await client.query('ROLLBACK');
      return res.redirect('/users');
    }

    const outstanding = parseInt(tgtRes.rows[0].due_amount, 10);
    if (amount > outstanding) amount = outstanding;

    await Transaction.receiveAndAllocate(targetId, amount, user.id, client);
    const fresh = await client.query('SELECT due_amount FROM users WHERE id = $1', [targetId]);
    if (parseInt(fresh.rows[0].due_amount, 10) === 0) {
      await User.reactivateDescendants(targetId, client);
    }

    await client.query('COMMIT');
    req.flash('success', `₹${amount.toLocaleString()} received. Due updated.`);
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
  res.redirect('/users');
};
