const db = require('../config/database');
const { logAudit } = require('../utils/audit');
const { body, validationResult } = require('express-validator');
const { authenticate, adminOnly } = require('../middleware/auth');
const { validateRequest, sanitizeInput } = require('../middleware/security');

// Get all settings
const getSettings = (req, res) => {
  try {
    const dbInstance = db.getDb();
    const settings = dbInstance.prepare('SELECT * FROM settings').all();
    
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });

    res.json({
      success: true,
      data: settingsObj
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat pengaturan'
    });
  }
};

// Update settings
const updateSettings = (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validasi gagal',
        errors: errors.array().map(e => e.msg)
      });
    }

    const dbInstance = db.getDb();
    const settings = req.body;

    const oldSettings = dbInstance.prepare('SELECT * FROM settings').all();
    const oldSettingsObj = {};
    oldSettings.forEach(s => oldSettingsObj[s.key] = s.value);

    const updateStmt = dbInstance.prepare(`
      UPDATE settings SET value = ?, updated_at = ? WHERE key = ?
    `);

    for (const [key, value] of Object.entries(settings)) {
      updateStmt.run(value, new Date().toISOString(), key);
    }

    logAudit(req.user.id, 'updated', 'Settings', 0, oldSettingsObj, settings, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      message: 'Pengaturan berhasil disimpan',
      data: settings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menyimpan pengaturan'
    });
  }
};

// Validation rules
const settingsValidation = [
  body('store_name').optional().isLength({ max: 255 }).withMessage('Nama toko terlalu panjang'),
  body('store_email').optional().isEmail().withMessage('Format email tidak valid'),
  body('store_phone').optional(),
  body('store_address').optional(),
  body('pakasir_api_key').optional(),
  body('pakasir_project_slug').optional(),
  body('pakasir_webhook_secret').optional(),
  body('mail_host').optional(),
  body('mail_port').optional().isInt({ min: 1, max: 65535 }).withMessage('Port tidak valid'),
  body('mail_username').optional(),
  body('mail_password').optional(),
  body('mail_from_address').optional().isEmail().withMessage('Format email tidak valid'),
  body('mail_from_name').optional(),
];

module.exports = {
  getSettings,
  updateSettings,
  settingsValidation,
};
