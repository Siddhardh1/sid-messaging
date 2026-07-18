const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');

const JWT_SECRET = process.env.JWT_SECRET || 'sid-jwt-secret-key-change-in-prod';
const RP_NAME = 'Sid Chat App';

// In-memory store for WebAuthn challenges
const webauthnChallenges = new Map();

// Helper to sign JWT
const signToken = (payload, expiresIn = '30d') => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

// In-memory store for registration OTPs
const registerOtps = new Map();

// @route   POST /api/auth/register/send-otp
// @desc    Validate input fields and email OTP code
router.post('/register/send-otp', async (req, res) => {
  const { username, email, sidId } = req.body;

  try {
    if (!username || !email || !sidId) {
      return res.status(400).json({ success: false, message: 'Please enter all fields' });
    }

    const formattedSidId = sidId.trim().toLowerCase();
    const formattedEmail = email.trim().toLowerCase();
    const formattedUsername = username.trim().toLowerCase();

    // Verify username, email, or sidId doesn't exist
    let user = await User.findOne({
      $or: [
        { email: formattedEmail },
        { username: formattedUsername },
        { sidId: formattedSidId }
      ]
    });

    if (user) {
      if (user.sidId === formattedSidId) {
        return res.status(400).json({ success: false, message: 'SID ID already exists' });
      }
      return res.status(400).json({ success: false, message: 'Username or email already exists' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in-memory with a 5-minute TTL
    registerOtps.set(formattedEmail, {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    });

    // Send email using Nodemailer
    const userEmail = process.env.EMAIL_USER;
    const userPass = process.env.EMAIL_PASS;

    if (userEmail && userPass) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: userEmail,
          pass: userPass
        }
      });

      const mailOptions = {
        from: `"Sid AI" <${userEmail}>`,
        to: formattedEmail,
        subject: 'Confirm Your Email Address - Sid Messenger OTP',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #ffffff; color: #1f2937;">
            <h2 style="color: #3b82f6; text-align: center;">Email Verification Code</h2>
            <p>Hello,</p>
            <p>Thank you for signing up for Sid Messenger! To complete your registration, please use the following One-Time Password (OTP) verification code:</p>
            <div style="background-color: #f3f4f6; border-radius: 8px; padding: 15px; margin: 20px 0; text-align: center;">
              <span style="font-size: 2.25rem; font-weight: bold; letter-spacing: 6px; color: #1e3a8a;">${otp}</span>
            </div>
            <p style="font-size: 0.875rem; color: #6b7280; text-align: center;">This code will expire in 5 minutes. Do not share this code with anyone.</p>
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="font-size: 0.75rem; color: #9ca3af; text-align: center;">If you did not request this code, you can safely ignore this email.</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log(`[SMTP] Registration OTP sent to ${formattedEmail}`);
    } else {
      // Developer bypass output
      console.log(`\n==============================================`);
      console.log(`[EMAIL BYPASS] OTP for ${formattedEmail} is: ${otp}`);
      console.log(`==============================================\n`);
    }

    res.json({ success: true, message: 'OTP sent successfully!' });
  } catch (err) {
    console.error('Error sending registration OTP:', err);
    res.status(500).json({ success: false, message: 'Error sending verification code' });
  }
});

