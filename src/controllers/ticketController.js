'use strict';
const Ticket = require('../models/Ticket');

exports.index = async (req, res, next) => {
  try {
    const date        = req.query.date || new Date().toISOString().split('T')[0];
    const licenseKey  = (req.query.license || '').trim();
    const tickets     = await Ticket.find({ date, licenseKey });

    res.render('tickets/index', {
      title:      'Ticket Panel',
      tickets,
      dateFilter: date,
      licFilter:  licenseKey,
    });
  } catch (err) { next(err); }
};

// Public API — called by the Electron desktop app after a successful booking
exports.apiUpload = async (req, res) => {
  try {
    let body = req.body || {};

    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          body = JSON.parse(trimmed.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":'));
        } catch (_) {
          const obj = {};
          trimmed
            .slice(1, -1)
            .split(',')
            .forEach((part) => {
              const idx = part.indexOf(':');
              if (idx === -1) return;
              const key = part.slice(0, idx).trim().replace(/['"]/g, '');
              const value = part.slice(idx + 1).trim();
              obj[key] = value.replace(/^['"]|['"]$/g, '');
            });
          body = obj;
        }
      }
    }

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ ok: false, error: 'empty body' });
    }

    const payload = {
      src_dest:    body.src_dest || body.src || body.from_to || body.route || null,
      train_no:    body.train_no || body.train || body.trainNumber || null,
      pay_mode:    body.pay_mode || body.payment_mode || body.paymentMethod || null,
      mac_id:      body.mac_id || body.machine_id || body.mac || null,
      user_id:     body.user_id || body.userId || body.userid || null,
      t_date:      body.t_date || body.date || new Date().toISOString().split('T')[0],
      pnr:         body.pnr || body.pnrNo || body.pnr_number || null,
      img_base64:  body.img_base64 || body.image_base64 || body.image || body.ticket_image || null,
      img_path:    body.img_path || body.image_path || null,
      license_key: body.license_key || body.license || body.licenseKey || null,
    };

    if (!payload.img_base64 && body.img && typeof body.img === 'string') {
      payload.img_base64 = body.img;
    }

    const id = await Ticket.create({
      ...payload,
      ip_address: req.ip || body.ip_address || body.ip || null,
    });

    res.json({ ok: true, id, message: 'booking saved' });
  } catch (err) {
    console.error('[ticketController.apiUpload]', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};

exports.imageServe = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(parseInt(req.params.id, 10));
    if (!ticket || !ticket.img_base64) return res.status(404).send('Not found');

    const data = ticket.img_base64.replace(/^data:image\/\w+;base64,/, '');
    const buf  = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', 'image/png');
    if (req.query.download !== undefined) {
      res.setHeader('Content-Disposition', `attachment; filename="ticket_${ticket.id}.png"`);
    }
    res.send(buf);
  } catch (err) { next(err); }
};
