const express = require('express');
const router = express.Router();
const {
  getCustomers,
  toggleBlock,
  customerIdValidation,
} = require('../controllers/customerController');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput, validateSearch } = require('../middleware/security');

// Admin routes
router.use(authenticate, adminOnly, sanitizeInput);

router.get('/', validateSearch, validateRequest(validateSearch), getCustomers);
router.put('/:id', customerIdValidation, validateRequest(customerIdValidation), toggleBlock);

module.exports = router;
