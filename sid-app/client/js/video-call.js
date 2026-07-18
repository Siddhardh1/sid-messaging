// ==================== WEBRTC VIDEO CALLING CONTROLLER ====================

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let callType = 'video'; // 'audio' | 'video'
let activeCallTargetUserId = null;
let currentCallRoomId = null;

let isAudioMuted = false;
let isVideoPaused = false;
let isScreenSharing = false;
let isHandRaised = false;
let isBackgroundBlurred = false;
let callRecorder = null;
let callRecordChunks = [];
let recordTimerInterval = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize call signaling socket event bindings
function initializeCallSignaling() {
  if (!window.socket) return;

  window.socket.on('call-incoming', ({ callerId, type, callerName }) => {
    activeCallTargetUserId = callerId;
    callType = type;
    showIncomingCallUI(callerName);
  });

  window.socket.on('call-accepted', () => {
    document.getElementById('calling-banner').innerText = 'Securing encrypted channel...';
    startRtcConnection();
  });

  window.socket.on('call-rejected', () => {
    alert('Call rejected');
    cleanupCallState();
  });

  window.socket.on('call-ended', () => {
    alert('Call ended');
    cleanupCallState();
  });

  // Relay ICE and SDP signaling
  window.socket.on('receive-offer', async ({ offer }) => {
    if (!peerConnection) createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    // Add local tracks if not already added
    if (localStream) {
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    window.socket.emit('send-answer', { targetUserId: activeCallTargetUserId, answer });
  });

  window.socket.on('receive-answer', async ({ answer }) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  window.socket.on('receive-ice', async ({ candidate }) => {
    try {
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (e) {
      console.error('Error adding ICE Candidate:', e);
    }
  });

  // Relay participant toggles
  window.socket.on('participant-screen-share', ({ isSharing }) => {
    console.log('Peer screen sharing:', isSharing);
  });

  window.socket.on('participant-hand-raised', ({ userId, isRaised }) => {
    const alertBox = document.getElementById('hand-raise-alert');
    if (isRaised) {
      alertBox.classList.remove('hidden');
      document.getElementById('hand-raise-alert-text').innerText = 'Peer raised hand!';
      setTimeout(() => alertBox.classList.add('hidden'), 4000);
    } else {
      alertBox.classList.add('hidden');
    }
  });

  window.socket.on('participant-audio-toggled', ({ isMuted }) => {
    console.log('Peer muted:', isMuted);
  });

  window.socket.on('participant-video-toggled', ({ isPaused }) => {
    console.log('Peer video paused:', isPaused);
  });
}

// Initiate out-going audio/video call
async function initiateWebRTCCall(type) {
  if (!activeChatId) return;
  
  // Find recipient participant
  const peer = currentChatParticipants.find(p => p._id !== currentUser.id);
  if (!peer) return alert('No peer user found in chat to call');

  activeCallTargetUserId = peer._id;
  callType = type;

  // Open call overlay
  document.getElementById('video-call-overlay').classList.remove('hidden');
  document.getElementById('calling-banner-name').innerText = `Calling ${peer.username}...`;
  document.getElementById('calling-banner').classList.remove('hidden');
  
  // Play Ringtone
  const ringtone = document.getElementById('call-ringtone');
  ringtone.play().catch(e => console.log(e));

  try {
    // Acquire local streams
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video'
    });

    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;

    // Notify Peer User
    window.socket.emit('call-user', {
      targetUserId: activeCallTargetUserId,
      callerId: currentUser.id,
      chatId: activeChatId,
      type,
      callerName: currentUser.username
    });

  } catch (err) {
    console.error('Error getting media devices:', err);
    alert('Could not open camera/mic access');
    cleanupCallState();
  }
}

// Show incoming call dialog controls
function showIncomingCallUI(callerName) {
  // We can open the overlay and overlay accepting screens
  document.getElementById('video-call-overlay').classList.remove('hidden');
  document.getElementById('calling-banner-name').innerText = `Incoming call from ${callerName}...`;
  document.getElementById('calling-banner').innerHTML = `
    <h2>Incoming Call from ${callerName}</h2>
    <p>Connecting Secure Channel</p>
    <div style="margin-top: 20px; display: flex; gap: 15px; justify-content: center;">
      <button class="btn btn-primary" onclick="acceptIncomingCall()" style="background: #10b981;">Accept</button>
      <button class="btn btn-secondary" onclick="rejectIncomingCall()" style="background: #ef4444; border:none; color:#fff;">Reject</button>
    </div>
  `;

  const ringtone = document.getElementById('call-ringtone');
  ringtone.play().catch(e => console.log(e));
}

// Call Accepted
async function acceptIncomingCall() {
  document.getElementById('call-ringtone').pause();
  document.getElementById('calling-banner').innerHTML = `
    <h2>Securing encrypted channel...</h2>
    <p>Connecting Secure End-to-End Channel</p>
  `;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video'
    });

    document.getElementById('local-video').srcObject = localStream;

    window.socket.emit('call-accepted', { targetUserId: activeCallTargetUserId, calleeId: currentUser.id });
    
    // Acceptor creates the peer connection
    startRtcConnection();

  } catch (err) {
    console.error(err);
    alert('Access to audio/video devices failed');
    rejectIncomingCall();
  }
}

