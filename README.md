# ⚡ CodeSync — Collaborative Coding for VS Code

> Real-time collaborative code editing, text chat, and video/audio calling — all inside VS Code.
> Think "Microsoft Live Share + Google Meet" but built for CS students.

---

## Project Structure

```
codesync/
├── extension/        VS Code Extension (TypeScript)
│   └── src/
│       ├── extension.ts          Entry point, command registration
│       ├── sidebar/
│       │   ├── SidebarProvider.ts  Webview controller
│       │   └── panelHtml.ts        Sidebar HTML/CSS/JS
│       ├── sync/
│       │   └── YjsSync.ts          Yjs real-time sync + cursor decorations
│       ├── chat/
│       │   └── ChatManager.ts      Text chat over Socket.io
│       └── auth/
│           └── LicenseManager.ts   Pro license key validation
│
├── server/           Signaling server (Node.js + Socket.io)
│   └── src/
│       ├── index.ts              Main server, socket event handlers
│       ├── rooms.ts              In-memory room/user state + Yjs relay
│       ├── database.ts           Neon.tech PostgreSQL setup
│       └── routes/
│           ├── license.ts        POST /api/license/validate
│           └── stripe.ts         Stripe checkout + webhook
│
└── landing/          Marketing page (plain HTML/CSS/JS)
    ├── index.html
    ├── styles.css
    └── script.js
```

---

## Features

| Feature | Free | Pro |
|---|:---:|:---:|
| Real-time code sync (Yjs) | ✅ | ✅ |
| Colored remote cursors | ✅ | ✅ |
| Text chat sidebar | ✅ | ✅ |
| 2-person rooms | ✅ | ✅ |
| 30-minute sessions | ✅ | — |
| Video calling (WebRTC P2P) | ❌ | ✅ |
| Audio calling | ❌ | ✅ |
| Screen sharing | ❌ | ✅ |
| Up to 5-person rooms | ❌ | ✅ |
| Unlimited session time | ❌ | ✅ |
| Session recording | ❌ | ✅ |

---

## Quick Start (Development)

### 1. Backend server

```bash
cd server
cp .env.example .env
# Fill in DATABASE_URL, STRIPE_SECRET_KEY, etc.

npm install
npm run dev
# → Server running on http://localhost:3001
```

### 2. VS Code Extension

```bash
cd extension
npm install

# Open in VS Code
code .

# Press F5 to launch the Extension Development Host
# The CodeSync icon will appear in the activity bar
```

### 3. Landing page

```bash
# No build step needed — open directly in a browser
open landing/index.html
```

---

## Environment Variables

### Server (`server/.env`)

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3001) |
| `CLIENT_ORIGINS` | Comma-separated allowed CORS origins (`*` for dev) |
| `DATABASE_URL` | Neon.tech PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint secret (`whsec_...`) |
| `STRIPE_PRO_PRICE_ID` | Stripe price ID for Pro subscription |
| `LANDING_URL` | URL of your Vercel landing page (for Stripe redirects) |

### Extension (VS Code Settings)

| Setting | Description |
|---|---|
| `codesync.serverUrl` | Backend URL (default: Railway deployment) |
| `codesync.username` | Your display name in rooms |

---

## Deployment

### Backend → Railway

1. Push the `server/` directory to a GitHub repo
2. Connect the repo to [Railway](https://railway.app)
3. Railway auto-detects the `Dockerfile` and deploys
4. Add all environment variables in the Railway dashboard
5. Note your Railway URL — update `codesync.serverUrl` default in `extension/package.json`

```bash
# Test your deployment
curl https://your-app.railway.app/health
# → {"status":"ok","timestamp":...}
```

### Database → Neon.tech

1. Create a free project at [neon.tech](https://neon.tech)
2. Copy the connection string from **Connection Details**
3. Set it as `DATABASE_URL` in Railway environment variables
4. Schema is auto-created on first server start

### Landing Page → Vercel

```bash
cd landing
vercel deploy
```

### VS Code Extension → Marketplace

```bash
cd extension
npm install -g @vscode/vsce

# Package
vsce package
# → codesync-0.1.0.vsix

# Publish (requires Marketplace publisher account)
vsce publish
```

---

## Database Schema

```sql
-- Users (created by Stripe webhook after payment)
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  license_key TEXT UNIQUE,
  tier        TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rooms (tracked for analytics)
CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code   CHAR(6) UNIQUE NOT NULL,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions (start/end timestamps per room)
CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID REFERENCES rooms(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);

-- License keys (provisioned by Stripe webhook)
CREATE TABLE license_keys (
  key        TEXT PRIMARY KEY,
  user_id    UUID REFERENCES users(id),
  tier       TEXT NOT NULL DEFAULT 'pro',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Architecture

```
VS Code Extension (TypeScript)
  │
  │  Socket.io + Yjs deltas
  ▼
Signaling Server (Railway)
  │
  ├── Relays Yjs document updates to all room members
  ├── Relays WebRTC offer/answer/ICE candidates
  ├── Broadcasts chat messages
  ├── Enforces 30-min limit for free tier
  └── Validates license keys against Neon DB
  │
  └── Neon PostgreSQL (users, rooms, licenses)

Video/Audio
  └── WebRTC P2P (browser ↔ browser, server only signals)

Payments
  └── Stripe → webhook → provision license key → email user
```

---

## How Real-time Sync Works

1. The first user (host) opens a file and creates a room
2. Their editor content is inserted into a **Yjs document** (`Y.Text`)
3. When a second user joins, the server sends the current document state
4. Every keystroke produces a **Yjs delta** (not the full document)
5. Deltas are relayed through the server to all room members
6. Each client applies deltas using Yjs's CRDT algorithm — **no conflicts ever**
7. Cursor positions are sent separately as lightweight `cursor-update` events

---

## How to Activate Pro

1. Purchase a Pro license on the landing page
2. Check your email for a key like `CODESYNC-ABCD-EFGH-IJKL`
3. In VS Code: `Cmd/Ctrl+Shift+P` → **"CodeSync: Activate License Key"**
4. Paste your key and press Enter
5. The Pro badge appears and video/audio features unlock immediately

**For development/testing**, any key starting with `CODESYNC-DEV-` is accepted by the server's offline fallback.

---

## Tech Stack

| Layer | Technology |
|---|---|
| VS Code Extension | TypeScript, VS Code Extension API |
| Real-time sync | [Yjs](https://github.com/yjs/yjs) (CRDT) |
| Transport | [Socket.io](https://socket.io) |
| Video/Audio | WebRTC via [simple-peer](https://github.com/feross/simple-peer) |
| Backend | Node.js, Express, TypeScript |
| Database | [Neon.tech](https://neon.tech) (serverless PostgreSQL) |
| Payments | [Stripe](https://stripe.com) |
| Extension hosting | VS Code Marketplace |
| Server hosting | [Railway](https://railway.app) |
| Landing page | Vercel |

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test with F5 in VS Code (extension) and `npm run dev` (server)
5. Submit a PR

---

## License

MIT © CodeSync
