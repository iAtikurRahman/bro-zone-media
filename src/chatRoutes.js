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

// GET /chat/dm/history/:userId — last 100 DMs with a specific user
router.get('/dm/history/:userId', requireAuth, async (req, res) => {
  const myId = req.user.id;
  const otherId = parseInt(req.params.userId);
  if (isNaN(otherId)) return res.status(400).json({ error: 'Invalid userId' });
  try {
    const result = await db.query(
      `SELECT id, sender_id, sender_email, receiver_id, content,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM private_messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at DESC
       LIMIT 100`,
      [myId, otherId]
    );
    res.json({ messages: result.rows.reverse() });
  } catch (err) {
    console.error('chat/dm/history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
