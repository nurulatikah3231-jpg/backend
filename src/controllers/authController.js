const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { logAudit } = require('../utils/audit');
const { body, validationResult } = require('express-validator');

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validasi gagal',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { email, password } = req.body;
    const dbInstance = db.getDb();

    const user = dbInstance.prepare('SELECT * FROM users WHERE email = ? AND role = ?').get(email, 'admin');

    if (!user) {
      logAudit(null, 'login_failed', 'User', 0, null, { email, reason: 'User not found' }, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logAudit(user.id, 'login_failed', 'User', user.id, null, { email, reason: 'Invalid password' }, req.ip, req.get('User-Agent'));
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }

    if (user.is_blocked) {
      logAudit(user.id, 'login_blocked', 'User', user.id, null, { email, reason: 'Account blocked' }, req.ip, req.get('User-Agent'));
      return res.status(403).json({
        success: false,
        message: 'Akun Anda diblokir'
      });
    }

    const token = generateToken(user.id);

    // Update last login
    dbInstance.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);

    logAudit(user.id, 'logged_in', 'User', user.id, null, { email: user.email }, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        token,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const logout = (req, res) => {
  try {
    if (req.user) {
      logAudit(req.user.id, 'logged_out', 'User', req.user.id, null, { email: req.user.email }, req.ip, req.get('User-Agent'));
    }
    res.json({
      success: true,
      message: 'Logout berhasil'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const me = (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user
    }
  });
};

const loginValidation = [
  body('email').isEmail().withMessage('Format email tidak valid'),
  body('password').notEmpty().withMessage('Password harus diisi'),
];

module.exports = {
  login,
  logout,
  me,
  loginValidation,
};
