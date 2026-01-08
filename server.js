// server.js
const sessionState = new Map(); // sessionId -> { offer, iceFromCustomer: [], iceFromAgent: [] }
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
// 
app.get('/support.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'support.html'));
});

function ensureState(sessionId) {
  if (!sessionState.has(sessionId)) {
    sessionState.set(sessionId, {
      offer: null,
      iceFromCustomer: [],
      iceFromAgent: []
    });
  }
  return sessionState.get(sessionId);
}

// --- Signaling logic (same as before) ---
// Example skeleton; plug your existing signaling handlers here:
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("register", ({ role, sessionId }, ack) => {
    try {
      if (!role || !sessionId) throw new Error("Missing role or sessionId");

      socket.join(sessionId);
      socket.data.role = role;
      socket.data.sessionId = sessionId;

      console.log(`Socket ${socket.id} registered as ${role} for session ${sessionId}`);

      const state = ensureState(sessionId);

      // ✅ ACK
      if (typeof ack === "function") ack({ ok: true });

      // ✅ Replay for late join
      if (role === "agent" && state.offer) {
        console.log("Replaying stored OFFER to agent");
        socket.emit("offer", { offer: state.offer });
        state.iceFromCustomer.forEach((c) => socket.emit("ice-candidate", { candidate: c }));
      }

      if (role === "customer" && state.iceFromAgent.length) {
        console.log("Replaying stored ICE to customer");
        state.iceFromAgent.forEach((c) => socket.emit("ice-candidate", { candidate: c }));
      }

      socket.to(sessionId).emit("peer-joined", { role });
    } catch (e) {
      console.error("register failed:", e);
      if (typeof ack === "function") ack({ ok: false, error: e.message });
    }
  });

  socket.on("offer", ({ sessionId, offer }) => {
    if (!sessionId || !offer) return;
    const state = ensureState(sessionId);
    state.offer = offer; // ✅ store always
    console.log("SERVER: stored offer for session", sessionId);
    socket.to(sessionId).emit("offer", { offer });
  });

  socket.on("answer", ({ sessionId, answer }) => {
    if (!sessionId || !answer) return;
    console.log("SERVER: forwarding answer for session", sessionId);
    socket.to(sessionId).emit("answer", { answer });
  });

  socket.on("ice-candidate", ({ sessionId, candidate }) => {
    if (!sessionId || !candidate) return;
    const state = ensureState(sessionId);

    if (socket.data.role === "customer") state.iceFromCustomer.push(candidate);
    else if (socket.data.role === "agent") state.iceFromAgent.push(candidate);

    socket.to(sessionId).emit("ice-candidate", { candidate });
  });

  socket.on("end-session", ({ sessionId }) => {
    if (!sessionId) return;
    console.log("SERVER: ending session", sessionId);
    sessionState.delete(sessionId);
    io.to(sessionId).emit("session-ended", { sessionId, reason: "customer_stopped" });
  });

  socket.on("disconnect", () => {
    // optional logging
  });
});
// io.on('connection', (socket) => {
//   console.log('Socket connected:', socket.id);

//   socket.on('register', ({ role, sessionId }) => {
//     socket.join(sessionId);
//     socket.data.role = role;
//     console.log(`Socket ${socket.id} registered as ${role} for session ${sessionId}`);
//   });

//   socket.on('offer', ({ sessionId, offer }) => {
//     socket.to(sessionId).emit('offer', { offer });
//   });

//   socket.on('answer', ({ sessionId, answer }) => {
//     socket.to(sessionId).emit('answer', { answer });
//   });

//   socket.on('ice-candidate', ({ sessionId, candidate }) => {
//     socket.to(sessionId).emit('ice-candidate', { candidate });
//   });

//   socket.on('control-event', ({ sessionId, event }) => {
//     socket.to(sessionId).emit('control-event', { event });
//   });

//   // 🔴 NEW: end-session from customer
//   socket.on('end-session', ({ sessionId }) => {
//     console.log(`Ending session ${sessionId} on request of client`);
//     io.to(sessionId).emit('session-ended', {
//       sessionId,
//       reason: 'customer_stopped'
//     });

//   socket.on('register', ({ role, sessionId }, ack) => {
//     try {
//       socket.join(sessionId);
//       socket.data.role = role;
//       socket.data.sessionId = sessionId;
  
//       // respond success
//       if (typeof ack === 'function') ack({ ok: true });
//     } catch (e) {
//       if (typeof ack === 'function') ack({ ok: false, error: e.message });
//     }
//   });

//     // optional: make this socket leave the room
//     socket.leave(sessionId);
//   });
// });

// IMPORTANT: listen on 0.0.0.0, not just localhost
const PORT = 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server listening on http://0.0.0.0:${PORT}`);
});