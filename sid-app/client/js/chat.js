// ==================== CHAT & MESSAGING CONTROLLER ====================

let activeChatId = null;
let currentChatParticipants = [];
let replyingToMessageId = null;
let disappearingSeconds = 0;
let scheduledDeliveryTime = null;
let mediaRecorder = null;
let audioChunks = [];

// Initialize Socket.io Connection
function initializeSocket() {
  window.socket = io();

  window.socket.emit('user-online', currentUser.id);

  window.socket.on('new-message', (message) => {
    const senderId = message.sender ? (message.sender._id || message.sender) : null;
    const currentId = currentUser ? (currentUser._id || currentUser.id) : null;
    const isSelf = senderId === currentId;

    if (activeChatId && message.chatId === activeChatId) {
      appendMessageToUI(message);
      // Mark as read immediately on server
      markChatMessagesAsRead(activeChatId);
    }
    loadChatsList(); // Refresh chats sidebar preview list

    if (!isSelf) {
      playNotificationSound(senderId);
      
      // Trigger native Web Notification if tab is hidden or user is in a different chat room
      const isWindowHidden = document.hidden;
      const isDifferentChat = message.chatId !== activeChatId;
      
      if ((isWindowHidden || isDifferentChat) && 'Notification' in window && Notification.permission === 'granted') {
        const decryptedText = decryptContentE2EE(message.encryptedContent, message.iv, getChatE2EEKey(message.chatId));
        const senderName = (message.sender && message.sender.username) ? message.sender.username : 'Sid Messenger';
        
        new Notification(senderName, {
          body: decryptedText || 'Sent an attachment',
          icon: (message.sender && message.sender.avatar) ? message.sender.avatar : `https://api.dicebear.com/7.x/bottts/svg?seed=${senderName}`
        });
      }
    }
  });

  window.socket.on('typing', ({ chatId, username }) => {
    if (activeChatId === chatId) {
      const indicator = document.getElementById('typing-indicator');
      document.getElementById('typing-text').innerText = `${username} is typing...`;
      indicator.classList.remove('hidden');
    }
  });

  window.socket.on('stop-typing', ({ chatId }) => {
    if (activeChatId === chatId) {
      document.getElementById('typing-indicator').classList.add('hidden');
    }
  });

  window.socket.on('message-reaction', ({ messageId, reactions }) => {
    updateMessageReactionsUI(messageId, reactions);
  });

  window.socket.on('message-pinned', ({ messageId, pinned }) => {
    if (pinned) {
      alert('A message was pinned in this chat');
    }
    if (activeChatId) loadChatMessages(activeChatId);
  });

  window.socket.on('message-deleted-everyone', ({ messageId }) => {
    const bubbleText = document.getElementById(`msg-text-${messageId}`);
    if (bubbleText) {
      bubbleText.innerText = 'This message was deleted';
      bubbleText.style.fontStyle = 'italic';
      bubbleText.style.opacity = '0.6';
    }
    // Remove attachment block if any
    const attBlock = document.getElementById(`msg-att-${messageId}`);
    if (attBlock) attBlock.remove();
  });



  // Track online status changes
  window.socket.on('user-status-change', ({ userId, status, lastSeen }) => {
    if (activeChatId) {
      const isTarget = currentChatParticipants.some(p => p._id === userId && p._id !== currentUser.id);
      if (isTarget) {
        const statusTextEl = document.getElementById('chat-target-status-text');
        const statusDot = document.getElementById('chat-target-status-dot');
        if (status === 'online') {
          statusTextEl.innerText = 'Online';
          statusDot.className = 'status-indicator';
        } else {
          statusTextEl.innerText = lastSeen ? `Last seen ${formatDate(lastSeen)}` : 'Offline';
          statusDot.className = 'status-indicator offline';
        }
      }
    }
    // Also refresh contacts list statuses
    if (document.getElementById('contacts-list').classList.contains('active')) {
      loadContactsList();
    }
  });
}

// Play notification sound
function playNotificationSound(senderId) {
  const currentId = currentUser ? (currentUser._id || currentUser.id) : null;
  if (senderId === currentId) return;
  const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-84.wav');
  audio.volume = 0.5;
  audio.play().catch(e => console.log('Audio playback blocked'));
}

