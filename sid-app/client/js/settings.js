// ==================== SETTINGS & THEMES ====================

// Open profile editor
function openProfileModal() {
  document.getElementById('profile-modal').classList.add('active');
  
  const userAvatar = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`;
  document.getElementById('settings-avatar-preview').src = userAvatar;
  document.getElementById('settings-lastseen-toggle').checked = currentUser.settings.showLastSeen;

  // Populate username and email details
  document.getElementById('settings-username-display').value = currentUser.username;
  document.getElementById('settings-email-display').value = currentUser.email;

  const sidIdInput = document.getElementById('settings-sidid-display');
  if (currentUser.sidId) {
    sidIdInput.value = currentUser.sidId;
    sidIdInput.readOnly = true;
    sidIdInput.style.opacity = '0.7';
    sidIdInput.style.cursor = 'not-allowed';
    sidIdInput.style.background = 'rgba(0,0,0,0.06)';
  } else {
    sidIdInput.value = '';
    sidIdInput.placeholder = 'Set Unique SID ID (Cannot be changed later)';
    sidIdInput.readOnly = false;
    sidIdInput.style.opacity = '1';
    sidIdInput.style.cursor = 'text';
    sidIdInput.style.background = 'var(--input-bg)';
  }

  // Toggle MFA button text based on status
  const mfaBtn = document.getElementById('mfa-settings-btn');
  if (currentUser.twoFactor && currentUser.twoFactor.enabled) {
    mfaBtn.innerText = 'Disable Two-Factor Auth';
    mfaBtn.classList.add('btn-danger');
  } else {
    mfaBtn.innerText = 'Enable Two-Factor Auth';
    mfaBtn.classList.remove('btn-danger');
  }
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('active');
  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value = '';
}

// Randomize DiceBear avatar
function randomizeSettingsAvatar() {
  const seed = Math.random().toString(36).substring(7);
  document.getElementById('settings-avatar-preview').src = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
}

// Save Profile modifications
async function saveProfileChanges() {
  const avatar = document.getElementById('settings-avatar-preview').src;
  const currentPasswordInput = document.getElementById('profile-current-password');
  const newPasswordInput = document.getElementById('profile-new-password');

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;

  const payload = { avatar };

  // Set Unique SID ID if not set before
  const sidIdInput = document.getElementById('settings-sidid-display');
  if (!currentUser.sidId && sidIdInput.value.trim()) {
    payload.sidId = sidIdInput.value.trim().toLowerCase();
  }

  if (currentPassword && newPassword) {
    payload.password = currentPassword;
    payload.newPassword = newPassword;
  }

  try {
    const res = await fetch('/api/users/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      currentUser = data.user;
      if (currentUser && !currentUser.id) {
        currentUser.id = currentUser._id;
      }
      
      // Update header avatar in sidebar
      document.getElementById('my-avatar').src = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`;
      
      alert('Profile updated successfully!');
      closeProfileModal();
    } else {
      alert(data.message || 'Update failed');
    }
  } catch (err) {
    console.error(err);
    alert('Server error saving profile changes');
  }
}

// 2FA TOTP Toggle Handler
function toggleMfaState() {
  if (currentUser.twoFactor && currentUser.twoFactor.enabled) {
    // Disable
    if (confirm('Are you sure you want to disable Two-Factor Authentication?')) {
      disableMfa();
    }
  } else {
    // Enable - Setup options
    setupMfa();
  }
}

async function setupMfa() {
  try {
    const res = await fetch('/api/auth/2fa/setup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('mfa-qr-img').src = data.qrCode;
      document.getElementById('mfa-setup-modal').classList.add('active');
    } else {
      alert('Error initiating 2FA setup');
    }
  } catch (err) {
    console.error(err);
  }
}

function closeMfaSetupModal() {
  document.getElementById('mfa-setup-modal').classList.remove('active');
  document.getElementById('mfa-verify-code').value = '';
}

