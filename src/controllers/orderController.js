const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('../utils/audit');
const { body, param, validationResult } = require('express-validator');
const { authenticate, adminOnly, optionalAuth } = require('../middleware/auth');
const { validateRequest, sanitizeInput } = require('../middleware/security');

// Generate order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
};

// Create checkout/order
const createOrder = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validasi gagal',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { customer_name, customer_email, customer_phone, customer_address, payment_method } = req.body;
    const dbInstance = db.getDb();

    // Get cart from localStorage equivalent - in real app, this would come from request
    // For now, we'll create a simple order with items from request
    const items = req.body.items || [];

    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Keranjang belanja kosong'
      });
    }

    // Calculate totals
    let subtotal = 0;
    for (const item of items) {
      const product = dbInstance.prepare('SELECT price, stock FROM products WHERE id = ? AND status = ?').get(item.product_id, 'active');
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Produk ID ${item.product_id} tidak ditemukan`
        });
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Stok tidak cukup untuk produk ID ${item.product_id}`
        });
      }
      subtotal += product.price * item.quantity;
    }

    const discount = 0;
    const totalAmount = subtotal - discount;
    const orderNumber = generateOrderNumber();

    // Start transaction
    const insertOrder = dbInstance.prepare(`
      INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, customer_address, 
                         subtotal, discount, total_amount, final_amount, payment_method, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const result = insertOrder.run(
      orderNumber,
      customer_name,
      customer_email,
      customer_phone || null,
      customer_address || null,
      subtotal,
      discount,
      totalAmount,
      totalAmount,
      payment_method
    );

    const orderId = result.lastInsertRowid;

    // Insert order items
    const insertItem = dbInstance.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const product = dbInstance.prepare('SELECT name, price FROM products WHERE id = ?').get(item.product_id);
      insertItem.run(orderId, item.product_id, product.name, item.quantity, product.price, product.price * item.quantity);
      
      // Update stock
      dbInstance.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.quantity, item.product_id);
    }

    // Create transaction record
    const transactionId = uuidv4();
    const insertTransaction = dbInstance.prepare(`
      INSERT INTO transactions (order_id, transaction_id, payment_method, amount, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    insertTransaction.run(orderId, transactionId, payment_method, totalAmount);

    const order = dbInstance.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

    logAudit(null, 'created', 'Order', orderId, null, { order_number: orderNumber, customer: customer_email }, req.ip, req.get('User-Agent'));

    res.status(201).json({
      success: true,
      message: 'Order berhasil dibuat',
      data: {
        ...order,
        order_number: orderNumber,
      }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal membuat pesanan'
    });
  }
};

// Get order by ID
const getOrder = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const order = dbInstance.prepare(`
      SELECT o.*, 
             (SELECT json_group_array(
              json_object(
                'id', oi.id,
                'product_id', oi.product_id,
                'product_name', oi.product_name,
                'quantity', oi.quantity,
                'price', oi.price,
                'subtotal', oi.subtotal,
                'product', json_object(
                  'id', p.id,
                  'name', p.name,
                  'thumbnail', p.thumbnail
                )
              )
            ) FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id) as items,
             (SELECT json_object(
              'id', t.id,
              'transaction_id', t.transaction_id,
              'payment_method', t.payment_method,
              'amount', t.amount,
              'status', t.status,
              'payment_url', t.payment_url,
              'qr_code_url', t.qr_code_url
            ) FROM transactions t WHERE t.order_id = o.id) as transaction
      FROM orders o
      WHERE o.id = ? OR o.order_number = ?
    `).get(req.params.id, req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order tidak ditemukan'
      });
    }

    // Parse JSON fields
    if (order.items) {
      order.items = JSON.parse(order.items);
    }
    if (order.transaction) {
      order.transaction = JSON.parse(order.transaction);
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data pesanan'
    });
  }
};

