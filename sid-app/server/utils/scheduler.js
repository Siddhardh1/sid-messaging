const mongoose = require('mongoose');
const Message = require('../models/Message');

const checkScheduledMessages = (io) => {
  setInterval(async () => {
    try {
      // Check if MongoDB connection is established (readyState 1)
      if (mongoose.connection.readyState !== 1) {
        return;
      }
      const now = new Date();
      // Fetch messages whose scheduled delivery time has arrived
      const messages = await Message.find({
        scheduledFor: { $ne: null, $lte: now }
      })
        .populate('sender', 'username avatar')
        .populate('replyTo');

      for (const msg of messages) {
        // Clear scheduled flag to make it visible
        msg.scheduledFor = null;
        await msg.save();

        if (io) {
          // Emit message dynamically to all room participants
          io.to(msg.chatId.toString()).emit('new-message', msg);
        }
      }
    } catch (err) {
      console.error('Error checking scheduled messages:', err);
    }
  }, 5000); // Every 5 seconds resolution
};

module.exports = { checkScheduledMessages };
