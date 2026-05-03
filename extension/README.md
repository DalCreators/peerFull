# PeerSync — Real-time Collaborative Coding

Code together in real-time, directly inside VS Code. No browser required.

## Features

- **Real-time code sync** — Every keystroke synced instantly using Yjs CRDT (no conflicts, ever)
- **Live cursors** — See your collaborator's cursor with colored decorations
- **Text chat** — Built-in sidebar chat while you code
- **File sharing** — Entire workspace folder shared automatically when a peer joins
- **Code execution** — Run code and share output with your peers (Python, Node.js, Go, Java, C/C++, Ruby)
- **Video & audio calling** — WebRTC peer-to-peer calls without leaving VS Code (Pro)

## How to Use

### Create a Room
1. Click the **PeerSync** icon in the activity bar
2. Enter your name and click **Create Room**
3. Share the 6-character room code with your collaborator

### Join a Room
1. Click the **PeerSync** icon in the activity bar
2. Enter your name and the room code
3. Click **Join Room** — the shared workspace opens automatically

### Run Code Together
- Click **Run** in the sidebar to execute the active file
- Output is streamed live to everyone in the room

## Free vs Pro

| Feature | Free | Pro |
|---|:---:|:---:|
| Real-time code sync | ✅ | ✅ |
| Live cursors | ✅ | ✅ |
| Text chat | ✅ | ✅ |
| File sharing | ✅ | ✅ |
| Code execution | ✅ | ✅ |
| 2-person rooms | ✅ | ✅ |
| 30-minute sessions | ✅ | — |
| Video & audio calling | ❌ | ✅ |
| Up to 5-person rooms | ❌ | ✅ |
| Unlimited session time | ❌ | ✅ |

## Activate a Pro License

`Ctrl+Shift+P` → **CodeSync: Activate License Key** → paste your key

## Settings

| Setting | Description |
|---|---|
| `codesync.username` | Your display name in rooms |
| `codesync.serverUrl` | Custom server URL (advanced) |

## Tech

Built with [Yjs](https://github.com/yjs/yjs) (CRDT), [Socket.io](https://socket.io), and [WebRTC](https://webrtc.org).
