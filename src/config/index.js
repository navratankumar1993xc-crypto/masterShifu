'use strict';
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  db: {
    client: (process.env.DB_CLIENT || 'pg').toLowerCase(),   // 'pg' | 'sqlite'
    sqliteFile: process.env.SQLITE_FILE || './data/web_ts_panel.sqlite',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'web_ts_panel',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },

  app: {
    name: process.env.APP_NAME || 'WEB_TS',
    version: process.env.APP_VERSION || '1.0.0',
  },

  client: {
    apiKey: process.env.CLIENT_API_KEY || '',
    dllUrl: process.env.CLIENT_DLL_URL || '',
    pass: process.env.CLIENT_PASS || '',
    saltKey: process.env.CLIENT_SALT_KEY || '',
    chromeDriver: process.env.CLIENT_CHROME_DRIVER || '',
    chromeVersion: process.env.CLIENT_CHROME_VERSION || '',
  },

  // Role hierarchy, top → bottom. A role can create any role below it.
  roleOrder: ['controller', 'developer', 'super_master', 'admin', 'super', 'seller'],

  // Role directly one level below
  roleMap: {
    controller:   'developer',
    developer:    'super_master',
    super_master: 'admin',
    admin:        'super',
    super:        'seller',
  },

  // Due amounts (INR) per role when a key is paid
  dueRates: {
    seller:       1500,
    super:        1400,
    admin:        1300,
    super_master: 1200,
    developer:    1000,
    controller:   0,
  },

  // Hours before due deadline triggers suspension
  deadlineHours: {
    seller:       26,
    super:        60,
    admin:        80,
    super_master: 110,
    developer:    140,
    controller:   0,
  },

  // Days a new key is valid
  keyValidityDays: 30,
};
