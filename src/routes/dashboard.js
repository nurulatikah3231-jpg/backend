const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/dashboardController');
const { authenticate, adminOnly } = require('../middleware/auth');
const { sanitizeInput } = require('../middleware/security');

// Admin routes
router.use(authenticate, adminOnly, sanitizeInput);

router.get('/', getDashboardStats);

module.exports = router;
