'use strict';
/**
 * Minimal flash message middleware.
 * Sets req.flash(type, msg) and exposes res.locals.flash for templates.
 */
module.exports = function flash(req, res, next) {
  if (!req.session) return next();

  req.flash = function (type, msg) {
    if (!req.session._flash) req.session._flash = {};
    if (!req.session._flash[type]) req.session._flash[type] = [];
    req.session._flash[type].push(msg);
  };

  const messages = req.session._flash || {};
  req.session._flash = {};
  res.locals.flash = messages;

  next();
};
