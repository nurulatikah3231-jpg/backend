const express = require('express');
const router = express.Router();
const { login, logout, me, loginValidation } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validateRequest, sanitizeInput } = require('../middleware/security');

// Public routes
router.post('/login', sanitizeInput, loginValidation, validateRequest(loginValidation), login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

module.exports = router;
