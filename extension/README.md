# PeerSync — Collaborative Coding for VS Code

**Code together in real-time, without leaving VS Code.**

PeerSync brings real-time collaboration directly into your editor — shared cursors, instant code sync, built-in chat, and peer-to-peer video calling. No browser tabs, no screen sharing hacks, no latency.

---

## What You Get

### Real-time Code Sync
Every keystroke is synced instantly to your collaborators using **Yjs CRDT** — the same conflict-free technology used by Figma and Google Docs. No merge conflicts. No overwrites. Ever.

### Live Cursors
See exactly where your collaborators are in the file — colored cursor decorations update in real-time as they type and move.

### Workspace Sharing
When a peer joins your room, your entire workspace is shared automatically. They get a full copy of your project files, ready to edit — no manual file sharing needed.

### Built-in Chat
A text chat sidebar so you can communicate without alt-tabbing to Slack or Discord.

### Code Execution
Run your code directly from the sidebar in **Python, Node.js, Go, Java, C, C++, Ruby, TypeScript, or Bash** — and everyone in the room sees the output live.

### Video & Audio Calling *(Pro)*
Peer-to-peer video and audio calls directly inside VS Code via WebRTC — no Zoom, no Google Meet, no external tools.

---

## Getting Started

**1. Create a room**
Click the PeerSync icon in the activity bar → enter your name → click **Create Room** → share the 6-character code with your collaborator.

**2. Join a room**
Click the PeerSync icon → enter your name and the room code → click **Join Room**. Your shared workspace opens instantly.

**3. Code together**
Your files, cursors, and edits are synced in real-time. Use the sidebar to chat, run code, or start a call.

---

## Free vs Pro

| Feature | Free | Pro |
|---|:---:|:---:|
| Real-time code sync | ✅ | ✅ |
| Live cursors | ✅ | ✅ |
| Text chat | ✅ | ✅ |
| Workspace sharing | ✅ | ✅ |
| Code execution | ✅ | ✅ |
| 2-person rooms | ✅ | ✅ |
| 30-minute sessions | ✅ | |
| Video & audio calling | | ✅ |
| Up to 5-person rooms | | ✅ |
| Unlimited session time | | ✅ |

---

## Requirements

- VS Code `1.85.0` or higher
- An internet connection

---

## Extension Settings

| Setting | Description |
|---|---|
| `peersync.username` | Your display name shown to collaborators |
| `peersync.serverUrl` | Custom signaling server URL (advanced) |

---

## Built With

- [Yjs](https://github.com/yjs/yjs) — CRDT-based real-time sync
- [Socket.io](https://socket.io) — WebSocket transport
- [simple-peer](https://github.com/feross/simple-peer) — WebRTC peer-to-peer calls

---

## Feedback & Issues

Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/DalCreators/peerFull/issues).
