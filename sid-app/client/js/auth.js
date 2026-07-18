// ==================== AUTHENTICATION & ACCESS ====================

let currentUser = null;
let currentToken = localStorage.getItem('sid_token') || null;
let tempMfaToken = null; // Temp holder during 2FA checks

// Check if user is already authenticated
async function checkAuthStatus() {
  if (!currentToken) {
    showScreen('auth-screen');
    return;
  }

  try {
    const res = await fetch('/api/users/profile', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      currentUser = data.user;
      if (currentUser && !currentUser.id) {
        currentUser.id = currentUser._id;
      }
      
      // Generate E2EE key derived from username (simulated local secure key)
      const e2eeKey = deriveE2EEKey(currentUser.username + '_secure_e2ee_passphrase');
      sessionStorage.setItem('e2ee_key', e2eeKey);

      applyUserSettings(currentUser.settings);
      showScreen('chat-screen');
      initializeMainDashboard();
    } else {
      handleLogout();
    }
  } catch (err) {
    console.error('Auth verification failed:', err);
    showScreen('auth-screen');
  }
}

// Standard username/password login
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      if (data.mfaRequired) {
        tempMfaToken = data.tempToken;
        document.getElementById('mfa-overlay').classList.remove('hidden');
      } else {
        loginSuccess(data.token, data.user);
      }
    } else {
      alert(data.message || 'Login failed');
    }
  } catch (err) {
    console.error(err);
    alert('Server error logging in');
  }
}

// 2FA Verification
async function handleMfaVerify(e) {
  e.preventDefault();
  const code = document.getElementById('mfa-code').value.trim();

  try {
    const res = await fetch('/api/auth/login/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, tempToken: tempMfaToken })
    });
    const data = await res.json();

    if (data.success) {
      closeMfaOverlay();
      loginSuccess(data.token, data.user);
    } else {
      alert(data.message || 'Invalid code');
    }
  } catch (err) {
    console.error(err);
    alert('Server error verifying code');
  }
}

function closeMfaOverlay() {
  document.getElementById('mfa-overlay').classList.add('hidden');
  document.getElementById('mfa-code').value = '';
  tempMfaToken = null;
}

let otpTimer = null;
let otpTimeLeft = 30;

// Standard Registration (Phase 1: Send OTP)
async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const sidId = document.getElementById('signup-sidid').value.trim();

  // Save registration fields temporarily in memory
  window.signupData = { username, email, password, sidId };

  try {
    const res = await fetch('/api/auth/register/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, sidId })
    });
    const data = await res.json();

    if (data.success) {
      document.getElementById('otp-modal').classList.add('active');
      startOtpCountdown();
    } else {
      alert(data.message || 'Registration failed');
    }
  } catch (err) {
    console.error(err);
    alert('Server error initiating verification');
  }
}

// 30 Seconds Countdown Timer
function startOtpCountdown() {
  otpTimeLeft = 30;
  document.getElementById('otp-countdown').innerText = otpTimeLeft;
  document.getElementById('otp-timer-text').classList.remove('hidden');
  document.getElementById('otp-resend-btn').classList.add('hidden');

  clearInterval(otpTimer);
  otpTimer = setInterval(() => {
    otpTimeLeft--;
    document.getElementById('otp-countdown').innerText = otpTimeLeft;

    if (otpTimeLeft <= 0) {
      clearInterval(otpTimer);
      document.getElementById('otp-timer-text').classList.add('hidden');
      document.getElementById('otp-resend-btn').classList.remove('hidden');
    }
  }, 1000);
}

// Resend OTP trigger
async function resendSignupOtp() {
  if (!window.signupData) return;
  try {
    const res = await fetch('/api/auth/register/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: window.signupData.username,
        email: window.signupData.email,
        sidId: window.signupData.sidId
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('OTP code resent successfully!');
      startOtpCountdown();
    } else {
      alert(data.message || 'Failed to resend OTP');
    }
  } catch (err) {
    console.error(err);
    alert('Error resending verification code');
  }
}

