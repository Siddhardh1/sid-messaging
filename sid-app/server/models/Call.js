const mongoose = require('mongoose');

const CallSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    default: null
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['ringing', 'active', 'ended'],
    default: 'ringing'
  },
  type: {
    type: String,
    enum: ['audio', 'video'],
    default: 'video'
  },
  scheduledFor: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // in seconds
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Call', CallSchema);
