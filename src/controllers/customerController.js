const db = require('../config/database');
const { logAudit } = require('../utils/audit');
const { query, param, validationResult } = require('express-validator');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput, validateSearch } = require('../middleware/security');

// Get all customers (admin)
const getCustomers = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 15;
    const search = req.query.search || '';
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE role = ?';
    const params = ['customer'];

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
    const total = dbInstance.prepare(countQuery).get(...params).total;

    const customersQuery = `
      SELECT u.*,
             (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as total_orders,
             (SELECT COALESCE(SUM(final_amount), 0) FROM orders WHERE user_id = u.id AND status = 'paid') as total_spent
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const customers = dbInstance.prepare(customersQuery).all(...params, perPage, offset);

    res.json({
      success: true,
      data: {
        data: customers,
        pagination: {
          total,
          per_page: perPage,
          current_page: page,
          last_page: Math.ceil(total / perPage),
        }
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data pelanggan'
    });
  }
};

// Toggle customer block status (admin)
const toggleBlock = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const customer = dbInstance.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'customer');

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Pelanggan tidak ditemukan'
      });
    }

    const newBlockStatus = customer.is_blocked ? 0 : 1;
    const oldValues = { ...customer };

    dbInstance.prepare('UPDATE users SET is_blocked = ?, updated_at = ? WHERE id = ?')
      .run(newBlockStatus, new Date().toISOString(), req.params.id);

    const updatedCustomer = dbInstance.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    logAudit(req.user.id, 'updated', 'User', customer.id, oldValues, updatedCustomer, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      message: `Pelanggan berhasil ${newBlockStatus ? 'diblokir' : 'dibuka blokir'}`,
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Toggle block error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status pelanggan'
    });
  }
};

// Validation rules
const customerIdValidation = [
  param('id').isInt().withMessage('ID pelanggan tidak valid'),
];

module.exports = {
  getCustomers,
  toggleBlock,
  customerIdValidation,
};
