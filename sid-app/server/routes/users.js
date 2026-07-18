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
  const { avatar, showLastSeen, theme, accentColor, password, newPassword } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (avatar !== undefined) user.avatar = avatar;
    if (showLastSeen !== undefined) user.settings.showLastSeen = showLastSeen;
    if (theme !== undefined) user.settings.theme = theme;
    if (accentColor !== undefined) user.settings.accentColor = accentColor;

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
// @desc    Search for users by username
router.get('/search', protect, async (req, res) => {
  const { q } = req.query;
  try {
    if (!q) {
      return res.status(400).json({ success: false, message: 'Query parameter is required' });
    }

    // Search username match, excluding current user
    const users = await User.find({
      username: { $regex: q, $options: 'i' },
      _id: { $ne: req.user.id }
    }).select('username email avatar lastSeen settings.showLastSeen');

    res.json({ success: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error searching users' });
  }
});

// @route   GET /api/users/contacts
// @desc    Get user contacts list
router.get('/contacts', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('contacts', 'username email avatar lastSeen settings.showLastSeen')
      .populate('blockedUsers', 'username email avatar');
    res.json({
      success: true,
      contacts: user.contacts,
      blockedUsers: user.blockedUsers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error loading contacts' });
  }
});

// @route   POST /api/users/contacts/add
// @desc    Add a user to contacts list
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

    user.contacts.push(contactId);
    await user.save();

    res.json({ success: true, message: 'Contact added successfully', contact: contactUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error adding contact' });
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

module.exports = router;
