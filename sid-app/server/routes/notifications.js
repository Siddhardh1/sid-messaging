const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Route to get VAPID public key
router.get('/vapid-key', (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || global.vapidKeys?.publicKey;
  if (!publicKey) {
    return res.status(500).json({ success: false, message: 'VAPID public key not found' });
  }
  res.json({ success: true, publicKey });
});

// Route to save subscription for the logged-in user
router.post('/subscribe', protect, async (req, res) => {
  const { subscription } = req.body;

  if (!subscription) {
    return res.status(400).json({ success: false, message: 'Subscription object required' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Initialize array if empty
    if (!user.pushSubscriptions) {
      user.pushSubscriptions = [];
    }

    // Check if subscription endpoint already registered to prevent duplicates
    const exists = user.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
      user.pushSubscriptions.push(subscription);
      await user.save();
    }

    res.json({ success: true, message: 'Subscription saved successfully!' });
  } catch (err) {
    console.error('Error saving subscription:', err);
    res.status(500).json({ success: false, message: 'Server error saving subscription' });
  }
});

module.exports = router;
