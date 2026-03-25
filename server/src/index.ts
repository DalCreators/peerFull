/**
 * CodeSync Signaling Server
 * ─────────────────────────
 * Responsibilities:
 *   • Socket.io hub for room creation/joining
 *   • Yjs update relay (delta sync)
 *   • Text chat relay
 *   • WebRTC signaling (offer/answer/ice forwarding)
 *   • Session time limiting for free tier
 *   • REST API for license validation and Stripe webhooks
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { RoomManager, RoomType } from './rooms';
import { setupDatabase } from './database';
import { licenseRouter } from './routes/license';
import { stripeRouter } from './routes/stripe';
import { getCallPageHtml } from './callPage';
import { sendFilesToSubscribers } from './email';

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || '*').split(',');

// ── Express + HTTP + Socket.io setup ────────────────────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGINS, methods: ['GET', 'POST'] }
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: CLIENT_ORIGINS }));
// Raw body needed for Stripe webhook signature verification
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── REST Routes ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: Date.now() }));
app.get('/call/:roomCode', (_req, res) => res.send(getCallPageHtml()));
app.use('/api/license', licenseRouter);
app.use('/api/stripe', stripeRouter);

// ── Room manager ─────────────────────────────────────────────────────────────
const roomManager = new RoomManager();
// Track voice-only browser sockets (socketId -> roomCode)
const voiceOnlySockets = new Map<string, string>();
const voiceSocketUsernames = new Map<string, string>(); // socketId → username

// ── Socket.io event handling ─────────────────────────────────────────────────
io.on('connection', (socket: Socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // ── Create room ──────────────────────────────────────────────────────
  socket.on('create-room', (data: {
    username: string; isPro: boolean; folderName?: string;
    snapshot?: Record<string, string>; roomType?: RoomType;
  }, callback) => {
    try {
      const room = roomManager.createRoom(socket.id, data.username, data.isPro);
      room.folderName = data.folderName || 'workspace';
      room.folderSnapshot = data.snapshot || {};
      room.roomType = data.roomType || 'work';
      socket.join(room.code);
      console.log(`[Room] Created ${room.code} by ${data.username} (type: ${room.roomType}, folder: ${room.folderName})`);

      // Start session timer for free users
      if (!data.isPro) {
        startSessionTimer(socket, room.code);
      }

      callback({ roomCode: room.code, roomType: room.roomType });

      // Broadcast updated user list
      broadcastUsers(room.code);
    } catch (err) {
      callback({ error: 'Failed to create room' });
    }
  });

  // ── Join room ────────────────────────────────────────────────────────
  socket.on('join-room', (data: { roomCode: string; username: string; isPro: boolean }, callback) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    // Free tier: max 5 people; Pro: max 10
    const maxUsers = room.isPro ? 10 : 5;
    if (room.users.size >= maxUsers) {
      callback({ success: false, error: `Room is full (max ${maxUsers} users)` });
      return;
    }

    roomManager.addUser(data.roomCode, socket.id, data.username);
    socket.join(data.roomCode);
    console.log(`[Room] ${data.username} joined ${data.roomCode}`);

    // Send the current Yjs document state to the joiner (full state vector)
    const yjsState = Array.from(room.getStateUpdate());

    callback({
      success: true,
      yjsState,
      folderName: room.folderName,
      snapshot: room.folderSnapshot,
      roomType: room.roomType
    });

    // Broadcast updated user list to everyone
    broadcastUsers(data.roomCode);

    // Notify existing users so they can initiate WebRTC calls
    socket.to(data.roomCode).emit('peer-joined', { peerId: socket.id });
  });

  // ── Yjs delta relay ──────────────────────────────────────────────────
  socket.on('yjs-update', (data: { roomCode: string; update: number[] }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;

    // In tutor mode, only the host may push edits
    if (room.roomType === 'tutor' && socket.id !== room.hostId) return;

    const update = new Uint8Array(data.update);
    room.applyUpdate(update);

    // Relay to everyone else in the room
    socket.to(data.roomCode).emit('yjs-update', update);
  });

  // ── File focus (who opened which file) ───────────────────────────────
  socket.on('file-focus', (data: { roomCode: string; relativePath: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    user.currentFile = data.relativePath;

    // In tutor mode, only host can steer others' file focus
    if (room.roomType === 'tutor' && socket.id !== room.hostId) {
      broadcastUsers(data.roomCode);
      return;
    }

    socket.to(data.roomCode).emit('user-file-focus', {
      userId: socket.id,
      username: user.username,
      color: user.color,
      relativePath: data.relativePath
    });
    broadcastUsers(data.roomCode);
  });

  // ── Cursor position ──────────────────────────────────────────────────
  socket.on('cursor-update', (data: { roomCode: string; position: number; length: number }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;

    const user = room.users.get(socket.id);
    if (!user) return;

    socket.to(data.roomCode).emit('cursor-update', {
      userId: socket.id,
      username: user.username,
      color: user.color,
      position: data.position,
      length: data.length
    });
  });

  // ── Chat message ─────────────────────────────────────────────────────
  socket.on('chat-message', (data: { text: string }) => {
    const roomCode = roomManager.getRoomForUser(socket.id);
    if (!roomCode) return;

    const room = roomManager.getRoom(roomCode)!;
    const user = room.users.get(socket.id);
    if (!user) return;

    const msg = {
      id: socket.id,
      username: user.username,
      text: data.text.slice(0, 500), // limit message length
      timestamp: Date.now()
    };

    // Broadcast to all including sender
    io.to(roomCode).emit('chat-message', msg);
  });

  // ── File created ─────────────────────────────────────────────────────
  socket.on('file-created', (data: { roomCode: string; relativePath: string; content: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    // In tutor mode, only host may create files for others
    if (room.roomType === 'tutor' && socket.id !== room.hostId) return;
    room.folderSnapshot[data.relativePath] = data.content;
    socket.to(data.roomCode).emit('file-created', { relativePath: data.relativePath, content: data.content });
  });

  // ── Folder created ────────────────────────────────────────────────────
  socket.on('folder-created', (data: { roomCode: string; relativePath: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    if (room.roomType === 'tutor' && socket.id !== room.hostId) return;
    socket.to(data.roomCode).emit('folder-created', { relativePath: data.relativePath });
  });

  // ── File updated (Yjs content saved back to snapshot) ────────────────
  socket.on('file-updated', (data: { roomCode: string; relativePath: string; content: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    room.folderSnapshot[data.relativePath] = data.content;
  });

  // ── Email subscription ────────────────────────────────────────────────
  socket.on('subscribe-email', (data: { roomCode: string; email: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    const email = data.email.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (!room.subscribers.includes(email)) {
      room.subscribers.push(email);
      console.log(`[Subscribe] ${email} subscribed to room ${data.roomCode}`);
    }
    socket.emit('subscribe-confirmed', { email });
  });

  // ── Call join (extension socket already in room) ─────────────────────
  socket.on('call-join', (data: { roomCode: string; isPanel?: boolean }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    room.callParticipants.add(socket.id);
    const others = Array.from(room.callParticipants).filter(id => id !== socket.id);
    socket.emit('call-participants', { participants: others });
    if (data.isPanel) {
      // Panel is receive-only — tell existing participants to initiate toward it
      socket.to(data.roomCode).emit('call-panel-joined', { peerId: socket.id });
    } else {
      socket.to(data.roomCode).emit('call-peer-joined', { peerId: socket.id });
    }
  });

  // ── Call leave ───────────────────────────────────────────────────────
  socket.on('call-leave', (data: { roomCode: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (room) room.callParticipants.delete(socket.id);
    socket.to(data.roomCode).emit('call-peer-left', { peerId: socket.id });
  });

  // ── Force-end call (extension closing → close any open browser tabs) ─
  socket.on('call-force-end', (data: { roomCode: string }) => {
    socket.to(data.roomCode).emit('call-force-end');
  });

  // ── Media control (VS Code panel → mini browser mic/cam toggle) ───────
  socket.on('call-media-control', (data: { roomCode: string; mic?: boolean; cam?: boolean }) => {
    socket.to(data.roomCode).emit('call-media-control', { mic: data.mic, cam: data.cam });
  });

  // ── Voice-only join (browser tab, not a full room member) ────────────
  socket.on('call-join-voice', (data: { roomCode: string; username: string }, callback) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) { callback({ error: 'Room not found' }); return; }
    socket.join(data.roomCode);
    voiceOnlySockets.set(socket.id, data.roomCode);
    voiceSocketUsernames.set(socket.id, data.username);
    room.callParticipants.add(socket.id);
    const others = Array.from(room.callParticipants).filter(id => id !== socket.id);
    const othersWithNames = others.map(id => ({
      peerId: id,
      username: voiceSocketUsernames.get(id) || room.users.get(id)?.username || id.slice(0, 6)
    }));
    socket.emit('call-participants', { participants: othersWithNames });
    socket.to(data.roomCode).emit('call-peer-joined', { peerId: socket.id, username: data.username });
    console.log(`[Call] ${data.username} joined voice call in ${data.roomCode}`);
    callback({ success: true });
  });

  // ── Voice-only leave ─────────────────────────────────────────────────
  socket.on('call-leave-voice', (data: { roomCode: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (room) room.callParticipants.delete(socket.id);
    voiceOnlySockets.delete(socket.id);
    socket.to(data.roomCode).emit('call-peer-left', { peerId: socket.id });
  });

  // ── Share file (manual broadcast of active file to all peers) ────────
  socket.on('share-file', (data: { roomCode: string; relativePath: string; content: string }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (room) { room.folderSnapshot[data.relativePath] = data.content; }
    socket.to(data.roomCode).emit('file-shared', { relativePath: data.relativePath, content: data.content });
  });

  // ── Shared code run output ───────────────────────────────────────────
  socket.on('run-output', (data: { roomCode: string; chunk: string; isError?: boolean; done?: boolean }) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return;
    const user = room.users.get(socket.id);
    io.to(data.roomCode).emit('run-output', {
      chunk: data.chunk,
      isError: data.isError,
      done: data.done,
      username: user?.username
    });
  });

  // ── WebRTC signaling ─────────────────────────────────────────────────
  socket.on('webrtc-signal', (data: { to: string; signal: unknown }) => {
    // Forward signal to the target peer
    io.to(data.to).emit('webrtc-signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);

    // Full room member disconnect
    const roomCode = roomManager.getRoomForUser(socket.id);
    if (roomCode) {
      const room = roomManager.getRoom(roomCode);
      const subscribers = room?.subscribers ?? [];
      const snapshot = room?.folderSnapshot ?? {};
      const folderName = room?.folderName ?? 'workspace';

      roomManager.removeUser(roomCode, socket.id);
      broadcastUsers(roomCode);
      socket.to(roomCode).emit('peer-left', { peerId: socket.id });
      socket.to(roomCode).emit('call-peer-left', { peerId: socket.id });

      // If room is now empty and has subscribers, send them the files.
      // Note: the room still exists in the manager (2-min grace period before
      // deletion), so we check isEmpty rather than !room.
      const updatedRoom = roomManager.getRoom(roomCode);
      if (updatedRoom?.isEmpty && subscribers.length > 0) {
        console.log(`[Email] Room ${roomCode} empty — sending files to ${subscribers.length} subscriber(s)`);
        sendFilesToSubscribers(subscribers, snapshot, folderName, roomCode).catch(console.error);
      }
    }

    // Voice-only browser tab disconnect
    const voiceRoomCode = voiceOnlySockets.get(socket.id);
    if (voiceRoomCode) {
      const room = roomManager.getRoom(voiceRoomCode);
      if (room) room.callParticipants.delete(socket.id);
      voiceOnlySockets.delete(socket.id);
      voiceSocketUsernames.delete(socket.id);
      socket.to(voiceRoomCode).emit('call-peer-left', { peerId: socket.id });
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  function broadcastUsers(roomCode: string) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    const users = Array.from(room.users.entries()).map(([id, u]) => ({
      id,
      username: u.username,
      color: u.color,
      isHost: id === room.hostId,
      currentFile: u.currentFile
    }));
    io.to(roomCode).emit('users-changed', users);
  }

  function startSessionTimer(socket: Socket, roomCode: string) {
    const FREE_TIER_SECONDS = 1800; // 30 minutes
    const WARNING_AT = [300, 120, 60, 30]; // warn at these intervals
    let secondsLeft = FREE_TIER_SECONDS;

    const interval = setInterval(() => {
      secondsLeft--;

      if (WARNING_AT.includes(secondsLeft)) {
        socket.emit('session-warning', { secondsLeft });
      }

      if (secondsLeft <= 0) {
        clearInterval(interval);
        socket.emit('session-ended', { reason: 'Free tier 30-minute limit reached. Upgrade to Pro for unlimited sessions.' });
        socket.disconnect();
      }
    }, 1000);

    // Clean up timer if socket disconnects early
    socket.on('disconnect', () => clearInterval(interval));
  }
});

// ── Start server ─────────────────────────────────────────────────────────────
async function main() {
  // Initialize DB (non-fatal if not configured — server still works for local dev)
  try {
    await setupDatabase();
  } catch (err) {
    console.warn('[DB] Database not configured — running without persistence');
  }

  httpServer.listen(PORT, () => {
    console.log(`\n🚀 CodeSync server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  });
}

main().catch(console.error);
