const express = require('express');
const router = express.Router();
const Call = require('../models/Call');
const Chat = require('../models/Chat');
const { protect } = require('../middleware/auth');

// @route   POST /api/calls
// @desc    Initiate/Log a new call session
router.post('/', protect, async (req, res) => {
  const { chatId, participants, type } = req.body;

  try {
    const call = new Call({
      chatId: chatId || null,
      caller: req.user.id,
      participants: participants || [],
      type: type || 'video',
      status: 'ringing'
    });

    await call.save();
    res.status(201).json({ success: true, call });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error logging call' });
  }
});

// @route   PUT /api/calls/:callId
// @desc    Update call status (accept, decline, end call)
router.put('/:callId', protect, async (req, res) => {
  const { callId } = req.params;
  const { status, duration } = req.body;

  try {
    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    if (status) call.status = status;
    if (duration !== undefined) call.duration = duration;

    await call.save();
    res.json({ success: true, call });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating call status' });
  }
});

// @route   GET /api/calls/history
// @desc    Get user's video call history logs
router.get('/history', protect, async (req, res) => {
  try {
    const calls = await Call.find({
      $or: [
        { caller: req.user.id },
        { participants: req.user.id }
      ]
    })
      .populate('caller', 'username avatar')
      .populate('participants', 'username avatar')
      .sort({ createdAt: -1 });

    res.json({ success: true, calls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error fetching call history' });
  }
});

// @route   POST /api/calls/schedule
// @desc    Schedule a call for a later date (calendar scheduling)
router.post('/schedule', protect, async (req, res) => {
  const { chatId, scheduledFor, type, participants } = req.body;

  try {
    if (!scheduledFor) {
      return res.status(400).json({ success: false, message: 'Schedule time is required' });
    }

    const call = new Call({
      chatId: chatId || null,
      caller: req.user.id,
      participants: participants || [],
      type: type || 'video',
      status: 'ringing',
      scheduledFor: new Date(scheduledFor)
    });

    await call.save();
    res.status(201).json({ success: true, call });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error scheduling call' });
  }
});

// @route   GET /api/calls/scheduled
// @desc    Get upcoming scheduled calls
router.get('/scheduled', protect, async (req, res) => {
  try {
    const calls = await Call.find({
      $or: [
        { caller: req.user.id },
        { participants: req.user.id }
      ],
      scheduledFor: { $gt: new Date() }
    })
      .populate('caller', 'username avatar')
      .populate('participants', 'username avatar')
      .sort({ scheduledFor: 1 });

    res.json({ success: true, calls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error fetching scheduled calls' });
  }
});

module.exports = router;
