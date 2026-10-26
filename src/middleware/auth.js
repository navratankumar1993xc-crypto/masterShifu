'use strict';
const User        = require('../models/User');
const Transaction = require('../models/Transaction');

/**
 * Enforce session auth + live DB status check.
 * Attaches req.user AND res.locals.user on success.
 */
async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.redirect('/auth/login');
  }

  try {
    await Transaction.enforceDueDeadlines();

    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.redirect('/auth/login');
    }

    // Controller "login as" — skip status/due blocks, the controller can open any account
    if (req.session.impersonatorId) {
      const imp = await User.findById(req.session.impersonatorId);
      if (!imp || imp.role !== 'controller') {
        req.session.destroy();
        return res.redirect('/auth/login');
      }
      req.user                 = user;
      res.locals.user          = user;
      res.locals.impersonator  = imp;
      return next();
    }

    if (user.status === 'inactive') {
      req.session.destroy();
      return res.redirect('/auth/login');
    }

    if (user.status === 'suspended_due' && parseInt(user.due_amount, 10) > 0) {
      req.session.destroy();
      return res.redirect('/auth/login?error=suspended_due');
    }

    const ancestorSuspended = await User.isAncestorSuspended(user.id);
    if (ancestorSuspended) {
      req.session.destroy();
      return res.redirect('/auth/login?error=suspended_due');
    }

    req.user          = user;
    res.locals.user   = user;   // ← make available to all templates
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role gate — pass allowed role(s).
 */
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) return res.redirect('/auth/login');
    if (!allowed.includes(req.user.role)) return res.redirect('/dashboard');
    next();
  };
}

module.exports = { requireAuth, requireRole };
