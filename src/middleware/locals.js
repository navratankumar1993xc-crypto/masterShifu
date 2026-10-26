'use strict';
const cfg     = require('../config');
const News    = require('../models/News');
const Setting = require('../models/Setting');

/**
 * Inject common template locals on every request.
 * req.user / res.locals.user is set by requireAuth — not here.
 */
module.exports = async function locals(req, res, next) {
  res.locals.appName    = cfg.app.name;
  res.locals.appVersion = cfg.app.version;
  res.locals.currentPath = req.path;

  // user will already be set by requireAuth on protected routes;
  // ensure it's at least null for public routes
  if (!res.locals.user) res.locals.user = null;

  if (req.user) {
    try {
      res.locals.systemNews = await News.getLatest(req.user.role);
      const giftEnabled     = await Setting.get('gift_offer_enabled', '0');
      res.locals.giftOfferEnabled = giftEnabled === '1';
      res.locals.giftOfferMessage = await Setting.get('gift_offer_message', '');
    } catch (_) {
      res.locals.systemNews = [];
    }
  } else {
    res.locals.systemNews = [];
  }

  next();
};
