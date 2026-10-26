'use strict';
const router = require('express').Router();
const lCtrl  = require('../controllers/licenseController');
const tCtrl  = require('../controllers/ticketController');

// License validation (used by WEB_TS Electron client)
router.get('/license',  lCtrl.check);
router.post('/license', lCtrl.check);

// Booking log upload from desktop app
router.post('/upload-booking-log', tCtrl.apiUpload);

module.exports = router;
