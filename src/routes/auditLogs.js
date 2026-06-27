const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditLogController');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput, validateSearch, validatePagination } = require('../middleware/security');

// Admin routes
router.use(authenticate, adminOnly, sanitizeInput);

router.get('/', validateSearch, validatePagination, validateRequest(validateSearch.concat(validatePagination)), getAuditLogs);

module.exports = router;
