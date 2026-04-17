// ──────────────────────────────────────────────────────────────────────────────
//  NEXUS — Real-Time Communication App
//  Features: Public Chat, Private DM, Audio/Video Calls, Group Calls,
//            Screen Sharing, Live Streaming, Responsive Video Layout
// ──────────────────────────────────────────────────────────────────────────────

// ── ICE CONFIG ────────────────────────────────────────────────────────────────
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

// ── STATE ─────────────────────────────────────────────────────────────────────
let socket             = null;
let currentUser        = null;
let localStream        = null;
let screenStream       = null;
let peerConnection     = null;
let inCallWithSocketId = null;
let callMode           = 'video'; // 'audio' or 'video'
let micEnabled         = true;
let camEnabled         = true;
let isSharingScreen    = false;
let pendingOffer       = null;
let pendingCallerId    = null;
let pendingCallType    = 'video';
let iceCandidateBuffer = [];
let remoteDescSet      = false;
let isCaller           = false;
let iceRestartAttempts = 0;
let isCallEstablished  = false;
let callTimeout        = null;
let isRestartingIce    = false;
let preAcceptIceCandidates = [];
let ringtoneHandle     = null;
let onlineUsersList    = [];

// ── DM STATE ──────────────────────────────────────────────────────────────────
let activeDmUserId     = null;
let activeDmEmail      = null;
let dmUnreadMap        = new Map(); // userId → count

// ── GROUP CALL STATE ──────────────────────────────────────────────────────────
let currentRoomId      = null;
let lastLeftRoomId     = null; // track last group room for rejoin
let groupPeers         = new Map(); // socketId → { pc, email, remoteDescSet, iceBuffer }
let pendingGroupInvite = null; // { roomId, from, inviterEmail }

// ── LIVE STREAMING STATE ──────────────────────────────────────────────────────
let pendingOpenParticipantModal = false; // deferred until group:created arrives

// ── DEVICE CAPABILITIES ───────────────────────────────────────────────────────
const supportsScreenShare = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
let currentFacingMode = 'user'; // 'user' = front camera, 'environment' = rear camera
let isStreaming         = false;
let liveStream          = null; // MediaStream for broadcast
let streamViewerPCs     = new Map(); // viewerSocketId → RTCPeerConnection
let watchingStreamFrom  = null; // streamerSocketId
let streamPC            = null; // viewer's PC to streamer
let streamMode          = 'camera'; // 'camera' | 'screen'
let streamMicEnabled    = true;
let streamCamEnabled    = true;
let pendingStreamInvite = null; // { streamerSocketId, streamerEmail }

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const authScreen       = document.getElementById('auth-screen');
const appScreen        = document.getElementById('app-screen');
const loginForm        = document.getElementById('login-form');
const signupForm       = document.getElementById('signup-form');
const loginEmail       = document.getElementById('login-email');
const loginPassword    = document.getElementById('login-password');
const loginError       = document.getElementById('login-error');
const signupEmail      = document.getElementById('signup-email');
const signupPassword   = document.getElementById('signup-password');
const signupError      = document.getElementById('signup-error');
const logoutBtn        = document.getElementById('logout-btn');
const headerEmail      = document.getElementById('header-email');
const usersList        = document.getElementById('users-list');
const userCount        = document.getElementById('user-count');
const noCallState      = document.getElementById('no-call-state');
const video1to1        = document.getElementById('video-1to1');
const videoGroup       = document.getElementById('video-group');
const remoteVideo      = document.getElementById('remote-video');
const localVideo       = document.getElementById('local-video');
const remoteLabel      = document.getElementById('remote-label');
const localIdle        = document.getElementById('local-idle');
const remoteIdle       = document.getElementById('remote-idle');
const groupLocalVideo  = document.getElementById('group-local-video');
const callControls     = document.getElementById('call-controls');
const callStatus       = document.getElementById('call-status');
const toggleMicBtn     = document.getElementById('toggle-mic');
const toggleCamBtn     = document.getElementById('toggle-cam');
const toggleScreenBtn  = document.getElementById('toggle-screen');
const addParticipantBtn= document.getElementById('add-participant-btn');
const hangupBtn        = document.getElementById('hangup-btn');
const incomingModal    = document.getElementById('incoming-modal');
const callerName       = document.getElementById('caller-name');
const incomingIcon     = document.getElementById('incoming-icon');
const incomingTypeLabel= document.getElementById('incoming-type-label');
const acceptCallBtn    = document.getElementById('accept-call');
const rejectCallBtn    = document.getElementById('reject-call');
const groupInviteModal = document.getElementById('group-invite-modal');
const groupInviterName = document.getElementById('group-inviter-name');
const groupParticipantCount = document.getElementById('group-participant-count');
const acceptGroupBtn   = document.getElementById('accept-group');
const rejectGroupBtn   = document.getElementById('reject-group');
const addPartModal     = document.getElementById('add-participant-modal');
const inviteUsersList  = document.getElementById('invite-users-list');
const closeInviteModal = document.getElementById('close-invite-modal');
const goLiveModal      = document.getElementById('go-live-modal');
const goLiveBtn        = document.getElementById('go-live-btn');
const stopLiveBtn      = document.getElementById('stop-live-btn');
const liveCameraBtn    = document.getElementById('live-camera');
const liveScreenBtn    = document.getElementById('live-screen');
const liveCancelBtn    = document.getElementById('live-cancel');
const streamViewer     = document.getElementById('stream-viewer');
const streamVideo      = document.getElementById('stream-video');
const streamLabel      = document.getElementById('stream-label');
const leaveStreamBtn   = document.getElementById('leave-stream');
const streamControls   = document.getElementById('stream-controls');
const streamToggleMicBtn  = document.getElementById('stream-toggle-mic');
const streamToggleCamBtn  = document.getElementById('stream-toggle-cam');
const streamToggleScreenBtn = document.getElementById('stream-toggle-screen');
const streamInviteBtn  = document.getElementById('stream-invite-btn');
const streamViewerCount= document.getElementById('stream-viewer-count');
const streamInviteModal= document.getElementById('stream-invite-modal');
const streamInviteUsersList = document.getElementById('stream-invite-users-list');
const closeStreamInviteModalBtn = document.getElementById('close-stream-invite-modal');
const streamInvitedModal= document.getElementById('stream-invited-modal');
const streamInviterName= document.getElementById('stream-inviter-name');
const acceptStreamInviteBtn = document.getElementById('accept-stream-invite');
const rejectStreamInviteBtn = document.getElementById('reject-stream-invite');
const flipCameraBtn     = document.getElementById('flip-camera-btn');
const streamFlipCamBtn  = document.getElementById('stream-flip-cam-btn');
// Chat DOM
const publicTabBtn     = document.getElementById('public-tab-btn');
const dmTabBtn         = document.getElementById('dm-tab-btn');
const publicChat       = document.getElementById('public-chat');
const dmChat           = document.getElementById('dm-chat');
const chatMessages     = document.getElementById('chat-messages');
const chatInput        = document.getElementById('chat-input');
const chatSendBtn      = document.getElementById('chat-send');
const dmMessages       = document.getElementById('dm-messages');
const dmInput          = document.getElementById('dm-input');
const dmSendBtn        = document.getElementById('dm-send');
const dmPartnerName    = document.getElementById('dm-partner-name');
const dmCloseBtn       = document.getElementById('dm-close');
const dmHeader         = document.getElementById('dm-header');
// Profile DOM
const profileBtn       = document.getElementById('profile-btn');
const profileModal     = document.getElementById('profile-modal');
const profileUsername   = document.getElementById('profile-username');
const profileSave      = document.getElementById('profile-save');
const profileError     = document.getElementById('profile-error');
const profileClose     = document.getElementById('profile-close');

// ── VIDEO PLAYBACK HELPERS ────────────────────────────────────────────────────
function ensureVideoPlayback(videoEl) {
  if (!videoEl || !videoEl.srcObject) return;
  videoEl.muted = false;
  const p = videoEl.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => {
      // Autoplay with audio blocked — play muted, then prompt user
      videoEl.muted = true;
      videoEl.play().then(() => {
        showUnmuteOverlay(videoEl);
      }).catch(() => {});
    });
  }
}

function showUnmuteOverlay(videoEl) {
  const parent = videoEl.closest('.video-layout-1to1, .group-video-tile, .stream-viewer');
  if (!parent || parent.querySelector('.unmute-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'unmute-overlay';
  overlay.textContent = '\uD83D\uDD07 Tap to enable audio';
  overlay.addEventListener('click', () => {
    videoEl.muted = false;
    videoEl.play().catch(() => {});
    overlay.remove();
  }, { once: true });
  parent.appendChild(overlay);
}

function removeUnmuteOverlay(videoEl) {
  const parent = videoEl.closest('.video-layout-1to1, .group-video-tile, .stream-viewer');
  if (!parent) return;
  const overlay = parent.querySelector('.unmute-overlay');
  if (overlay) overlay.remove();
}

// ── AUTH TABS ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + '-form').classList.add('active');
    loginError.textContent = '';
    signupError.textContent = '';
  });
});