// Fetch and render recent chats sidebar list
async function loadChatsList() {
  try {
    const res = await fetch('/api/messages/chats', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      renderRecentChats(data.chats);
    }
  } catch (err) {
    console.error('Error loading chats:', err);
  }
}

// Render recent chats list
function renderRecentChats(chats) {
  const container = document.getElementById('chats-list');
  if (!container) return;

  if (chats.length === 0) {
    container.innerHTML = `
      <div class="empty-state-list">
        <i class="fa-regular fa-comment-dots"></i>
        <p>No active chats</p>
      </div>
    `;
    return;
  }

  container.innerHTML = chats.map(chat => {
    const key = getChatE2EEKey(chat._id);
    // Determine chat name & avatar (DM vs Group)
    let chatName = chat.name;
    let chatAvatar = chat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${chatName || chat._id}`;
    let isOnline = false;
    
    if (!chat.isGroup) {
      const currentId = currentUser ? (currentUser._id || currentUser.id) : null;
      const peer = chat.participants.find(p => (p._id || p) !== currentId);
      if (peer) {
        chatName = peer.username;
        chatAvatar = peer.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${peer.username}`;
        isOnline = peer.lastSeen && (new Date() - new Date(peer.lastSeen) < 60000);
      }
    }

    const statusDotClass = isOnline ? 'status-indicator' : 'status-indicator offline';
    const activeClass = chat._id === activeChatId ? 'active' : '';

    // Decrypt last message preview if E2EE
    let messagePreview = 'No messages';
    let timeText = '';
    if (chat.lastMessage) {
      if (chat.lastMessage.isSystem) {
        messagePreview = 'Message deleted';
      } else if (chat.lastMessage.attachments && chat.lastMessage.attachments.length > 0) {
        messagePreview = '📷 File Attachment';
      } else {
        messagePreview = decryptContentE2EE(chat.lastMessage.encryptedContent, chat.lastMessage.iv, key);
      }
      timeText = formatTime(chat.lastMessage.createdAt);
    }

    const unreadBadge = chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : '';

    return `
      <div class="chat-item ${activeClass}" onclick="selectActiveChat('${chat._id}')">
        <div class="chat-item-avatar">
          <img src="${chatAvatar}" alt="${chatName}">
          <div class="${chat.isGroup ? 'hidden' : statusDotClass}"></div>
        </div>
        <div class="chat-item-info">
          <div class="chat-item-header">
            <span class="chat-item-name">${chatName}</span>
            <span class="chat-item-time">${timeText}</span>
          </div>
          <div class="chat-item-sub">
            <span class="chat-item-preview">${messagePreview}</span>
            ${unreadBadge}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Select active chat room
async function selectActiveChat(chatId) {
  if (activeChatId) {
    window.socket.emit('leave-chat', activeChatId);
  }

  activeChatId = chatId;
  document.getElementById('chat-empty-state').classList.remove('active');
  document.getElementById('chat-active-panel').classList.add('active');
  
  // Mobile responsive layout shifts
  document.getElementById('chat-screen').querySelector('.chat-workspace').classList.add('active-mobile');
  document.getElementById('chat-screen').querySelector('.app-sidebar').classList.add('hidden-mobile');

  window.socket.emit('join-chat', chatId);

  try {
    // Fetch chat meta first
    const chatRes = await fetch(`/api/messages/chats`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const chatData = await chatRes.json();
    const activeChat = chatData.chats.find(c => c._id === chatId);
    
    currentChatParticipants = activeChat.participants;

    // Render active header info
    let chatName = activeChat.name;
    let chatAvatar = activeChat.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${chatName || activeChat._id}`;
    
    if (!activeChat.isGroup) {
      const currentId = currentUser ? (currentUser._id || currentUser.id) : null;
      const peer = activeChat.participants.find(p => (p._id || p) !== currentId);
      if (peer) {
        chatName = peer.username;
        chatAvatar = peer.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${peer.username}`;
        
        // Show last seen
        const isOnline = peer.lastSeen && (new Date() - new Date(peer.lastSeen) < 60000);
        const statusDot = document.getElementById('chat-target-status-dot');
        const statusText = document.getElementById('chat-target-status-text');
        
        if (peer.settings && !peer.settings.showLastSeen) {
          statusText.innerText = 'Offline';
          statusDot.className = 'status-indicator offline';
        } else if (isOnline) {
          statusText.innerText = 'Online';
          statusDot.className = 'status-indicator';
        } else {
          statusText.innerText = peer.lastSeen ? `Last seen ${formatDate(peer.lastSeen)}` : 'Offline';
          statusDot.className = 'status-indicator offline';
        }
      }
    } else {
      document.getElementById('chat-target-status-text').innerText = `${activeChat.participants.length} members`;
      document.getElementById('chat-target-status-dot').className = 'status-indicator hidden';
    }

    document.getElementById('chat-target-name').innerText = chatName;
    document.getElementById('chat-target-avatar').src = chatAvatar;

    // Load Chat Messages
    await loadChatMessages(chatId);

  } catch (err) {
    console.error(err);
  }
}

// Mark messages inside conversation as read
async function markChatMessagesAsRead(chatId) {
  try {
    await fetch(`/api/messages/chat/${chatId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
  } catch (err) {
    console.error('Error marking as read:', err);
  }
}

// Fetch all messages inside a conversation room
async function loadChatMessages(chatId) {
  try {
    const res = await fetch(`/api/messages/chat/${chatId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      const container = document.getElementById('chat-messages-container');
      container.innerHTML = '';
      data.messages.forEach(msg => appendMessageToUI(msg));
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    console.error(err);
  }
}

// Append single message to workspace UI
function appendMessageToUI(msg) {
  const container = document.getElementById('chat-messages-container');
  const key = getChatE2EEKey(msg.chatId);

  const senderId = msg.sender ? (msg.sender._id || msg.sender) : null;
  const currentId = currentUser ? (currentUser._id || currentUser.id) : null;
  const isSelf = senderId === currentId;

  const row = document.createElement('div');
  row.className = `message-row ${isSelf ? 'self' : 'peer'}`;
  row.id = `msg-row-${msg._id}`;

  // Decrypt content E2EE
  let messageContent = '';
  if (msg.isSystem) {
    messageContent = 'This message was deleted';
  } else {
    messageContent = decryptContentE2EE(msg.encryptedContent, msg.iv, key);
  }

  // Construct message HTML components
  let attachmentsHtml = '';
  if (msg.attachments && msg.attachments.length > 0) {
    msg.attachments.forEach(att => {
      if (att.mimetype.startsWith('image/')) {
        attachmentsHtml += `<img src="${att.path}" alt="${att.filename}" class="attachment-preview-img" onclick="window.open('${att.path}')">`;
      } else if (att.mimetype.startsWith('audio/')) {
        // Voice Message UI
        attachmentsHtml += `
          <div class="voice-bubble-content" id="msg-att-${msg._id}">
            <button class="voice-play-btn" onclick="playVoiceNote('${att.path}', this)"><i class="fa-solid fa-play"></i></button>
            <div class="voice-progress-bar"><div class="voice-progress-fill"></div></div>
            <span class="font-sm" style="font-size: 11px;">Voice</span>
          </div>
        `;
      } else {
        attachmentsHtml += `
          <div class="message-attachment" id="msg-att-${msg._id}">
            <i class="fa-solid fa-file-arrow-down attachment-icon"></i>
            <div class="attachment-info">
              <span class="attachment-name">${att.filename}</span>
              <span class="attachment-size">${formatBytes(att.size)}</span>
            </div>
            <button class="attachment-dl-btn" onclick="window.open('${att.path}')"><i class="fa-solid fa-download"></i></button>
          </div>
        `;
      }
    });
  }

  // Reply reference markup
  let replyHtml = '';
  if (msg.replyTo) {
    const replyDecrypted = decryptContentE2EE(msg.replyTo.encryptedContent, msg.replyTo.iv, key);
    const replySenderId = msg.replyTo.sender ? (msg.replyTo.sender._id || msg.replyTo.sender) : null;
    const isReplySelf = replySenderId === currentId;

    replyHtml = `
      <div class="message-reply-ref" onclick="scrollToMessage('msg-row-${msg.replyTo._id}')">
        <span class="reply-ref-user">${isReplySelf ? 'You' : 'Reply'}</span>
        <span>${replyDecrypted || '📷 File Attachment'}</span>
      </div>
    `;
  }

  // Emoji Reactions pills
  const reactionsPills = msg.reactions && msg.reactions.length > 0
    ? `<div class="message-reactions">${renderReactionsList(msg.reactions)}</div>`
    : '';

  // Options context triggers
  const actionTriggerHtml = `
    <div class="dropdown-wrapper">
      <div class="bubble-action-trigger" onclick="toggleBubbleDropdown('${msg._id}')"><i class="fa-solid fa-angle-down"></i></div>
      <div id="bubble-dropdown-${msg._id}" class="dropdown-menu bottom-up">
        <button onclick="setReplyMessage('${msg._id}', '${escapeHtml(messageContent)}')"><i class="fa-solid fa-reply"></i> Reply</button>
        <button onclick="handlePinMessage('${msg._id}')"><i class="fa-solid fa-thumbtack"></i> Pin Message</button>
        <button onclick="triggerTextToSpeech('${escapeHtml(messageContent)}')"><i class="fa-solid fa-volume-high"></i> Listen Speech</button>
        <button onclick="triggerTranslateMessage('${msg._id}', '${escapeHtml(messageContent)}')"><i class="fa-solid fa-language"></i> Translate</button>
        <button onclick="handleDeleteMessage('${msg._id}', 'me')"><i class="fa-solid fa-trash"></i> Delete for me</button>
        ${isSelf ? `<button onclick="handleDeleteMessage('${msg._id}', 'everyone')"><i class="fa-solid fa-trash-can"></i> Delete for everyone</button>` : ''}
      </div>
    </div>
  `;

  const italicStyle = msg.isSystem ? 'style="font-style: italic; opacity: 0.6;"' : '';

  row.innerHTML = `
    ${isSelf ? actionTriggerHtml : ''}
    <div class="message-bubble">
      ${replyHtml}
      ${attachmentsHtml}
      <span id="msg-text-${msg._id}" ${italicStyle}>${escapeHtml(messageContent)}</span>
      <div class="message-meta">
        <span>${formatTime(msg.createdAt)}</span>
        ${isSelf ? `<i class="fa-solid fa-check-double read-receipt ${msg.readBy && msg.readBy.length > 0 ? 'read' : ''}"></i>` : ''}
      </div>
      ${reactionsPills}
    </div>
    ${!isSelf ? actionTriggerHtml : ''}
  `;

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  // Perform AI reply suggestion check for peer messages
  if (!isSelf && !msg.isSystem) {
    generateSmartReplies(messageContent);
  }
}

// Render reactions list helper
function renderReactionsList(reactions) {
  // Aggregate emoji counts
  const counts = {};
  reactions.forEach(r => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  });
  return Object.keys(counts).map(emoji => `
    <span class="reaction-pill" onclick="handleEmojiReaction(null, '${emoji}')">
      <span>${emoji}</span>
      <strong>${counts[emoji]}</strong>
    </span>
  `).join('');
}

// Voice Note player action
function playVoiceNote(path, btn) {
  const audio = new Audio(path);
  const fill = btn.parentElement.querySelector('.voice-progress-fill');
  btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  
  audio.play();
  audio.ontimeupdate = () => {
    const pct = (audio.currentTime / audio.duration) * 100;
    fill.style.width = `${pct}%`;
  };
  audio.onended = () => {
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    fill.style.width = '0%';
  };
}

// Context menu triggers
function toggleBubbleDropdown(msgId) {
  document.getElementById(`bubble-dropdown-${msgId}`).classList.toggle('active');
}

// Send Chat Message Action
async function sendMessage() {
  const input = document.getElementById('message-text-input');
  const text = input.value.trim();
  const fileInput = document.getElementById('attachment-input');
  
  if (!text && fileInput.files.length === 0) return;

  const key = getChatE2EEKey(activeChatId);
  
  // Encrypt plaintext locally
  const encrypted = encryptContentE2EE(text, key);

  const formData = new FormData();
  formData.append('chatId', activeChatId);
  formData.append('encryptedContent', encrypted.ciphertext);
  formData.append('iv', encrypted.iv);
  
  if (replyingToMessageId) {
    formData.append('replyTo', replyingToMessageId);
  }
  if (disappearingSeconds > 0) {
    formData.append('disappearSeconds', disappearingSeconds);
  }
  if (scheduledDeliveryTime) {
    formData.append('scheduledFor', scheduledDeliveryTime);
  }

  // Files
  if (fileInput.files.length > 0) {
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('attachments', fileInput.files[i]);
    }
  }

  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` },
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      input.value = '';
      fileInput.value = '';
      cancelReply();
      
      if (scheduledDeliveryTime) {
        alert('Message scheduled successfully');
        scheduledDeliveryTime = null;
      } else {
        appendMessageToUI(data.message);
      }
      
      loadChatsList();
      window.socket.emit('stop-typing', { chatId: activeChatId, username: currentUser.username });
    }
  } catch (err) {
    console.error(err);
    alert('Failed to send message');
  }
}

// Keyboard typing indicator trigger
let typingTimeout = null;
function handleInputTyping() {
  if (!activeChatId) return;

  window.socket.emit('typing', { chatId: activeChatId, username: currentUser.username });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    window.socket.emit('stop-typing', { chatId: activeChatId, username: currentUser.username });
  }, 2000);
}

