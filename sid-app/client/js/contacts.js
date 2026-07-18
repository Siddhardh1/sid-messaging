// ==================== CONTACTS & GROUPS MANAGER ====================

let myContacts = [];
let myBlockedUsers = [];

// Fetch and render contacts sidebar list
async function loadContactsList() {
  try {
    const res = await fetch('/api/users/contacts', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      myContacts = data.contacts;
      myBlockedUsers = data.blockedUsers;
      renderContacts();
    }
  } catch (err) {
    console.error('Error loading contacts:', err);
  }
}

// Render contacts to sidebar list
function renderContacts() {
  const container = document.getElementById('contacts-sublist');
  if (!container) return;

  if (myContacts.length === 0) {
    container.innerHTML = `
      <div class="empty-state-list">
        <i class="fa-regular fa-address-book"></i>
        <p>No contacts added yet</p>
      </div>
    `;
    return;
  }

  container.innerHTML = myContacts.map(contact => {
    const isOnline = contact.lastSeen && (new Date() - new Date(contact.lastSeen) < 60000);
    const statusText = contact.settings.showLastSeen ? (isOnline ? 'Online' : `Last seen ${formatDate(contact.lastSeen)}`) : 'Offline';
    const statusDotClass = isOnline ? 'status-indicator' : 'status-indicator offline';
    const avatar = contact.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${contact.username}`;

    return `
      <div class="chat-item" onclick="startDirectChat('${contact._id}')">
        <div class="chat-item-avatar">
          <img src="${avatar}" alt="${contact.username}">
          <div class="${statusDotClass}"></div>
        </div>
        <div class="chat-item-info">
          <div class="chat-item-header">
            <span class="chat-item-name">${contact.username}</span>
          </div>
          <div class="chat-item-sub">
            <span class="chat-item-preview">${statusText}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Add New Contact search input trigger
async function handleContactSearch(query) {
  const resultsContainer = document.getElementById('contact-search-results');
  if (!query.trim()) {
    resultsContainer.innerHTML = '';
    return;
  }

  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      if (data.users.length === 0) {
        resultsContainer.innerHTML = '<p class="font-sm text-center py-2">No matching users found</p>';
        return;
      }

      resultsContainer.innerHTML = data.users.map(user => {
        const avatar = user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
        const isAlreadyContact = myContacts.some(c => c._id === user._id);
        const isBlocked = myBlockedUsers.some(b => b._id === user._id);

        let actionBtn = `<button class="btn btn-sm btn-primary" onclick="addContact('${user._id}')">Add</button>`;
        if (isAlreadyContact) {
          actionBtn = `<span class="font-sm text-muted"><i class="fa-solid fa-check"></i> Added</span>`;
        } else if (isBlocked) {
          actionBtn = `<span class="font-sm text-danger"><i class="fa-solid fa-ban"></i> Blocked</span>`;
        }

        return `
          <div class="result-item">
            <div class="chat-target-info">
              <div class="avatar-wrapper" style="width: 36px; height: 36px;">
                <img src="${avatar}" alt="${user.username}" style="width: 100%; height: 100%; border-radius: 50%;">
              </div>
              <span class="font-sm font-weight-bold" style="color: var(--text-primary);">${user.username}</span>
            </div>
            ${actionBtn}
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error searching contacts:', err);
  }
}

// Add user to contacts database API
async function addContact(contactId) {
  try {
    const res = await fetch('/api/users/contacts/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ contactId })
    });
    const data = await res.json();
    if (data.success) {
      alert('Contact added!');
      loadContactsList();
      closeAddContactModal();
    } else {
      alert(data.message || 'Error adding contact');
    }
  } catch (err) {
    console.error(err);
    alert('Server error adding contact');
  }
}

// UI trigger modal helper scripts
function openAddContactModal() {
  document.getElementById('add-contact-modal').classList.add('active');
}

function closeAddContactModal() {
  document.getElementById('add-contact-modal').classList.remove('active');
  document.getElementById('contact-search-input').value = '';
  document.getElementById('contact-search-results').innerHTML = '';
}

// Group Creation
function openCreateGroupModal() {
  const container = document.getElementById('group-members-list');
  if (myContacts.length === 0) {
    container.innerHTML = '<p class="font-sm text-muted">You need contacts to create a group.</p>';
    document.getElementById('create-group-modal').classList.add('active');
    return;
  }

  container.innerHTML = myContacts.map(contact => `
    <label class="result-item" style="cursor: pointer;">
      <div class="chat-target-info">
        <input type="checkbox" name="group-members" value="${contact._id}" style="margin-right: 10px;">
        <span class="font-sm">${contact.username}</span>
      </div>
    </label>
  `).join('');

  document.getElementById('create-group-modal').classList.add('active');
}

function closeCreateGroupModal() {
  document.getElementById('create-group-modal').classList.remove('active');
  document.getElementById('group-name-input').value = '';
}

async function submitCreateGroup() {
  const groupName = document.getElementById('group-name-input').value.trim();
  const checkboxes = document.querySelectorAll('input[name="group-members"]:checked');
  
  if (!groupName) {
    alert('Please enter a group name');
    return;
  }
  
  const participants = Array.from(checkboxes).map(cb => cb.value);
  if (participants.length === 0) {
    alert('Please select at least one member');
    return;
  }

  try {
    const res = await fetch('/api/messages/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        isGroup: true,
        name: groupName,
        participants
      })
    });
    const data = await res.json();

    if (data.success) {
      closeCreateGroupModal();
      loadChatsList();
      selectActiveChat(data.chat._id);
    } else {
      alert(data.message || 'Error creating group');
    }
  } catch (err) {
    console.error(err);
    alert('Server error creating group');
  }
}