// ── GOOGLE SIGN-IN ────────────────────────────────────────────────────────────
function initGoogleSignIn() {
  if (typeof google === 'undefined' || !google.accounts) {
    // GIS script not loaded yet — retry after a short delay
    setTimeout(initGoogleSignIn, 500);
    return;
  }
  google.accounts.id.initialize({
    client_id: '587752196180-tlu3l06kmtl2655sd6fpa74gm4ka2c3h.apps.googleusercontent.com',
    callback: handleGoogleCredential,
  });
  google.accounts.id.renderButton(
    document.getElementById('google-signin-btn-login'),
    { theme: 'filled_black', size: 'large', width: '100%', text: 'continue_with' }
  );
  google.accounts.id.renderButton(
    document.getElementById('google-signin-btn-signup'),
    { theme: 'filled_black', size: 'large', width: '100%', text: 'signup_with' }
  );
}

async function handleGoogleCredential(response) {
  try {
    const res = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || 'Google sign-in failed';
      return;
    }
    currentUser = data.user;
    enterApp();
  } catch {
    loginError.textContent = 'Google sign-in failed. Try again.';
  }
}

initGoogleSignIn();

// ── AUTH ──────────────────────────────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail.value, password: loginPassword.value })
    });
    const data = await res.json();
    if (!res.ok) { loginError.textContent = data.error; return; }
    currentUser = data.user;
    enterApp();
  } catch { loginError.textContent = 'Connection error. Try again.'; }
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  signupError.textContent = '';
  if (signupPassword.value.length < 6) {
    signupError.textContent = 'Password must be at least 6 characters.'; return;
  }
  try {
    const res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupEmail.value, password: signupPassword.value })
    });
    const data = await res.json();
    if (!res.ok) { signupError.textContent = data.error; return; }
    currentUser = data.user;
    enterApp();
  } catch { signupError.textContent = 'Connection error. Try again.'; }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  if (socket) socket.disconnect();
  socket = null; currentUser = null;
  hangupCall();
  stopStreaming();
  leaveStream();
  appScreen.classList.remove('active');
  authScreen.classList.add('active');
});

// ── PROFILE ───────────────────────────────────────────────────────────────────
profileBtn.addEventListener('click', () => {
  profileUsername.value = currentUser.username || '';
  profileError.textContent = '';
  profileModal.classList.remove('hidden');
});

profileClose.addEventListener('click', () => {
  profileModal.classList.add('hidden');
});

