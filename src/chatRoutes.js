const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const db      = require('./db');

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

// GET /chat/history — last 100 messages, oldest first
router.get('/history', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, user_id, email, content,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM messages
       ORDER BY created_at DESC
       LIMIT 100`,
      []
    );
    res.json({ messages: result.rows.reverse() });
  } catch (err) {
    console.error('chat/history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
