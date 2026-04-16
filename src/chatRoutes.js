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
      `SELECT m.id, m.user_id, m.email, m.content,
              to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              COALESCE(u.username, m.email) AS display_name
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       ORDER BY m.created_at DESC
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
      `SELECT pm.id, pm.sender_id, pm.sender_email, pm.receiver_id, pm.content,
              to_char(pm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              COALESCE(u.username, pm.sender_email) AS display_name
       FROM private_messages pm
       LEFT JOIN users u ON pm.sender_id = u.id
       WHERE (pm.sender_id = $1 AND pm.receiver_id = $2)
          OR (pm.sender_id = $2 AND pm.receiver_id = $1)
       ORDER BY pm.created_at DESC
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