profileSave.addEventListener('click', async () => {
  const username = profileUsername.value.trim();
  profileError.textContent = '';

  try {
    const res = await fetch('/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) { profileError.textContent = data.error; return; }

    currentUser.username = data.username;
    headerEmail.textContent = data.username || currentUser.email;
    profileModal.classList.add('hidden');

    // Notify server to update display name for all users
    if (socket) socket.emit('profile:username-updated', { username: data.username });
  } catch {
    profileError.textContent = 'Failed to update profile.';
  }
});

// ── SESSION CHECK ─────────────────────────────────────────────────────────────
(async () => {
  try {
    const res = await fetch('/auth/me');
    if (res.ok) { const d = await res.json(); currentUser = d.user; enterApp(); }
  } catch {}
})();

// ── ENTER APP ─────────────────────────────────────────────────────────────────
async function enterApp() {
  headerEmail.textContent = currentUser.username || currentUser.email;
  // Set local avatar letter for group call tile
  const avatarLetter = document.getElementById('group-local-avatar-letter');
  if (avatarLetter) {
    const name = currentUser.username || currentUser.email || '?';
    avatarLetter.textContent = name.charAt(0).toUpperCase();
  }
  authScreen.classList.remove('active');
  appScreen.classList.add('active');
  try {
    const r = await fetch('/config/ice');
    const data = await r.json();
    if (data.iceServers && data.iceServers.length) {
      iceServers = data.iceServers;
      console.log('[ICE] Loaded', iceServers.length, 'servers');
    }
  } catch (e) {
    console.warn('[ICE] Failed to load config:', e.message);
  }
  goLiveBtn.classList.remove('hidden');
  loadChatHistory();
  connectSocket();
}

// ══════════════════════════════════════════════════════════════════════════════
//  SOCKET.IO
// ══════════════════════════════════════════════════════════════════════════════
function connectSocket() {
  if (socket && socket.connected) return;
  const token = getCookie('token');
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    setStatus('Connected — ready.');
  });
  socket.on('disconnect', () => setStatus('Disconnected…'));
  socket.on('users:online', renderUsers);
  socket.on('chat:message', (msg) => appendChatMessage(msg));
  socket.on('dm:message', (msg) => handleDmMessage(msg));

  // ── 1-to-1 Call Events ──────────────────────────────────────────────────────
  socket.on('call:incoming', ({ from, callerEmail, offer, callType }) => {
    console.log('Incoming', callType, 'call from', callerEmail);
    if (inCallWithSocketId || pendingCallerId || currentRoomId) {
      socket.emit('call:reject', { targetSocketId: from }); return;
    }
    pendingOffer = offer;
    pendingCallerId = from;
    pendingCallType = callType || 'video';
    callerName.textContent = callerEmail;
    incomingIcon.textContent = pendingCallType === 'audio' ? '🎤' : '📹';
    incomingTypeLabel.textContent = pendingCallType === 'audio' ? 'Incoming Audio Call' : 'Incoming Video Call';
    incomingModal.classList.remove('hidden');
    startRingtone();
  });

  socket.on('call:answered', async ({ answer }) => {
    if (!peerConnection) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescSet = true;
      await flushIceCandidates();
    } catch (err) { console.error('setRemoteDescription(answer):', err); }
  });

  socket.on('ice:candidate', async ({ candidate }) => {
    if (!peerConnection) {
      if (pendingCallerId) { preAcceptIceCandidates.push(candidate); }
      return;
    }
    const ice = candidate ? new RTCIceCandidate(candidate) : null;
    if (remoteDescSet) {
      try { await peerConnection.addIceCandidate(ice); } catch {}
    } else {
      iceCandidateBuffer.push(ice);
    }
  });

  socket.on('call:rejected', () => { setStatus('Call was declined.'); hangupCall(); });
  socket.on('call:hangup', () => { setStatus('Call ended by remote.'); hangupCall(); });
  socket.on('call:busy', () => { setStatus('User is busy.'); hangupCall(); });

  socket.on('call:ice-restart', async ({ from, offer }) => {
    if (!peerConnection || inCallWithSocketId !== from) return;
    iceCandidateBuffer = []; remoteDescSet = false;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescSet = true;
      await flushIceCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('call:ice-restart-answer', { targetSocketId: from, answer });
    } catch (err) { console.error('ice-restart answer:', err); }
  });

  socket.on('call:ice-restart-answer', async ({ answer }) => {
    if (!peerConnection) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescSet = true;
      await flushIceCandidates();
    } catch (err) { console.error('ice-restart-answer:', err); }
  });

  // ── Group Call Events ───────────────────────────────────────────────────────
  socket.on('group:created', ({ roomId, participants }) => {
    console.log('[GROUP] Room created:', roomId);
    currentRoomId = roomId;
    // If this user was the partner in a 1-to-1→group conversion, migrate peer state
    if (inCallWithSocketId && peerConnection) {
      const partnerSocket = inCallWithSocketId;
      const partnerEmail = remoteLabel.textContent || 'Unknown';
      groupPeers.set(partnerSocket, {
        pc: peerConnection,
        email: partnerEmail,
        remoteDescSet: true,
        iceBuffer: []
      });
      peerConnection = null;
      inCallWithSocketId = null;
    }
    switchToGroupLayout();
    // Open the invite modal now that currentRoomId is confirmed
    if (pendingOpenParticipantModal) {
      pendingOpenParticipantModal = false;
      showAddParticipantModal();
    }
  });

  socket.on('group:incoming', ({ roomId, from, inviterEmail, participantCount }) => {
    if (inCallWithSocketId || currentRoomId || pendingCallerId) {
      socket.emit('group:reject', { roomId }); return;
    }
    pendingGroupInvite = { roomId, from, inviterEmail };
    groupInviterName.textContent = inviterEmail;
    groupParticipantCount.textContent = participantCount + ' participants in call';
    groupInviteModal.classList.remove('hidden');
    startRingtone();
  });

  socket.on('group:joined', async ({ roomId, participants }) => {
    console.log('[GROUP] Joined room:', roomId, 'with', participants.length, 'existing');
    currentRoomId = roomId;
    try { await startLocalStream(callMode); } catch { setStatus('Media blocked.'); return; }
    switchToGroupLayout();
    // Do NOT create offers here — existing participants will send offers to us
    // via group:participant-joined. This avoids signaling collision on rejoin.
    for (const p of participants) {
      await createGroupPeerConnection(p.socketId, p.email, false);
    }
    callControls.classList.remove('hidden');
    setStatus('In group call');
  });

  socket.on('group:participant-joined', async ({ roomId, socketId, email }) => {
    console.log('[GROUP] Participant joined:', email);
    // Existing participant creates offer to new joiner
    await createGroupPeerConnection(socketId, email, true);
    updateGroupLayout();
  });

  socket.on('group:participant-left', ({ roomId, socketId }) => {
    console.log('[GROUP] Participant left:', socketId);
    removeGroupPeer(socketId);
    updateGroupLayout();
  });

  socket.on('group:dissolved', ({ roomId }) => {
    console.log('[GROUP] Room dissolved');
    // Clear rejoin if this was the room we left
    if (lastLeftRoomId === roomId) lastLeftRoomId = null;
    setStatus('Group call ended.');
    hangupGroupCall();
  });

  socket.on('group:offer', async ({ roomId, from, offer }) => {
    let peer = groupPeers.get(from);
    if (!peer) {
      const email = onlineUsersList.find(u => u.socketId === from)?.email || 'Unknown';
      peer = createGroupPeerObj(from, email);
    }
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
      peer.remoteDescSet = true;
      for (const c of peer.iceBuffer) {
        try { await peer.pc.addIceCandidate(c); } catch {}
      }
      peer.iceBuffer = [];
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      socket.emit('group:answer', { roomId, targetSocketId: from, answer });
    } catch (err) { console.error('[GROUP] offer handling:', err); }
  });

  socket.on('group:answer', async ({ roomId, from, answer }) => {
    const peer = groupPeers.get(from);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      peer.remoteDescSet = true;
      for (const c of peer.iceBuffer) {
        try { await peer.pc.addIceCandidate(c); } catch {}
      }
      peer.iceBuffer = [];
    } catch (err) { console.error('[GROUP] answer handling:', err); }
  });

  socket.on('group:ice', async ({ roomId, from, candidate }) => {
    const peer = groupPeers.get(from);
    if (!peer) return;
    const ice = candidate ? new RTCIceCandidate(candidate) : null;
    if (peer.remoteDescSet) {
      try { await peer.pc.addIceCandidate(ice); } catch {}
    } else {
      peer.iceBuffer.push(ice);
    }
  });

  socket.on('group:invite-rejected', ({ socketId, email }) => {
    setStatus(email + ' declined the invite.');
  });

  // ── Screen Sharing Events ──────────────────────────────────────────────────
  socket.on('screen:sharing', ({ from, sharing }) => {
    console.log('[SCREEN]', from, sharing ? 'started' : 'stopped', 'sharing');
  });

  // ── Live Streaming Events ──────────────────────────────────────────────────
  socket.on('stream:viewer-joined', async ({ viewerSocketId, viewerEmail }) => {
    console.log('[STREAM] Viewer joined:', viewerEmail);
    if (!liveStream) return;
    const pc = new RTCPeerConnection({ iceServers });
    liveStream.getTracks().forEach(t => pc.addTrack(t, liveStream));
    pc.onicecandidate = ({ candidate }) => {
      socket.emit('stream:ice', { targetSocketId: viewerSocketId, candidate: candidate || null });
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('stream:offer', { targetSocketId: viewerSocketId, offer });
      streamViewerPCs.set(viewerSocketId, pc);
      streamViewerCount.textContent = '\u{1F441} ' + streamViewerPCs.size;
    } catch (err) { console.error('[STREAM] offer to viewer:', err); }
  });

  socket.on('stream:viewer-left', ({ viewerSocketId }) => {
    const pc = streamViewerPCs.get(viewerSocketId);
    if (pc) { pc.close(); streamViewerPCs.delete(viewerSocketId); }
    if (isStreaming) streamViewerCount.textContent = '\u{1F441} ' + streamViewerPCs.size;
  });

  socket.on('stream:invited', ({ streamerSocketId, streamerEmail }) => {
    if (watchingStreamFrom || isStreaming) return; // already busy with a stream
    pendingStreamInvite = { streamerSocketId, streamerEmail };
    streamInviterName.textContent = streamerEmail;
    streamInvitedModal.classList.remove('hidden');
  });

  socket.on('stream:offer', async ({ from, offer }) => {
    if (!watchingStreamFrom) return;
    streamPC = new RTCPeerConnection({ iceServers });
    streamPC.ontrack = (e) => {
      // Stream viewer video must NOT be mirrored
      streamVideo.classList.remove('mirror-self');
      streamVideo.style.transform = '';
      if (e.streams && e.streams[0]) {
        streamVideo.srcObject = e.streams[0];
      } else {
        if (!streamVideo.srcObject) streamVideo.srcObject = new MediaStream();
        streamVideo.srcObject.addTrack(e.track);
      }
      streamVideo.play().catch(() => {});
    };
    streamPC.onicecandidate = ({ candidate }) => {
      socket.emit('stream:ice', { targetSocketId: from, candidate: candidate || null });
    };
    try {
      await streamPC.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await streamPC.createAnswer();
      await streamPC.setLocalDescription(answer);
      socket.emit('stream:answer', { targetSocketId: from, answer });
    } catch (err) { console.error('[STREAM] answer to streamer:', err); }
  });

  socket.on('stream:answer', async ({ from, answer }) => {
    const pc = streamViewerPCs.get(from);
    if (!pc) return;
    try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch {}
  });

  socket.on('stream:ice', async ({ from, candidate }) => {
    // Could be from viewer or streamer
    const viewerPC = streamViewerPCs.get(from);
    const targetPC = viewerPC || streamPC;
    if (!targetPC) return;
    try {
      if (candidate) await targetPC.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {}
  });

  socket.on('stream:ended', ({ streamerSocketId }) => {
    if (watchingStreamFrom === streamerSocketId) {
      setStatus('Stream ended.');
      leaveStream();
    }
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connect_error:', err.message);
    if (err.message === 'Authentication error') {
      currentUser = null;
      appScreen.classList.remove('active');
      authScreen.classList.add('active');
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  FLUSH BUFFERED ICE CANDIDATES
// ══════════════════════════════════════════════════════════════════════════════
async function flushIceCandidates() {
  for (const c of iceCandidateBuffer) {
    try { await peerConnection.addIceCandidate(c); } catch {}
  }
  iceCandidateBuffer = [];
}

// ══════════════════════════════════════════════════════════════════════════════
//  RENDER ONLINE USERS
// ══════════════════════════════════════════════════════════════════════════════
function renderUsers(users) {
  onlineUsersList = users;
  const others = users.filter(u => u.userId !== currentUser.id);
  userCount.textContent = others.length;

  if (others.length === 0) {
    usersList.innerHTML = '<div class="empty-state">No other users online.</div>';
    return;
  }
  usersList.innerHTML = '';
  others.forEach(u => {
    const card = document.createElement('div');
    const isInMyCall = inCallWithSocketId === u.socketId;
    const isBusy = u.inCall && !isInMyCall;
    card.className = 'user-card';

    const initial = (u.displayName || u.email).charAt(0).toUpperCase();
    const display = u.displayName || u.email;
    const shortDisplay = display.length > 20 ? display.substring(0, 20) + '…' : display;
    let statusText, dotClass;

    if (u.isStreaming) {
      statusText = 'LIVE'; dotClass = 'status-dot live';
    } else if (isInMyCall) {
      statusText = 'IN CALL'; dotClass = 'status-dot';
    } else if (isBusy) {
      statusText = 'BUSY'; dotClass = 'status-dot busy';
    } else {
      statusText = 'ONLINE'; dotClass = 'status-dot';
    }

    const statusClass = u.isStreaming ? 'live' : (isBusy ? 'busy' : '');

    let actionsHtml = '';
    if (isBusy && !u.isStreaming) {
      // If user is in the group call we left, show rejoin button
      if (u.inGroupCall && lastLeftRoomId && u.groupRoomId === lastLeftRoomId && !inCallWithSocketId && !currentRoomId) {
        actionsHtml = '<div class="action-btn video-call" data-action="rejoin" title="Rejoin Group Call">🔁</div>';
      } else {
        actionsHtml = '<div class="action-btn busy-btn" title="Busy">📵</div>';
      }
    } else {
      actionsHtml =
        '<div class="action-btn dm-btn" data-action="dm" title="Message">💬</div>' +
        '<div class="action-btn audio-call" data-action="audio" title="Audio Call">🎤</div>' +
        '<div class="action-btn video-call" data-action="video" title="Video Call">📹</div>';
      if (u.isStreaming) {
        actionsHtml += '<div class="action-btn watch-btn" data-action="watch" title="Watch Stream">👁</div>';
      }
    }

    card.innerHTML =
      '<div class="user-avatar">' + initial +
        (u.isStreaming ? '<span class="live-badge">LIVE</span>' : '') +
      '</div>' +
      '<div class="user-info">' +
        '<div class="user-email" title="' + escapeHtml(u.email) + '">' + escapeHtml(shortDisplay) + '</div>' +
        '<div class="user-status"><div class="' + dotClass + '"></div>' +
        '<span class="status-text ' + statusClass + '">' + statusText + '</span></div>' +
      '</div>' +
      '<div class="user-actions">' + actionsHtml + '</div>';

    // Attach action handlers
    card.querySelectorAll('.action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'dm') openDm(u.userId, u.displayName || u.email);
        else if (action === 'audio') initiateCall(u.socketId, u.displayName || u.email, 'audio');
        else if (action === 'video') initiateCall(u.socketId, u.displayName || u.email, 'video');
        else if (action === 'watch') watchStream(u.socketId, u.displayName || u.email);
        else if (action === 'rejoin') rejoinGroupCall();
      });
    });

    usersList.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  1-TO-1 CALLS
// ══════════════════════════════════════════════════════════════════════════════
async function initiateCall(targetSocketId, targetEmail, type = 'video') {
  if (inCallWithSocketId || currentRoomId) return;
  callMode = type;
  setStatus('Starting ' + type + ' call…');
  try { await startLocalStream(type); }
  catch { setStatus('Media blocked — check permissions.'); return; }

  isCaller = true;
  isCallEstablished = false;
  iceRestartAttempts = 0;
  resetPeerState();
  peerConnection = createPeerConnection(targetSocketId);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call:offer', { targetSocketId, offer, callType: type });
    inCallWithSocketId = targetSocketId;
    remoteLabel.textContent = targetEmail;

    // Show appropriate layout
    noCallState.classList.add('hidden');
    if (type === 'audio') {
      showAudioCallUI(targetEmail);
    } else {
      video1to1.classList.remove('hidden');
    }
    callControls.classList.remove('hidden');
    setStatus('Calling ' + targetEmail + '…');
    if (window._switchToVideoPanel) window._switchToVideoPanel();
    startCallTimeout();
  } catch (err) {
    console.error('createOffer:', err);
    setStatus('Failed to create call.');
    hangupCall();
  }
}

// ── ACCEPT INCOMING CALL ──────────────────────────────────────────────────────
acceptCallBtn.addEventListener('click', async () => {
  incomingModal.classList.add('hidden');
  stopRingtone();
  const from = pendingCallerId;
  const offer = pendingOffer;
  const email = callerName.textContent;
  const type = pendingCallType;
  callMode = type;

  const savedPreAccept = preAcceptIceCandidates.slice();
  preAcceptIceCandidates = [];

  setStatus('Answering ' + type + ' call from ' + email + '…');
  try { await startLocalStream(type); }
  catch {
    setStatus('Media blocked — check permissions.');
    socket.emit('call:reject', { targetSocketId: from });
    return;
  }

  isCaller = false;
  isCallEstablished = false;
  iceRestartAttempts = 0;
  resetPeerState();
  peerConnection = createPeerConnection(from);

  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    remoteDescSet = true;

    peerConnection.getTransceivers().forEach(t => {
      if (t.direction === 'recvonly' || t.direction === 'inactive') {
        t.direction = 'sendrecv';
      }
    });

    for (const c of savedPreAccept) {
      try { await peerConnection.addIceCandidate(c ? new RTCIceCandidate(c) : null); } catch {}
    }
    await flushIceCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call:answer', { targetSocketId: from, answer });
    inCallWithSocketId = from;
    remoteLabel.textContent = email;

    noCallState.classList.add('hidden');
    if (type === 'audio') {
      showAudioCallUI(email);
    } else {
      video1to1.classList.remove('hidden');
    }
    callControls.classList.remove('hidden');
    setStatus('Connecting…');
    if (window._switchToVideoPanel) window._switchToVideoPanel();
    startCallTimeout();
  } catch (err) {
    console.error('Accept error:', err);
    setStatus('Failed to answer call.');
    hangupCall();
  }
});

rejectCallBtn.addEventListener('click', () => {
  incomingModal.classList.add('hidden');
  stopRingtone();
  socket.emit('call:reject', { targetSocketId: pendingCallerId });
  pendingOffer = null; pendingCallerId = null;
  preAcceptIceCandidates = [];
});

// ── AUDIO CALL UI ─────────────────────────────────────────────────────────────
function showAudioCallUI(email) {
  // Replace the 1to1 video panel content with an audio indicator
  video1to1.classList.remove('hidden');
  remoteVideo.style.display = 'none';
  remoteIdle.style.display = 'none';
  const pip = document.getElementById('pip-container');
  pip.style.display = 'none';

  let audioUI = document.getElementById('audio-call-ui');
  if (!audioUI) {
    audioUI = document.createElement('div');
    audioUI.id = 'audio-call-ui';
    audioUI.className = 'audio-call-indicator';
    audioUI.innerHTML =
      '<div class="audio-avatar">' + (email ? email.charAt(0).toUpperCase() : '?') + '</div>' +
      '<div class="audio-label">' + escapeHtml(email) + '</div>' +
      '<div class="audio-waves">' +
        '<div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>' +
        '<div class="wave-bar"></div><div class="wave-bar"></div>' +
      '</div>' +
      '<div class="audio-label">AUDIO CALL</div>';
    video1to1.appendChild(audioUI);
  }
}

function hideAudioCallUI() {
  const audioUI = document.getElementById('audio-call-ui');
  if (audioUI) audioUI.remove();
  remoteVideo.style.display = '';
  const pip = document.getElementById('pip-container');
  if (pip) pip.style.display = '';
}

// ── CREATE PEER CONNECTION ────────────────────────────────────────────────────
function createPeerConnection(targetSocketId) {
  const pc = new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  pc.onicecandidate = ({ candidate }) => {
    socket.emit('ice:candidate', { targetSocketId, candidate: candidate || null });
  };

  pc.onsignalingstatechange = () => console.log('Signaling:', pc.signalingState);

  pc.oniceconnectionstatechange = () => {
    console.log('ICE connection:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') doIceRestart(pc, targetSocketId);
    if (pc.iceConnectionState === 'disconnected') setStatus('Reconnecting…');
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      iceRestartAttempts = 0; isRestartingIce = false;
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.log('Connection:', s);
    if (s === 'connected') {
      setStatus('✅ Call connected');
      iceRestartAttempts = 0; isRestartingIce = false;
      isCallEstablished = true; clearCallTimeout();
      // Retry unmuted playback now that connection is fully established
      if (remoteVideo.srcObject) {
        remoteVideo.muted = false;
        remoteVideo.play().then(() => removeUnmuteOverlay(remoteVideo)).catch(() => {});
      }
    } else if (s === 'failed') {
      doIceRestart(pc, targetSocketId);
    } else if (s === 'closed') {
      if (inCallWithSocketId) { setStatus('Call ended.'); hangupCall(); }
    }
  };

  pc.ontrack = (event) => {
    console.log('[TRACK] Remote:', event.track.kind);
    remoteIdle.style.display = 'none';
    remoteVideo.classList.remove('mirror-self');
    remoteVideo.style.transform = '';
    if (event.streams && event.streams[0]) {
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
    } else {
      if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream();
      remoteVideo.srcObject.addTrack(event.track);
    }
    ensureVideoPlayback(remoteVideo);
  };

  return pc;
}

// ── ICE RESTART ───────────────────────────────────────────────────────────────
function doIceRestart(pc, targetSocketId) {
  if (isRestartingIce) return;
  if (isCaller && iceRestartAttempts < 3) {
    isRestartingIce = true;
    iceRestartAttempts++;
    setStatus('Reconnecting… (' + iceRestartAttempts + '/3)');
    (async () => {
      try {
        remoteDescSet = false; iceCandidateBuffer = [];
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        socket.emit('call:ice-restart', { targetSocketId, offer });
      } catch { hangupCall(); }
      finally { isRestartingIce = false; }
    })();
  } else if (!isCaller) {
    setStatus('Waiting for caller to reconnect…');
    setTimeout(() => {
      if (peerConnection && peerConnection.connectionState === 'failed') {
        setStatus('Connection failed.'); hangupCall();
      }
    }, 15000);
  } else {
    setStatus('Connection failed.'); hangupCall();
  }
}

// ── RESET PEER STATE ──────────────────────────────────────────────────────────
function resetPeerState() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  iceCandidateBuffer = [];
  remoteDescSet = false;
  iceRestartAttempts = 0;
  isCallEstablished = false;
  isRestartingIce = false;
}

// ── LOCAL STREAM ──────────────────────────────────────────────────────────────
async function startLocalStream(type = 'video') {
  if (localStream) return;
  const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  if (type === 'audio') {
    // AUDIO ONLY — never request video
    localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints });
    console.log('[MEDIA] Audio-only stream acquired');
  } else {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: audioConstraints
      });
      console.log('[MEDIA] Video+audio stream acquired');
    } catch (e) {
      console.warn('[MEDIA] Video failed, trying audio-only:', e.name);
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints });
      setStatus('Camera unavailable — audio only');
    }
  }

  localVideo.srcObject = localStream;
  localVideo.play().catch(() => {});
  localIdle.style.display = 'none';

  // Mirror the self-view for camera (selfie effect); screen share must NOT be mirrored
  const hasCamera = localStream.getVideoTracks().length > 0;
  localVideo.classList.toggle('mirror-self', hasCamera);
  groupLocalVideo.classList.toggle('mirror-self', hasCamera);

  // Also set group local video
  groupLocalVideo.srcObject = localStream;
  groupLocalVideo.play().catch(() => {});
}

