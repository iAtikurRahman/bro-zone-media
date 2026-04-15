// ──────────────────────────────────────────────────────────────────────────────
//  NEXUS — WebRTC Calling App
// ──────────────────────────────────────────────────────────────────────────────

// ICE servers loaded from server at login (uses .env TURN credentials)
let iceServers = [
  { urls: 'stun:stun.l.google.com:19302' }
];

// ── STATE ─────────────────────────────────────────────────────────────────────
let socket             = null;
let currentUser        = null;
let localStream        = null;
let peerConnection     = null;
let inCallWithSocketId = null;
let micEnabled         = true;
let camEnabled         = true;
let pendingOffer       = null;
let pendingCallerId    = null;
let iceCandidateBuffer    = [];
let remoteDescSet         = false;
let isCaller              = false;  // true for the side that placed the call
let iceRestartAttempts    = 0;
let isCallEstablished     = false;
let callTimeout           = null;
let isRestartingIce       = false;  // guard against rapid-fire ICE 'failed' events
let preAcceptIceCandidates = [];    // ICE candidates from caller that arrive before callee accepts
let ringtoneHandle        = null;   // Web Audio ringtone control

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const authScreen     = document.getElementById('auth-screen');
const appScreen      = document.getElementById('app-screen');
const loginForm      = document.getElementById('login-form');
const signupForm     = document.getElementById('signup-form');
const loginEmail     = document.getElementById('login-email');
const loginPassword  = document.getElementById('login-password');
const loginError     = document.getElementById('login-error');
const signupEmail    = document.getElementById('signup-email');
const signupPassword = document.getElementById('signup-password');
const signupError    = document.getElementById('signup-error');
const logoutBtn      = document.getElementById('logout-btn');
const headerEmail    = document.getElementById('header-email');
const usersList      = document.getElementById('users-list');
const userCount      = document.getElementById('user-count');
const localVideo     = document.getElementById('local-video');
const remoteVideo    = document.getElementById('remote-video');
const remoteLabel    = document.getElementById('remote-label');
const localIdle      = document.getElementById('local-idle');
const remoteIdle     = document.getElementById('remote-idle');
const callControls   = document.getElementById('call-controls');
const callStatus     = document.getElementById('call-status');
const toggleMicBtn   = document.getElementById('toggle-mic');
const toggleCamBtn   = document.getElementById('toggle-cam');
const hangupBtn      = document.getElementById('hangup-btn');
const incomingModal  = document.getElementById('incoming-modal');
const callerName     = document.getElementById('caller-name');
const acceptCallBtn  = document.getElementById('accept-call');
const rejectCallBtn  = document.getElementById('reject-call');

