// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',   // demo only; tighten in prod
  }
});

// Serve static files (support.html, etc.) from this directory
app.use(express.static(path.join(__dirname)));

// Simple root route (optional)
app.get('/', (req, res) => {
  res.send('<h1>Signaling server running</h1><p>Open /support.html for agent UI.</p>');
});

// --- Signaling logic (same as before) ---
// Example skeleton; plug your existing signaling handlers here:

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('register', ({ role, sessionId }) => {
    socket.join(sessionId);
    socket.data.role = role;
    console.log(`Socket ${socket.id} registered as ${role} for session ${sessionId}`);
  });

  socket.on('offer', ({ sessionId, offer }) => {
    socket.to(sessionId).emit('offer', { offer });
  });

  socket.on('answer', ({ sessionId, answer }) => {
    socket.to(sessionId).emit('answer', { answer });
  });

  socket.on('ice-candidate', ({ sessionId, candidate }) => {
    socket.to(sessionId).emit('ice-candidate', { candidate });
  });

  socket.on('control-event', ({ sessionId, event }) => {
    socket.to(sessionId).emit('control-event', { event });
  });
});

// IMPORTANT: listen on 0.0.0.0, not just localhost
const PORT = 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server listening on http://0.0.0.0:${PORT}`);
});