require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const connectDB = require('./config/database');
const { configureSocket } = require('./config/socket');
const { checkScheduledMessages, startAutoDeleteJob } = require('./utils/scheduler');

// Routes imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const callRoutes = require('./routes/calls');

const app = express();
const server = http.createServer(app);

// Database connection
connectDB();

// Middleware configuration
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file hosting configuration
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../client')));

// API routing endpoints map
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calls', callRoutes);

// SPA client fallback routing
app.get('(.*)', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Real-time socket coordination
const io = configureSocket(server);
app.set('socketio', io);

// Scheduled message checks daemon
checkScheduledMessages(io);
startAutoDeleteJob();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server successfully started on port ${PORT}`);
});