// ── TABS ──────────────────────────────────────────────────────────────────────
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
  appScreen.classList.remove('active');
  authScreen.classList.add('active');
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
  headerEmail.textContent = currentUser.email;
  authScreen.classList.remove('active');
  appScreen.classList.add('active');
  // Fetch TURN config FIRST, then connect — ensures TURN is available before any call
  try {
    const r = await fetch('/config/ice');
    const data = await r.json();
    if (data.iceServers && data.iceServers.length) {
      iceServers = data.iceServers;
      console.log('[ICE] Loaded', iceServers.length, 'ICE servers from server:',
        iceServers.map(s => Array.isArray(s.urls) ? s.urls[0] : s.urls).join(', '));
    }
  } catch (e) {
    console.warn('[ICE] Failed to load ICE config — using fallback STUN only:', e.message);
  }
  loadChatHistory();
  connectSocket();
}

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
function connectSocket() {
  if (socket && socket.connected) return;
  const token = getCookie('token');
  socket = io({
    auth: { token },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    setStatus('Connected — ready to call.');
  });
  socket.on('disconnect', () => setStatus('Disconnected…'));
  socket.on('users:online', renderUsers);
  socket.on('chat:message', (msg) => appendChatMessage(msg));

  // Incoming call
  socket.on('call:incoming', ({ from, callerEmail, offer }) => {
    console.log('Incoming call from', callerEmail);
    if (inCallWithSocketId || pendingCallerId) { socket.emit('call:reject', { targetSocketId: from }); return; }
    pendingOffer = offer;
    pendingCallerId = from;
    callerName.textContent = callerEmail;
    incomingModal.classList.remove('hidden');
    startRingtone();
  });

  // Caller receives answer
  socket.on('call:answered', async ({ answer }) => {
    console.log('[SIGNAL] call:answered received — peerConnection:', !!peerConnection);
    if (!peerConnection) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescSet = true;
      console.log('[SIGNAL] Remote description (answer) set — flushing ICE buffer:', iceCandidateBuffer.length);
      await flushIceCandidates();
    } catch (err) { console.error('[SIGNAL] setRemoteDescription(answer):', err); }
  });

  // ICE candidates — buffer if remote desc not ready; pre-buffer during ringing
  socket.on('ice:candidate', async ({ candidate }) => {
    if (!peerConnection) {
      // peerConnection doesn't exist yet — callee is still in the ringing modal
      if (pendingCallerId) {
        console.log('[ICE] Pre-accept buffer: storing candidate from caller');
        preAcceptIceCandidates.push(candidate);
      }
      return;
    }
    const ice = candidate ? new RTCIceCandidate(candidate) : null;
    if (remoteDescSet) {
      try { await peerConnection.addIceCandidate(ice); }
      catch (err) { console.warn('[ICE] addIceCandidate:', err.message); }
    } else {
      iceCandidateBuffer.push(ice);
    }
  });

  socket.on('call:rejected', () => { setStatus('Call was declined.'); hangupCall(); });
  socket.on('call:hangup',   () => { setStatus('Call ended by remote.'); hangupCall(); });

  // Remote user is busy — tear down local call attempt
  socket.on('call:busy', () => {
    setStatus('User is busy \u2014 try again later.');
    hangupCall();
  });

  // Callee: receives ICE-restart offer from caller after a connection failure
  socket.on('call:ice-restart', async ({ from, offer }) => {
    if (!peerConnection || inCallWithSocketId !== from) return;
    iceCandidateBuffer = [];
    remoteDescSet = false;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescSet = true;
      await flushIceCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('call:ice-restart-answer', { targetSocketId: from, answer });
    } catch (err) { console.error('ice-restart answer:', err); }
  });

  // Caller: receives ICE-restart answer from callee
  socket.on('call:ice-restart-answer', async ({ answer }) => {
    if (!peerConnection) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescSet = true;
      await flushIceCandidates();
    } catch (err) { console.error('ice-restart-answer:', err); }
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

// ── FLUSH BUFFERED ICE CANDIDATES ─────────────────────────────────────────────
async function flushIceCandidates() {
  console.log('Flushing', iceCandidateBuffer.length, 'buffered ICE candidates');
  for (const c of iceCandidateBuffer) {
    try { await peerConnection.addIceCandidate(c); }
    catch (err) { console.warn('addIceCandidate(buffered):', err.message); }
  }
  iceCandidateBuffer = [];
}

// ── RENDER ONLINE USERS ───────────────────────────────────────────────────────
function renderUsers(users) {
  const others = users.filter(u => u.userId !== currentUser.id);
  userCount.textContent = others.length;

  if (others.length === 0) {
    usersList.innerHTML = '<div class="empty-state">No other users online.<br>Share the app to connect.</div>';
    return;
  }
  usersList.innerHTML = '';
  others.forEach(u => {
    const card = document.createElement('div');
    const isInMyCall = inCallWithSocketId === u.socketId;
    const isBusy     = u.inCall && !isInMyCall;
    card.className   = 'user-card' + (isBusy ? ' busy-card' : '');
    const initial    = u.email.charAt(0).toUpperCase();
    const shortEmail = u.email.length > 22 ? u.email.substring(0, 22) + '\u2026' : u.email;
    const statusText = isInMyCall ? 'IN CALL' : (isBusy ? 'BUSY' : 'ONLINE');
    const dotClass   = isBusy ? 'status-dot busy' : 'status-dot';
    const btnHtml    = isBusy
      ? '<div class="call-btn busy-btn" title="User is busy">\uD83D\uDCF5</div>'
      : '<div class="call-btn">\uD83D\uDCDE</div>';
    card.innerHTML =
      '<div class="user-avatar">' + initial + '</div>' +
      '<div class="user-info">' +
        '<div class="user-email" title="' + u.email + '">' + shortEmail + '</div>' +
        '<div class="user-status"><div class="' + dotClass + '"></div>' +
        '<span class="status-text' + (isBusy ? ' busy' : '') + '">' + statusText + '</span></div>' +
      '</div>' + btnHtml;
    card.addEventListener('click', () => {
      if (isBusy) { setStatus(shortEmail + ' is busy \u2014 try again later.'); return; }
      if (!inCallWithSocketId) initiateCall(u.socketId, u.email);
    });
    usersList.appendChild(card);
  });
}

// ── INITIATE CALL ─────────────────────────────────────────────────────────────
async function initiateCall(targetSocketId, targetEmail) {
  setStatus('Starting camera…');
  try { await startLocalStream(); }
  catch (err) { setStatus('Camera/mic blocked — check browser permissions.'); return; }

  isCaller = true;           // ✔ must be set BEFORE createPeerConnection
  isCallEstablished = false;
  iceRestartAttempts = 0;
  resetPeerState();
  peerConnection = createPeerConnection(targetSocketId);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call:offer', { targetSocketId, offer });
    inCallWithSocketId = targetSocketId;
    remoteLabel.textContent = targetEmail;
    callControls.classList.remove('hidden');
    setStatus('Calling ' + targetEmail + '\u2026');
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
  const from  = pendingCallerId;
  const offer = pendingOffer;
  const email = callerName.textContent;

  // Save ICE candidates that arrived while ringing (peerConnection was null then)
  const savedPreAccept = preAcceptIceCandidates.slice();
  preAcceptIceCandidates = [];
  console.log('[ACCEPT] Pre-accept ICE candidates saved:', savedPreAccept.length);

  setStatus('Answering call from ' + email + '…');
  try { await startLocalStream(); }
  catch (err) {
    setStatus('Camera/mic blocked — check permissions.');
    socket.emit('call:reject', { targetSocketId: from });
    return;
  }

  isCaller = false;
  isCallEstablished = false;
  iceRestartAttempts = 0;
  resetPeerState();
  peerConnection = createPeerConnection(from);

  // Add local tracks FIRST so transceivers start as sendrecv
  localStream.getTracks().forEach(t => {
    console.log('[ACCEPT] Adding local track:', t.kind, t.readyState);
    peerConnection.addTrack(t, localStream);
  });

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    remoteDescSet = true;
    console.log('[ACCEPT] Transceivers after setRemoteDesc:',
      peerConnection.getTransceivers().map(t => t.kind + ':' + t.direction).join(', '));

    // Force every transceiver to sendrecv — guarantees callee tracks are transmitted
    peerConnection.getTransceivers().forEach(t => {
      if (t.direction === 'recvonly' || t.direction === 'inactive') {
        console.log('[ACCEPT] Forcing', t.kind, t.direction, '→ sendrecv');
        t.direction = 'sendrecv';
      }
    });

    // Flush candidates that arrived while ringing + any buffered ones
    console.log('[ACCEPT] Flushing pre-accept:', savedPreAccept.length, '| buffer:', iceCandidateBuffer.length);
    for (const c of savedPreAccept) {
      try { await peerConnection.addIceCandidate(c ? new RTCIceCandidate(c) : null); }
      catch (e) { console.warn('[ICE] pre-accept failed:', e.message); }
    }
    await flushIceCandidates();

    const answer = await peerConnection.createAnswer();
    console.log('[ACCEPT] Answer directions:',
      answer.sdp.split('\n').filter(l => l.match(/^a=(sendrecv|recvonly|sendonly|inactive)/)).join(' | '));
    await peerConnection.setLocalDescription(answer);
    socket.emit('call:answer', { targetSocketId: from, answer });
    inCallWithSocketId = from;
    remoteLabel.textContent = email;
    callControls.classList.remove('hidden');
    setStatus('Connecting…');
    startCallTimeout();
  } catch (err) {
    console.error('[ACCEPT] Error:', err);
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

// ── CREATE PEER CONNECTION ────────────────────────────────────────────────────
function createPeerConnection(targetSocketId) {
  const hasTurn = iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn:')));
  console.log('[PC] Creating RTCPeerConnection — ICE servers:', iceServers.length, '| TURN:', hasTurn ? 'YES ✅' : 'NO ❌');
  if (!hasTurn) console.warn('[PC] No TURN server! Call will fail if peers cannot reach each other directly.');
  const pc = new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      console.log('[ICE] Local candidate:', candidate.type, '|', candidate.protocol, '|', candidate.address || '?');
    } else {
      console.log('[ICE] Gathering complete (null candidate sent)');
    }
    socket.emit('ice:candidate', { targetSocketId, candidate: candidate || null });
  };

  pc.onicegatheringstatechange = () => {
    console.log('[ICE] Gathering state:', pc.iceGatheringState);
    if (pc.iceGatheringState === 'complete') {
      const stats = { host: 0, srflx: 0, relay: 0 };
      // count candidate types from SDP
      const sdp = pc.localDescription ? pc.localDescription.sdp : '';
      (sdp.match(/a=candidate:[^\r\n]+/g) || []).forEach(line => {
        if (line.includes(' host '))   stats.host++;
        if (line.includes(' srflx '))  stats.srflx++;
        if (line.includes(' relay '))  stats.relay++;
      });
      console.log('[ICE] Candidates gathered — host:', stats.host, '| srflx(STUN):', stats.srflx, '| relay(TURN):', stats.relay, stats.relay === 0 ? '❌ NO RELAY — TURN may be broken!' : '✅');
    }
  };
  pc.onsignalingstatechange     = () => console.log('Signaling state:', pc.signalingState);

  pc.oniceconnectionstatechange = () => {
    console.log('ICE connection:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      doIceRestart(pc, targetSocketId);
    }
    if (pc.iceConnectionState === 'disconnected') {
      setStatus('Connection unstable \u2014 reconnecting\u2026');
    }
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      iceRestartAttempts = 0;
      isRestartingIce = false;
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.log('Connection state:', s);
    if (s === 'connected') {
      setStatus('\u2705 Call connected');
      iceRestartAttempts = 0;
      isRestartingIce = false;
      isCallEstablished = true;
      clearCallTimeout();
    } else if (s === 'failed') {
      doIceRestart(pc, targetSocketId);
    } else if (s === 'closed') {
      if (inCallWithSocketId) { setStatus('Call ended.'); hangupCall(); }
    }
  };

  pc.ontrack = (event) => {
    const { kind } = event.track;
    console.log('[TRACK] Received remote track:', kind, '| streams:', event.streams.length, '| readyState:', event.track.readyState);
    remoteIdle.style.display = 'none';

    if (event.streams && event.streams[0]) {
      // Normal case: stream is attached
      if (remoteVideo.srcObject !== event.streams[0]) {
        console.log('[TRACK] Setting remoteVideo.srcObject from stream');
        remoteVideo.srcObject = event.streams[0];
      }
    } else {
      // Unified-plan fallback: no stream attached — build one manually
      console.warn('[TRACK] No stream in event — building MediaStream manually');
      if (!remoteVideo.srcObject || !(remoteVideo.srcObject instanceof MediaStream)) {
        remoteVideo.srcObject = new MediaStream();
      }
      remoteVideo.srcObject.addTrack(event.track);
    }

    // Ensure the video is playing (autoplay attribute handles most cases;
    // explicit play() as fallback for browsers that block it)
    remoteVideo.muted = false;
    if (remoteVideo.paused) {
      remoteVideo.play().catch(err => {
        // Autoplay blocked — mute and try again (browser policy requirement)
        console.warn('[TRACK] play() blocked, retrying muted:', err.message);
        remoteVideo.muted = true;
        remoteVideo.play()
          .then(() => {
            // Unmute via user gesture is required by browser — prompt user
            remoteVideo.muted = false;
          })
          .catch(e2 => console.error('[TRACK] muted play() also failed:', e2.message));
      });
    }
  };

  // Track lifecycle events for debugging
  return pc;
}

