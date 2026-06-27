const db = require('../config/database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { sanitizeInput } = require('../middleware/security');

// Get dashboard stats
const getDashboardStats = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    // Today's sales
    const todaySales = dbInstance.prepare(`
      SELECT COALESCE(SUM(final_amount), 0) as total
      FROM orders
      WHERE DATE(created_at) = ? AND status = 'paid'
    `).get(today).total;

    // This month's sales
    const monthSales = dbInstance.prepare(`
      SELECT COALESCE(SUM(final_amount), 0) as total
      FROM orders
      WHERE DATE(created_at) >= ? AND status = 'paid'
    `).get(firstDayOfMonth).total;

    // New orders count
    const newOrders = dbInstance.prepare(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE DATE(created_at) = ?
    `).get(today).count;

    // New customers count
    const newCustomers = dbInstance.prepare(`
      SELECT COUNT(*) as count
      FROM users
      WHERE role = 'customer' AND DATE(created_at) = ?
    `).get(today).count;

    // Sales chart (last 7 days)
    const salesChart = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const daySales = dbInstance.prepare(`
        SELECT COALESCE(SUM(final_amount), 0) as amount
        FROM orders
        WHERE DATE(created_at) = ? AND status = 'paid'
      `).get(dateStr).amount;

      salesChart.push({
        date: dateStr,
        amount: daySales
      });
    }

    // Top products
    const topProducts = dbInstance.prepare(`
      SELECT p.name, SUM(oi.quantity) as sales
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = 'paid'
      GROUP BY p.id
      ORDER BY sales DESC
      LIMIT 5
    `).all();

    // Recent orders
    const recentOrders = dbInstance.prepare(`
      SELECT id, order_number, customer_name, customer_email, total_amount, status, payment_method, created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        stats: {
          todaySales,
          monthSales,
          newOrders,
          newCustomers,
          salesChart,
          topProducts,
        },
        recentOrders
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data dashboard'
    });
  }
};

module.exports = {
  getDashboardStats,
};
