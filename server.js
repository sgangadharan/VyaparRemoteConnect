// server.js
const sessionState = new Map(); 
// sessionId -> { offer, appDimensions, iceFromCustomer: [], iceFromAgent: [] }

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' } // demo only; tighten in prod
});

app.use(express.static(path.join(__dirname)));

app.get('/support.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'support.html'));
});

function ensureState(sessionId) {
  if (!sessionState.has(sessionId)) {
    sessionState.set(sessionId, {
      offer: null,
      appDimensions: null, // { width, height }
      iceFromCustomer: [],
      iceFromAgent: []
    });
  }
  return sessionState.get(sessionId);
}

// Helper: safe ack
function ackOk(ack, extra = {}) {
  if (typeof ack === 'function') ack({ ok: true, ...extra });
}
function ackFail(ack, msg) {
  if (typeof ack === 'function') ack({ ok: false, error: msg });
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // ✅ Register (ACK supported)
  socket.on('register', ({ role, sessionId }, ack) => {
    try {
      if (!role || !sessionId) throw new Error('Missing role or sessionId');

      socket.join(sessionId);
      socket.data.role = role;
      socket.data.sessionId = sessionId;

      console.log(`Socket ${socket.id} registered as ${role} for session ${sessionId}`);

      const state = ensureState(sessionId);

      // ✅ ACK success
      ackOk(ack);

      // ✅ Replay stored signaling for late join
      if (role === 'agent') {
        if (state.appDimensions) {
          socket.emit('app-dimensions', state.appDimensions);
        }
        if (state.offer) {
          console.log('Replaying stored OFFER to agent');
          socket.emit('offer', { offer: state.offer });
          state.iceFromCustomer.forEach((c) => socket.emit('ice-candidate', { candidate: c }));
        }
      }

      if (role === 'customer') {
        if (state.iceFromAgent.length) {
          console.log('Replaying stored ICE to customer');
          state.iceFromAgent.forEach((c) => socket.emit('ice-candidate', { candidate: c }));
        }
      }

      // Useful UI signal (optional)
      socket.to(sessionId).emit('peer-joined', { role, sessionId });
    } catch (e) {
      console.error('register failed:', e);
      ackFail(ack, e.message);
    }
  });

  // ✅ IMPORTANT: app-dimensions must be forwarded (and stored for replay)
  socket.on('app-dimensions', ({ sessionId, width, height }, ack) => {
    try {
      if (!sessionId || !width || !height) throw new Error('Missing sessionId/width/height');
      const state = ensureState(sessionId);
      state.appDimensions = { width, height };

      // forward to the other peer (agent)
      socket.to(sessionId).emit('app-dimensions', { width, height });

      ackOk(ack);
    } catch (e) {
      console.error('app-dimensions failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('offer', ({ sessionId, offer }, ack) => {
    try {
      if (!sessionId || !offer) throw new Error('Missing sessionId or offer');
      const state = ensureState(sessionId);
      state.offer = offer; // ✅ store for late-joining agent
      console.log('SERVER: stored offer for session', sessionId);

      socket.to(sessionId).emit('offer', { offer });
      ackOk(ack);
    } catch (e) {
      console.error('offer failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('answer', ({ sessionId, answer }, ack) => {
    try {
      if (!sessionId || !answer) throw new Error('Missing sessionId or answer');
      console.log('SERVER: forwarding answer for session', sessionId);

      socket.to(sessionId).emit('answer', { answer });
      ackOk(ack);
    } catch (e) {
      console.error('answer failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('ice-candidate', ({ sessionId, candidate }, ack) => {
    try {
      if (!sessionId || !candidate) throw new Error('Missing sessionId or candidate');
      const state = ensureState(sessionId);

      if (socket.data.role === 'customer') state.iceFromCustomer.push(candidate);
      else if (socket.data.role === 'agent') state.iceFromAgent.push(candidate);

      socket.to(sessionId).emit('ice-candidate', { candidate });
      ackOk(ack);
    } catch (e) {
      console.error('ice-candidate failed:', e);
      ackFail(ack, e.message);
    }
  });

  // ✅ IMPORTANT: control-event must be forwarded (this is your mouse/keyboard channel)
  socket.on('control-event', ({ sessionId, event }, ack) => {
    try {
      if (!sessionId || !event) throw new Error('Missing sessionId or event');

      // forward to the other peer (customer)
      socket.to(sessionId).emit('control-event', { event });

      ackOk(ack);
    } catch (e) {
      console.error('control-event failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('end-session', ({ sessionId }, ack) => {
    try {
      if (!sessionId) throw new Error('Missing sessionId');
      console.log('SERVER: ending session', sessionId);

      sessionState.delete(sessionId);
      io.to(sessionId).emit('session-ended', { sessionId, reason: 'customer_stopped' });

      ackOk(ack);
    } catch (e) {
      console.error('end-session failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('disconnect', (reason) => {
    // optional logging
    // console.log('Socket disconnected:', socket.id, reason);
  });
});

const PORT = 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server listening on http://0.0.0.0:${PORT}`);
});