// ── CONTROLS ──────────────────────────────────────────────────────────────────
toggleMicBtn.addEventListener('click', () => {
  micEnabled = !micEnabled;
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
  toggleMicBtn.classList.toggle('muted', !micEnabled);
});

toggleCamBtn.addEventListener('click', () => {
  if (callMode === 'audio') return; // No camera toggle in audio calls
  camEnabled = !camEnabled;
  if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = camEnabled; });
  toggleCamBtn.classList.toggle('muted', !camEnabled);
  // Update local group tile avatar visibility
  const localAvatar = document.getElementById('group-local-avatar');
  if (localAvatar) localAvatar.style.display = camEnabled ? 'none' : '';
  if (groupLocalVideo) groupLocalVideo.style.display = camEnabled ? '' : 'none';
});

hangupBtn.addEventListener('click', () => {
  if (currentRoomId) {
    socket.emit('group:leave', { roomId: currentRoomId });
    hangupGroupCall();
  } else if (inCallWithSocketId) {
    socket.emit('call:hangup', { targetSocketId: inCallWithSocketId });
    setStatus('You ended the call.');
    hangupCall();
  }
});

// ── SCREEN SHARING ────────────────────────────────────────────────────────────
toggleScreenBtn.addEventListener('click', async () => {
  if (isSharingScreen) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
});

