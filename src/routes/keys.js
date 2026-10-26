'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/keyController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/',                   ctrl.index);
router.get('/export',             ctrl.exportKeys);
router.post('/create',            ctrl.create);
router.post('/create-demo',       ctrl.createDemo);
router.post('/mark-paid',         ctrl.markPaid);
router.post('/toggle-status',     ctrl.toggleStatus);
router.post('/toggle-payment',    ctrl.togglePayment);
router.post('/reset-mac',         ctrl.resetMac);
router.post('/delete',            ctrl.deleteKey);
router.post('/pay-with-credit',   ctrl.payWithCredit);
router.post('/renew-with-credit', ctrl.renewWithCredit);
router.post('/edit',              ctrl.editKey);

module.exports = router;
