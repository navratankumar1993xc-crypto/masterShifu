'use strict';
require('dotenv').config();
const path     = require('path');
const express  = require('express');
const session  = require('express-session');
const nunjucks = require('nunjucks');

const cfg     = require('./config');
const db      = require('./db/pool');
const migrate = require('./db/migrate');
const seedController = require('./helpers/seedController');

const flash   = require('./middleware/flash');
const locals  = require('./middleware/locals');

const app = express();

app.use((req, res, next) => {
  const isApiSuccessRoute = /^\/api\/(?:success|app\/success\/?)$/.test(req.path);

  if (req.method === 'POST' && isApiSuccessRoute) {
    req.headers['content-type'] = 'text/plain';
    return express.text({ type: '*/*' })(req, res, next);
  }

  next();
});

// ── View engine: Nunjucks ───────────────────────────────────────────────────
const nunjucksEnv = nunjucks.configure(path.join(__dirname, '..', 'views'), {
  autoescape: true,
  express: app,
  noCache: !cfg.isProduction,
});

// Template helpers
nunjucksEnv.addFilter('date', (val, fmt) => {
  if (!val) return '—';
  // Extract just the date part to avoid timezone display issues
  let dateStr;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    dateStr = val; // already a plain date string
  } else {
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    if (fmt === 'datetime') {
      return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true });
    }
    // For date-only: use en-CA locale which gives YYYY-MM-DD
    dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  if (fmt === 'date') {
    // Convert YYYY-MM-DD to DD/MM/YYYY
    const [y, m, day] = dateStr.split('-');
    return `${day}/${m}/${y}`;
  }
  return dateStr; // default: YYYY-MM-DD
});

nunjucksEnv.addFilter('number', (val) => {
  const n = parseInt(val, 10);
  return isNaN(n) ? '0' : n.toLocaleString('en-IN');
});
nunjucksEnv.addFilter('roleName', (role) => {
  return (role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
});
nunjucksEnv.addFilter('daysLeft', (expiry) => {
  if (!expiry) return 0;
  // Get date string in YYYY-MM-DD
  let dateStr;
  if (typeof expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    dateStr = expiry;
  } else {
    dateStr = new Date(expiry).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  // Today in IST as YYYY-MM-DD
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const exp   = new Date(dateStr);
  const today = new Date(todayStr);
  return Math.max(0, Math.ceil((exp - today) / 86400000));
});
nunjucksEnv.addFilter('truncate', (str, len, killwords, end) => {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len) + (end || '…');
});

app.set('view engine', 'html');

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Sessions (PostgreSQL / SQLite store) ─────────────────────────────────────────────
app.use(session({
  store: db.client === 'sqlite'
    ? new (require('./db/sqliteSessionStore')(session))(db)
    : new (require('connect-pg-simple')(session))({ pool: db.pool, tableName: 'session' }),
  secret: cfg.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.isProduction,
    maxAge: cfg.session.maxAge,
  },
}));

// ── Flash + template locals ──────────────────────────────────────────────────
app.use(flash);
app.use(locals);

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

app.use('/auth',      require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/users',     require('./routes/users'));
app.use('/keys',      require('./routes/keys'));
app.use('/transfers', require('./routes/transfers'));
app.use('/credits',   require('./routes/credits'));
app.use('/news',      require('./routes/news'));
app.use('/tickets',   require('./routes/tickets'));
app.use('/profile',   require('./routes/profile'));
app.use('/api',       require('./routes/api'));

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    title:   '404 — Not Found',
    message: 'Page not found.',
    user:    req.user || null,
  });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).render('error', {
    title:   '500 — Server Error',
    message: cfg.isProduction ? 'An unexpected error occurred.' : err.message,
    user:    req.user || null,
  });
});

// ── Bootstrap & Start ─────────────────────────────────────────────────────────
(async () => {
  try {
    await migrate();
    await seedController();

    app.listen(cfg.port, () => {
      console.log(`\n  ██╗    ██╗███████╗██████╗     ████████╗███████╗`);
      console.log(`  ██║    ██║██╔════╝██╔══██╗    ╚══██╔══╝██╔════╝`);
      console.log(`  ██║ █╗ ██║█████╗  ██████╔╝       ██║   ███████╗`);
      console.log(`  ██║███╗██║██╔══╝  ██╔══██╗       ██║   ╚════██║`);
      console.log(`  ╚███╔███╔╝███████╗██████╔╝       ██║   ███████║`);
      console.log(`   ╚══╝╚══╝ ╚══════╝╚═════╝        ╚═╝   ╚══════╝\n`);
      console.log(`  WEB_TS Panel running on http://localhost:${cfg.port}`);
      console.log(`  Environment: ${cfg.nodeEnv}\n`);
    });
  } catch (err) {
    console.error('[Startup Error]', err);
    process.exit(1);
  }
})();
