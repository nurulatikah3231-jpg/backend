const db = require('../config/database');

const logAudit = (userId, action, modelType, modelId, oldValues, newValues, ipAddress, userAgent) => {
  try {
    const dbInstance = db.getDb();
    let userName = null;

    if (userId) {
      const user = dbInstance.prepare('SELECT name FROM users WHERE id = ?').get(userId);
      userName = user ? user.name : null;
    }

    dbInstance.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, model_type, model_id, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      userName,
      action,
      modelType,
      modelId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent
    );
  } catch (error) {
    console.error('Failed to log audit:', error);
  }
};

module.exports = {
  logAudit,
};
