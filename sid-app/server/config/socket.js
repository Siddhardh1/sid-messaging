const socketIO = require('socket.io');
const User = require('../models/User');

const activeUsers = new Map(); // userId -> Set of socket.id

const configureSocket = (server) => {
  const io = socketIO(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    let currentUserId = null;

    // Track user session status
    socket.on('user-online', async (userId) => {
      currentUserId = userId;
      if (!activeUsers.has(userId)) {
        activeUsers.set(userId, new Set());
      }
      activeUsers.get(userId).add(socket.id);
      
      try {
        await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
        io.emit('user-status-change', { userId, status: 'online' });
      } catch (err) {
        console.error('Error updating status on connect:', err);
      }
    });

    // Chat Rooms
    socket.on('join-chat', (chatId) => {
      socket.join(chatId);
    });

    socket.on('leave-chat', (chatId) => {
      socket.leave(chatId);
    });

    // Typing Indicators
    socket.on('typing', ({ chatId, username }) => {
      socket.to(chatId).emit('typing', { chatId, username });
    });

    socket.on('stop-typing', ({ chatId, username }) => {
      socket.to(chatId).emit('stop-typing', { chatId, username });
    });

    // WebRTC Calling Signaling
    socket.on('call-user', ({ targetUserId, callerId, chatId, type, callerName }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('call-incoming', { callerId, chatId, type, callerName });
        });
      }
    });

    socket.on('call-accepted', ({ targetUserId, calleeId }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('call-accepted', { calleeId });
        });
      }
    });

    socket.on('call-rejected', ({ targetUserId, calleeId }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('call-rejected', { calleeId });
        });
      }
    });

    socket.on('call-ended', ({ targetUserId, callerId }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('call-ended', { callerId });
        });
      }
    });

    socket.on('send-offer', ({ targetUserId, offer }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('receive-offer', { offer, senderId: currentUserId });
        });
      }
    });

    socket.on('send-answer', ({ targetUserId, answer }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('receive-answer', { answer, senderId: currentUserId });
        });
      }
    });

    socket.on('send-ice-candidate', ({ targetUserId, candidate }) => {
      const targetSockets = activeUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('receive-ice', { candidate, senderId: currentUserId });
        });
      }
    });

    // Group calling support (relays calls to list of room participants)
    socket.on('join-call-room', ({ callRoomId, peerId, username }) => {
      socket.join(callRoomId);
      socket.to(callRoomId).emit('participant-joined-call', { peerId, username, socketId: socket.id });
    });

    socket.on('leave-call-room', ({ callRoomId, peerId }) => {
      socket.leave(callRoomId);
      socket.to(callRoomId).emit('participant-left-call', { peerId, socketId: socket.id });
    });

    // In-call toggles
    socket.on('toggle-screen-share', ({ chatId, isSharing }) => {
      socket.to(chatId).emit('participant-screen-share', { userId: currentUserId, isSharing });
    });

    socket.on('raise-hand', ({ chatId, isRaised }) => {
      socket.to(chatId).emit('participant-hand-raised', { userId: currentUserId, isRaised });
    });

    socket.on('toggle-audio', ({ chatId, isMuted }) => {
      socket.to(chatId).emit('participant-audio-toggled', { userId: currentUserId, isMuted });
    });

    socket.on('toggle-video', ({ chatId, isPaused }) => {
      socket.to(chatId).emit('participant-video-toggled', { userId: currentUserId, isPaused });
    });

    // Security Alert - Screenshots
    socket.on('screenshot-taken', ({ chatId, username }) => {
      io.to(chatId).emit('screenshot-taken-alert', { username });
    });

    // Disconnect handling
    socket.on('disconnect', async () => {
      if (currentUserId && activeUsers.has(currentUserId)) {
        const socketSet = activeUsers.get(currentUserId);
        socketSet.delete(socket.id);
        if (socketSet.size === 0) {
          activeUsers.delete(currentUserId);
          const lastSeen = new Date();
          try {
            await User.findByIdAndUpdate(currentUserId, { lastSeen });
            io.emit('user-status-change', { userId: currentUserId, status: 'offline', lastSeen });
          } catch (err) {
            console.error('Error updating status on disconnect:', err);
          }
        }
      }
    });
  });

  return io;
};

module.exports = { configureSocket, activeUsers };
