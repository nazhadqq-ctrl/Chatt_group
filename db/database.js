const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: 'master', // connect to master first to create DB
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;

async function connectDB() {
  try {
    // First connect to master to create DB if not exists
    const masterPool = await sql.connect(config);

    await masterPool.request().query(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'ChatAppDB')
      BEGIN
        CREATE DATABASE ChatAppDB
      END
    `);

    await masterPool.close();
    await sql.close();

    // Now connect to ChatAppDB
    const appConfig = { ...config, database: process.env.DB_DATABASE || 'ChatAppDB' };
    pool = await sql.connect(appConfig);

    console.log('✅ Connected to SQL Server - ChatAppDB');
    return pool;
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    throw err;
  }
}

async function initializeTables() {
  try {
    const request = pool.request();

    // Users Table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
      CREATE TABLE users (
        id INT PRIMARY KEY IDENTITY(1,1),
        username NVARCHAR(50) UNIQUE NOT NULL,
        full_name NVARCHAR(100) NOT NULL,
        email NVARCHAR(100) UNIQUE NOT NULL,
        password_hash NVARCHAR(255) NOT NULL,
        avatar NVARCHAR(255) DEFAULT NULL,
        is_admin BIT DEFAULT 0,
        is_active BIT DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE(),
        last_seen DATETIME DEFAULT GETDATE()
      )
    `);

    // Group Messages Table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='group_messages' AND xtype='U')
      CREATE TABLE group_messages (
        id INT PRIMARY KEY IDENTITY(1,1),
        sender_id INT NOT NULL,
        content NVARCHAR(MAX),
        message_type NVARCHAR(20) DEFAULT 'text',
        file_path NVARCHAR(500) DEFAULT NULL,
        file_name NVARCHAR(255) DEFAULT NULL,
        file_size BIGINT DEFAULT NULL,
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (sender_id) REFERENCES users(id)
      )
    `);

    // Private Messages Table (between users and admin, and between users)
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='private_messages' AND xtype='U')
      CREATE TABLE private_messages (
        id INT PRIMARY KEY IDENTITY(1,1),
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        content NVARCHAR(MAX),
        message_type NVARCHAR(20) DEFAULT 'text',
        file_path NVARCHAR(500) DEFAULT NULL,
        file_name NVARCHAR(255) DEFAULT NULL,
        file_size BIGINT DEFAULT NULL,
        is_read BIT DEFAULT 0,
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
      )
    `);

    // Online Status / Sessions Table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='user_sessions' AND xtype='U')
      CREATE TABLE user_sessions (
        id INT PRIMARY KEY IDENTITY(1,1),
        user_id INT NOT NULL,
        socket_id NVARCHAR(100),
        is_online BIT DEFAULT 0,
        connected_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    console.log('✅ All tables initialized successfully');
  } catch (err) {
    console.error('❌ Table initialization error:', err.message);
    throw err;
  }
}

async function createAdminUser() {
  const bcrypt = require('bcryptjs');
  try {
    const request = pool.request();
    const adminCheck = await request.query(`
      SELECT id FROM users WHERE is_admin = 1
    `);

    if (adminCheck.recordset.length === 0) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123456', 12);
      await pool.request()
        .input('username', sql.NVarChar, process.env.ADMIN_USERNAME || 'admin')
        .input('full_name', sql.NVarChar, 'Administrator')
        .input('email', sql.NVarChar, process.env.ADMIN_EMAIL || 'admin@chatapp.com')
        .input('password_hash', sql.NVarChar, hashedPassword)
        .query(`
          INSERT INTO users (username, full_name, email, password_hash, is_admin)
          VALUES (@username, @full_name, @email, @password_hash, 1)
        `);
      console.log('✅ Admin user created successfully');
      console.log(`   Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
      console.log(`   Password: ${process.env.ADMIN_PASSWORD || 'Admin@123456'}`);
    }
  } catch (err) {
    console.error('❌ Admin creation error:', err.message);
  }
}

function getPool() {
  return pool;
}

module.exports = { connectDB, initializeTables, createAdminUser, getPool, sql };