// ── ICE RESTART (shared by ICE + connection state 'failed') ──────────────────
function doIceRestart(pc, targetSocketId) {
  if (isRestartingIce) return;  // already in progress — ignore duplicate events
  if (isCaller && iceRestartAttempts < 3) {
    isRestartingIce = true;
    iceRestartAttempts++;
    console.warn('ICE/connection failed \u2014 restart attempt', iceRestartAttempts);
    setStatus('Reconnecting\u2026 (' + iceRestartAttempts + '/3)');
    (async () => {
      try {
        remoteDescSet = false;
        iceCandidateBuffer = [];
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        socket.emit('call:ice-restart', { targetSocketId, offer });
      } catch (e) { console.error('ICE restart offer failed:', e); hangupCall(); }
      finally { isRestartingIce = false; }
    })();
  } else if (!isCaller) {
    if (!isRestartingIce) {
      setStatus('Connection lost \u2014 waiting for caller to reconnect\u2026');
      setTimeout(() => {
        if (peerConnection &&
           (peerConnection.iceConnectionState === 'failed' ||
            peerConnection.connectionState === 'failed')) {
          setStatus('Connection failed. Please retry the call.'); hangupCall();
        }
      }, 15000);
    }
  } else {
    setStatus('Connection failed. Please retry the call.');
    hangupCall();
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
async function startLocalStream() {
  if (localStream) return;
  const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: audioConstraints
    });
    console.log('Got video+audio stream');
  } catch (e) {
    console.warn('Video failed (' + e.name + '), trying audio-only');
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints });
      setStatus('Camera unavailable — audio only call');
    } catch (e2) { throw e2; }
  }
  localVideo.srcObject = localStream;
  localVideo.play().catch(() => {});
  localIdle.style.display = 'none';
}

