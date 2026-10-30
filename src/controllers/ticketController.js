'use strict';
const fs     = require('fs');
const path   = require('path');
const Ticket = require('../models/Ticket');

// Screenshots disk par date-wise: data/tickets/YYYY-MM-DD/<file>.png
const TICKET_IMG_DIR = path.join(__dirname, '..', '..', 'data', 'tickets');

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function saveTicketImage(base64, date, tag) {
  const data = String(base64).replace(/^data:image\/\w+;base64,/, '');
  const buf  = Buffer.from(data, 'base64');
  if (!buf.length) return null;
  const day  = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate();
  const dir  = path.join(TICKET_IMG_DIR, day);
  fs.mkdirSync(dir, { recursive: true });
  const safeTag = String(tag || 'ticket').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'ticket';
  const file = `${Date.now()}_${safeTag}.png`;
  fs.writeFileSync(path.join(dir, file), buf);
  return `${day}/${file}`;
}

exports.index = async (req, res, next) => {
  try {
    const date        = req.query.date || localDate();
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
          body = JSON.parse(trimmed);
        } catch (_) {
          body = null;
        }
      }
      if (body === null) {
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
      src_dest:    body.src_dest || body.Src_Dest || body.src || body.from_to || body.route || null,
      train_no:    body.train_no || body.TrainNo || body.train || body.trainNumber || null,
      pay_mode:    body.pay_mode || body.Payment || body.payment_mode || body.paymentMethod || null,
      gateway:     body.gateway || body.Gateway || null,
      from_stn:    body.from_stn || body.From || null,
      to_stn:      body.to_stn || body.To || null,
      seat_avl:    body.seat_avl || body.SeatAvl || null,
      home_ip:     body.home_ip || body.HomeIP || null,
      booking_time: body.booking_time || body.BookingTime || null,
      mac_id:      body.mac_id || body.MachineID || body.machine_id || body.mac || null,
      user_id:     body.user_id || body.UserID || body.userId || body.userid || null,
      t_date:      body.t_date || body.date || localDate(),
      pnr:         body.pnr || body.PNR || body.pnrNo || body.pnr_number || null,
      img_base64:  body.img_base64 || body.base64image || body.image_base64 || body.image || body.ticket_image || null,
      img_path:    body.img_path || body.image_path || null,
      license_key: body.license_key || body.license || body.licenseKey || body.UserID || null,
    };

    if (!payload.img_base64 && body.img && typeof body.img === 'string') {
      payload.img_base64 = body.img;
    }
    if (payload.license_key) payload.license_key = String(payload.license_key).trim().toUpperCase();

    // Image DB me nahi — file date-wise folder me, DB me sirf path
    if (payload.img_base64) {
      try {
        const rel = saveTicketImage(payload.img_base64, payload.t_date, payload.pnr || body.Mode || 'ticket');
        if (rel) {
          payload.img_path   = rel;
          payload.img_base64 = null;
        }
      } catch (e) {
        console.error('[ticketController.apiUpload] image save failed', e.message);
      }
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
    if (!ticket) return res.status(404).send('Not found');

    if (req.query.download !== undefined) {
      res.setHeader('Content-Disposition', `attachment; filename="ticket_${ticket.id}.png"`);
    }

    if (ticket.img_path) {
      const file = path.resolve(TICKET_IMG_DIR, ticket.img_path);
      if (file.startsWith(TICKET_IMG_DIR + path.sep) && fs.existsSync(file)) {
        return res.type('png').sendFile(file);
      }
    }
    if (!ticket.img_base64) return res.status(404).send('Not found');

    const data = ticket.img_base64.replace(/^data:image\/\w+;base64,/, '');
    const buf  = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (err) { next(err); }
};
