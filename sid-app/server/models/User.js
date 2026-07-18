const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: ''
  },
  twoFactor: {
    enabled: { type: Boolean, default: false },
    secret: { type: String, default: '' },
    tempSecret: { type: String, default: '' }
  },
  biometrics: [{
    credentialID: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: [String]
  }],
  contacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastSeen: {
    type: Date,
    default: Date.now
  },
  settings: {
    showLastSeen: { type: Boolean, default: true },
    theme: { type: String, default: 'dark' }, // 'dark' | 'light'
    accentColor: { type: String, default: 'cobalt' }, // 'cobalt' | 'emerald' | 'amethyst' | 'amber' | 'rose'
    customSounds: {
      type: Map,
      of: String,
      default: new Map()
    }
  },
  publicKeyDH: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', UserSchema);
