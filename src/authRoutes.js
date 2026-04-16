const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
require('dotenv').config();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// POST /auth/google — verify Google ID token, create or login user
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing Google credential' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    if (!email) return res.status(400).json({ error: 'Google account has no email' });

    // Check if user exists
    let result = await db.query('SELECT id, email, username FROM users WHERE email = $1', [email]);
    let userId;
    let username = null;

    if (result.rows.length > 0) {
      userId = result.rows[0].id;
      username = result.rows[0].username;
    } else {
      // Create new user with a random password (Google-only auth)
      const randomPass = require('crypto').randomBytes(32).toString('hex');
      const hashed = await bcrypt.hash(randomPass, 10);
      const insertResult = await db.query(
        'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id',
        [email, hashed]
      );
      userId = insertResult.rows[0].id;
    }

    const token = jwt.sign(
      { id: userId, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: userId, email, username } });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Invalid Google credential' });
  }
});

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id',
      [email, hashed]
    );

    const newId = result.rows[0].id;
    const token = jwt.sign(
      { id: newId, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: newId, email, username: null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: user.id, email: user.email, username: user.username || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /auth/me
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query('SELECT username FROM users WHERE id = $1', [decoded.id]);
    const username = result.rows.length > 0 ? result.rows[0].username : null;
    res.json({ user: { id: decoded.id, email: decoded.email, username } });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /auth/profile — set username
router.post('/profile', requireAuth, async (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string')
    return res.status(400).json({ error: 'Username required' });

  const clean = username.trim().toLowerCase();
  if (clean.length < 3 || clean.length > 30)
    return res.status(400).json({ error: 'Username must be 3-30 characters' });

  if (!/^[a-z0-9_]+$/.test(clean))
    return res.status(400).json({ error: 'Only letters, numbers, and underscores allowed' });

  try {
    const existing = await db.query('SELECT id FROM users WHERE username = $1 AND id != $2', [clean, req.user.id]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Username already taken' });

    await db.query('UPDATE users SET username = $1 WHERE id = $2', [clean, req.user.id]);
    res.json({ success: true, username: clean });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /auth/check-username/:username
router.get('/check-username/:username', requireAuth, async (req, res) => {
  const clean = req.params.username.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(clean) || clean.length < 3)
    return res.json({ available: false });
  try {
    const existing = await db.query('SELECT id FROM users WHERE username = $1 AND id != $2', [clean, req.user.id]);
    res.json({ available: existing.rows.length === 0 });
  } catch {
    res.json({ available: false });
  }
});

module.exports = router;
