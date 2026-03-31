// server.js
const sessionState = new Map(); 
// sessionId -> { offer, appDimensions, iceFromCustomer: [], iceFromAgent: [], customerSocketId: null, agentSocketId: null }

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
      iceFromAgent: [],
      customerSocketId: null,
      agentSocketId: null,
      offerSequence: 0 // Track offer sequence to detect new offers
    });
  }
  return sessionState.get(sessionId);
}

function clearCustomerState(sessionId) {
  const state = sessionState.get(sessionId);
  if (state) {
    console.log(`[SERVER] Clearing customer state for session ${sessionId} (reconnection detected)`);
    state.offer = null;
    state.iceFromCustomer = [];
    state.iceFromAgent = []; // Also clear stale agent ICE — agent PC resets too
    state.customerSocketId = null;
    state.offerSequence++;
  }
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

      const state = ensureState(sessionId);

      // ✅ Detect customer reconnection - clear old state
      if (role === 'customer' && state.customerSocketId && state.customerSocketId !== socket.id) {
        console.log(`[SERVER] 🔄 Customer reconnection detected for session ${sessionId}`);
        console.log(`[SERVER] Old socket: ${state.customerSocketId}, New socket: ${socket.id}`);
        // Cancel any pending cleanup timer from a previous disconnect
        if (state.cleanupTimer) {
          clearTimeout(state.cleanupTimer);
          state.cleanupTimer = null;
        }
        clearCustomerState(sessionId);
        // Notify agent that customer reconnected
        if (state.agentSocketId) {
          io.to(state.agentSocketId).emit('customer-reconnected', { sessionId });
        }
      }

      socket.join(sessionId);
      socket.data.role = role;
      socket.data.sessionId = sessionId;

      // Track socket IDs for reconnection detection
      if (role === 'customer') {
        state.customerSocketId = socket.id;
      } else if (role === 'agent') {
        state.agentSocketId = socket.id;
      }

      console.log(`[SERVER] Socket ${socket.id} registered as ${role} for session ${sessionId}`);

      // ✅ ACK success
      ackOk(ack);

      // ✅ Replay stored signaling for late join
      if (role === 'agent') {
        if (state.appDimensions) {
          socket.emit('app-dimensions', state.appDimensions);
        }
        if (state.offer) {
          console.log(`[SERVER] Replaying stored OFFER (sequence: ${state.offerSequence}) to agent`);
          socket.emit('offer', { offer: state.offer, isNewOffer: false, sequence: state.offerSequence });
          // Only replay recent ICE candidates (from current connection)
          state.iceFromCustomer.forEach((c) => socket.emit('ice-candidate', { candidate: c }));
        }
      }

      if (role === 'customer') {
        if (state.iceFromAgent.length) {
          console.log(`[SERVER] Replaying ${state.iceFromAgent.length} stored ICE candidates to customer`);
          state.iceFromAgent.forEach((c) => socket.emit('ice-candidate', { candidate: c }));
        }
      }

      // Useful UI signal (optional)
      socket.to(sessionId).emit('peer-joined', { role, sessionId });
    } catch (e) {
      console.error('[SERVER] register failed:', e);
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
      console.error('[SERVER] app-dimensions failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('offer', ({ sessionId, offer }, ack) => {
    try {
      if (!sessionId || !offer) throw new Error('Missing sessionId or offer');
      const state = ensureState(sessionId);
      
      // Check if this is a new offer (customer reconnected)
      const isNewOffer = state.offer !== null && state.offerSequence > 0;
      
      // Store new offer and increment sequence
      state.offer = offer;
      state.offerSequence++;
      
      // Clear old customer ICE candidates when new offer arrives (reconnection)
      if (isNewOffer) {
        console.log(`[SERVER] 🔄 New offer received (sequence: ${state.offerSequence}) - clearing old customer ICE candidates`);
        state.iceFromCustomer = [];
      }
      
      console.log(`[SERVER] Stored offer for session ${sessionId} (sequence: ${state.offerSequence}, isNew: ${isNewOffer})`);

      // When this is a reconnect offer, send peer-reset to the agent FIRST.
      // Socket.IO guarantees FIFO ordering on a single connection, so peer-reset
      // always arrives and is processed before the offer — no race condition.
      if (isNewOffer && state.agentSocketId) {
        console.log(`[SERVER] 🔄 Sending peer-reset to agent before new offer (sequence: ${state.offerSequence})`);
        io.to(state.agentSocketId).emit('peer-reset', { sessionId });
      }

      // Forward to agent with sequence info so they know it's a new offer
      socket.to(sessionId).emit('offer', {
        offer,
        isNewOffer: isNewOffer,
        sequence: state.offerSequence
      });
      
      ackOk(ack);
    } catch (e) {
      console.error('[SERVER] offer failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('answer', ({ sessionId, answer }, ack) => {
    try {
      if (!sessionId || !answer) throw new Error('Missing sessionId or answer');
      console.log(`[SERVER] Forwarding answer for session ${sessionId}`);

      socket.to(sessionId).emit('answer', { answer });
      ackOk(ack);
    } catch (e) {
      console.error('[SERVER] answer failed:', e);
      ackFail(ack, e.message);
    }
  });

  socket.on('ice-candidate', ({ sessionId, candidate }, ack) => {
    try {
      if (!sessionId || !candidate) throw new Error('Missing sessionId or candidate');
      const state = ensureState(sessionId);

      // Store ICE candidates (only for current connection)
      if (socket.data.role === 'customer') {
        state.iceFromCustomer.push(candidate);
      } else if (socket.data.role === 'agent') {
        state.iceFromAgent.push(candidate);
      }

      // Forward to the other peer
      socket.to(sessionId).emit('ice-candidate', { candidate });
      ackOk(ack);
    } catch (e) {
      console.error('[SERVER] ice-candidate failed:', e);
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
    const role = socket.data.role;
    const sessionId = socket.data.sessionId;
    
    if (sessionId) {
      const state = sessionState.get(sessionId);
      if (state) {
        // If customer disconnects, clear their state (they'll reconnect)
        if (role === 'customer' && state.customerSocketId === socket.id) {
          console.log(`[SERVER] Customer disconnected from session ${sessionId}, reason: ${reason}`);
          state.customerSocketId = null;
          // Schedule cleanup in case customer never reconnects (crash, closed tab, etc.)
          state.cleanupTimer = setTimeout(() => {
            if (!state.customerSocketId) {
              console.log(`[SERVER] Session ${sessionId} expired — cleaning up`);
              io.to(sessionId).emit('session-ended', { sessionId, reason: 'customer_timeout' });
              sessionState.delete(sessionId);
            }
          }, 60000); // 60-second grace period for reconnection
        } else if (role === 'agent' && state.agentSocketId === socket.id) {
          console.log(`[SERVER] Agent disconnected from session ${sessionId}, reason: ${reason}`);
          state.agentSocketId = null;
        }
      }
    }
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`[SERVER] ========================================`);
  console.log(`[SERVER] Signaling server listening on port ${PORT} (all interfaces)`);
  console.log(`[SERVER] Reconnection handling: ENABLED`);
  console.log(`[SERVER] ========================================`);
});