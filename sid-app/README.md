# Sid | Production-Ready E2EE Messaging & WebRTC Calling App

Sid is a secure, modern, and production-ready private messaging Single Page Application (SPA) designed with a premium glassmorphic UI. It features real-time messaging, end-to-end encryption (E2EE), WebRTC voice/video calls, Multi-Factor Authentication (2FA), and biometric login support.

---

## 🏗️ Technical Stack

- **Frontend:** HTML5, CSS3 (Vanilla CSS with dark/light themes & 5 accent colors), JavaScript (Vanilla ES6+)
- **Backend:** Node.js with Express.js
- **Database:** MongoDB (via Mongoose schemas)
- **Real-Time:** Socket.io for messaging events & WebRTC signaling
- **Video Calls:** Native WebRTC (`RTCPeerConnection` with Socket.io signaling)
- **Security:**
  - JWT Tokens (Authorization Headers)
  - 2FA TOTP (`speakeasy` + `qrcode` verification)
  - Biometric Auth (`WebAuthn` using Windows Hello / Touch ID / Face ID)
  - End-to-End Encryption (E2EE using client-side `CryptoJS` AES-256-CBC)
- **File Storage:** Multer (up to 50MB file sharing capacity)

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB running locally on `mongodb://localhost:27017` (or a MongoDB Atlas URI)

### Local Installation

1. Navigate to the project directory:
   ```bash
   cd C:\Users\siddh\.gemini\antigravity\scratch\sid-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment variables:
   A default `.env` file has been pre-configured in the project root:
   ```env
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/sid-db
   JWT_SECRET=sid-jwt-secure-secret-key-for-local-development-123456
   ENCRYPTION_KEY=sid-server-totp-encryption-key-32-chars-long!
   ```

4. Run the validation check script:
   ```bash
   node test-server.js
   ```

5. Start the server:
   ```bash
   npm start
   ```

6. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## 🐳 Docker Deployment

To spin up the server container alongside a MongoDB database instance in a single click:

```bash
docker-compose up --build
```

The application will be accessible at `http://localhost:3000`.

---

## ⚡ Key Features Implementation Details

### 1. End-to-End Encryption (E2EE)
- **Key Derivation:** Client-side passphrase derivation is executed on login. An E2EE key is derived using `CryptoJS.SHA256` and saved only inside `sessionStorage`.
- **Message Payloads:** Clean text is encrypted client-side using `CryptoJS.AES.encrypt` with an IV. The server only receives and stores the `encryptedContent` and `ivHex`.
- **Decryption:** Message bubbles are decrypted dynamically on the client when rendered. Cleartext never touches the server.

### 2. WebRTC Video/Audio Calling
- **Socket Signaling:** WebRTC handshakes (offers, answers, and ICE candidates) are routed in real-time via Socket.io channels directly.
- **Background Blur:** Implemented canvas-based video stream processing using `ctx.filter = 'blur(8px)'` before drawing onto the peer connection channel.
- **Call Recording:** Uses the browser `MediaRecorder` API to package streams into downloadable WebM recording archives.

### 3. Biometric Authentication (WebAuthn)
- Native browser biometric authentication is enabled. Registering Windows Hello or Touch ID calls `/api/auth/webauthn/register-options` and passes credentials to the browser's native credential manager. Verification keys are validated on the server using `@simplewebauthn/server`.

---

## 📁 Project Directory Tree

```
sid-app/
├── client/
│   ├── index.html
│   ├── css/
│   │   └── style.css            # Main CSS variables, layouts, and animations
│   └── js/
│       ├── app.js               # SPA screen router & loaders
│       ├── auth.js              # Standard and biometric auth controllers
│       ├── chat.js              # Messaging sockets & voice note recorders
│       ├── video-call.js        # WebRTC connections & canvas streams
│       ├── settings.js          # Accents toggling & PDF histories exports
│       ├── contacts.js          # Searching, blocking, and group chats
│       └── utils.js             # CryptoJS E2EE & conversion helpers
├── server/
│   ├── server.js                # Server entry point
│   ├── routes/
│   │   ├── auth.js              # Register, login, 2FA, biometric routes
│   │   ├── messages.js          # Conversations, reactions, attachments
│   │   ├── users.js             # Contacts lists & block logs
│   │   └── calls.js             # Calls logging & calendar scheduling
│   ├── models/                  # Mongoose models (User, Chat, Message, Call)
│   ├── middleware/              # Auth protections & Multer uploads limiters
│   ├── config/                  # Database connections & Socket signaling
│   └── utils/                   # Scheduled daemon & TOTP encrypt tools
├── Dockerfile
├── docker-compose.yml
├── .env
├── package.json
└── README.md
```
