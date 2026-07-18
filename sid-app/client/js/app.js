// ==================== APP ROUTER & WORKSPACE INITIALIZER ====================

document.addEventListener('DOMContentLoaded', () => {
  // Check auth session immediately
  checkAuthStatus();

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('Service Worker Registered'))
      .catch(err => console.error('Service Worker Registration Failed:', err));
  }

  // Request Notification Permissions if supported
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // Set up responsive visibility listeners
  window.addEventListener('resize', handleWindowResize);

  // Close active modals on Escape key press
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModals = document.querySelectorAll('.modal-overlay.active');
      activeModals.forEach(modal => {
        if (modal.id === 'profile-modal') {
          if (typeof closeProfileModal === 'function') closeProfileModal();
        } else if (modal.id === 'add-contact-modal') {
          if (typeof closeAddContactModal === 'function') closeAddContactModal();
        } else if (modal.id === 'create-group-modal') {
          if (typeof closeCreateGroupModal === 'function') closeCreateGroupModal();
        } else if (modal.id === 'mfa-setup-modal') {
          if (typeof closeMfaSetupModal === 'function') closeMfaSetupModal();
        } else {
          modal.classList.remove('active');
        }
      });
    }
  });

  // Handle enter key press on chat textarea to send message
  document.getElementById('message-text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
});

// SPA view visibility switcher
function showScreen(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(screen => {
    if (screen.id === screenId) {
      screen.classList.add('active');
    } else {
      screen.classList.remove('active');
    }
  });
}

// Switch between dashboard panels (Chats, Contacts, Calls)
function switchDashboardTab(tabName) {
  const tabs = ['chats', 'contacts', 'calls'];
  
  tabs.forEach(tab => {
    const list = document.getElementById(`${tab}-list`);
    if (tab === tabName) {
      list.classList.add('active');
    } else {
      list.classList.remove('active');
    }
  });

  // Toggle active class on sidebar icons
  const navIcons = document.querySelectorAll('.nav-icon');
  navIcons.forEach(btn => btn.classList.remove('active'));

  const titleEl = document.getElementById('sidebar-title');

  if (tabName === 'chats') {
    navIcons[0].classList.add('active');
    titleEl.innerText = 'Chats';
    loadChatsList();
  } else if (tabName === 'contacts') {
    navIcons[1].classList.add('active');
    titleEl.innerText = 'Contacts';
    loadContactsList();
  } else if (tabName === 'calls') {
    navIcons[2].classList.add('active');
    titleEl.innerText = 'Call Logs';
    loadCallsHistory();
  }
}

// Initialise dashboards loaders
function initializeMainDashboard() {
  // Bind Socket connection
  initializeSocket();
  // Bind Call handshakes listeners
  initializeCallSignaling();
  
  // Load Chats first
  loadChatsList();
  
  // Set avatar in nav top
  const userAvatar = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`;
  document.getElementById('my-avatar').src = userAvatar;
}

// Get and render call logs history
async function loadCallsHistory() {
  const container = document.getElementById('calls-sublist');
  if (!container) return;

  try {
    const res = await fetch('/api/calls/history', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      if (data.calls.length === 0) {
        container.innerHTML = `
          <div class="empty-state-list">
            <i class="fa-solid fa-phone"></i>
            <p>No call history logs</p>
          </div>
        `;
        return;
      }

      container.innerHTML = data.calls.map(call => {
        const isCaller = call.caller._id === currentUser.id;
        const peer = isCaller ? (call.participants[0] || { username: 'Group Call' }) : call.caller;
        const peerAvatar = peer.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${peer.username}`;
        
        let directionIcon = '<i class="fa-solid fa-phone-arrow-down-left text-success"></i>'; // incoming
        if (isCaller) {
          directionIcon = '<i class="fa-solid fa-phone-arrow-up-right text-accent"></i>'; // outgoing
        }
        if (call.status === 'ringing') {
          directionIcon = '<i class="fa-solid fa-phone-slash text-danger"></i>'; // missed/failed
        }

        const typeIcon = call.type === 'video' ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-phone"></i>';
        const formattedDate = formatDate(call.createdAt) + ' ' + formatTime(call.createdAt);

        return `
          <div class="chat-item">
            <div class="chat-item-avatar">
              <img src="${peerAvatar}" alt="User">
            </div>
            <div class="chat-item-info">
              <div class="chat-item-header">
                <span class="chat-item-name">${peer.username}</span>
                <span class="chat-item-time">${typeIcon}</span>
              </div>
              <div class="chat-item-sub">
                <span class="chat-item-preview">${directionIcon} ${formattedDate} (${call.duration || 0}s)</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error fetching calls history:', err);
  }
}

// Scheduled Call controllers
function openScheduleCallModal() {
  const select = document.getElementById('schedule-call-chat');
  if (myContacts.length === 0) {
    alert('Please add contacts before scheduling calls');
    return;
  }

  // Populate chats options
  select.innerHTML = myContacts.map(c => `
    <option value="${c._id}">${c.username}</option>
  `).join('');

  document.getElementById('schedule-call-modal').classList.add('active');
}

function closeScheduleCallModal() {
  document.getElementById('schedule-call-modal').classList.remove('active');
}

async function submitScheduledCall() {
  const select = document.getElementById('schedule-call-chat');
  const targetUserId = select.value;
  const time = document.getElementById('schedule-call-time').value;

  if (!time) return alert('Select scheduled date & time');

  try {
    const res = await fetch('/api/calls/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        participants: [targetUserId],
        scheduledFor: new Date(time).toISOString(),
        type: 'video'
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Video call scheduled successfully!');
      closeScheduleCallModal();
      loadCallsHistory(); // refresh
    }
  } catch (err) {
    console.error(err);
    alert('Server error scheduling call');
  }
}

// Mobile responsive drawer handlers
function closeActiveChatMobile() {
  document.getElementById('chat-screen').querySelector('.chat-workspace').classList.remove('active-mobile');
  document.getElementById('chat-screen').querySelector('.app-sidebar').classList.remove('hidden-mobile');
  if (activeChatId) {
    window.socket.emit('leave-chat', activeChatId);
    activeChatId = null;
  }
  loadChatsList();
}

function handleWindowResize() {
  if (window.innerWidth > 768) {
    // Show both side panel and chat area on desktop
    document.getElementById('chat-screen').querySelector('.chat-workspace').classList.remove('active-mobile');
    document.getElementById('chat-screen').querySelector('.app-sidebar').classList.remove('hidden-mobile');
  }
}

// Generic search bar routing
function handleSidebarSearch(query) {
  const container = document.getElementById('chats-list');
  if (!container) return;

  const chatItems = container.querySelectorAll('.chat-item');
  chatItems.forEach(item => {
    const name = item.querySelector('.chat-item-name').innerText.toLowerCase();
    if (name.includes(query.toLowerCase())) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}
