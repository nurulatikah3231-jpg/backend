const { body, validationResult } = require('express-validator');
const { logAudit } = require('../utils/audit');

// WAF - Block suspicious requests
const blockSuspiciousRequests = (req, res, next) => {
  const suspiciousPatterns = [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|script)\b)/i,
    /(<script|javascript:|onload=|onerror=|onclick=)/i,
    /(\.\.(\/|\\))/g,
    /(eval|function\s*\()/i,
    /(base64_decode|base64_encode|phpinfo|shell_exec)/i,
  ];

  const checkValue = (value) => {
    if (typeof value !== 'string') return false;
    return suspiciousPatterns.some(pattern => pattern.test(value));
  };

  // Check query params
  const queryParams = Object.values(req.query).flat();
  if (queryParams.some(checkValue)) {
    logAudit(null, 'suspicious_request_blocked', 'WAF', 0, null, { url: req.url, query: req.query }, { reason: 'Suspicious pattern detected in query' }, req.ip, req.get('User-Agent'));
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }

  // Check body
  if (req.body && typeof req.body === 'object') {
    const bodyValues = Object.values(req.body).flat();
    if (bodyValues.some(checkValue)) {
      logAudit(null, 'suspicious_request_blocked', 'WAF', 0, null, { url: req.url }, { reason: 'Suspicious pattern detected in body' }, req.ip, req.get('User-Agent'));
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
  }

  next();
};

// Request Logger with security info
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || null,
    };
    
    if (res.statusCode >= 400) {
      console.log(`[SECURITY] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms - IP: ${req.ip}`);
    } else {
      console.log(`[${req.method}] ${req.url} - ${res.statusCode} - ${duration}ms`);
    }
  });

  next();
};

// Input Sanitization
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj.trim().replace(/[<>]/g, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitize(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);

  next();
};

// Validate request
const validateRequest = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const errorMessages = errors.array().map(err => err.msg);
    res.status(400).json({
      success: false,
      message: 'Validasi gagal',
      errors: errorMessages
    });
  };
};

// Common validation rules
const validatePagination = [
  body('page').optional().isInt({ min: 1 }).withMessage('Halaman harus berupa angka positif'),
  body('per_page').optional().isInt({ min: 1, max: 100 }).withMessage('Per halaman harus antara 1-100'),
];

const validateSearch = [
  body('search').optional().isLength({ max: 100 }).withMessage('Pencarian terlalu panjang'),
];

module.exports = {
  blockSuspiciousRequests,
  requestLogger,
  sanitizeInput,
  validateRequest,
  validatePagination,
  validateSearch,
};
