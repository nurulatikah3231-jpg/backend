const db = require('../config/database');
const { logAudit } = require('../utils/audit');
const { body, param, query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validateRequest, sanitizeInput } = require('../middleware/security');

// Get all products (public)
const getProducts = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 12;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const categoryId = req.query.category_id ? parseInt(req.query.category_id) : null;
    const offset = (page - 1) * perPage;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      whereClause += ' AND p.status = ?';
      params.push(status);
    }

    if (categoryId) {
      whereClause += ' AND p.category_id = ?';
      params.push(categoryId);
    }

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM products p 
      ${whereClause}
    `;
    const total = dbInstance.prepare(countQuery).get(...params).total;

    const productsQuery = `
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const products = dbInstance.prepare(productsQuery).all(...params, perPage, offset);

    res.json({
      success: true,
      data: products,
      pagination: {
        total,
        per_page: perPage,
        current_page: page,
        last_page: Math.ceil(total / perPage),
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data produk'
    });
  }
};

// Get product by slug (public)
const getProductBySlug = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const product = dbInstance.prepare(`
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.slug = ? AND p.status = 'active'
    `).get(req.params.slug);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    // Get related products
    const related = dbInstance.prepare(`
      SELECT id, name, slug, price, thumbnail
      FROM products
      WHERE category_id = ? AND id != ? AND status = 'active'
      LIMIT 4
    `).all(product.category_id, product.id);

    res.json({
      success: true,
      data: product,
      related
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data produk'
    });
  }
};

// Get product by ID (admin)
const getProductById = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const product = dbInstance.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data produk'
    });
  }
};

// Create product (admin)
const createProduct = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validasi gagal',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { name, slug, description, price, category_id, stock, status, specifications } = req.body;
    const dbInstance = db.getDb();

    // Check if slug exists
    const existing = dbInstance.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Slug produk sudah ada'
      });
    }

    const thumbnail = req.files?.thumbnail?.[0]?.filename || null;
    const productFile = req.files?.product_file?.[0]?.filename || null;

    const result = dbInstance.prepare(`
      INSERT INTO products (name, slug, description, price, category_id, stock, status, thumbnail, product_file, specifications)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, description, price, category_id, stock, status, thumbnail, productFile, specifications);

    const newProduct = dbInstance.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);

    logAudit(req.user.id, 'created', 'Product', newProduct.id, null, newProduct, req.ip, req.get('User-Agent'));

    res.status(201).json({
      success: true,
      message: 'Produk berhasil ditambahkan',
      data: newProduct
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menambahkan produk'
    });
  }
};

// Update product (admin)
const updateProduct = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validasi gagal',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { name, slug, description, price, category_id, stock, status, specifications } = req.body;
    const dbInstance = db.getDb();

    const existing = dbInstance.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    // Check if slug is taken by another product
    const slugExists = dbInstance.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(slug, req.params.id);
    if (slugExists) {
      return res.status(409).json({
        success: false,
        message: 'Slug produk sudah digunakan produk lain'
      });
    }

    const thumbnail = req.files?.thumbnail?.[0]?.filename || existing.thumbnail;
    const productFile = req.files?.product_file?.[0]?.filename || existing.product_file;

    const oldValues = { ...existing };

    dbInstance.prepare(`
      UPDATE products 
      SET name = ?, slug = ?, description = ?, price = ?, category_id = ?, stock = ?, 
          status = ?, thumbnail = ?, product_file = ?, specifications = ?, updated_at = ?
      WHERE id = ?
    `).run(name, slug, description, price, category_id, stock, status, thumbnail, productFile, specifications, new Date().toISOString(), req.params.id);

    const updatedProduct = dbInstance.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);

    logAudit(req.user.id, 'updated', 'Product', updatedProduct.id, oldValues, updatedProduct, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      message: 'Produk berhasil diperbarui',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui produk'
    });
  }
};

// Delete product (admin)
const deleteProduct = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const existing = dbInstance.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Produk tidak ditemukan'
      });
    }

    logAudit(req.user.id, 'deleted', 'Product', existing.id, existing, null, req.ip, req.get('User-Agent'));

    dbInstance.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);

    res.json({
      success: true,
      message: 'Produk berhasil dihapus'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus produk'
    });
  }
};

// Get categories
const getCategories = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const categories = dbInstance.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data kategori'
    });
  }
};

// Validation rules
const productValidation = [
  body('name').notEmpty().withMessage('Nama produk harus diisi'),
  body('slug').notEmpty().withMessage('Slug harus diisi').isSlug().withMessage('Format slug tidak valid'),
  body('description').notEmpty().withMessage('Deskripsi harus diisi'),
  body('price').isInt({ min: 0 }).withMessage('Harga harus berupa angka positif'),
  body('category_id').isInt().withMessage('Kategori harus dipilih'),
  body('stock').isInt({ min: 0 }).withMessage('Stok harus berupa angka positif'),
  body('status').isIn(['active', 'inactive']).withMessage('Status tidak valid'),
];

const productIdValidation = [
  param('id').isInt().withMessage('ID produk tidak valid'),
];

const slugValidation = [
  param('slug').notEmpty().withMessage('Slug harus diisi'),
];

module.exports = {
  getProducts,
  getProductBySlug,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  productValidation,
  productIdValidation,
  slugValidation,
};
