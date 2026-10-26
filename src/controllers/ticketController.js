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
    const body = req.body;
    if (!body) return res.status(400).json({ ok: false, error: 'empty body' });

    const id = await Ticket.create({
      src_dest:    body.src_dest   || null,
      train_no:    body.train_no   || null,
      pay_mode:    body.pay_mode   || null,
      mac_id:      body.mac_id     || null,
      user_id:     body.user_id    || null,
      ip_address:  req.ip          || null,
      t_date:      body.t_date     || new Date().toISOString().split('T')[0],
      pnr:         body.pnr        || null,
      img_base64:  body.img_base64 || null,
      img_path:    body.img_path   || null,
      license_key: body.license_key || null,
    });
    res.json({ ok: true, id });
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
