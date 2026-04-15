require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const path         = require('path');
const authRoutes   = require('./src/authRoutes');
const chatRoutes   = require('./src/chatRoutes');
const db           = require('./src/db');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/auth', authRoutes);
app.use('/chat', chatRoutes);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── ICE / TURN config endpoint (auth-gated) ──────────────────────────────────
app.get('/config/ice', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' }
  ];

  const turnUrl    = process.env.TURN_SERVER_URL;
  const username   = process.env.TURN_USERNAME;
  const credential = process.env.TURN_PASSWORD;

  if (turnUrl && username && credential) {
    const host = turnUrl.split(':')[0];
    const port = turnUrl.split(':')[1] || '3478';
    iceServers.push({
      urls: [
        `turn:${turnUrl}`,
        `turn:${turnUrl}?transport=tcp`,
        `turns:${host}:5349`,
        `turns:${host}:5349?transport=tcp`
      ],
      username,
      credential
    });
  }

  res.json({ iceServers });
});

// ─── Online Users: socketId → { userId, email } ───────────────────────────────
const onlineUsers = new Map();
// ─── Active Call Pairs: socketId → partnerSocketId ────────────────────────────
const callPairs   = new Map();

// ─── HTTP server ─────────────────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT || '3000');
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ─── Socket Auth Middleware ──────────────────────────────────────────────────
io.use((socket, next) => {
  let token = (socket.handshake.auth && socket.handshake.auth.token) || null;
  if (!token) {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const match = cookieHeader.split(';').find(c => c.trim().startsWith('token='));
    if (match) token = decodeURIComponent(match.split('=').slice(1).join('='));
  }
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = { id: decoded.id, email: decoded.email };
    next();
  } catch {
    next(new Error('Authentication error'));
  }
});

// ─── Socket Events ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const { id: userId, email } = socket.user;
  console.log(`✅ CONNECTED  ${email} [${socket.id}]`);

  onlineUsers.set(socket.id, { userId, email });
  broadcastOnlineUsers();

  socket.on('call:offer', ({ targetSocketId, offer }) => {
    const caller = onlineUsers.get(socket.id);
    console.log(`📞 call:offer  ${email} → ${targetSocketId}`);
    // Reject immediately if target is already in a call
    if (callPairs.has(targetSocketId)) {
      socket.emit('call:busy', { targetSocketId });
      return;
    }
    io.to(targetSocketId).emit('call:incoming', {
      from: socket.id,
      callerEmail: caller ? caller.email : email,
      offer
    });
  });

  socket.on('call:answer', ({ targetSocketId, answer }) => {
    console.log(`✅ call:answer  ${email} → ${targetSocketId}`);
    callPairs.set(socket.id, targetSocketId);
    callPairs.set(targetSocketId, socket.id);
    io.to(targetSocketId).emit('call:answered', { from: socket.id, answer });
    broadcastOnlineUsers();
  });

  socket.on('ice:candidate', ({ targetSocketId, candidate }) => {
    if (candidate) {
      // Parse type from the SDP candidate string (e.g. "... typ host ...")
      const sdp    = candidate.candidate || '';
      const tmatch = sdp.match(/typ (\S+)/);
      const pmatch = sdp.match(/^candidate:\S+ \d+ (\S+)/);
      const type   = (tmatch && tmatch[1]) || '?';
      const proto  = (pmatch && pmatch[1]) || '?';
      console.log(`📡 ice:candidate  ${email} → ${targetSocketId}  [${type}/${proto}]`);
    }
    io.to(targetSocketId).emit('ice:candidate', { from: socket.id, candidate });
  });

  socket.on('call:reject', ({ targetSocketId }) => {
    io.to(targetSocketId).emit('call:rejected', { from: socket.id });
  });

  socket.on('call:hangup', ({ targetSocketId }) => {
    callPairs.delete(socket.id);
    callPairs.delete(targetSocketId);
    io.to(targetSocketId).emit('call:hangup', { from: socket.id });
    broadcastOnlineUsers();
  });

  // ICE restart relay — lets the caller renegotiate after connection failure
  socket.on('call:ice-restart', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('call:ice-restart', { from: socket.id, offer });
  });

  socket.on('call:ice-restart-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('call:ice-restart-answer', { from: socket.id, answer });
  });

  // ─── Chat ──────────────────────────────────────────────────────────────────
  socket.on('chat:message', async ({ content }) => {
    if (!content || typeof content !== 'string') return;
    const text = content.trim().slice(0, 2000);
    if (!text) return;
    try {
      const result = await db.query(
        `INSERT INTO messages (user_id, email, content)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, email, content,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
        [userId, email, text]
      );
      const msg = result.rows[0];
      io.emit('chat:message', msg);
    } catch (err) {
      console.error('chat:message DB error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ DISCONNECTED  ${email} [${socket.id}]`);
    // Notify the call partner if this user was in an active call
    if (callPairs.has(socket.id)) {
      const partner = callPairs.get(socket.id);
      callPairs.delete(socket.id);
      callPairs.delete(partner);
      io.to(partner).emit('call:hangup', { from: socket.id });
    }
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

function broadcastOnlineUsers() {
  const users = Array.from(onlineUsers.entries()).map(([socketId, u]) => ({
    socketId,
    email:  u.email,
    userId: u.userId,
    inCall: callPairs.has(socketId)
  }));
  io.emit('users:online', users);
}

// ─── Start Server ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 NEXUS HTTP  → http://localhost:${PORT}`);
  console.log(`   From other devices on your network, find your LAN IP:`);
  console.log(`   Windows: ipconfig  |  Linux/Mac: hostname -I`);
  console.log(`   Then open: http://<YOUR-LAN-IP>:${PORT}\n`);
});
