'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/ticketController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Ticket panel — controller + developer only
router.get('/',                   requireAuth, requireRole(['controller', 'developer']), ctrl.index);
router.get('/image/:id',          requireAuth, ctrl.imageServe);

// Public API endpoint (called by Electron app — no session auth needed)
router.post('/api/upload',        ctrl.apiUpload);

module.exports = router;
