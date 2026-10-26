'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/newsController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('controller'));

router.get('/system',         ctrl.systemIndex);
router.post('/system',        ctrl.systemPost);
router.post('/system/delete', ctrl.systemDelete);
router.get('/software',       ctrl.softwareIndex);
router.post('/software',      ctrl.softwarePost);

module.exports = router;