async function startScreenShare() {
  if (!supportsScreenShare) {
    setStatus('Screen sharing is not supported on this browser/device.');
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch(e) {
    if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
      setStatus('Screen share failed. Please try again.');
    }
    return;
  }

  const screenTrack = screenStream.getVideoTracks()[0];
  isSharingScreen = true;
  toggleScreenBtn.classList.add('active-share');

  screenTrack.onended = () => stopScreenShare();

  // Replace video track in peer connection(s)
  if (peerConnection) {
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(screenTrack);
    socket.emit('screen:sharing', { targetSocketId: inCallWithSocketId, sharing: true });
  }

  // Group call: replace in all peer connections
  for (const [sid, peer] of groupPeers) {
    const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(screenTrack);
  }
  if (currentRoomId) {
    socket.emit('screen:sharing-group', { roomId: currentRoomId, sharing: true });
  }

  // Show screen in local preview — remove mirror so screen content is not flipped
  localVideo.classList.remove('mirror-self');
  groupLocalVideo.classList.remove('mirror-self');
  localVideo.srcObject = screenStream;
  groupLocalVideo.srcObject = screenStream;
}

function stopScreenShare() {
  if (!isSharingScreen) return;
  isSharingScreen = false;
  toggleScreenBtn.classList.remove('active-share');

  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }

  // Restore camera track
  const camTrack = localStream ? localStream.getVideoTracks()[0] : null;

  if (peerConnection && camTrack) {
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(camTrack);
    socket.emit('screen:sharing', { targetSocketId: inCallWithSocketId, sharing: false });
  }

  for (const [sid, peer] of groupPeers) {
    if (camTrack) {
      const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(camTrack);
    }
  }
  if (currentRoomId) {
    socket.emit('screen:sharing-group', { roomId: currentRoomId, sharing: false });
  }

  // Restore camera mirror only when using front camera
  const shouldMirror = currentFacingMode === 'user' && camEnabled;
  localVideo.classList.toggle('mirror-self', shouldMirror);
  groupLocalVideo.classList.toggle('mirror-self', shouldMirror);
  localVideo.srcObject = localStream;
  groupLocalVideo.srcObject = localStream;
}

// ── FLIP CAMERA (mobile front/rear toggle during a call) ──────────────────────
if (flipCameraBtn) {
  flipCameraBtn.addEventListener('click', flipCamera);
}

async function flipCamera() {
  if (!localStream || isSharingScreen) return;
  const newFacing = currentFacingMode === 'user' ? 'environment' : 'user';
  let newCamStream;
  try {
    newCamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing },
      audio: false
    });
  } catch(e) {
    setStatus('Could not switch camera.');
    return;
  }
  currentFacingMode = newFacing;
  const newVideoTrack = newCamStream.getVideoTracks()[0];
  if (peerConnection) {
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newVideoTrack);
  }
  for (const [, peer] of groupPeers) {
    const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newVideoTrack);
  }
  localStream.getVideoTracks().forEach(t => t.stop());
  const audioTracks = localStream.getAudioTracks();
  localStream = new MediaStream([newVideoTrack, ...audioTracks]);
  localVideo.srcObject = localStream;
  groupLocalVideo.srcObject = localStream;
  const mirrorAfterFlip = newFacing === 'user' && camEnabled;
  localVideo.classList.toggle('mirror-self', mirrorAfterFlip);
  groupLocalVideo.classList.toggle('mirror-self', mirrorAfterFlip);
}

// ── HANGUP ────────────────────────────────────────────────────────────────────
function hangupCall() {
  stopRingtone();
  stopScreenShare();
  resetPeerState();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  groupLocalVideo.srcObject = null;
  // Clean up mirror classes
  remoteVideo.classList.remove('mirror-self');
  remoteVideo.style.transform = '';
  localVideo.classList.remove('mirror-self');
  groupLocalVideo.classList.remove('mirror-self');
  localIdle.style.display = '';
  remoteIdle.style.display = '';
  callControls.classList.add('hidden');
  video1to1.classList.add('hidden');
  videoGroup.classList.add('hidden');
  noCallState.classList.remove('hidden');
  hideAudioCallUI();
  inCallWithSocketId = null;
  micEnabled = true; camEnabled = true;
  toggleMicBtn.classList.remove('muted');
  toggleCamBtn.classList.remove('muted');
  remoteLabel.textContent = 'REMOTE';
  pendingOffer = null; pendingCallerId = null;
  preAcceptIceCandidates = [];
  isCaller = false;
  callMode = 'video';
  clearCallTimeout();
}

// ══════════════════════════════════════════════════════════════════════════════
//  GROUP CALLS
// ══════════════════════════════════════════════════════════════════════════════

// ── Add Participant (convert to group or invite to existing group) ─────────
addParticipantBtn.addEventListener('click', () => {
  if (!inCallWithSocketId && !currentRoomId) return;

  // If in 1-to-1 call, convert to group first
  if (inCallWithSocketId && !currentRoomId) {
    // Move existing 1-to-1 connection into group peers
    const partnerSocket = inCallWithSocketId;
    const partnerEmail = remoteLabel.textContent;

    socket.emit('group:create', { partnerSocketId: partnerSocket });

    // Store existing peer connection in group peers map
    groupPeers.set(partnerSocket, {
      pc: peerConnection,
      email: partnerEmail,
      remoteDescSet: true,
      iceBuffer: []
    });
    peerConnection = null;
    inCallWithSocketId = null;
    // Defer modal until server confirms the room (currentRoomId is set in group:created)
    pendingOpenParticipantModal = true;
    return; // modal will open inside group:created handler
  }

  showAddParticipantModal();
});

function showAddParticipantModal() {
  const available = onlineUsersList.filter(u => {
    if (u.userId === currentUser.id) return false;
    if (u.inCall) return false;
    if (groupPeers.has(u.socketId)) return false;
    return true;
  });

  inviteUsersList.innerHTML = '';
  if (available.length === 0) {
    inviteUsersList.innerHTML = '<div class="empty-state">No available users to invite.</div>';
  } else {
    available.forEach(u => {
      const card = document.createElement('div');
      card.className = 'invite-user-card';
      card.innerHTML =
        '<div class="user-avatar" style="width:30px;height:30px;font-size:12px;">' +
          (u.displayName || u.email).charAt(0).toUpperCase() +
        '</div>' +
        '<span class="user-email">' + escapeHtml(u.displayName || u.email) + '</span>' +
        '<button class="invite-btn">INVITE</button>';
      card.querySelector('.invite-btn').addEventListener('click', () => {
        if (currentRoomId) {
          socket.emit('group:invite', { roomId: currentRoomId, targetSocketId: u.socketId });
          card.querySelector('.invite-btn').textContent = 'SENT';
          card.querySelector('.invite-btn').disabled = true;
        }
      });
      inviteUsersList.appendChild(card);
    });
  }
  addPartModal.classList.remove('hidden');
}

