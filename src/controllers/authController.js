'use strict';
const bcrypt      = require('bcrypt');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const Setting     = require('../models/Setting');
const Key         = require('../models/Key');

async function renderLogin(res, extra = {}) {
  const [downloadUrl, demoEnabled] = await Promise.all([
    Setting.get('download_zip_url', ''),
    Setting.get('demo_creation_enabled', '0'),
  ]);
  res.render('auth/login', {
    title: 'Login',
    error: null,
    downloadUrl,
    demoEnabled: demoEnabled === '1',
    ...extra,
  });
}

exports.getLogin = async (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  await renderLogin(res, { error: req.query.error || null });
};

// ── Public Demo Key (from login page, when enabled by controller) ───────────
exports.postDemo = async (req, res) => {
  try {
    const enabled = await Setting.get('demo_creation_enabled', '0');
    if (enabled !== '1') {
      return renderLogin(res, { error: 'Demo key creation is currently disabled.' });
    }

    const controller = await User.getControllerUser();
    if (!controller) {
      return renderLogin(res, { error: 'Demo key creation is unavailable right now.' });
    }

    // Next free DEMO{N}
    const keyValue = await Key.nextDemoValue();

    const expiryDate = Key.newExpiryDate(2);
    await Key.create({
      key_value:      keyValue,
      created_by:     controller.id,
      expiry_date:    expiryDate,
      payment_status: 'paid',
      status:         'active',
    });

    renderLogin(res, { demoKey: keyValue, demoExpiry: expiryDate });
  } catch (err) {
    console.error('[authController.postDemo]', err);
    renderLogin(res, { error: 'Server error. Please try again.' });
  }
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return renderLogin(res, { error: 'All fields are required.' });
  }

  try {
    const user = await User.findByLogin(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return renderLogin(res, { error: 'Invalid credentials.' });
    }

    if (user.status === 'inactive') {
      return renderLogin(res, { error: 'Your account is deactivated.' });
    }

    await Transaction.enforceDueDeadlines();
    const fresh = await User.findById(user.id);

    if (fresh.status === 'suspended_due') {
      return renderLogin(res, { error: 'suspended_due', dueInfo: { self: true, ...fresh } });
    }

    const blocker = await User.findBlockingAncestor(fresh.id);
    if (blocker) {
      return renderLogin(res, { error: 'suspended_due', dueInfo: blocker });
    }

    req.session.regenerate((err) => {
      if (err) return res.redirect('/auth/login');
      req.session.userId = fresh.id;
      res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('[authController.postLogin]', err);
    renderLogin(res, { error: 'Server error. Please try again.' });
  }
};

// ── Controller: return from "login as" back to own account ──────────────────
exports.stopImpersonate = (req, res) => {
  const impId = req.session?.impersonatorId;
  if (!impId) return res.redirect('/dashboard');
  req.session.userId = impId;
  delete req.session.impersonatorId;
  req.session.save(() => res.redirect('/users/all'));
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
};
