const db = require('../config/database');
const { query, validationResult } = require('express-validator');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput, validateSearch, validatePagination } = require('../middleware/security');

// Get audit logs
const getAuditLogs = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 15;
    const search = req.query.search || '';
    const action = req.query.action || '';
    const date = req.query.date || '';
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (user_name LIKE ? OR model_type LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (action) {
      whereClause += ' AND action = ?';
      params.push(action);
    }

    if (date) {
      whereClause += ' AND DATE(created_at) = ?';
      params.push(date);
    }

    const countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
    const total = dbInstance.prepare(countQuery).get(...params).total;

    const logsQuery = `
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const logs = dbInstance.prepare(logsQuery).all(...params, perPage, offset);

    res.json({
      success: true,
      data: {
        data: logs,
        pagination: {
          total,
          per_page: perPage,
          current_page: page,
          last_page: Math.ceil(total / perPage),
        }
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat audit log'
    });
  }
};

module.exports = {
  getAuditLogs,
};
