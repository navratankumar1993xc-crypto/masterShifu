'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/authController');

router.get('/login',  ctrl.getLogin);
router.post('/login', ctrl.postLogin);
router.post('/demo',  ctrl.postDemo);
router.get('/logout', ctrl.logout);
router.post('/return', ctrl.stopImpersonate);

module.exports = router;
