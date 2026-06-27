const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateSettings,
  settingsValidation,
} = require('../controllers/settingController');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput } = require('../middleware/security');

// Admin routes
router.use(authenticate, adminOnly, sanitizeInput);

router.get('/', getSettings);
router.put('/', settingsValidation, validateRequest(settingsValidation), updateSettings);

module.exports = router;