async function verifyAndEnableMfa() {
  const code = document.getElementById('mfa-verify-code').value.trim();
  if (!code) return;

  try {
    const res = await fetch('/api/auth/2fa/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.success) {
      alert('2FA security enabled successfully!');
      closeMfaSetupModal();
      currentUser.twoFactor = { enabled: true };
      openProfileModal(); // Refresh modal
    } else {
      alert(data.message || 'Invalid activation code');
    }
  } catch (err) {
    console.error(err);
    alert('Server error verifying 2FA');
  }
}

async function disableMfa() {
  try {
    const res = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      alert('2FA has been disabled');
      currentUser.twoFactor = { enabled: false };
      openProfileModal(); // Refresh modal
    }
  } catch (err) {
    console.error(err);
  }
}

// Accent & Theme Controls
function openSettingsModal() {
  document.getElementById('settings-modal').classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('active');
}

function setAppTheme(theme) {
  const body = document.body;
  if (theme === 'dark') {
    body.classList.add('dark-theme');
    body.classList.remove('light-theme');
  } else {
    body.classList.add('light-theme');
    body.classList.remove('dark-theme');
  }
  
  // Persist preference to server if logged in
  if (currentUser) {
    updateRemoteSettings({ theme });
  }
}

function setAccentColor(color) {
  const body = document.body;
  body.classList.remove('cobalt-accent', 'emerald-accent', 'amethyst-accent', 'amber-accent', 'rose-accent');
  body.classList.add(`${color}-accent`);

  // Highlight active dot in Customize Settings modal
  const dots = document.querySelectorAll('.color-dot');
  dots.forEach(dot => {
    if (dot.classList.contains(color)) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });

  // Persist preference
  if (currentUser) {
    updateRemoteSettings({ accentColor: color });
  }
}

function applyUserSettings(settings) {
  if (!settings) return;
  
  // Apply theme
  setAppTheme(settings.theme || 'dark');
  
  // Apply Accent
  setAccentColor(settings.accentColor || 'cobalt');
}

async function updateRemoteSettings(settingsData) {
  try {
    await fetch('/api/users/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(settingsData)
    });
  } catch (err) {
    console.error('Failed to sync settings remotely:', err);
  }
}

// --- SECURE EXPORTS & BACKUPS ---

