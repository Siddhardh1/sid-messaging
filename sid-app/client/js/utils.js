// ==================== SECURITY & UTILITIES ====================

// Derive a cryptographic key from a passphrase/secret using SHA256
function deriveE2EEKey(passphrase) {
  if (!passphrase) return null;
  return CryptoJS.SHA256(passphrase).toString();
}

// Get or derive chat-specific E2EE key cached in sessionStorage
function getChatE2EEKey(chatId) {
  if (!chatId) return null;
  let key = sessionStorage.getItem(`e2ee_key_${chatId}`);
  if (!key) {
    key = deriveE2EEKey(chatId + '_secure_e2ee_passphrase');
    sessionStorage.setItem(`e2ee_key_${chatId}`, key);
  }
  return key;
}

// Encrypt plaintext using AES-256 (returns { ciphertext, iv })
function encryptContentE2EE(plaintext, key) {
  if (!plaintext || !key) return { ciphertext: '', iv: '' };
  
  // Generate random initialization vector
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plaintext, CryptoJS.enc.Hex.parse(key), {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });

  return {
    ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
    iv: iv.toString(CryptoJS.enc.Hex)
  };
}

// Decrypt E2EE ciphertext using key and IV
function decryptContentE2EE(ciphertext, ivHex, key) {
  if (!ciphertext || !ivHex || !key) return '';

  try {
    const iv = CryptoJS.enc.Hex.parse(ivHex);
    const decrypted = CryptoJS.AES.decrypt(ciphertext, CryptoJS.enc.Hex.parse(key), {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    console.error('Decryption failed:', err);
    return '[Decryption Failure: Check Encryption Keys]';
  }
}

// Format date into human-readable format
function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

// Format bytes size
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Utility to convert ArrayBuffer to Base64url (for WebAuthn APIs)
function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Utility to convert Base64url to Uint8Array (for WebAuthn verification)
function base64urlToBuffer(base64url) {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Client-side image resize and JPEG compression helper
function compressAndResizeImage(file, maxWidth, maxHeight, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Adjust dimensions preserving aspect ratio
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to compressed jpeg Base64 (70% quality)
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
      callback(compressedBase64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
