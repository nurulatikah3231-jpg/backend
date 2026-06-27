const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrder,
  getOrders,
  updateOrderStatus,
  resendEmail,
  exportOrders,
  checkoutValidation,
  orderIdValidation,
} = require('../controllers/orderController');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput, validatePagination, validateSearch } = require('../middleware/security');

// Public routes
router.post('/checkout', sanitizeInput, checkoutValidation, validateRequest(checkoutValidation), createOrder);
router.get('/:id', sanitizeInput, orderIdValidation, validateRequest(orderIdValidation), getOrder);

// Admin routes
router.use(authenticate, adminOnly, sanitizeInput);

router.get('/', validatePagination, validateSearch, validateRequest(validatePagination.concat(validateSearch)), getOrders);
router.put('/:id', orderIdValidation, validateRequest(orderIdValidation), updateOrderStatus);
router.post('/:id/resend-email', orderIdValidation, validateRequest(orderIdValidation), resendEmail);
router.get('/export/csv', exportOrders);

module.exports = router;