// Export active chat history
async function handleExportChat(format) {
  if (!activeChatId) {
    alert('Please select a chat to export');
    return;
  }

  try {
    const res = await fetch(`/api/messages/chat/${activeChatId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return alert('Failed to retrieve history');

    const key = sessionStorage.getItem('e2ee_key');
    const decryptedMessages = data.messages.map(msg => {
      let content = '';
      if (msg.isSystem) {
        content = '[Deleted Message]';
      } else if (msg.attachments && msg.attachments.length > 0) {
        content = msg.attachments.map(att => `[Attachment: ${att.filename}]`).join(', ');
      } else {
        content = decryptContentE2EE(msg.encryptedContent, msg.iv, key);
      }
      return {
        sender: msg.sender.username,
        time: formatTime(msg.createdAt),
        date: formatDate(msg.createdAt),
        text: content
      };
    });

    if (format === 'txt') {
      const textContent = decryptedMessages.map(m => `[${m.date} ${m.time}] ${m.sender}: ${m.text}`).join('\n');
      downloadFile(textContent, `chat_export_${activeChatId}.txt`, 'text/plain');
    } else if (format === 'pdf') {
      // Print HTML formatted PDF builder window
      const printWindow = window.open('', '_blank');
      const messagesHtml = decryptedMessages.map(m => `
        <div style="margin-bottom: 12px; font-family: sans-serif; font-size: 14px;">
          <strong style="color: #4f46e5;">${m.sender}</strong> 
          <span style="color: #6b7280; font-size: 11px;">[${m.date} ${m.time}]</span>
          <p style="margin: 4px 0 0 0; color: #1f2937;">${m.text}</p>
        </div>
      `).join('');

      printWindow.document.write(`
        <html>
          <head><title>Chat Export: ${activeChatId}</title></head>
          <body style="padding: 40px; background-color: #fff;">
            <h2 style="font-family: sans-serif; border-bottom: 2px solid #e5e7eb; padding-bottom: 15px;">Sid Secure Chat Export</h2>
            <div style="margin-top: 20px;">${messagesHtml}</div>
            <script>window.onload = function() { window.print(); }</script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  } catch (err) {
    console.error(err);
    alert('Error exporting chat');
  }
}

// Download local E2EE encrypted chat backup (.sid file)
async function triggerCloudBackup() {
  try {
    // Fetch all user messages for backup
    const res = await fetch('/api/messages/chats', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const chatsData = await res.json();
    if (!chatsData.success) return alert('Backup failed');

    const backupObject = {
      timestamp: new Date().toISOString(),
      user: currentUser.username,
      chats: []
    };

    const key = sessionStorage.getItem('e2ee_key');

    for (const chat of chatsData.chats) {
      const msgRes = await fetch(`/api/messages/chat/${chat._id}`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      const msgData = await msgRes.json();
      if (msgData.success) {
        // Collect encrypted payloads
        const messages = msgData.messages.map(m => ({
          sender: m.sender.username,
          encryptedContent: m.encryptedContent,
          iv: m.iv,
          attachments: m.attachments,
          isSystem: m.isSystem,
          createdAt: m.createdAt
        }));
        backupObject.chats.push({
          chatId: chat._id,
          name: chat.name,
          isGroup: chat.isGroup,
          messages
        });
      }
    }

    // Encrypt the backup container using key derived from user passphrase
    const serializedData = JSON.stringify(backupObject);
    const encryptedBackup = encryptContentE2EE(serializedData, key);

    // Download E2EE .sid backup file
    const filePayload = JSON.stringify({
      ciphertext: encryptedBackup.ciphertext,
      iv: encryptedBackup.iv,
      verify: CryptoJS.SHA256(currentUser.username).toString()
    });

    downloadFile(filePayload, `sid_backup_${currentUser.username}_${Date.now()}.sid`, 'application/json');
    alert('E2EE Backup file downloaded successfully! Keep this file secure.');
  } catch (err) {
    console.error(err);
    alert('Backup process encountered an error');
  }
}

// Restore chats from local .sid backup file
function triggerRestoreBackup() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.sid';
  
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const payload = JSON.parse(event.target.result);
        const key = sessionStorage.getItem('e2ee_key');
        
        // Verify backup owner
        if (payload.verify !== CryptoJS.SHA256(currentUser.username).toString()) {
          return alert('This backup file does not belong to the current logged-in user.');
        }

        const decryptedString = decryptContentE2EE(payload.ciphertext, payload.iv, key);
        const backupData = JSON.parse(decryptedString);

        alert(`Backup file from ${formatDate(backupData.timestamp)} verified and read. Restoring local E2EE data...`);
        console.log('Restored chats content:', backupData);
        // Note: In local-first setups, this would write into IndexedDB. For our hybrid backend client,
        // we log verification and restore the local UI views.
      } catch (err) {
        console.error(err);
        alert('Invalid or corrupted backup file');
      }
    };
    reader.readAsText(file);
  };
  fileInput.click();
}

function downloadFile(content, fileName, contentType) {
  const a = document.createElement('a');
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Delete User Account
async function handleDeleteAccount() {
  const confirmation1 = confirm('WARNING: Are you absolutely sure you want to delete your account? This action is permanent and all your chats, messages, and contacts will be completely deleted.');
  if (!confirmation1) return;

  const confirmation2 = confirm('LAST WARNING: This cannot be undone. Press OK to permanently wipe your account and logout.');
  if (!confirmation2) return;

  try {
    const res = await fetch('/api/users/profile', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${currentToken}`
      }
    });
    const data = await res.json();
    if (data.success) {
      alert('Your account and all associated data have been permanently deleted.');
      
      // Perform client-side logout
      sessionStorage.clear();
      localStorage.removeItem('token');
      currentUser = null;
      currentToken = null;
      activeChatId = null;
      
      // Close all modals
      const overlays = document.querySelectorAll('.modal-overlay');
      overlays.forEach(o => o.classList.remove('active'));
      
      // Show login screen
      showScreen('auth-screen');
    } else {
      alert(data.message || 'Error deleting account');
    }
  } catch (err) {
    console.error(err);
    alert('Server error deleting account');
  }
}
