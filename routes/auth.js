const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../db/database');

const router = express.Router();

// ریجستەر
router.post('/register', async (req, res) => {
  try {
    const { username, full_name, email, password } = req.body;

    if (!username || !full_name || !email || !password) {
      return res.status(400).json({ success: false, message: 'هەموو خانەکان پڕ بکەرەوە' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'پاسوۆردەکە دەبێت لانیکەم 6 پیت بێت' });
    }

    const pool = getPool();

    // Check if username or email already exists
    const existingUser = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('email', sql.NVarChar, email)
      .query('SELECT id FROM users WHERE username = @username OR email = @email');

    if (existingUser.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'ئەم یوزەرنەیم یان ئیمەیڵە پێشتر تۆمارکراوە' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .input('full_name', sql.NVarChar, full_name)
      .input('email', sql.NVarChar, email)
      .input('password_hash', sql.NVarChar, hashedPassword)
      .query(`
        INSERT INTO users (username, full_name, email, password_hash)
        OUTPUT INSERTED.id, INSERTED.username, INSERTED.full_name, INSERTED.email, INSERTED.is_admin
        VALUES (@username, @full_name, @email, @password_hash)
      `);

    const user = result.recordset[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'تۆمارکردن سەرکەوتوو بوو',
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'هەڵەی سێرڤەر' });
  }
});

// لۆگین
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'یوزەرنەیم و پاسوۆرد داخڵ بکە' });
    }

    const pool = getPool();
    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .query(`
        SELECT id, username, full_name, email, password_hash, is_admin, avatar, is_active
        FROM users WHERE username = @username
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ success: false, message: 'یوزەرنەیم یان پاسوۆرد هەڵەیە' });
    }

    const user = result.recordset[0];

    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'ئەم ئەکاونتە داخراوە' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'یوزەرنەیم یان پاسوۆرد هەڵەیە' });
    }

    // Update last seen
    await pool.request()
      .input('id', sql.Int, user.id)
      .query('UPDATE users SET last_seen = GETDATE() WHERE id = @id');

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'بەخێربێیت',
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        is_admin: user.is_admin,
        avatar: user.avatar
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'هەڵەی سێرڤەر' });
  }
});

// بەدەستهێنانی زانیاری یوزەری کنونی
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query('SELECT id, username, full_name, email, is_admin, avatar, created_at FROM users WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'یوزەر نەدۆزرایەوە' });
    }

    res.json({ success: true, user: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'هەڵەی سێرڤەر' });
  }
});

module.exports = router;
