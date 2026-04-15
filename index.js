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
// ─── Group Call Rooms: roomId → { participants: Set<socketId>, host: socketId }
const callRooms   = new Map();
// ─── Active Live Streams: socketId → { viewers: Set<socketId> }
const activeStreams = new Map();

function generateRoomId() {
  return 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function isInGroupCall(socketId) {
  for (const [, room] of callRooms) {
    if (room.participants.has(socketId)) return true;
  }
  return false;
}

function getRoomForSocket(socketId) {
  for (const [roomId, room] of callRooms) {
    if (room.participants.has(socketId)) return roomId;
  }
  return null;
}

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

  socket.on('call:offer', ({ targetSocketId, offer, callType }) => {
    const caller = onlineUsers.get(socket.id);
    console.log(`📞 call:offer  ${email} → ${targetSocketId} [${callType || 'video'}]`);
    // Reject immediately if target is already in a call
    if (callPairs.has(targetSocketId) || isInGroupCall(targetSocketId)) {
      socket.emit('call:busy', { targetSocketId });
      return;
    }
    io.to(targetSocketId).emit('call:incoming', {
      from: socket.id,
      callerEmail: caller ? caller.email : email,
      offer,
      callType: callType || 'video'
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

  // ─── Private DM ────────────────────────────────────────────────────────────
  socket.on('dm:send', async ({ targetUserId, content }) => {
    if (!content || typeof content !== 'string') return;
    const text = content.trim().slice(0, 2000);
    if (!text || !targetUserId) return;
    try {
      const result = await db.query(
        `INSERT INTO private_messages (sender_id, sender_email, receiver_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, sender_id, sender_email, receiver_id, content,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
        [userId, email, targetUserId, text]
      );
      const msg = result.rows[0];
      socket.emit('dm:message', msg);
      const targetEntry = [...onlineUsers.entries()].find(([, u]) => u.userId === targetUserId);
      if (targetEntry) {
        io.to(targetEntry[0]).emit('dm:message', msg);
      }
    } catch (err) {
      console.error('dm:send DB error:', err);
    }
  });

  // ─── Group Calls ───────────────────────────────────────────────────────────
  socket.on('group:create', ({ partnerSocketId }) => {
    const roomId = generateRoomId();
    const room = { participants: new Set([socket.id, partnerSocketId]), host: socket.id };
    callRooms.set(roomId, room);
    callPairs.delete(socket.id);
    callPairs.delete(partnerSocketId);
    const participantList = [...room.participants].map(pid => ({
      socketId: pid,
      email: onlineUsers.get(pid)?.email || 'Unknown'
    }));
    io.to(socket.id).emit('group:created', { roomId, participants: participantList });
    io.to(partnerSocketId).emit('group:created', { roomId, participants: participantList });
    broadcastOnlineUsers();
  });

  socket.on('group:invite', ({ roomId, targetSocketId }) => {
    const room = callRooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) return;
    if (callPairs.has(targetSocketId) || isInGroupCall(targetSocketId)) {
      socket.emit('call:busy', { targetSocketId });
      return;
    }
    const inviter = onlineUsers.get(socket.id);
    io.to(targetSocketId).emit('group:incoming', {
      roomId,
      from: socket.id,
      inviterEmail: inviter ? inviter.email : 'Unknown',
      participantCount: room.participants.size
    });
  });

  socket.on('group:accept', ({ roomId }) => {
    const room = callRooms.get(roomId);
    if (!room) return;
    const existingParticipants = [...room.participants];
    room.participants.add(socket.id);
    existingParticipants.forEach(pid => {
      io.to(pid).emit('group:participant-joined', {
        roomId,
        socketId: socket.id,
        email: onlineUsers.get(socket.id)?.email || 'Unknown'
      });
    });
    const participantInfo = existingParticipants.map(pid => ({
      socketId: pid,
      email: onlineUsers.get(pid)?.email || 'Unknown'
    }));
    socket.emit('group:joined', { roomId, participants: participantInfo });
    broadcastOnlineUsers();
  });

  socket.on('group:reject', ({ roomId }) => {
    const room = callRooms.get(roomId);
    if (!room) return;
    room.participants.forEach(pid => {
      io.to(pid).emit('group:invite-rejected', {
        socketId: socket.id,
        email: onlineUsers.get(socket.id)?.email || 'Unknown'
      });
    });
  });

  socket.on('group:offer', ({ roomId, targetSocketId, offer }) => {
    io.to(targetSocketId).emit('group:offer', { roomId, from: socket.id, offer });
  });

  socket.on('group:answer', ({ roomId, targetSocketId, answer }) => {
    io.to(targetSocketId).emit('group:answer', { roomId, from: socket.id, answer });
  });

  socket.on('group:ice', ({ roomId, targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('group:ice', { roomId, from: socket.id, candidate });
  });

  socket.on('group:leave', ({ roomId }) => {
    const room = callRooms.get(roomId);
    if (!room) return;
    room.participants.delete(socket.id);
    if (room.participants.size <= 1) {
      const lastPerson = [...room.participants][0];
      if (lastPerson) io.to(lastPerson).emit('group:dissolved', { roomId });
      callRooms.delete(roomId);
    } else {
      room.participants.forEach(pid => {
        io.to(pid).emit('group:participant-left', { roomId, socketId: socket.id });
      });
    }
    broadcastOnlineUsers();
  });

  // ─── Screen Sharing ────────────────────────────────────────────────────────
  socket.on('screen:sharing', ({ targetSocketId, sharing }) => {
    io.to(targetSocketId).emit('screen:sharing', { from: socket.id, sharing });
  });

  socket.on('screen:sharing-group', ({ roomId, sharing }) => {
    const room = callRooms.get(roomId);
    if (!room) return;
    room.participants.forEach(pid => {
      if (pid !== socket.id) {
        io.to(pid).emit('screen:sharing', { from: socket.id, sharing });
      }
    });
  });

  // ─── Live Streaming ────────────────────────────────────────────────────────
  socket.on('stream:start', () => {
    activeStreams.set(socket.id, { viewers: new Set() });
    broadcastOnlineUsers();
  });

  socket.on('stream:stop', () => {
    const stream = activeStreams.get(socket.id);
    if (stream) {
      stream.viewers.forEach(vid => {
        io.to(vid).emit('stream:ended', { streamerSocketId: socket.id });
      });
    }
    activeStreams.delete(socket.id);
    broadcastOnlineUsers();
  });

  socket.on('stream:watch', ({ streamerSocketId }) => {
    const stream = activeStreams.get(streamerSocketId);
    if (!stream) return;
    stream.viewers.add(socket.id);
    io.to(streamerSocketId).emit('stream:viewer-joined', {
      viewerSocketId: socket.id,
      viewerEmail: onlineUsers.get(socket.id)?.email || 'Unknown'
    });
  });

  socket.on('stream:offer', ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit('stream:offer', { from: socket.id, offer });
  });

  socket.on('stream:answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('stream:answer', { from: socket.id, answer });
  });

  socket.on('stream:ice', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('stream:ice', { from: socket.id, candidate });
  });

  socket.on('stream:invite', ({ targetSocketId }) => {
    if (!activeStreams.has(socket.id)) return; // only active streamers can invite
    const inviter = onlineUsers.get(socket.id);
    io.to(targetSocketId).emit('stream:invited', {
      streamerSocketId: socket.id,
      streamerEmail: inviter ? inviter.email : 'Unknown'
    });
  });

  socket.on('stream:leave', ({ streamerSocketId }) => {
    const stream = activeStreams.get(streamerSocketId);
    if (stream) {
      stream.viewers.delete(socket.id);
      io.to(streamerSocketId).emit('stream:viewer-left', { viewerSocketId: socket.id });
    }
  });

  // ─── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`❌ DISCONNECTED  ${email} [${socket.id}]`);
    // Notify the call partner if this user was in an active call
    if (callPairs.has(socket.id)) {
      const partner = callPairs.get(socket.id);
      callPairs.delete(socket.id);
      callPairs.delete(partner);
      io.to(partner).emit('call:hangup', { from: socket.id });
    }
    // Clean up group calls
    for (const [roomId, room] of callRooms) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        if (room.participants.size <= 1) {
          const lastPerson = [...room.participants][0];
          if (lastPerson) io.to(lastPerson).emit('group:dissolved', { roomId });
          callRooms.delete(roomId);
        } else {
          room.participants.forEach(pid => {
            io.to(pid).emit('group:participant-left', { roomId, socketId: socket.id });
          });
        }
      }
    }
    // Clean up streams
    const stream = activeStreams.get(socket.id);
    if (stream) {
      stream.viewers.forEach(vid => {
        io.to(vid).emit('stream:ended', { streamerSocketId: socket.id });
      });
      activeStreams.delete(socket.id);
    }
    // Remove as viewer from any streams
    for (const [streamerSid, s] of activeStreams) {
      if (s.viewers.has(socket.id)) {
        s.viewers.delete(socket.id);
        io.to(streamerSid).emit('stream:viewer-left', { viewerSocketId: socket.id });
      }
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
    inCall: callPairs.has(socketId) || isInGroupCall(socketId),
    inGroupCall: isInGroupCall(socketId),
    groupRoomId: getRoomForSocket(socketId),
    isStreaming: activeStreams.has(socketId)
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
