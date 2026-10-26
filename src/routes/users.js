'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/auth');

const ALLOWED = ['controller', 'developer', 'super_master', 'admin', 'super'];
router.use(requireAuth, requireRole(ALLOWED));

router.get('/',                ctrl.index);
router.get('/all',             requireRole('controller'), ctrl.all);
router.post('/impersonate',    requireRole('controller'), ctrl.impersonate);
router.post('/create',         ctrl.create);
router.post('/toggle-status',  ctrl.toggleStatus);
router.post('/edit',           ctrl.edit);
router.post('/delete',         requireRole('controller'), ctrl.delete);
router.post('/receive-due',    ctrl.receiveDue);

module.exports = router;
