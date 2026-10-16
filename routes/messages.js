const express = require('express');
const { getPool, sql } = require('../db/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// بەدەستهێنانی هەموو یوزەرەکان (بۆ لیستی چات)
router.get('/users', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('my_id', sql.Int, req.user.id)
      .query(`
        SELECT 
          u.id, u.username, u.full_name, u.avatar, u.is_admin, u.last_seen,
          (SELECT COUNT(*) FROM private_messages pm 
           WHERE pm.sender_id = u.id AND pm.receiver_id = @my_id AND pm.is_read = 0) as unread_count,
          (SELECT TOP 1 content FROM private_messages pm2 
           WHERE (pm2.sender_id = u.id AND pm2.receiver_id = @my_id) 
              OR (pm2.sender_id = @my_id AND pm2.receiver_id = u.id)
           ORDER BY pm2.created_at DESC) as last_message,
          (SELECT TOP 1 created_at FROM private_messages pm3 
           WHERE (pm3.sender_id = u.id AND pm3.receiver_id = @my_id) 
              OR (pm3.sender_id = @my_id AND pm3.receiver_id = u.id)
           ORDER BY pm3.created_at DESC) as last_message_time
        FROM users u
        WHERE u.id != @my_id AND u.is_active = 1
        ORDER BY u.is_admin DESC, last_message_time DESC, u.full_name ASC
      `);

    res.json({ success: true, users: result.recordset });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, message: 'هەڵەی سێرڤەر' });
  }
});

// بەدەستهێنانی مەسەجەکانی گرووپ
router.get('/group', async (req, res) => {
  try {
    const pool = getPool();
    const { before_id } = req.query;
    let query = `
      SELECT TOP 50
        gm.id, gm.content, gm.message_type, gm.file_path, gm.file_name, gm.file_size, gm.created_at,
        u.id as sender_id, u.username, u.full_name, u.avatar, u.is_admin
      FROM group_messages gm
      INNER JOIN users u ON gm.sender_id = u.id
    `;
    if (before_id) {
      query += ` WHERE gm.id < ${parseInt(before_id)}`;
    }
    query += ' ORDER BY gm.created_at DESC';

    const result = await pool.request().query(query);
    res.json({ success: true, messages: result.recordset.reverse() });
  } catch (err) {
    console.error('Get group messages error:', err);
    res.status(500).json({ success: false, message: 'هەڵەی سێرڤەر' });
  }
});

// بەدەستهێنانی مەسەجەکانی پرایڤەت
router.get('/private/:userId', async (req, res) => {
  try {
    const pool = getPool();
    const otherId = parseInt(req.params.userId);
    const myId = req.user.id;
    const { before_id } = req.query;

    let query = `
      SELECT TOP 50
        pm.id, pm.content, pm.message_type, pm.file_path, pm.file_name, pm.file_size, 
        pm.is_read, pm.created_at,
        u.id as sender_id, u.username, u.full_name, u.avatar, u.is_admin
      FROM private_messages pm
      INNER JOIN users u ON pm.sender_id = u.id
      WHERE (pm.sender_id = @my_id AND pm.receiver_id = @other_id)
         OR (pm.sender_id = @other_id AND pm.receiver_id = @my_id)
    `;
    if (before_id) {
      query += ` AND pm.id < ${parseInt(before_id)}`;
    }
    query += ' ORDER BY pm.created_at DESC';

    const result = await pool.request()
      .input('my_id', sql.Int, myId)
      .input('other_id', sql.Int, otherId)
      .query(query);

    // Mark messages as read
    await pool.request()
      .input('my_id', sql.Int, myId)
      .input('other_id', sql.Int, otherId)
      .query(`
        UPDATE private_messages 
        SET is_read = 1 
        WHERE sender_id = @other_id AND receiver_id = @my_id AND is_read = 0
      `);

    res.json({ success: true, messages: result.recordset.reverse() });
  } catch (err) {
    console.error('Get private messages error:', err);
    res.status(500).json({ success: false, message: 'هەڵەی سێرڤەر' });
  }
});

module.exports = router;
