'use strict';
/**
 * License API — consumed by the WEB_TS Electron desktop app.
 * Port of webPanel/license4.php.
 * POST /api/license  { Key, Machine, Action }
 * GET  /api/license?userName=KEY&macAddress=MAC&action=validate
 */
const Key         = require('../models/Key');
const News        = require('../models/News');
const Transaction = require('../models/Transaction');
const cfg         = require('../config');

exports.check = async (req, res) => {
  await Transaction.enforceDueDeadlines();

  const softwareNews = await News.getSoftwareLatest();

  // Parse input from JSON body or query string
  let keyVal = '', macAddress = '', action = 'validate';
  if (req.method === 'POST' && req.body) {
    keyVal     = req.body.Key        || req.body.key || req.body.key_value || '';
    macAddress = req.body.Machine    || req.body.mac       || '';
    action     = String(req.body.Action || 'validate').toLowerCase().trim();
  }
  keyVal     = keyVal     || req.query.userName    || req.query.key    || '';
  macAddress = macAddress || req.query.macAddress  || req.query.mac    || '';
  if (req.query.action) action = String(req.query.action).toLowerCase().trim();

  const keyUpper = String(keyVal).toUpperCase().trim();
  const mac      = String(macAddress).trim();

  const fail = (msg, extra = {}) => res.json({
    success: false, ok: false,
    message: msg, ShortMessage: msg,
    leftDays: 0, tokens: null, appVersion: null,
    ipList: null, KeyType: null, PaidStatus: 0, paid: 'Unpaid',
    News: softwareNews,
    logs: `username: ${keyUpper}`,
    ...extra,
  });
  // Known-key failures carry appVersion / KeyType like license4.php
  const keyFail = (msg, logs, extra = {}) =>
    fail(msg, { appVersion: '1.0.0.0', KeyType: 'monthly', logs, ...extra });

  if (!keyUpper) return fail('Invalid Key!');

  try {
    let key = await Key.findByValue(keyUpper);

    if (!key) return fail('Invalid Key!');

    // ── RESET action ────────────────────────────────────────────────────────
    if (action === 'reset') {
      await Key.resetMac(key.id);
      return res.json({
        success: true, ok: true,
        message: 'Reset successful',
        ShortMessage: 'License key reset successfully. You can now activate on a new PC.',
        leftDays: 0, tokens: null, appVersion: '1.0.0.0', ipList: null,
        News: softwareNews,
        KeyType: 'monthly', PaidStatus: 1, paid: 'Paid',
        logs: `MAC reset for key: ${keyUpper}`,
      });
    }

    // ── VALIDATE action ─────────────────────────────────────────────────────
    // Bind MAC on first use (or stamp mac_bound_at for an already-bound key)
    const bindTo = mac || (key.mac_id || '').trim();
    if (bindTo) {
      await Key.bindMac(key.id, bindTo);
      key = await Key.findById(key.id);
    }

    // MAC mismatch check
    if (key.mac_id && mac && key.mac_id.toLowerCase() !== mac.toLowerCase()) {
      return keyFail('Reset Your ID, Thank You',
        `MAC Address mismatch. DB MAC: ${key.mac_id} Client MAC: ${mac}`);
    }

    const isPaid = key.payment_status === 'paid';
    const days   = Key.calcLeftDays(key.expiry_date);

    if (key.status === 'active' && isPaid && days > 0) {
      return res.json({
        success: true, ok: true,
        message: 'success',
        ShortMessage: `${cfg.app.name} Active. Expiry: ${key.expiry_date}`,
        leftDays: days,
        expiryDate: key.expiry_date,
        tokens: null,
        appVersion: '1.0.0.0',
        ipList: '127.0.0.1',
        KeyType: 'monthly',
        PaidStatus: 1,
        paid: 'Paid',
        News: softwareNews,
        apiKey:        cfg.client.apiKey,
        DllVersion:    encodeURIComponent(cfg.client.dllUrl),
        ChromeDriver:  cfg.client.chromeDriver,
        SaltKey:       cfg.client.saltKey,
        ChromeVersion: cfg.client.chromeVersion,
        edata: '0',
        sdata: '0',
        adata: '0',
        pass:          cfg.client.pass,
        BatchNo:       cfg.client.apiKey,
      });
    }

    if (key.status === 'active' && !isPaid) {
      const msg = 'APKA ADMIN PAYMENT DUE HEIN, APNE SELLER SE CONTACT KRE!';
      return keyFail(msg, 'License Unpaid.');
    }

    // Expired / inactive
    let clientNews = softwareNews;
    let inactiveMsg = 'Key is Inactive.';
    if (key.status === 'inactive') {
      inactiveMsg = await Key.inactiveReason(key);
      clientNews  = softwareNews ? `${inactiveMsg} | ${softwareNews}` : inactiveMsg;
    }
    const msg = days <= 0 ? 'License expired.' : inactiveMsg;
    return keyFail(msg, `License expired or inactive. Days: ${days}, Status: ${key.status}`,
      { News: clientNews });

  } catch (err) {
    console.error('[licenseController]', err);
    return fail('Server error.', { logs: `Database Error: ${err.message}` });
  }
};
