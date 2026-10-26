'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/transferController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/',         ctrl.index);
router.post('/key',     ctrl.transferKey);
router.post('/account', ctrl.transferAccount);

module.exports = router;
