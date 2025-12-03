// signaling-server.js
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', ({ role, sessionId }) => {
    socket.join(sessionId);
    socket.data.role = role;
    socket.data.sessionId = sessionId;
    console.log(`Socket ${socket.id} registered as ${role} for session ${sessionId}`);
  });

  socket.on('offer', ({ sessionId, offer }) => {
    console.log('OFFER received from', socket.id, 'for session', sessionId);
    socket.to(sessionId).emit('offer', { offer });
  });

  socket.on('answer', ({ sessionId, answer }) => {
    console.log('ANSWER received from', socket.id, 'for session', sessionId);
    socket.to(sessionId).emit('answer', { answer });
  });

  socket.on('ice-candidate', ({ sessionId, candidate }) => {
    console.log('ICE candidate from', socket.id, 'for session', sessionId);
    socket.to(sessionId).emit('ice-candidate', { candidate });
  });

  socket.on('app-dimensions', ({ sessionId, width, height }) => {
    console.log('App dimensions from', socket.id, width, height);
    socket.to(sessionId).emit('app-dimensions', { width, height });
  });

  socket.on('control-event', ({ sessionId, event }) => {
    console.log('Control event from', socket.id, 'for session', sessionId, event.type, event.subtype);
    socket.to(sessionId).emit('control-event', { event });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT,'0.0.0.0', () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`);
});
//server.listen(PORT,'0.0.0.0');