// @route   POST /api/auth/register
// @desc    Register a new user
router.post('/register', async (req, res) => {
  const { username, email, password, sidId, otp } = req.body;

  try {
    if (!username || !email || !password || !sidId || !otp) {
      return res.status(400).json({ success: false, message: 'Please enter all fields' });
    }

    const formattedSidId = sidId.trim().toLowerCase();
    const formattedEmail = email.trim().toLowerCase();

    // Verify OTP code
    const storedOtpData = registerOtps.get(formattedEmail);
    if (!storedOtpData) {
      return res.status(400).json({ success: false, message: 'OTP not found. Please request a new one.' });
    }

    if (storedOtpData.expires < Date.now()) {
      registerOtps.delete(formattedEmail);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (storedOtpData.otp !== otp.trim()) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code' });
    }

    // OTP verified successfully, delete it
    registerOtps.delete(formattedEmail);

    // Check if email, username, or sidId already exists
    let user = await User.findOne({
      $or: [
        { email: formattedEmail },
        { username: username.trim().toLowerCase() },
        { sidId: formattedSidId }
      ]
    });

    if (user) {
      if (user.sidId === formattedSidId) {
        return res.status(400).json({ success: false, message: 'SID ID already exists' });
      }
      return res.status(400).json({ success: false, message: 'Username or email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    user = new User({
      username,
      email,
      passwordHash,
      sidId: formattedSidId
    });

    await user.save();

    const token = signToken({ id: user._id });
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        sidId: user.sidId,
        settings: user.settings
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Please enter all fields' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.twoFactor && user.twoFactor.enabled) {
      const tempToken = signToken({ id: user._id, mfaPending: true }, '5m');
      return res.json({
        success: true,
        mfaRequired: true,
        tempToken
      });
    }

    const token = signToken({ id: user._id });
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        settings: user.settings
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/auth/login/mfa
// @desc    Verify 2FA code during login
router.post('/login/mfa', async (req, res) => {
  const { code, tempToken } = req.body;

  try {
    if (!code || !tempToken) {
      return res.status(400).json({ success: false, message: 'Code and token are required' });
    }

    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.mfaPending) {
      return res.status(400).json({ success: false, message: 'Invalid operation' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Decrypt the secret
    const secretParts = user.twoFactor.secret.split(':');
    const totpSecret = decrypt(secretParts[0], secretParts[1]);

    const verified = speakeasy.totp.verify({
      secret: totpSecret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    const token = signToken({ id: user._id });
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        settings: user.settings
      }
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ success: false, message: 'MFA token expired or invalid' });
  }
});

// @route   POST /api/auth/2fa/setup
// @desc    Setup 2FA (requires protection)
router.post('/2fa/setup', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const secret = speakeasy.generateSecret({ name: `${RP_NAME} (${user.username})` });
    
    // Temporarily save secret
    user.twoFactor.tempSecret = secret.base32;
    await user.save();

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeUrl
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error setting up 2FA' });
  }
});

// @route   POST /api/auth/2fa/verify
// @desc    Verify and enable 2FA
router.post('/2fa/verify', protect, async (req, res) => {
  const { code } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user.twoFactor.tempSecret) {
      return res.status(400).json({ success: false, message: 'MFA setup not initiated' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactor.tempSecret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: 'Invalid code, please try again' });
    }

    // Encrypt the temporary secret
    const encryptedSecretObj = encrypt(user.twoFactor.tempSecret);
    user.twoFactor.secret = `${encryptedSecretObj.iv}:${encryptedSecretObj.encryptedData}`;
    user.twoFactor.enabled = true;
    user.twoFactor.tempSecret = '';
    await user.save();

    res.json({ success: true, message: 'Two-factor authentication enabled successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/auth/2fa/disable
// @desc    Disable 2FA
router.post('/2fa/disable', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.twoFactor.enabled = false;
    user.twoFactor.secret = '';
    await user.save();
    res.json({ success: true, message: 'Two-factor authentication disabled' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- WEBAUTHN (BIOMETRIC LOGIN) ROUTES ---

// @route   GET /api/auth/webauthn/register-options
// @desc    Generate options for registering a biometric credential
router.get('/webauthn/register-options', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const rpID = req.hostname === 'localhost' ? 'localhost' : req.hostname;

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: user._id.toString(),
      userName: user.username,
      userDisplayName: user.username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform' // Restrict to TouchID / FaceID / Windows Hello
      }
    });

    // Save challenge in-memory associated with this user
    webauthnChallenges.set(user._id.toString(), options.challenge);

    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error generating registration options' });
  }
});

// @route   POST /api/auth/webauthn/register-verify
// @desc    Verify the biometric registration response and save credential
router.post('/webauthn/register-verify', protect, async (req, res) => {
  const { body } = req;
  try {
    const user = await User.findById(req.user.id);
    const expectedChallenge = webauthnChallenges.get(user._id.toString());
    const rpID = req.hostname === 'localhost' ? 'localhost' : req.hostname;
    
    // Dynamic origin extraction
    const origin = `${req.protocol}://${req.headers.host}`;

    if (!expectedChallenge) {
      return res.status(400).json({ success: false, message: 'Challenge expired or missing' });
    }

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID
    });

    webauthnChallenges.delete(user._id.toString());

    if (verification.verified && verification.registrationInfo) {
      const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

      // Check if credential ID already registered
      const credExists = user.biometrics.some(
        cred => cred.credentialID === Buffer.from(credentialID).toString('base64url')
      );

      if (!credExists) {
        user.biometrics.push({
          credentialID: Buffer.from(credentialID).toString('base64url'),
          publicKey: Buffer.from(credentialPublicKey).toString('base64url'),
          counter,
          transports: body.response.transports || []
        });
        await user.save();
      }

      res.json({ success: true, message: 'Biometric credential registered successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Verification failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error verifying biometric registration' });
  }
});

// @route   GET /api/auth/webauthn/login-options
// @desc    Generate authentication options for biometric login
router.get('/webauthn/login-options', async (req, res) => {
  const { username } = req.query;
  try {
    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const user = await User.findOne({ username });
    if (!user || user.biometrics.length === 0) {
      return res.status(400).json({ success: false, message: 'No biometric credentials registered' });
    }

    const rpID = req.hostname === 'localhost' ? 'localhost' : req.hostname;

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: user.biometrics.map(cred => ({
        id: Buffer.from(cred.credentialID, 'base64url'),
        type: 'public-key',
        transports: cred.transports
      })),
      userVerification: 'preferred'
    });

    webauthnChallenges.set(`login-${user.username}`, {
      challenge: options.challenge,
      userId: user._id.toString()
    });

    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error generating login options' });
  }
});

// @route   POST /api/auth/webauthn/login-verify
// @desc    Verify the biometric assertion response and return a JWT
router.post('/webauthn/login-verify', async (req, res) => {
  const { username, body } = req;
  try {
    const challengeData = webauthnChallenges.get(`login-${body.username || username || ''}`);
    if (!challengeData) {
      return res.status(400).json({ success: false, message: 'Challenge expired or missing' });
    }

    const { challenge: expectedChallenge, userId } = challengeData;
    const user = await User.findById(userId);
    const rpID = req.hostname === 'localhost' ? 'localhost' : req.hostname;
    const origin = `${req.protocol}://${req.headers.host}`;

    // Find saved credential
    const savedCredential = user.biometrics.find(
      cred => cred.credentialID === body.id
    );

    if (!savedCredential) {
      return res.status(400).json({ success: false, message: 'Credential not registered' });
    }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: Buffer.from(savedCredential.credentialID, 'base64url'),
        credentialPublicKey: Buffer.from(savedCredential.publicKey, 'base64url'),
        counter: savedCredential.counter
      }
    });

    webauthnChallenges.delete(`login-${body.username || username || ''}`);

    if (verification.verified && verification.authenticationInfo) {
      // Update counter
      savedCredential.counter = verification.authenticationInfo.newCounter;
      await user.save();

      const token = signToken({ id: user._id });
      res.json({
        success: true,
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          settings: user.settings
        }
      });
    } else {
      res.status(400).json({ success: false, message: 'Authentication verification failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error verifying biometric login' });
  }
});

module.exports = router;