closeInviteModal.addEventListener('click', () => {
  addPartModal.classList.add('hidden');
});

// ── Accept Group Invite ───────────────────────────────────────────────────────
acceptGroupBtn.addEventListener('click', async () => {
  groupInviteModal.classList.add('hidden');
  stopRingtone();
  if (!pendingGroupInvite) return;
  callMode = 'video';
  socket.emit('group:accept', { roomId: pendingGroupInvite.roomId });
  pendingGroupInvite = null;
});

rejectGroupBtn.addEventListener('click', () => {
  groupInviteModal.classList.add('hidden');
  stopRingtone();
  if (pendingGroupInvite) {
    socket.emit('group:reject', { roomId: pendingGroupInvite.roomId });
    pendingGroupInvite = null;
  }
});

// ── Create Group Peer Connection ──────────────────────────────────────────────
function createGroupPeerObj(socketId, email) {
  const pc = new RTCPeerConnection({ iceServers });

  // Create tile immediately so participant is always visible
  let tile = document.getElementById('group-tile-' + socketId);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'group-video-tile';
    tile.id = 'group-tile-' + socketId;

    const avatar = document.createElement('div');
    avatar.className = 'group-tile-avatar';
    avatar.innerHTML =
      '<div class="avatar-circle">' + escapeHtml(email ? email.charAt(0).toUpperCase() : '?') + '</div>' +
      '<div class="avatar-name">' + escapeHtml(email) + '</div>';
    tile.appendChild(avatar);

    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.playsInline = true;
    vid.classList.remove('mirror-self');
    vid.style.display = 'none';
    tile.appendChild(vid);

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = email;
    tile.appendChild(label);

    videoGroup.appendChild(tile);
    updateGroupLayout();
  }

  pc.onicecandidate = ({ candidate }) => {
    socket.emit('group:ice', { roomId: currentRoomId, targetSocketId: socketId, candidate: candidate || null });
  };

  pc.ontrack = (event) => {
    console.log('[GROUP-TRACK]', email, event.track.kind);
    const t = document.getElementById('group-tile-' + socketId);
    if (!t) return;
    const vid = t.querySelector('video');
    const avatar = t.querySelector('.group-tile-avatar');

    if (event.streams && event.streams[0]) {
      vid.srcObject = event.streams[0];
    } else {
      if (!vid.srcObject) vid.srcObject = new MediaStream();
      vid.srcObject.addTrack(event.track);
    }

    if (event.track.kind === 'video') {
      vid.style.display = '';
      if (avatar) avatar.style.display = 'none';

      event.track.onmute = () => {
        vid.style.display = 'none';
        if (avatar) avatar.style.display = '';
      };
      event.track.onunmute = () => {
        vid.style.display = '';
        if (avatar) avatar.style.display = 'none';
      };
    }

    ensureVideoPlayback(vid);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      // Peer disconnected
    }
    if (pc.connectionState === 'connected') {
      setStatus('Group call connected');
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  const peer = { pc, email, remoteDescSet: false, iceBuffer: [] };
  groupPeers.set(socketId, peer);
  return peer;
}

async function createGroupPeerConnection(socketId, email, createOffer) {
  const peer = createGroupPeerObj(socketId, email);

  if (createOffer) {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      socket.emit('group:offer', { roomId: currentRoomId, targetSocketId: socketId, offer });
    } catch (err) { console.error('[GROUP] createOffer:', err); }
  }
}

function removeGroupPeer(socketId) {
  const peer = groupPeers.get(socketId);
  if (peer) { peer.pc.close(); groupPeers.delete(socketId); }
  const tile = document.getElementById('group-tile-' + socketId);
  if (tile) tile.remove();
}

function switchToGroupLayout() {
  noCallState.classList.add('hidden');
  video1to1.classList.add('hidden');
  hideAudioCallUI();
  videoGroup.classList.remove('hidden');
  callControls.classList.remove('hidden');
  updateGroupLayout();
  if (window._switchToVideoPanel) window._switchToVideoPanel();
}

function updateGroupLayout() {
  const totalTiles = groupPeers.size + 1; // +1 for local
  for (let i = 1; i <= 9; i++) videoGroup.classList.remove('p-' + i);
  videoGroup.classList.add('p-' + Math.min(totalTiles, 9));
}

function hangupGroupCall() {
  stopScreenShare();
  for (const [sid, peer] of groupPeers) {
    peer.pc.close();
    const tile = document.getElementById('group-tile-' + sid);
    if (tile) tile.remove();
  }
  groupPeers.clear();
  // Save room ID for rejoin before clearing
  if (currentRoomId) lastLeftRoomId = currentRoomId;
  currentRoomId = null;
  // Also clean up any leftover 1-to-1 state (from call→group conversion)
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  inCallWithSocketId = null;
  iceCandidateBuffer = [];
  remoteDescSet = false;
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  localVideo.srcObject = null;
  groupLocalVideo.srcObject = null;
  remoteVideo.classList.remove('mirror-self');
  remoteVideo.style.transform = '';
  localVideo.classList.remove('mirror-self');
  groupLocalVideo.classList.remove('mirror-self');
  callControls.classList.add('hidden');
  videoGroup.classList.add('hidden');
  noCallState.classList.remove('hidden');
  micEnabled = true; camEnabled = true;
  toggleMicBtn.classList.remove('muted');
  toggleCamBtn.classList.remove('muted');
  callMode = 'video';
}

// ── Rejoin Group Call ─────────────────────────────────────────────────────────
function rejoinGroupCall() {
  if (!lastLeftRoomId || inCallWithSocketId || currentRoomId) return;
  callMode = 'video';
  const roomId = lastLeftRoomId;
  lastLeftRoomId = null;
  socket.emit('group:accept', { roomId });
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIVE STREAMING
// ══════════════════════════════════════════════════════════════════════════════
goLiveBtn.addEventListener('click', () => {
  if (inCallWithSocketId || currentRoomId) {
    setStatus('End your call before going live.');
    return;
  }
  goLiveModal.classList.remove('hidden');
});

liveCancelBtn.addEventListener('click', () => {
  goLiveModal.classList.add('hidden');
});

liveCameraBtn.addEventListener('click', async () => {
  goLiveModal.classList.add('hidden');
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    startStreamingSession('camera');
  } catch { setStatus('Camera access denied.'); }
});

liveScreenBtn.addEventListener('click', async () => {
  if (!supportsScreenShare) {
    setStatus('Screen sharing is not supported on this browser/device.');
    return;
  }
  goLiveModal.classList.add('hidden');
  try {
    liveStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    liveStream.getVideoTracks()[0].onended = () => stopStreaming();
    startStreamingSession('screen');
  } catch(e) {
    if (e.name !== 'AbortError') setStatus('Screen share denied.');
  }
});

function startStreamingSession(mode = 'camera') {
  streamMode = mode;
  streamMicEnabled = true;
  streamCamEnabled = true;
  isStreaming = true;
  goLiveBtn.classList.add('hidden');
  stopLiveBtn.classList.remove('hidden');
  socket.emit('stream:start');

  // Show own stream in video panel
  noCallState.classList.add('hidden');
  video1to1.classList.remove('hidden');
  remoteVideo.srcObject = liveStream;
  remoteVideo.muted = true;
  remoteIdle.style.display = 'none';
  remoteLabel.textContent = 'YOUR LIVE STREAM';

  // Mirror only for camera (selfie-view); screen share must not be flipped
  // Use inline style so the .mirror-self class never touches remoteVideo
  remoteVideo.style.transform = mode === 'camera' ? 'scaleX(-1)' : '';

  // Show stream controls; hide cam toggle for screen-only streams
  streamControls.classList.remove('hidden');
  streamToggleCamBtn.classList.toggle('hidden', mode === 'screen');
  streamToggleMicBtn.classList.remove('muted');
  streamToggleCamBtn.classList.remove('muted');
  streamViewerCount.textContent = '\u{1F441} 0';

  setStatus('🔴 You are live!');
}

stopLiveBtn.addEventListener('click', stopStreaming);

// ── Stream mic / cam toggles ──────────────────────────────────────────────────
streamToggleMicBtn.addEventListener('click', () => {
  streamMicEnabled = !streamMicEnabled;
  if (liveStream) liveStream.getAudioTracks().forEach(t => { t.enabled = streamMicEnabled; });
  streamToggleMicBtn.classList.toggle('muted', !streamMicEnabled);
});

streamToggleCamBtn.addEventListener('click', () => {
  streamCamEnabled = !streamCamEnabled;
  if (liveStream) liveStream.getVideoTracks().forEach(t => { t.enabled = streamCamEnabled; });
  streamToggleCamBtn.classList.toggle('muted', !streamCamEnabled);
});