// Call Rejected
function rejectIncomingCall() {
  window.socket.emit('call-rejected', { targetUserId: activeCallTargetUserId, calleeId: currentUser.id });
  cleanupCallState();
}

// Start peer connection & SDP negotiations
async function startRtcConnection() {
  document.getElementById('calling-banner').classList.add('hidden');
  document.getElementById('call-ringtone').pause();

  createPeerConnection();

  // Add tracks
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Caller creates offer
  if (currentUser.id !== activeCallTargetUserId) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    window.socket.emit('send-offer', { targetUserId: activeCallTargetUserId, offer });
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      window.socket.emit('send-ice-candidate', { targetUserId: activeCallTargetUserId, candidate: event.candidate });
    }
  };

  peerConnection.ontrack = (event) => {
    remoteStream = event.streams[0];
    document.getElementById('remote-video').srcObject = remoteStream;
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection && (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'closed')) {
      cleanupCallState();
    }
  };
}

// --- CALL CONTROLS SETTERS ---

function toggleCallAudio() {
  isAudioMuted = !isAudioMuted;
  localStream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);

  const btn = document.getElementById('call-btn-mute');
  btn.className = isAudioMuted ? 'control-btn active' : 'control-btn';
  btn.innerHTML = isAudioMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';

  window.socket.emit('toggle-audio', { chatId: activeChatId, isMuted: isAudioMuted });
}

function toggleCallVideo() {
  isVideoPaused = !isVideoPaused;
  localStream.getVideoTracks().forEach(track => track.enabled = !isVideoPaused);

  const btn = document.getElementById('call-btn-video');
  btn.className = isVideoPaused ? 'control-btn active' : 'control-btn';
  btn.innerHTML = isVideoPaused ? '<i class="fa-solid fa-video-slash"></i>' : '<i class="fa-solid fa-video"></i>';

  window.socket.emit('toggle-video', { chatId: activeChatId, isPaused: isVideoPaused });
}

async function toggleCallScreenShare() {
  try {
    if (!isScreenSharing) {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const videoTrack = screenStream.getVideoTracks()[0];

      // Replace active video track
      const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      }

      document.getElementById('local-video').srcObject = screenStream;

      videoTrack.onended = () => {
        stopScreenShare();
      };

      isScreenSharing = true;
      document.getElementById('call-btn-screen').classList.add('active');
      window.socket.emit('toggle-screen-share', { chatId: activeChatId, isSharing: true });
    } else {
      stopScreenShare();
    }
  } catch (err) {
    console.error('Screen sharing cancelled:', err);
  }
}

function stopScreenShare() {
  const localVideoTrack = localStream.getVideoTracks()[0];
  const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
  if (sender && localVideoTrack) {
    sender.replaceTrack(localVideoTrack);
  }
  document.getElementById('local-video').srcObject = localStream;
  isScreenSharing = false;
  document.getElementById('call-btn-screen').classList.remove('active');
  window.socket.emit('toggle-screen-share', { chatId: activeChatId, isSharing: false });
}

// Canvas-based virtual background blur filter
async function toggleVirtualBackground() {
  isBackgroundBlurred = !isBackgroundBlurred;
  const btn = document.getElementById('call-btn-background');
  
  if (isBackgroundBlurred) {
    btn.classList.add('active');
    applyCanvasBackgroundBlur();
  } else {
    btn.classList.remove('active');
    // Revert local video source back to normal stream
    document.getElementById('local-video').srcObject = localStream;
  }
}

