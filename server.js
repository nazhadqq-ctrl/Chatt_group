require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { connectDB, initializeTables, createAdminUser, getPool, sql } = require('./db/database');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB for file transfer
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/files', require('./routes/files'));

// Serve main chat page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Online users tracking
const onlineUsers = new Map(); // userId -> { socketId, userInfo }

// Socket.IO Authentication Middleware
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// Socket.IO Connection Handler
io.on('connection', async (socket) => {
  const user = socket.user;
  console.log(`✅ User connected: ${user.username} (${socket.id})`);

  // Store online user
  onlineUsers.set(user.id, { socketId: socket.id, user });

  // Join personal room and group room
  socket.join('group');
  socket.join(`user_${user.id}`);

  // Broadcast online users list
  io.emit('online_users', Array.from(onlineUsers.keys()));

  // Update last seen and online status in DB
  try {
    const pool = getPool();
    await pool.request()
      .input('user_id', sql.Int, user.id)
      .input('socket_id', sql.NVarChar, socket.id)
      .query(`
        IF EXISTS (SELECT 1 FROM user_sessions WHERE user_id = @user_id)
          UPDATE user_sessions SET is_online = 1, socket_id = @socket_id, connected_at = GETDATE() WHERE user_id = @user_id
        ELSE
          INSERT INTO user_sessions (user_id, socket_id, is_online) VALUES (@user_id, @socket_id, 1)
      `);
    
    await pool.request()
      .input('id', sql.Int, user.id)
      .query('UPDATE users SET last_seen = GETDATE() WHERE id = @id');
  } catch (err) {
    console.error('Session update error:', err.message);
  }

  // ==================== GROUP MESSAGE ====================
  socket.on('group_message', async (data) => {
    try {
      const pool = getPool();
      const { content, message_type, file_path, file_name, file_size } = data;

      const result = await pool.request()
        .input('sender_id', sql.Int, user.id)
        .input('content', sql.NVarChar, content || null)
        .input('message_type', sql.NVarChar, message_type || 'text')
        .input('file_path', sql.NVarChar, file_path || null)
        .input('file_name', sql.NVarChar, file_name || null)
        .input('file_size', sql.BigInt, file_size || null)
        .query(`
          INSERT INTO group_messages (sender_id, content, message_type, file_path, file_name, file_size)
          OUTPUT INSERTED.id, INSERTED.created_at
          VALUES (@sender_id, @content, @message_type, @file_path, @file_name, @file_size)
        `);

      const inserted = result.recordset[0];

      // Get sender info
      const userResult = await pool.request()
        .input('id', sql.Int, user.id)
        .query('SELECT id, username, full_name, avatar, is_admin FROM users WHERE id = @id');

      const messageData = {
        id: inserted.id,
        sender_id: user.id,
        content,
        message_type: message_type || 'text',
        file_path,
        file_name,
        file_size,
        created_at: inserted.created_at,
        username: userResult.recordset[0].username,
        full_name: userResult.recordset[0].full_name,
        avatar: userResult.recordset[0].avatar,
        is_admin: userResult.recordset[0].is_admin
      };

      io.to('group').emit('group_message', messageData);
    } catch (err) {
      console.error('Group message error:', err.message);
      socket.emit('error', { message: 'هەڵە لە ناردنی مەسەج' });
    }
  });

  // ==================== PRIVATE MESSAGE ====================
  socket.on('private_message', async (data) => {
    try {
      const pool = getPool();
      const { receiver_id, content, message_type, file_path, file_name, file_size } = data;

      // Verify receiver exists
      const receiverCheck = await pool.request()
        .input('id', sql.Int, receiver_id)
        .query('SELECT id, username, full_name, avatar, is_admin FROM users WHERE id = @id AND is_active = 1');

      if (receiverCheck.recordset.length === 0) {
        return socket.emit('error', { message: 'وەرگری مەسەجەکە نەدۆزرایەوە' });
      }

      const result = await pool.request()
        .input('sender_id', sql.Int, user.id)
        .input('receiver_id', sql.Int, receiver_id)
        .input('content', sql.NVarChar, content || null)
        .input('message_type', sql.NVarChar, message_type || 'text')
        .input('file_path', sql.NVarChar, file_path || null)
        .input('file_name', sql.NVarChar, file_name || null)
        .input('file_size', sql.BigInt, file_size || null)
        .query(`
          INSERT INTO private_messages (sender_id, receiver_id, content, message_type, file_path, file_name, file_size)
          OUTPUT INSERTED.id, INSERTED.created_at
          VALUES (@sender_id, @receiver_id, @content, @message_type, @file_path, @file_name, @file_size)
        `);

      const inserted = result.recordset[0];

      // Get sender info
      const senderResult = await pool.request()
        .input('id', sql.Int, user.id)
        .query('SELECT id, username, full_name, avatar, is_admin FROM users WHERE id = @id');

      const messageData = {
        id: inserted.id,
        sender_id: user.id,
        receiver_id,
        content,
        message_type: message_type || 'text',
        file_path,
        file_name,
        file_size,
        created_at: inserted.created_at,
        username: senderResult.recordset[0].username,
        full_name: senderResult.recordset[0].full_name,
        avatar: senderResult.recordset[0].avatar,
        is_admin: senderResult.recordset[0].is_admin
      };

      // Send to sender
      socket.emit('private_message', messageData);

      // Send to receiver if online
      const receiverSocket = onlineUsers.get(receiver_id);
      if (receiverSocket) {
        io.to(`user_${receiver_id}`).emit('private_message', messageData);
      }

      // Notify receiver of new message
      io.to(`user_${receiver_id}`).emit('new_message_notification', {
        from: user.id,
        from_name: senderResult.recordset[0].full_name,
        preview: content || (message_type === 'image' ? '📷 وینە' : '📄 دۆکیومێنت')
      });

    } catch (err) {
      console.error('Private message error:', err.message);
      socket.emit('error', { message: 'هەڵە لە ناردنی مەسەج' });
    }
  });

  // ==================== TYPING INDICATORS ====================
  socket.on('typing_group', () => {
    socket.to('group').emit('user_typing_group', { user_id: user.id, username: user.username });
  });

  socket.on('typing_private', ({ to_user_id }) => {
    io.to(`user_${to_user_id}`).emit('user_typing_private', { 
      user_id: user.id, 
      username: user.username 
    });
  });

  socket.on('stop_typing_group', () => {
    socket.to('group').emit('stop_typing_group', { user_id: user.id });
  });

  socket.on('stop_typing_private', ({ to_user_id }) => {
    io.to(`user_${to_user_id}`).emit('stop_typing_private', { user_id: user.id });
  });

  // ==================== DISCONNECT ====================
  socket.on('disconnect', async () => {
    console.log(`❌ User disconnected: ${user.username}`);
    onlineUsers.delete(user.id);
    io.emit('online_users', Array.from(onlineUsers.keys()));

    try {
      const pool = getPool();
      await pool.request()
        .input('user_id', sql.Int, user.id)
        .query('UPDATE user_sessions SET is_online = 0 WHERE user_id = @user_id');
      
      await pool.request()
        .input('id', sql.Int, user.id)
        .query('UPDATE users SET last_seen = GETDATE() WHERE id = @id');
    } catch (err) {
      console.error('Disconnect update error:', err.message);
    }
  });
});

// Start Server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await connectDB();
    await initializeTables();
    await createAdminUser();

    // Create uploads directories
    const fs = require('fs');
    ['uploads', 'uploads/images', 'uploads/documents'].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Chat Server running on port ${PORT}`);
      console.log(`   Local: http://localhost:${PORT}`);
      console.log(`   Network: http://62.201.232.190:${PORT}\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