// ── Stream screen share toggle (switch between camera and screen during live) ─
streamToggleScreenBtn.addEventListener('click', async () => {
  if (!isStreaming || !liveStream) return;

  if (streamMode === 'screen') {
    // Currently screen sharing — switch back to camera
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      const newVideoTrack = camStream.getVideoTracks()[0];
      const newAudioTrack = camStream.getAudioTracks()[0];

      // Replace tracks in all viewer peer connections
      for (const [, pc] of streamViewerPCs) {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (videoSender && newVideoTrack) await videoSender.replaceTrack(newVideoTrack);
        if (audioSender && newAudioTrack) await audioSender.replaceTrack(newAudioTrack);
      }

      // Stop old tracks and swap local stream
      liveStream.getTracks().forEach(t => t.stop());
      liveStream = camStream;
      streamMode = 'camera';
      remoteVideo.srcObject = liveStream;
      remoteVideo.style.transform = 'scaleX(-1)';
      streamToggleScreenBtn.classList.remove('active-share');
      streamToggleCamBtn.classList.remove('hidden');
    } catch { setStatus('Camera access denied.'); }
  } else {
    // Currently camera — switch to screen share
    if (!supportsScreenShare) {
      setStatus('Screen sharing is not supported on this browser/device.');
      return;
    }
    try {
      const screenStr = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const newVideoTrack = screenStr.getVideoTracks()[0];
      const newAudioTrack = screenStr.getAudioTracks().length ? screenStr.getAudioTracks()[0] : null;

      newVideoTrack.onended = () => {
        // User stopped screen share via browser UI — switch back to camera
        streamToggleScreenBtn.click();
      };

      // Replace tracks in all viewer peer connections
      for (const [, pc] of streamViewerPCs) {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) await videoSender.replaceTrack(newVideoTrack);
        if (newAudioTrack) {
          const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
          if (audioSender) await audioSender.replaceTrack(newAudioTrack);
        }
      }

      // Stop old video tracks and swap local stream
      liveStream.getVideoTracks().forEach(t => t.stop());
      if (newAudioTrack) liveStream.getAudioTracks().forEach(t => t.stop());
      liveStream = screenStr;
      streamMode = 'screen';
      remoteVideo.srcObject = liveStream;
      remoteVideo.style.transform = '';
      streamToggleScreenBtn.classList.add('active-share');
      streamToggleCamBtn.classList.add('hidden');
    } catch(e) { if (e.name !== 'AbortError') setStatus('Screen share denied.'); }
  }
});

// ── Stream flip camera (mobile front/rear toggle during live) ─────────────────
if (streamFlipCamBtn) {
  streamFlipCamBtn.addEventListener('click', flipStreamCamera);
}

async function flipStreamCamera() {
  if (!isStreaming || !liveStream || streamMode === 'screen') return;
  const newFacing = currentFacingMode === 'user' ? 'environment' : 'user';
  let newCamStream;
  try {
    newCamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing },
      audio: false
    });
  } catch(e) {
    setStatus('Could not switch camera.');
    return;
  }
  currentFacingMode = newFacing;
  const newVideoTrack = newCamStream.getVideoTracks()[0];
  for (const [, pc] of streamViewerPCs) {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newVideoTrack);
  }
  liveStream.getVideoTracks().forEach(t => t.stop());
  const audioTracks = liveStream.getAudioTracks();
  liveStream = new MediaStream([newVideoTrack, ...audioTracks]);
  remoteVideo.srcObject = liveStream;
  remoteVideo.style.transform = newFacing === 'user' ? 'scaleX(-1)' : '';
}

// ── Stream invite (streamer invites a viewer) ─────────────────────────────────
streamInviteBtn.addEventListener('click', showStreamInviteModal);

closeStreamInviteModalBtn.addEventListener('click', () => {
  streamInviteModal.classList.add('hidden');
});

function showStreamInviteModal() {
  const available = onlineUsersList.filter(u => {
    if (u.userId === currentUser.id) return false;
    if (u.inCall || u.inGroupCall) return false;
    if (u.isStreaming) return false;
    return true;
  });
  if (available.length === 0) {
    streamInviteUsersList.innerHTML = '<div class="empty-state">No available users to invite.</div>';
  } else {
    streamInviteUsersList.innerHTML = '';
    available.forEach(u => {
      const item = document.createElement('div');
      item.className = 'invite-user-item';
      item.innerHTML =
        '<div class="invite-user-email">' + escapeHtml(u.displayName || u.email) + '</div>' +
        '<button class="modal-btn accept" style="padding:6px 14px;font-size:10px">INVITE</button>';
      item.querySelector('button').addEventListener('click', () => {
        socket.emit('stream:invite', { targetSocketId: u.socketId });
        setStatus('Invite sent to ' + (u.displayName || u.email));
        streamInviteModal.classList.add('hidden');
      });
      streamInviteUsersList.appendChild(item);
    });
  }
  streamInviteModal.classList.remove('hidden');
}

// ── Incoming stream invitation (shown to invited viewer) ──────────────────────
acceptStreamInviteBtn.addEventListener('click', () => {
  streamInvitedModal.classList.add('hidden');
  if (pendingStreamInvite) {
    const { streamerSocketId, streamerEmail } = pendingStreamInvite;
    pendingStreamInvite = null;
    watchStream(streamerSocketId, streamerEmail);
  }
});

rejectStreamInviteBtn.addEventListener('click', () => {
  streamInvitedModal.classList.add('hidden');
  pendingStreamInvite = null;
});

function stopStreaming() {
  if (!isStreaming) return;
  isStreaming = false;
  stopLiveBtn.classList.add('hidden');
  goLiveBtn.classList.remove('hidden');
  streamControls.classList.add('hidden');
  remoteVideo.style.transform = '';
  remoteVideo.classList.remove('mirror-self');

  if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
  for (const [, pc] of streamViewerPCs) { pc.close(); }
  streamViewerPCs.clear();
  socket.emit('stream:stop');

  remoteVideo.srcObject = null;
  remoteIdle.style.display = '';
  video1to1.classList.add('hidden');
  noCallState.classList.remove('hidden');
  remoteLabel.textContent = 'REMOTE';
  setStatus('Stream ended.');
}

// ── Watch Stream ──────────────────────────────────────────────────────────────
function watchStream(streamerSocketId, email) {
  if (inCallWithSocketId || currentRoomId || watchingStreamFrom) return;
  watchingStreamFrom = streamerSocketId;

  noCallState.classList.add('hidden');
  streamViewer.classList.remove('hidden');
  streamLabel.textContent = email + ' — LIVE';

  socket.emit('stream:watch', { streamerSocketId });
  setStatus('Connecting to stream…');
  if (window._switchToVideoPanel) window._switchToVideoPanel();
}

leaveStreamBtn.addEventListener('click', leaveStream);

function leaveStream() {
  if (!watchingStreamFrom) return;
  socket.emit('stream:leave', { streamerSocketId: watchingStreamFrom });
  if (streamPC) { streamPC.close(); streamPC = null; }
  watchingStreamFrom = null;
  streamVideo.srcObject = null;
  streamViewer.classList.add('hidden');
  noCallState.classList.remove('hidden');
  setStatus('Left stream.');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRIVATE DM
// ══════════════════════════════════════════════════════════════════════════════
function openDm(userId, email) {
  activeDmUserId = userId;
  activeDmEmail = email;
  dmPartnerName.textContent = email;
  dmTabBtn.classList.remove('hidden');
  dmTabBtn.textContent = 'DM';
  dmTabBtn.classList.remove('has-unread');
  dmUnreadMap.delete(userId);

  // Switch to DM tab
  publicTabBtn.classList.remove('active');
  dmTabBtn.classList.add('active');
  publicChat.classList.remove('active');
  dmChat.classList.add('active');

  // On mobile, switch to the chat panel so the DM is visible
  if (window._switchToPanel) window._switchToPanel('chat');

  loadDmHistory(userId);
}

async function loadDmHistory(userId) {
  dmMessages.innerHTML = '<div class="chat-empty">Loading…</div>';
  try {
    const res = await fetch('/chat/dm/history/' + userId);
    if (!res.ok) return;
    const data = await res.json();
    dmMessages.innerHTML = '';
    if (!data.messages || data.messages.length === 0) {
      dmMessages.innerHTML = '<div class="chat-empty">Start a private conversation.</div>';
      return;
    }
    data.messages.forEach(m => appendDmMessage(m, false));
    dmMessages.scrollTop = dmMessages.scrollHeight;
  } catch {
    dmMessages.innerHTML = '<div class="chat-empty">Failed to load messages.</div>';
  }
}

function appendDmMessage(msg, scroll = true) {
  const empty = dmMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const isOwn = currentUser && msg.sender_id === currentUser.id;
  const author = isOwn ? 'You' : (msg.display_name || msg.sender_email || 'Unknown');

  const div = document.createElement('div');
  div.className = 'chat-msg' + (isOwn ? ' own' : '');
  div.innerHTML =
    '<div class="chat-msg-meta">' +
      '<span class="chat-msg-author">' + escapeHtml(author) + '</span>' +
      '<span class="chat-msg-time">' + formatTime(msg.created_at) + '</span>' +
    '</div>' +
    '<div class="chat-msg-bubble">' + escapeHtml(msg.content) + '</div>';
  dmMessages.appendChild(div);
  if (scroll) dmMessages.scrollTop = dmMessages.scrollHeight;
}

function handleDmMessage(msg) {
  const isFromActiveDm =
    (msg.sender_id === activeDmUserId) ||
    (msg.receiver_id === activeDmUserId && msg.sender_id === currentUser.id);

  if (isFromActiveDm && dmChat.classList.contains('active')) {
    appendDmMessage(msg);
  } else {
    // Show unread indicator
    const senderId = msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id;
    const count = (dmUnreadMap.get(senderId) || 0) + 1;
    dmUnreadMap.set(senderId, count);

    if (activeDmUserId === senderId) {
      // DM tab is open but not active (user is on public tab)
      dmTabBtn.classList.add('has-unread');
    }
  }
}

function sendDmMessage() {
  const text = dmInput.value.trim();
  if (!text || !socket || !socket.connected || !activeDmUserId) return;
  socket.emit('dm:send', { targetUserId: activeDmUserId, content: text });
  dmInput.value = '';
}

dmSendBtn.addEventListener('click', sendDmMessage);
dmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDmMessage(); }
});