// ── CONTROLS ──────────────────────────────────────────────────────────────────
toggleMicBtn.addEventListener('click', () => {
  micEnabled = !micEnabled;
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
  toggleMicBtn.classList.toggle('muted', !micEnabled);
});

toggleCamBtn.addEventListener('click', () => {
  camEnabled = !camEnabled;
  if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = camEnabled; });
  toggleCamBtn.classList.toggle('muted', !camEnabled);
});

hangupBtn.addEventListener('click', () => {
  if (inCallWithSocketId) socket.emit('call:hangup', { targetSocketId: inCallWithSocketId });
  setStatus('You ended the call.');
  hangupCall();
});

// ── HANGUP ────────────────────────────────────────────────────────────────────
function hangupCall() {
  stopRingtone();
  resetPeerState();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  localIdle.style.display = '';
  remoteIdle.style.display = '';
  callControls.classList.add('hidden');
  inCallWithSocketId = null;
  micEnabled = true; camEnabled = true;
  toggleMicBtn.classList.remove('muted');
  toggleCamBtn.classList.remove('muted');
  remoteLabel.textContent = 'REMOTE';
  pendingOffer = null; pendingCallerId = null;
  preAcceptIceCandidates = [];
  isCaller = false;
  clearCallTimeout();
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function setStatus(msg) { callStatus.textContent = msg; console.log('[status]', msg); }
function startCallTimeout() {
  clearCallTimeout();
  callTimeout = setTimeout(() => {
    if (!isCallEstablished && inCallWithSocketId) {
      setStatus('No answer \u2014 call timed out.');
      socket.emit('call:hangup', { targetSocketId: inCallWithSocketId });
      hangupCall();
    }
  }, 45000);
}

function clearCallTimeout() {
  if (callTimeout) { clearTimeout(callTimeout); callTimeout = null; }
}

// ── RINGTONE (MP3 file with Web Audio fallback) ──────────────────────────────────────────────
let ringtoneAudio = null;
function startRingtone() {
  stopRingtone();
  try {
    ringtoneAudio = new Audio('/assets/soft_ringtone.mp3');
    ringtoneAudio.loop = true;
    ringtoneAudio.volume = 0.7;
    ringtoneAudio.play().catch(err => {
      console.warn('[RING] MP3 play blocked:', err.message);
      ringtoneAudio = null;
      startRingtoneFallback();
    });
  } catch (e) {
    startRingtoneFallback();
  }
}

function startRingtoneFallback() {
  stopRingtone();
  let active = true;
  let ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
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
  if (ctx.state === 'running') ring();
  ringtoneHandle = { stop: () => { active = false; clearTimeout(ringtoneHandle); try { ctx.close(); } catch(e){} } };
}

function stopRingtone() {
  if (ringtoneAudio) {
    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;
    ringtoneAudio = null;
  }
  if (ringtoneHandle && typeof ringtoneHandle.stop === 'function') {
    ringtoneHandle.stop();
  } else if (ringtoneHandle) {
    clearTimeout(ringtoneHandle);
  }
  ringtoneHandle = null;
}

function getCookie(name) {
  const c = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
  return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : '';
}

// ── CHAT ───────────────────────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');
const chatSendBtn  = document.getElementById('chat-send');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function appendChatMessage(msg, scrollToBottom = true) {
  const empty = chatMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const isOwn = currentUser && msg.user_id === currentUser.id;
  const shortEmail = msg.email.length > 18 ? msg.email.slice(0, 18) + '…' : msg.email;

  const div = document.createElement('div');
  div.className = 'chat-msg' + (isOwn ? ' own' : '');
  div.innerHTML =
    '<div class="chat-msg-meta">' +
      '<span class="chat-msg-author" title="' + escapeHtml(msg.email) + '">' + escapeHtml(shortEmail) + '</span>' +
      '<span class="chat-msg-time">' + formatTime(msg.created_at) + '</span>' +
    '</div>' +
    '<div class="chat-msg-bubble">' + escapeHtml(msg.content) + '</div>';

  chatMessages.appendChild(div);
  if (scrollToBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
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
  } catch (e) {
    console.warn('[CHAT] Failed to load history:', e.message);
  }
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