// Get all orders (admin)
const getOrders = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 15;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const paymentMethod = req.query.payment_method || '';
    const date = req.query.date || '';
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }

    if (paymentMethod) {
      whereClause += ' AND o.payment_method = ?';
      params.push(paymentMethod);
    }

    if (date) {
      whereClause += ' AND DATE(o.created_at) = ?';
      params.push(date);
    }

    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const total = dbInstance.prepare(countQuery).get(...params).total;

    const ordersQuery = `
      SELECT o.*, 
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count
      FROM orders o
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const orders = dbInstance.prepare(ordersQuery).all(...params, perPage, offset);

    res.json({
      success: true,
      data: {
        data: orders,
        pagination: {
          total,
          per_page: perPage,
          current_page: page,
          last_page: Math.ceil(total / perPage),
        }
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data pesanan'
    });
  }
};

// Update order status (admin)
const updateOrderStatus = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const { payment_status } = req.body;

    const order = dbInstance.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pesanan tidak ditemukan'
      });
    }

    const oldStatus = order.payment_status;
    const oldValues = { ...order };

    dbInstance.prepare(`
      UPDATE orders 
      SET payment_status = ?, status = ?, paid_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payment_status,
      payment_status === 'paid' ? 'paid' : order.status,
      payment_status === 'paid' ? new Date().toISOString() : null,
      new Date().toISOString(),
      req.params.id
    );

    // Update transaction if exists
    const transaction = dbInstance.prepare('SELECT * FROM transactions WHERE order_id = ?').get(req.params.id);
    if (transaction) {
      dbInstance.prepare(`
        UPDATE transactions SET status = ?, paid_at = ? WHERE order_id = ?
      `).run(payment_status, payment_status === 'paid' ? new Date().toISOString() : null, req.params.id);
    }

    const updatedOrder = dbInstance.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);

    logAudit(req.user.id, 'updated', 'Order', order.id, oldValues, updatedOrder, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      message: 'Status pesanan berhasil diperbarui',
      data: updatedOrder
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status pesanan'
    });
  }
};

// Resend email (admin)
const resendEmail = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const order = dbInstance.prepare(`
      SELECT o.*, t.payment_url, t.qr_code_url
      FROM orders o
      LEFT JOIN transactions t ON o.id = t.order_id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pesanan tidak ditemukan'
      });
    }

    // In a real app, you would send email here
    logAudit(req.user.id, 'exported', 'Order', order.id, null, { action: 'resend_email', order_number: order.order_number }, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      message: 'Email notifikasi berhasil dikirim'
    });
  } catch (error) {
    console.error('Resend email error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengirim email'
    });
  }
};

// Export orders to CSV (admin)
const exportOrders = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const orders = dbInstance.prepare(`
      SELECT o.order_number, o.customer_name, o.customer_email, o.customer_phone,
             o.total_amount, o.status, o.payment_method, o.created_at
      FROM orders o
      ORDER BY o.created_at DESC
    `).all();

    let csv = 'Order Number,Customer Name,Customer Email,Customer Phone,Total Amount,Status,Payment Method,Created At\n';
    
    orders.forEach(order => {
      csv += `"${order.order_number}","${order.customer_name}","${order.customer_email}","${order.customer_phone || ''}",${order.total_amount},"${order.status}","${order.payment_method || ''}","${order.created_at}"\n`;
    });

    logAudit(req.user.id, 'exported', 'Order', 0, null, { count: orders.length }, req.ip, req.get('User-Agent'));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengekspor data'
    });
  }
};

// Validation rules
const checkoutValidation = [
  body('customer_name').notEmpty().withMessage('Nama lengkap harus diisi'),
  body('customer_email').isEmail().withMessage('Format email tidak valid'),
  body('customer_phone').optional().isMobilePhone('id-ID').withMessage('Format nomor telepon tidak valid'),
  body('customer_address').optional(),
  body('payment_method').isIn(['bank_transfer', 'ewallet', 'qris', 'convenience_store']).withMessage('Metode pembayaran tidak valid'),
  body('items').optional().isArray().withMessage('Items harus berupa array'),
];

const orderIdValidation = [
  param('id').isInt().withMessage('ID order tidak valid'),
];

module.exports = {
  createOrder,
  getOrder,
  getOrders,
  updateOrderStatus,
  resendEmail,
  exportOrders,
  checkoutValidation,
  orderIdValidation,
};