dmCloseBtn.addEventListener('click', () => {
  activeDmUserId = null;
  activeDmEmail = null;
  dmTabBtn.classList.add('hidden');
  publicTabBtn.classList.add('active');
  dmTabBtn.classList.remove('active');
  publicChat.classList.add('active');
  dmChat.classList.remove('active');
});

// ── Chat Tabs ─────────────────────────────────────────────────────────────────
publicTabBtn.addEventListener('click', () => {
  publicTabBtn.classList.add('active');
  dmTabBtn.classList.remove('active');
  publicChat.classList.add('active');
  dmChat.classList.remove('active');
});

dmTabBtn.addEventListener('click', () => {
  dmTabBtn.classList.add('active');
  dmTabBtn.classList.remove('has-unread');
  publicTabBtn.classList.remove('active');
  dmChat.classList.add('active');
  publicChat.classList.remove('active');
  if (activeDmUserId) dmUnreadMap.delete(activeDmUserId);
});

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC CHAT
// ══════════════════════════════════════════════════════════════════════════════
function appendChatMessage(msg, scroll = true) {
  const empty = chatMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const isOwn = currentUser && msg.user_id === currentUser.id;
  const authorName = msg.display_name || msg.email;
  const shortName = authorName.length > 18 ? authorName.slice(0, 18) + '…' : authorName;

  const div = document.createElement('div');
  div.className = 'chat-msg' + (isOwn ? ' own' : '');
  div.innerHTML =
    '<div class="chat-msg-meta">' +
      '<span class="chat-msg-author" title="' + escapeHtml(msg.email) + '">' + escapeHtml(shortName) + '</span>' +
      '<span class="chat-msg-time">' + formatTime(msg.created_at) + '</span>' +
    '</div>' +
    '<div class="chat-msg-bubble">' + escapeHtml(msg.content) + '</div>';
  chatMessages.appendChild(div);
  if (scroll) chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function loadChatHistory() {
  try {
    const res = await fetch('/chat/history');
    if (!res.ok) return;
    const data = await res.json();
    chatMessages.innerHTML = '';
    if (!data.messages || data.messages.length === 0) {
      chatMessages.innerHTML = '<div class="chat-empty">Send a message to everyone online.</div>';
      return;
    }
    data.messages.forEach(m => appendChatMessage(m, false));
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch {}
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !socket || !socket.connected) return;
  socket.emit('chat:message', { content: text });
  chatInput.value = '';
}

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function setStatus(msg) { callStatus.textContent = msg; }

function startCallTimeout() {
  clearCallTimeout();
  callTimeout = setTimeout(() => {
    if (!isCallEstablished && inCallWithSocketId) {
      setStatus('No answer — timed out.');
      socket.emit('call:hangup', { targetSocketId: inCallWithSocketId });
      hangupCall();
    }
  }, 45000);
}

function clearCallTimeout() {
  if (callTimeout) { clearTimeout(callTimeout); callTimeout = null; }
}

function getCookie(name) {
  const c = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
  return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : '';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(isoStr) {
  try { return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ── RINGTONE ──────────────────────────────────────────────────────────────────
let ringtoneAudio = null;

function startRingtone() {
  stopRingtone();
  try {
    ringtoneAudio = new Audio('/assets/soft_ringtone.mp3');
    ringtoneAudio.loop = true;
    ringtoneAudio.volume = 0.7;
    ringtoneAudio.play().catch(() => { ringtoneAudio = null; startRingtoneFallback(); });
  } catch { startRingtoneFallback(); }
}

function startRingtoneFallback() {
  stopRingtone();
  let active = true;
  let ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  function beep(freq, startTime, duration) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.setValueAtTime(0.18, startTime + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.start(startTime); osc.stop(startTime + duration);
  }
  function ring() {
    if (!active) return;
    const t = ctx.currentTime;
    beep(480, t, 0.4); beep(440, t + 0.45, 0.4); beep(480, t + 0.9, 0.4);
    ringtoneHandle = setTimeout(ring, 2500);
  }
  ctx.resume().then(ring).catch(() => {});
  ringtoneHandle = {
    stop: () => { active = false; clearTimeout(ringtoneHandle); try { ctx.close(); } catch {} }
  };
}

function stopRingtone() {
  if (ringtoneAudio) { ringtoneAudio.pause(); ringtoneAudio.currentTime = 0; ringtoneAudio = null; }
  if (ringtoneHandle && typeof ringtoneHandle.stop === 'function') { ringtoneHandle.stop(); }
  else if (ringtoneHandle) { clearTimeout(ringtoneHandle); }
  ringtoneHandle = null;
}

// ── MOBILE NAVIGATION ─────────────────────────────────────────────────────────
(function initMobileNav() {
  const nav = document.getElementById('mobile-nav');
  if (!nav) return;
  const panels = {
    users: document.querySelector('.users-panel'),
    video: document.querySelector('.video-panel'),
    chat: document.querySelector('.chat-panel')
  };

  function setPanel(name) {
    Object.entries(panels).forEach(([key, el]) => {
      el.classList.toggle('mobile-active', key === name);
    });
    nav.querySelectorAll('.mobile-nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.panel === name);
    });
  }

  nav.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setPanel(btn.dataset.panel));
  });

  // Set initial active panel so the class-based display system is in sync
  setPanel('video');

  window._switchToVideoPanel = () => {
    if (window.innerWidth <= 768) setPanel('video');
  };

  window._switchToPanel = (name) => {
    if (window.innerWidth <= 768) setPanel(name);
  };
})();

// ── PiP DRAGGING ──────────────────────────────────────────────────────────────
(function initPipDrag() {
  const pip = document.getElementById('pip-container');
  if (!pip) return;
  let dragging = false, startX, startY, origX, origY;

  pip.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = pip.getBoundingClientRect();
    origX = rect.left; origY = rect.top;
    pip.style.cursor = 'grabbing';
    pip.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    pip.style.position = 'absolute';
    pip.style.left = (origX - pip.parentElement.getBoundingClientRect().left + dx) + 'px';
    pip.style.top = (origY - pip.parentElement.getBoundingClientRect().top + dy) + 'px';
    pip.style.bottom = 'auto';
    pip.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; pip.style.cursor = 'grab'; }
  });

  // ── Touch support for PiP drag ───────────────────────────────────
  pip.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    dragging = true;
    startX = touch.clientX; startY = touch.clientY;
    const rect = pip.getBoundingClientRect();
    origX = rect.left; origY = rect.top;
    pip.style.transition = 'none';
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX, dy = touch.clientY - startY;
    pip.style.position = 'absolute';
    pip.style.left = (origX - pip.parentElement.getBoundingClientRect().left + dx) + 'px';
    pip.style.top = (origY - pip.parentElement.getBoundingClientRect().top + dy) + 'px';
    pip.style.bottom = 'auto';
    pip.style.right = 'auto';
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', () => { dragging = false; });
})();

// ── DEVICE CAPABILITY SETUP ───────────────────────────────────────────────────
(function applyDeviceCapabilities() {
  // Hide screen share buttons on unsupported browsers/devices
  if (!supportsScreenShare) {
    toggleScreenBtn.classList.add('hidden');
    streamToggleScreenBtn.classList.add('hidden');
    if (liveScreenBtn) liveScreenBtn.classList.add('hidden');
  }
  // Show flip camera button on mobile (has front/rear cameras)
  if (isMobile) {
    if (flipCameraBtn) flipCameraBtn.classList.remove('hidden');
    if (streamFlipCamBtn) streamFlipCamBtn.classList.remove('hidden');
  }
})();