// Complete Registration (Phase 2: Verify OTP)
async function verifyOtpAndRegister() {
  const otpInput = document.getElementById('otp-verify-code').value.trim();
  if (!otpInput || otpInput.length !== 6) {
    return alert('Please enter the 6-digit OTP code');
  }

  if (!window.signupData) {
    return alert('Signup data missing. Please refresh and try again.');
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: window.signupData.username,
        email: window.signupData.email,
        password: window.signupData.password,
        sidId: window.signupData.sidId,
        otp: otpInput
      })
    });
    const data = await res.json();

    if (data.success) {
      alert('Registration successful!');
      closeOtpModal();
      loginSuccess(data.token, data.user);
    } else {
      alert(data.message || 'Verification failed');
    }
  } catch (err) {
    console.error(err);
    alert('Server error verifying OTP');
  }
}

function closeOtpModal() {
  document.getElementById('otp-modal').classList.remove('active');
  document.getElementById('otp-verify-code').value = '';
  clearInterval(otpTimer);
}

function loginSuccess(token, user) {
  currentToken = token;
  currentUser = user;
  if (currentUser && !currentUser._id) {
    currentUser._id = currentUser.id;
  }
  localStorage.setItem('sid_token', token);
  
  // Deriving E2EE session key locally
  const e2eeKey = deriveE2EEKey(user.username + '_secure_e2ee_passphrase');
  sessionStorage.setItem('e2ee_key', e2eeKey);

  applyUserSettings(user.settings);
  showScreen('chat-screen');
  initializeMainDashboard();
}

function handleLogout() {
  if (!confirm('Are you sure you want to log out?')) return;
  
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('sid_token');
  sessionStorage.removeItem('e2ee_key');
  
  if (window.socket) {
    window.socket.disconnect();
  }

  showScreen('auth-screen');
}

// Switch UI forms tabs
function switchAuthTab(tab) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');

  if (tab === 'login') {
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
  } else {
    loginForm.classList.remove('active');
    signupForm.classList.add('active');
    tabLogin.classList.remove('active');
    tabSignup.classList.add('active');
  }
}

// --- BIOMETRICS / WEBAUTHN CONTROLLER ACTIONS ---

// Register Biometric credential
async function registerBiometricKeys() {
  try {
    const res = await fetch('/api/auth/webauthn/register-options', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const options = await res.json();

    // Map base64url back to ArrayBuffers
    options.challenge = base64urlToBuffer(options.challenge);
    options.user.id = base64urlToBuffer(options.user.id);
    if (options.excludeCredentials) {
      options.excludeCredentials.forEach(cred => {
        cred.id = base64urlToBuffer(cred.id);
      });
    }

    const credential = await navigator.credentials.create({ publicKey: options });
    
    // Convert ArrayBuffers back to base64url for submission
    const responsePayload = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      response: {
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        attestationObject: bufferToBase64url(credential.response.attestationObject),
        transports: credential.response.getTransports ? credential.response.getTransports() : []
      },
      type: credential.type
    };

    const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(responsePayload)
    });
    const verifyData = await verifyRes.json();

    if (verifyData.success) {
      alert('Biometrics registered successfully!');
    } else {
      alert(verifyData.message || 'Verification failed');
    }
  } catch (err) {
    console.error(err);
    alert('Biometric registration cancelled or unsupported');
  }
}

// Log in via Biometrics
async function triggerBiometricLogin() {
  const username = document.getElementById('login-username').value.trim();
  if (!username) {
    alert('Please enter your username to trigger biometric login');
    return;
  }

  try {
    const res = await fetch(`/api/auth/webauthn/login-options?username=${encodeURIComponent(username)}`);
    const options = await res.json();

    // Parse options challenges and allowed credentials IDs
    options.challenge = base64urlToBuffer(options.challenge);
    if (options.allowCredentials) {
      options.allowCredentials.forEach(cred => {
        cred.id = base64urlToBuffer(cred.id);
      });
    }

    const credential = await navigator.credentials.get({ publicKey: options });

    const responsePayload = {
      username,
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      response: {
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        authenticatorData: bufferToBase64url(credential.response.authenticatorData),
        signature: bufferToBase64url(credential.response.signature),
        userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : ''
      }
    };

    const verifyRes = await fetch('/api/auth/webauthn/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responsePayload)
    });
    const verifyData = await verifyRes.json();

    if (verifyData.success) {
      loginSuccess(verifyData.token, verifyData.user);
    } else {
      alert(verifyData.message || 'Biometric authentication failed');
    }
  } catch (err) {
    console.error(err);
    alert('Biometric authentication failed or credential not found');
  }
}
