'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/',                 ctrl.getDashboard);
router.post('/settings',        ctrl.postSettings);
router.post('/quick-credit',    ctrl.postQuickCredit);

module.exports = router;