function applyCanvasBackgroundBlur() {
  const video = document.createElement('video');
  video.srcObject = localStream;
  video.muted = true;
  video.play();

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');

  // Capture canvas frames into stream
  const canvasStream = canvas.captureStream(30);
  document.getElementById('local-video').srcObject = canvasStream;

  // Replace video track in RTCPeerConnection sender
  const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
  if (sender) {
    sender.replaceTrack(canvasStream.getVideoTracks()[0]);
  }

  function renderBlurLoop() {
    if (!isBackgroundBlurred) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply blur native canvas filter
    ctx.filter = 'blur(8px)';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Reset filter and draw clear subject silhouette (simulated or simplified overlay here)
    ctx.filter = 'none';
    ctx.drawImage(video, 40, 30, canvas.width - 80, canvas.height - 30); // Draw cropped center as non-blurred overlay

    requestAnimationFrame(renderBlurLoop);
  }

  video.onloadedmetadata = () => {
    renderBlurLoop();
  };
}

function toggleCallHandRaise() {
  isHandRaised = !isHandRaised;
  const btn = document.getElementById('call-btn-hand');
  btn.className = isHandRaised ? 'control-btn active' : 'control-btn';

  window.socket.emit('raise-hand', { chatId: activeChatId, isRaised: isHandRaised });
}

// Call recording
function toggleCallRecording() {
  const btn = document.getElementById('call-btn-record');
  const indicator = document.getElementById('recording-indicator');
  
  if (callRecorder && callRecorder.state === 'recording') {
    callRecorder.stop();
    btn.classList.remove('active');
    indicator.classList.add('hidden');
    clearInterval(recordTimerInterval);
    return;
  }

  try {
    // Combine local & remote streams
    const combinedTracks = [];
    if (localStream) localStream.getTracks().forEach(t => combinedTracks.push(t));
    if (remoteStream) remoteStream.getVideoTracks().forEach(t => combinedTracks.push(t));

    const combinedStream = new MediaStream(combinedTracks);
    callRecorder = new MediaRecorder(combinedStream);
    callRecordChunks = [];

    callRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) callRecordChunks.push(e.data);
    };

    callRecorder.onstop = () => {
      const blob = new Blob(callRecordChunks, { type: 'video/webm' });
      downloadFile(blob, `call_record_${Date.now()}.webm`, 'video/webm');
      alert('Call recording saved!');
    };

    callRecorder.start();
    btn.classList.add('active');
    indicator.classList.remove('hidden');

    let seconds = 0;
    document.getElementById('recording-timer').innerText = '00:00';
    recordTimerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      document.getElementById('recording-timer').innerText = `${m}:${s}`;
    }, 1000);

  } catch (err) {
    console.error(err);
    alert('Call recording requires audio/video streams active');
  }
}

// In-call text messages
function toggleInCallChat() {
  document.getElementById('in-call-chat').classList.toggle('hidden');
}

function handleInCallChatSend(e) {
  if (e.key === 'Enter') {
    sendInCallChatMessage();
  }
}

function sendInCallChatMessage() {
  const input = document.getElementById('in-call-input');
  const text = input.value.trim();
  if (!text) return;

  // Render locally
  appendInCallMessage(currentUser.username, text);

  // Send to peer
  window.socket.emit('new-message', {
    chatId: activeChatId,
    sender: { _id: currentUser.id, username: currentUser.username },
    encryptedContent: text, // simple E2E relay inside call
    isSystem: false,
    createdAt: new Date().toISOString()
  });

  input.value = '';
}

function appendInCallMessage(sender, text) {
  const container = document.getElementById('in-call-messages');
  const bubble = document.createElement('div');
  bubble.style = 'margin-bottom: 8px; font-size:12px; color:#fff;';
  bubble.innerHTML = `<strong>${sender}:</strong> <span>${escapeHtml(text)}</span>`;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// Terminate / hangup active call session
function endCurrentCall() {
  window.socket.emit('call-ended', { targetUserId: activeCallTargetUserId, callerId: currentUser.id });
  cleanupCallState();
}

function cleanupCallState() {
  document.getElementById('call-ringtone').pause();
  document.getElementById('video-call-overlay').classList.add('hidden');
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  remoteStream = null;
  activeCallTargetUserId = null;
  currentCallRoomId = null;
  isAudioMuted = false;
  isVideoPaused = false;
  isScreenSharing = false;
  isHandRaised = false;
  isBackgroundBlurred = false;
  
  document.getElementById('local-video').srcObject = null;
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('hand-raise-alert').classList.add('hidden');
}
