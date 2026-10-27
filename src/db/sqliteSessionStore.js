'use strict';
/**
 * express-session store on the SQLite "session" table (replaces connect-pg-simple
 * when DB_CLIENT=sqlite). expire is stored as epoch milliseconds.
 */
module.exports = (session) => {
  const DAY = 86400000;

  class SqliteStore extends session.Store {
    constructor(db) {
      super();
      this.db = db;
      // Prune expired sessions every 15 minutes
      this.timer = setInterval(() => {
        this.db.query('DELETE FROM session WHERE expire < $1', [Date.now()]).catch(() => {});
      }, 15 * 60 * 1000);
      this.timer.unref();
    }

    expiry(sess) {
      const e = sess?.cookie?.expires;
      return e ? new Date(e).getTime() : Date.now() + DAY;
    }

    get(sid, cb) {
      this.db.query('SELECT sess FROM session WHERE sid = $1 AND expire >= $2', [sid, Date.now()])
        .then(r => cb(null, r.rows[0] ? JSON.parse(r.rows[0].sess) : null))
        .catch(cb);
    }

    set(sid, sess, cb = () => {}) {
      this.db.query(
        `INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sess), this.expiry(sess)]
      ).then(() => cb(null)).catch(cb);
    }

    touch(sid, sess, cb = () => {}) {
      this.db.query('UPDATE session SET expire = $1 WHERE sid = $2', [this.expiry(sess), sid])
        .then(() => cb(null)).catch(cb);
    }

    destroy(sid, cb = () => {}) {
      this.db.query('DELETE FROM session WHERE sid = $1', [sid])
        .then(() => cb(null)).catch(cb);
    }
  }

  return SqliteStore;
};