// Reactions action
async function handleEmojiReaction(messageId, emoji) {
  const targetId = messageId || selectedMessageId; // fallback
  try {
    const res = await fetch(`/api/messages/${targetId}/react`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ emoji })
    });
    const data = await res.json();
    if (data.success && activeChatId) {
      loadChatMessages(activeChatId);
    }
  } catch (err) {
    console.error(err);
  }
}

function updateMessageReactionsUI(messageId, reactions) {
  const row = document.getElementById(`msg-row-${messageId}`);
  if (row) {
    let container = row.querySelector('.message-reactions');
    if (!container) {
      container = document.createElement('div');
      container.className = 'message-reactions';
      row.querySelector('.message-bubble').appendChild(container);
    }
    container.innerHTML = renderReactionsList(reactions);
    if (reactions.length === 0) container.remove();
  }
}

// Pin message
async function handlePinMessage(messageId) {
  try {
    const res = await fetch(`/api/messages/${messageId}/pin`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      alert('Message pinned!');
      loadChatMessages(activeChatId);
    }
  } catch (err) {
    console.error(err);
  }
}

// Delete Message API
async function handleDeleteMessage(messageId, deleteType) {
  if (deleteType === 'everyone' && !confirm('Delete message for everyone?')) return;

  try {
    const res = await fetch(`/api/messages/${messageId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ deleteType })
    });
    const data = await res.json();
    if (data.success) {
      if (deleteType === 'everyone') {
        loadChatMessages(activeChatId);
      } else {
        document.getElementById(`msg-row-${messageId}`).remove();
      }
    }
  } catch (err) {
    console.error(err);
  }
}

// Mic Microphone Recording Note
async function toggleVoiceRecording() {
  const btn = document.getElementById('voice-record-btn');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    btn.classList.remove('recording');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioFile = new File([audioBlob], `voice_note_${Date.now()}.webm`, { type: 'audio/webm' });
      
      // Inject into attachment input manually
      const fileInput = document.getElementById('attachment-input');
      
      // Create DataTransfer container
      const container = new DataTransfer();
      container.items.add(audioFile);
      fileInput.files = container.files;

      alert('Voice recording captured! Ready to send.');
    };

    mediaRecorder.start();
    btn.classList.add('recording');
  } catch (err) {
    console.error(err);
    alert('Microphone access denied');
  }
}

// Native Text-to-Speech Readout
function triggerTextToSpeech(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  } else {
    alert('Text-to-speech not supported on this browser');
  }
}

// Native Voice-to-Text Input dictation
function triggerVoiceToTextInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert('Speech recognition not supported');

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.onstart = () => alert('Listening... speak now.');
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('message-text-input').value += transcript;
  };
  recognition.start();
}

// Dynamic Smart Replies Generator based on content
function generateSmartReplies(text) {
  const lower = text.toLowerCase();
  let suggestions = [];

  if (lower.includes('hello') || lower.includes('hi')) {
    suggestions = ['Hello!', 'Hey there!', 'Hi, how are you?'];
  } else if (lower.includes('how are you')) {
    suggestions = ['Doing great!', 'All good, you?', 'Pretty busy today.'];
  } else if (lower.includes('ready') || lower.includes('call')) {
    suggestions = ['Yes, ready!', 'Give me 5 mins.', 'Can we call later?'];
  } else if (lower.includes('thank')) {
    suggestions = ['Welcome!', 'No problem.', 'Sure thing!'];
  }

  // Render smart suggestions row above input bar
  let container = document.getElementById('smart-replies-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'smart-replies-container';
    container.style = 'display: flex; gap: 8px; padding: 8px 24px; background: var(--hover-bg); overflow-x: auto;';
    document.getElementById('chat-active-panel').insertBefore(container, document.querySelector('.chat-input-bar'));
  }

  if (suggestions.length === 0) {
    container.remove();
    return;
  }

  container.innerHTML = suggestions.map(s => `
    <button class="btn btn-sm btn-secondary" style="border-radius: 20px; font-size: 11px;" onclick="sendSmartReply('${escapeHtml(s)}')">${s}</button>
  `).join('');
}

function sendSmartReply(text) {
  document.getElementById('message-text-input').value = text;
  sendMessage();
  const container = document.getElementById('smart-replies-container');
  if (container) container.remove();
}

// Translation Handler Mock
function triggerTranslateMessage(msgId, text) {
  // Let's simulate a translation directly (e.g. translate to French/Spanish)
  const translations = {
    'hello': 'Hola (Spanish)',
    'how are you': '¿Cómo estás? (Spanish)',
    'ready': 'Listo (Spanish)',
    'thank you': 'Gracias (Spanish)'
  };

  let translated = `Traducido: ${text} (Spanish Mock)`;
  const lower = text.toLowerCase().trim();
  
  for (const key in translations) {
    if (lower.includes(key)) {
      translated = translations[key];
      break;
    }
  }

  alert(`Translation:\n${translated}`);
}

// E2EE DM Navigation Helper
async function startDirectChat(userId) {
  try {
    const res = await fetch('/api/messages/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        isGroup: false,
        participants: [userId]
      })
    });
    const data = await res.json();
    if (data.success) {
      loadChatsList();
      selectActiveChat(data.chat._id);
    }
  } catch (err) {
    console.error(err);
  }
}

// Pin panel helper
function togglePinPanel() {
  const banner = document.getElementById('pinned-messages-banner');
  banner.classList.toggle('hidden');
}

// Reply state
function setReplyMessage(msgId, previewText) {
  replyingToMessageId = msgId;
  const bar = document.getElementById('reply-preview-container');
  document.getElementById('reply-preview-text').innerText = previewText;
  bar.classList.remove('hidden');
}

function cancelReply() {
  replyingToMessageId = null;
  document.getElementById('reply-preview-container').classList.add('hidden');
}

// Disappearing timers
function toggleDisappearingDropdown() {
  document.getElementById('disappearing-dropdown').classList.toggle('active');
}

function setDisappearingTimer(seconds, label) {
  disappearingSeconds = seconds;
  document.getElementById('disappearing-btn').innerHTML = `<i class="fa-solid fa-clock"></i> ${label}`;
  document.getElementById('disappearing-dropdown').classList.remove('active');
}

// Scheduled Message options
function openScheduledMessageModal() {
  document.getElementById('schedule-message-modal').classList.add('active');
}

function closeScheduledMessageModal() {
  document.getElementById('schedule-message-modal').classList.remove('active');
}

function saveScheduledMessageSettings() {
  const time = document.getElementById('schedule-time-input').value;
  if (!time) return alert('Please select a valid time');
  
  scheduledDeliveryTime = new Date(time).toISOString();
  alert(`Scheduled message active for: ${new Date(time).toLocaleString()}`);
  closeScheduledMessageModal();
}

// Helper block user trigger
async function handleBlockToggle() {
  // Find peer participant
  const peer = currentChatParticipants.find(p => p._id !== currentUser.id);
  if (!peer) return;

  const isBlocked = myBlockedUsers.some(b => b._id === peer._id);
  const url = isBlocked ? '/api/users/unblock' : '/api/users/block';
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ targetUserId: peer._id })
    });
    const data = await res.json();
    if (data.success) {
      alert(isBlocked ? 'User unblocked!' : 'User blocked!');
      loadContactsList();
      selectActiveChat(activeChatId);
    }
  } catch (err) {
    console.error(err);
  }
}

// Attachments file input
function triggerAttachmentSelect() {
  document.getElementById('attachment-input').click();
}

function handleFilesSelected() {
  const files = document.getElementById('attachment-input').files;
  if (files.length > 0) {
    alert(`${files.length} file(s) attached and ready for upload.`);
  }
}

// HTML Character Escaping helper
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function scrollToMessage(rowId) {
  const el = document.getElementById(rowId);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
