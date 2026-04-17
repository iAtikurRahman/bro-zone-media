const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      is_active  BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      email      VARCHAR(255) NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id           SERIAL PRIMARY KEY,
      sender_id    INTEGER NOT NULL,
      sender_email VARCHAR(255) NOT NULL,
      receiver_id  INTEGER NOT NULL,
      content      TEXT NOT NULL,
      created_at   TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pm_participants
    ON private_messages (sender_id, receiver_id)
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
    ON users (username) WHERE username IS NOT NULL
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP
  `);
  console.log('PostgreSQL tables ready.');
}

initDb().catch(err => console.error('DB init error:', err));

module.exports = pool;
