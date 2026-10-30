'use strict';
const db = require('../db/pool');

const Ticket = {
  async find({ date, licenseKey }) {
    let sql    = `SELECT id, src_dest, train_no, pay_mode, mac_id, user_id,
                         ip_address, t_date, pnr, img_path, license_key, created_at,
                         from_stn, to_stn, gateway, seat_avl, home_ip, booking_time,
                         CASE WHEN img_base64 IS NOT NULL OR img_path IS NOT NULL
                              THEN 1 ELSE 0 END AS has_img
                  FROM tickets
                  WHERE t_date = $1`;
    const params = [date];

    if (licenseKey) {
      params.push(licenseKey.toUpperCase());
      sql += ` AND license_key = $${params.length}`;
    }
    sql += ' ORDER BY id DESC LIMIT 200';
    const r = await db.query(sql, params);
    return r.rows;
  },

  async create({ src_dest, train_no, pay_mode, mac_id, user_id,
                  ip_address, t_date, pnr, img_base64, img_path, license_key,
                  from_stn, to_stn, gateway, seat_avl, home_ip, booking_time }) {
    const r = await db.query(
      `INSERT INTO tickets
         (src_dest, train_no, pay_mode, mac_id, user_id, ip_address,
          t_date, pnr, img_base64, img_path, license_key,
          from_stn, to_stn, gateway, seat_avl, home_ip, booking_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [src_dest || null, train_no || null, pay_mode || null, mac_id || null,
       user_id || null,  ip_address || null, t_date || null, pnr || null,
       img_base64 || null, img_path || null, license_key || null,
       from_stn || null, to_stn || null, gateway || null, seat_avl || null,
       home_ip || null, booking_time || null]
    );
    return r.rows[0].id;
  },

  async count() {
    const r = await db.query('SELECT COUNT(*) AS cnt FROM tickets');
    return parseInt(r.rows[0].cnt, 10);
  },

  async countToday() {
    const r = await db.query(
      `SELECT COUNT(*) AS cnt FROM tickets WHERE t_date = CURRENT_DATE`
    );
    return parseInt(r.rows[0].cnt, 10);
  },

  async findById(id) {
    const r = await db.query('SELECT * FROM tickets WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
};

module.exports = Ticket;
