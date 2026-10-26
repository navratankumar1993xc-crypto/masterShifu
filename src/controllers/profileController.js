'use strict';
const bcrypt = require('bcrypt');
const User   = require('../models/User');

exports.index = async (req, res, next) => {
  try {
    res.render('profile/index', { title: 'My Profile' });
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/profile');
  }
  if (new_password.length < 6) {
    req.flash('error', 'New password must be at least 6 characters.');
    return res.redirect('/profile');
  }
  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/profile');
  }

  try {
    const user = await User.findByIdWithPassword(req.user.id);
    if (!user || !(await bcrypt.compare(current_password, user.password))) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }

    const hashed = await bcrypt.hash(new_password, 12);
    await User.update(req.user.id, { password: hashed });
    req.flash('success', 'Password changed successfully.');
  } catch (err) { return next(err); }
  res.redirect('/profile');
};
