const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Helper to check if two users have blocked each other
async function checkBlockStatus(userId, targetUserId) {
  const user = await User.findById(userId);
  const targetUser = await User.findById(targetUserId);
  if (!user || !targetUser) return false;
  return user.blockedUsers.includes(targetUserId) || targetUser.blockedUsers.includes(userId);
}

// @route   POST /api/messages/chat
// @desc    Create a new chat conversation (DM or Group)
router.post('/chat', protect, async (req, res) => {
  const { isGroup, name, participants, avatar } = req.body;

  try {
    if (!isGroup) {
      // Direct Message
      const targetUserId = participants[0];
      if (!targetUserId) {
        return res.status(400).json({ success: false, message: 'Recipient required' });
      }

      // Check block status
      if (await checkBlockStatus(req.user.id, targetUserId)) {
        return res.status(400).json({ success: false, message: 'Cannot start chat due to blocking settings' });
      }

      // Look for existing DM
      let chat = await Chat.findOne({
        isGroup: false,
        participants: { $all: [req.user.id, targetUserId] }
      }).populate('participants', 'username email avatar lastSeen settings.showLastSeen');

      if (chat) {
        return res.json({ success: true, chat });
      }

      chat = new Chat({
        isGroup: false,
        participants: [req.user.id, targetUserId],
        admins: [req.user.id]
      });

      await chat.save();
      chat = await Chat.findById(chat._id).populate('participants', 'username email avatar lastSeen settings.showLastSeen');
      return res.status(201).json({ success: true, chat });
    } else {
      // Group Chat
      if (!name) {
        return res.status(400).json({ success: false, message: 'Group name is required' });
      }

      // Include current user in group participants
      const allParticipants = Array.from(new Set([...participants, req.user.id]));

      let chat = new Chat({
        isGroup: true,
        name,
        avatar: avatar || '',
        participants: allParticipants,
        admins: [req.user.id]
      });

      await chat.save();
      chat = await Chat.findById(chat._id).populate('participants', 'username email avatar lastSeen settings.showLastSeen');
      return res.status(201).json({ success: true, chat });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error creating chat' });
  }
});

// @route   PUT /api/messages/chat/:chatId
// @desc    Update group chat metadata (admins only)
router.put('/chat/:chatId', protect, async (req, res) => {
  const { chatId } = req.params;
  const { name, avatar, participants, admins } = req.body;

  try {
    let chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    // Verify requesting user is admin
    if (!chat.admins.includes(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Only admins can modify group settings' });
    }

    if (name !== undefined) chat.name = name;
    if (avatar !== undefined) chat.avatar = avatar;
    if (participants !== undefined) chat.participants = participants;
    if (admins !== undefined) chat.admins = admins;

    await chat.save();
    chat = await Chat.findById(chatId).populate('participants', 'username email avatar lastSeen settings.showLastSeen');
    
    res.json({ success: true, chat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating chat' });
  }
});

// @route   GET /api/messages/chats
// @desc    Get user's recent chats list with last message metadata
router.get('/chats', protect, async (req, res) => {
  try {
    const chats = await Chat.find({
      participants: req.user.id
    }).populate('participants', 'username email avatar lastSeen settings.showLastSeen');

    const chatsWithLastMessage = await Promise.all(
      chats.map(async (chat) => {
        // Fetch last message that was NOT scheduled (or whose scheduled time has passed) and NOT deleted for this user
        const lastMessage = await Message.findOne({
          chatId: chat._id,
          deletedFor: { $ne: req.user.id },
          $or: [
            { scheduledFor: null },
            { scheduledFor: { $lte: new Date() } }
          ]
        })
          .sort({ createdAt: -1 })
          .populate('sender', 'username avatar');

        // Count unread messages
        const unreadCount = await Message.countDocuments({
          chatId: chat._id,
          sender: { $ne: req.user.id },
          'readBy.userId': { $ne: req.user.id },
          deletedFor: { $ne: req.user.id },
          $or: [
            { scheduledFor: null },
            { scheduledFor: { $lte: new Date() } }
          ]
        });

        return {
          _id: chat._id,
          isGroup: chat.isGroup,
          name: chat.name,
          avatar: chat.avatar,
          participants: chat.participants,
          admins: chat.admins,
          pinnedMessages: chat.pinnedMessages,
          lastMessage,
          unreadCount,
          updatedAt: chat.updatedAt
        };
      })
    );

    // Sort by last message date or update date
    chatsWithLastMessage.sort((a, b) => {
      const dateA = a.lastMessage ? a.lastMessage.createdAt : a.updatedAt;
      const dateB = b.lastMessage ? b.lastMessage.createdAt : b.updatedAt;
      return new Date(dateB) - new Date(dateA);
    });

    res.json({ success: true, chats: chatsWithLastMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error listing chats' });
  }
});

// @route   GET /api/messages/chat/:chatId
// @desc    Get all messages inside a chat (and mark as read)
router.get('/chat/:chatId', protect, async (req, res) => {
  const { chatId } = req.params;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.includes(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Fetch messages (exclude scheduled ones for future, and deleted ones)
    const messages = await Message.find({
      chatId,
      deletedFor: { $ne: req.user.id },
      $or: [
        { scheduledFor: null },
        { scheduledFor: { $lte: new Date() } }
      ]
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username avatar')
      .populate('replyTo');

    // Mark as read for this user
    await Message.updateMany(
      {
        chatId,
        sender: { $ne: req.user.id },
        'readBy.userId': { $ne: req.user.id }
      },
      {
        $addToSet: { readBy: { userId: req.user.id, readAt: new Date() } }
      }
    );

    res.json({ success: true, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error loading messages' });
  }
});

// @route   POST /api/messages
// @desc    Send a message (supports attachments, replying, disappearing timer, scheduled dates)
router.post('/', protect, upload.array('attachments', 5), async (req, res) => {
  const { chatId, encryptedContent, iv, replyTo, disappearSeconds, scheduledFor } = req.body;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.includes(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Check blocking configuration for DMs
    if (!chat.isGroup) {
      const recipientId = chat.participants.find(p => p.toString() !== req.user.id);
      if (recipientId && await checkBlockStatus(req.user.id, recipientId)) {
        return res.status(400).json({ success: false, message: 'Cannot send message to this user due to blocks' });
      }
    }

    const messageData = {
      chatId,
      sender: req.user.id,
      encryptedContent: encryptedContent || '',
      iv: iv || '',
      replyTo: replyTo || null
    };

    // Handle files upload
    if (req.files && req.files.length > 0) {
      messageData.attachments = req.files.map(file => ({
        filename: file.originalname,
        path: `/uploads/${file.filename}`,
        mimetype: file.mimetype,
        size: file.size
      }));
    }

    // Handle disappearing timer
    if (disappearSeconds) {
      const seconds = parseInt(disappearSeconds, 10);
      if (!isNaN(seconds) && seconds > 0) {
        messageData.disappearAt = new Date(Date.now() + seconds * 1000);
      }
    }

    // Handle scheduled time
    if (scheduledFor) {
      const schedDate = new Date(scheduledFor);
      if (schedDate > new Date()) {
        messageData.scheduledFor = schedDate;
      }
    }

    let message = new Message(messageData);
    await message.save();

    message = await Message.findById(message._id)
      .populate('sender', 'username avatar')
      .populate('replyTo');

    // Notify connected socket rooms immediately if not scheduled
    if (!message.scheduledFor) {
      const io = req.app.get('socketio');
      if (io) {
        io.to(chatId).emit('new-message', message);
      }
    }

    res.status(201).json({ success: true, message });

    // Send background Web Push notifications to other participants
    if (!message.scheduledFor) {
      try {
        const webpush = require('web-push');
        const recipients = chat.participants.filter(p => p.toString() !== req.user.id);

        for (const recipientId of recipients) {
          const recipient = await User.findById(recipientId);
          if (recipient && recipient.pushSubscriptions && recipient.pushSubscriptions.length > 0) {
            
            // Build notification payload
            let bodyPreview = 'Sent you a message';
            if (message.attachments && message.attachments.length > 0) {
              const mime = message.attachments[0].mimetype;
              if (mime.startsWith('image/')) {
                bodyPreview = '📷 Sent you a photo';
              } else if (mime.startsWith('video/')) {
                bodyPreview = '📹 Sent you a video';
              } else if (mime.startsWith('audio/')) {
                bodyPreview = '🎙️ Sent you a voice message';
              } else {
                bodyPreview = '📁 Sent you a file';
              }
            }

            const payload = JSON.stringify({
              title: req.user.username || 'Sid Messenger',
              body: bodyPreview,
              url: `/`
            });

            const invalidSubscriptions = [];
            for (const sub of recipient.pushSubscriptions) {
              try {
                await webpush.sendNotification(sub, payload);
              } catch (pushErr) {
                console.error('Push failed for endpoint:', sub.endpoint, pushErr.statusCode);
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                  invalidSubscriptions.push(sub);
                }
              }
            }

            // Clean up invalid/expired subscriptions
            if (invalidSubscriptions.length > 0) {
              recipient.pushSubscriptions = recipient.pushSubscriptions.filter(
                sub => !invalidSubscriptions.includes(sub)
              );
              await recipient.save();
            }
          }
        }
      } catch (pushGlobalErr) {
        console.error('Failed to dispatch background Web Push:', pushGlobalErr.message);
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error sending message' });
  }
});

// @route   POST /api/messages/:messageId/react
// @desc    Add or remove an emoji reaction to a message
router.post('/:messageId/react', protect, async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;

  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Check if reaction by user already exists
    const reactionIndex = message.reactions.findIndex(
      r => r.userId.toString() === req.user.id
    );

    if (reactionIndex > -1) {
      if (message.reactions[reactionIndex].emoji === emoji) {
        // Toggle off if same emoji clicked again
        message.reactions.splice(reactionIndex, 1);
      } else {
        // Update reaction
        message.reactions[reactionIndex].emoji = emoji;
      }
    } else {
      // Add new reaction
      message.reactions.push({ userId: req.user.id, emoji });
    }

    await message.save();

    // Broadcast to chat room
    const io = req.app.get('socketio');
    if (io) {
      io.to(message.chatId.toString()).emit('message-reaction', {
        messageId,
        reactions: message.reactions
      });
    }

    res.json({ success: true, reactions: message.reactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating reaction' });
  }
});

// @route   POST /api/messages/:messageId/pin
// @desc    Pin a message in a conversation
router.post('/:messageId/pin', protect, async (req, res) => {
  const { messageId } = req.params;

  try {
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    const chat = await Chat.findById(message.chatId);
    if (!chat.pinnedMessages.includes(messageId)) {
      chat.pinnedMessages.push(messageId);
      await chat.save();

      // Emit real-time event
      const io = req.app.get('socketio');
      if (io) {
        io.to(message.chatId.toString()).emit('message-pinned', { messageId, pinned: true });
      }
    }

    res.json({ success: true, message: 'Message pinned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/messages/:messageId/unpin
// @desc    Unpin a message in a conversation
router.post('/:messageId/unpin', protect, async (req, res) => {
  const { messageId } = req.params;

  try {
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    const chat = await Chat.findById(message.chatId);
    chat.pinnedMessages = chat.pinnedMessages.filter(pId => pId.toString() !== messageId);
    await chat.save();

    // Emit real-time event
    const io = req.app.get('socketio');
    if (io) {
      io.to(message.chatId.toString()).emit('message-pinned', { messageId, pinned: false });
    }

    res.json({ success: true, message: 'Message unpinned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/messages/:messageId
// @desc    Delete message (for myself or for everyone)
router.delete('/:messageId', protect, async (req, res) => {
  const { messageId } = req.params;
  const { deleteType } = req.body; // 'me' or 'everyone'

  try {
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    if (deleteType === 'everyone') {
      // Must be sender to delete for everyone
      if (message.sender.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Only sender can delete for everyone' });
      }

      // Empty contents and attachments, flag as system message or deleted
      message.encryptedContent = '';
      message.iv = '';
      message.attachments = [];
      message.isSystem = true; // Treats message bubble as a system message e.g. "This message was deleted"
      await message.save();

      // Emit real-time event
      const io = req.app.get('socketio');
      if (io) {
        io.to(message.chatId.toString()).emit('message-deleted-everyone', { messageId });
      }
    } else {
      // Just for me - add user to deletedFor list
      if (!message.deletedFor.includes(req.user.id)) {
        message.deletedFor.push(req.user.id);
        await message.save();
      }
    }

    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error deleting message' });
  }
});

module.exports = router;
