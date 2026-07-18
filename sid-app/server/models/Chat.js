const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  isGroup: {
    type: Boolean,
    default: false
  },
  name: {
    type: String,
    default: ''
  },
  avatar: {
    type: String,
    default: ''
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  pinnedMessages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Chat', ChatSchema);
