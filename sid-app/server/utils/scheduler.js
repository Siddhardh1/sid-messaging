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

// Background job to delete messages older than 20 days
const startAutoDeleteJob = () => {
  const runPruning = async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 20);
      
      // Delete all messages created before the 20 days cutoff
      const result = await Message.deleteMany({
        createdAt: { $lt: cutoffDate }
      });
      
      if (result.deletedCount > 0) {
        console.log(`[Auto-Delete Daemon] Pruned ${result.deletedCount} message(s) older than 20 days.`);
      }
    } catch (err) {
      console.error('Error running message auto-delete job:', err);
    }
  };

  // Run once immediately on startup
  runPruning();

  // Then check every hour
  setInterval(runPruning, 3600000);
};

module.exports = { checkScheduledMessages, startAutoDeleteJob };
