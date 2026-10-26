'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/profileController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/',                   ctrl.index);
router.post('/change-password',   ctrl.changePassword);

module.exports = router;
