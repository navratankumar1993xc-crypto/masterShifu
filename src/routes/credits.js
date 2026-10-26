'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/creditController');
const { requireAuth, requireRole } = require('../middleware/auth');

const ALLOWED = ['controller', 'developer', 'super_master', 'admin', 'super'];
router.use(requireAuth, requireRole(ALLOWED));

router.get('/',       ctrl.index);
router.post('/add',   ctrl.add);

module.exports = router;
