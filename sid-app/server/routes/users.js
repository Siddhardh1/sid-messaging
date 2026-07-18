const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// @route   GET /api/users/profile
// @desc    Get user profile details
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile & settings
router.put('/profile', protect, async (req, res) => {
  const { avatar, showLastSeen, theme, accentColor, password, newPassword, sidId } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (avatar !== undefined) user.avatar = avatar;
    if (showLastSeen !== undefined) user.settings.showLastSeen = showLastSeen;
    if (theme !== undefined) user.settings.theme = theme;
    if (accentColor !== undefined) user.settings.accentColor = accentColor;

    // Set sidId if not set before
    if (sidId !== undefined && !user.sidId) {
      const formattedSidId = sidId.trim().toLowerCase();
      // Verify uniqueness
      const existingUser = await User.findOne({ sidId: formattedSidId });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'SID ID already exists' });
      }
      user.sidId = formattedSidId;
    }

    // Handle password change
    if (password && newPassword) {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Incorrect current password' });
      }
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(newPassword, salt);
    }

    await user.save();
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        sidId: user.sidId,
        avatar: user.avatar,
        settings: user.settings,
        contacts: user.contacts
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating profile' });
  }
});

// @route   GET /api/users/search
// @desc    Search for users by exact sidId
router.get('/search', protect, async (req, res) => {
  const { q } = req.query;
  try {
    if (!q) {
      return res.status(400).json({ success: false, message: 'Query parameter is required' });
    }

    // Search STRICTLY by exact sidId (case-insensitive/lowercase, excluding current user)
    const users = await User.find({
      sidId: q.trim().toLowerCase(),
      _id: { $ne: req.user.id }
    }).select('username email avatar lastSeen settings.showLastSeen sidId');

    res.json({ success: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error searching users' });
  }
});

// @route   GET /api/users/contacts
// @desc    Get user contacts list and pending requests
router.get('/contacts', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('contacts', 'username email avatar lastSeen settings.showLastSeen sidId')
      .populate('incomingRequests', 'username email avatar lastSeen settings.showLastSeen sidId')
      .populate('outgoingRequests', 'username email avatar lastSeen settings.showLastSeen sidId')
      .populate('blockedUsers', 'username email avatar');
    res.json({
      success: true,
      contacts: user.contacts,
      incomingRequests: user.incomingRequests || [],
      outgoingRequests: user.outgoingRequests || [],
      blockedUsers: user.blockedUsers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error loading contacts' });
  }
});

// @route   POST /api/users/contacts/add
// @desc    Send contact request to a user
router.post('/contacts/add', protect, async (req, res) => {
  const { contactId } = req.body;
  try {
    if (contactId === req.user.id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot add yourself as a contact' });
    }

    const contactUser = await User.findById(contactId);
    if (!contactUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = await User.findById(req.user.id);
    if (user.contacts.includes(contactId)) {
      return res.status(400).json({ success: false, message: 'User is already in your contacts' });
    }

    if (user.outgoingRequests.includes(contactId)) {
      return res.status(400).json({ success: false, message: 'Request already sent to this user' });
    }

    if (user.incomingRequests.includes(contactId)) {
      return res.status(400).json({ success: false, message: 'This user already sent you a contact request' });
    }

    // Add to outgoing/incoming lists
    user.outgoingRequests.push(contactId);
    contactUser.incomingRequests.push(req.user.id);

    await user.save();
    await contactUser.save();

    // Emit Socket updates to trigger list reload in real-time
    const io = req.app.get('socketio');
    if (io) {
      io.emit('contacts-update', { userId: contactId });
      io.emit('contacts-update', { userId: req.user.id });
    }

    res.json({ success: true, message: 'Contact request sent successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error sending request' });
  }
});

// @route   DELETE /api/users/contacts/remove
// @desc    Remove a contact from contacts list
router.delete('/contacts/remove', protect, async (req, res) => {
  const { contactId } = req.body;
  try {
    const user = await User.findById(req.user.id);
    user.contacts = user.contacts.filter(cId => cId.toString() !== contactId);
    await user.save();
    res.json({ success: true, message: 'Contact removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error removing contact' });
  }
});

// @route   POST /api/users/contacts/requests/accept
// @desc    Accept a contact request
router.post('/contacts/requests/accept', protect, async (req, res) => {
  const { requesterId } = req.body;
  try {
    const user = await User.findById(req.user.id);
    const requester = await User.findById(requesterId);
    if (!user || !requester) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Move from requests queues to contacts arrays
    user.incomingRequests = user.incomingRequests.filter(id => id.toString() !== requesterId);
    requester.outgoingRequests = requester.outgoingRequests.filter(id => id.toString() !== req.user.id);

    if (!user.contacts.includes(requesterId)) user.contacts.push(requesterId);
    if (!requester.contacts.includes(req.user.id)) requester.contacts.push(req.user.id);

    await user.save();
    await requester.save();

    // Auto-create Chat (DM) between them if not exist
    const Chat = require('../models/Chat');
    let chat = await Chat.findOne({
      isGroup: false,
      participants: { $all: [req.user.id, requesterId] }
    });

    if (!chat) {
      chat = new Chat({
        isGroup: false,
        participants: [req.user.id, requesterId],
        admins: [req.user.id]
      });
      await chat.save();
    }

    // Emit Socket updates
    const io = req.app.get('socketio');
    if (io) {
      io.emit('contacts-update', { userId: req.user.id });
      io.emit('contacts-update', { userId: requesterId });
      io.emit('chats-update', { userId: req.user.id });
      io.emit('chats-update', { userId: requesterId });
    }

    res.json({ success: true, message: 'Contact request accepted!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error accepting request' });
  }
});

// @route   POST /api/users/contacts/requests/decline
// @desc    Decline a contact request
router.post('/contacts/requests/decline', protect, async (req, res) => {
  const { requesterId } = req.body;
  try {
    const user = await User.findById(req.user.id);
    const requester = await User.findById(requesterId);
    if (!user || !requester) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.incomingRequests = user.incomingRequests.filter(id => id.toString() !== requesterId);
    requester.outgoingRequests = requester.outgoingRequests.filter(id => id.toString() !== req.user.id);

    await user.save();
    await requester.save();

    const io = req.app.get('socketio');
    if (io) {
      io.emit('contacts-update', { userId: req.user.id });
      io.emit('contacts-update', { userId: requesterId });
    }

    res.json({ success: true, message: 'Contact request declined' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error declining request' });
  }
});

// @route   POST /api/users/block
// @desc    Block a user
router.post('/block', protect, async (req, res) => {
  const { targetUserId } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (user.blockedUsers.includes(targetUserId)) {
      return res.status(400).json({ success: false, message: 'User already blocked' });
    }

    user.blockedUsers.push(targetUserId);
    // Also remove from contacts list if they exist there
    user.contacts = user.contacts.filter(cId => cId.toString() !== targetUserId);

    await user.save();
    res.json({ success: true, message: 'User blocked successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error blocking user' });
  }
});

// @route   POST /api/users/unblock
// @desc    Unblock a user
router.post('/unblock', protect, async (req, res) => {
  const { targetUserId } = req.body;
  try {
    const user = await User.findById(req.user.id);
    user.blockedUsers = user.blockedUsers.filter(uId => uId.toString() !== targetUserId);
    await user.save();
    res.json({ success: true, message: 'User unblocked successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error unblocking user' });
  }
});

// @route   DELETE /api/users/profile
// @desc    Delete user account and all associated data
router.delete('/profile', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    const Chat = require('../models/Chat');
    const Message = require('../models/Message');

    // Find all chats they are a participant of
    const userChats = await Chat.find({ participants: userId });

    for (const chat of userChats) {
      if (chat.isGroup) {
        // Remove user from group participants
        chat.participants = chat.participants.filter(p => p.toString() !== userId);
        // If they were the admin, assign someone else
        if (chat.admins.includes(userId)) {
          chat.admins = chat.admins.filter(a => a.toString() !== userId);
          if (chat.participants.length > 0 && chat.admins.length === 0) {
            chat.admins.push(chat.participants[0]);
          }
        }
        if (chat.participants.length === 0) {
          // Delete chat and messages if no participants left
          await Message.deleteMany({ chatId: chat._id });
          await Chat.findByIdAndDelete(chat._id);
        } else {
          await chat.save();
        }
      } else {
        // Direct Message: Delete the entire chat and all its messages
        await Message.deleteMany({ chatId: chat._id });
        await Chat.findByIdAndDelete(chat._id);
      }
    }

    // Remove user reference from all other users' lists
    await User.updateMany(
      {},
      {
        $pull: {
          contacts: userId,
          incomingRequests: userId,
          outgoingRequests: userId,
          blockedUsers: userId
        }
      }
    );

    // Delete the user document
    await User.findByIdAndDelete(userId);

    res.json({ success: true, message: 'Account successfully deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error deleting account' });
  }
});

module.exports = router;
