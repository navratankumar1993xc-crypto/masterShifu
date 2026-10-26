'use strict';
const News = require('../models/News');

// ── System News (controller only) ───────────────────────────────────────────

exports.systemIndex = async (req, res, next) => {
  try {
    const news = await News.getLatest();
    res.render('news/system', { title: 'Manage System News', news });
  } catch (err) { next(err); }
};

exports.systemPost = async (req, res, next) => {
  try {
    const { news_message, target_role, action } = req.body;
    if (action === 'clear') {
      await News.clearAll();
      req.flash('success', 'All system news cleared.');
    } else {
      // action === 'publish' or anything else
      if (!news_message?.trim()) {
        req.flash('error', 'Message cannot be empty.');
      } else {
        await News.add(news_message.trim(), target_role || 'all');
        req.flash('success', 'Notice sent successfully.');
      }
    }
  } catch (err) { return next(err); }
  res.redirect('/news/system');
};

exports.systemDelete = async (req, res, next) => {
  try {
    await News.deleteById(parseInt(req.body.id, 10));
    req.flash('success', 'News item deleted.');
  } catch (err) { return next(err); }
  res.redirect('/news/system');
};

// ── Software News (controller only) ─────────────────────────────────────────

exports.softwareIndex = async (req, res, next) => {
  try {
    const current = await News.getSoftwareLatest();
    res.render('news/software', { title: 'Manage Software News', current });
  } catch (err) { next(err); }
};

exports.softwarePost = async (req, res, next) => {
  try {
    const { news_message, action } = req.body;
    if (action === 'clear') {
      await News.clearSoftwareNews();
      req.flash('success', 'Software news cleared.');
    } else {
      if (!news_message?.trim()) {
        req.flash('error', 'Message cannot be empty.');
      } else {
        await News.addSoftwareNews(news_message.trim());
        req.flash('success', 'Software news published. Desktop client will see it on next license check.');
      }
    }
  } catch (err) { return next(err); }
  res.redirect('/news/software');
};
