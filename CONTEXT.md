# CodeSync — Session Context

## What we built
A VS Code extension called **CodeSync** — collaborative coding with real-time sync, chat, and video/audio calling. Think "Live Share + Google Meet" for CS students.

Three parts:
- `extension/` — VS Code Extension (TypeScript)
- `server/` — Node.js signaling server (Railway-deployable)
- `landing/` — Marketing landing page (Vercel-deployable)

## Current Status (2026-03-17)
- ✅ Full project scaffold created
- ✅ Extension compiles (`npm run compile` works)
- ✅ Sidebar UI working (lobby, room view, chat, video section)
- ✅ Chat feature working
- ✅ Real-time editor sync (Yjs) implemented
- ✅ `.vscode/launch.json` added so F5 works
- 🔄 Testing editor sync — in progress
- ❌ Server not deployed yet
- ❌ Video/audio not tested yet
- ❌ Stripe/payments not configured yet

## How to run

### Extension (for development)
```bash
cd extension
npm install
npm run compile
# Press F5 in VS Code to open Extension Development Host
```

### Package as .vsix (for two-window testing)
```bash
cd extension
vsce package --no-dependencies --skip-license
# Then in a second VS Code window:
# Cmd+Shift+P → "Extensions: Install from VSIX" → select codesync-0.1.0.vsix
```

### Server (local)
```bash
cd server
npm install
cp .env.example .env   # fill in vars
npm run dev
# Runs on http://localhost:3001
```

### Point extension at local server
In VS Code settings (settings.json):
```json
"codesync.serverUrl": "http://localhost:3001"
```

## Two-window testing setup
- **Window 1**: F5 → Extension Development Host → Create Room
- **Window 2**: Install .vsix → Join Room with the 6-char code
- When Window 2 joins, a temp file auto-opens at `/tmp/codesync-<code>.txt`
- Type in Window 1 → see changes appear in Window 2

## Key files
| File | What it does |
|---|---|
| `extension/src/extension.ts` | Entry point, command registration |
| `extension/src/sidebar/SidebarProvider.ts` | Webview ↔ extension bridge |
| `extension/src/sidebar/panelHtml.ts` | Full sidebar UI (HTML/CSS/JS) |
| `extension/src/sync/YjsSync.ts` | Real-time sync + colored cursors |
| `extension/src/chat/ChatManager.ts` | Chat over Socket.io |
| `extension/src/auth/LicenseManager.ts` | Pro license key system |
| `server/src/index.ts` | Socket.io hub, session timer, signaling |
| `server/src/rooms.ts` | In-memory room/user state |
| `server/src/database.ts` | Neon.tech PostgreSQL schema |
| `server/src/routes/stripe.ts` | Stripe checkout + webhook |

## Next steps (in order)
1. Finish testing editor sync with two windows
2. Test colored cursors appearing for remote users
3. Deploy server to Railway
4. Test with real server URL
5. Set up Neon.tech DB + add DATABASE_URL to Railway
6. Configure Stripe + test Pro license flow
7. Test video/audio calling (Pro feature)
8. Deploy landing page to Vercel
9. Publish extension to VS Code Marketplace

## Known issues / notes
- `vsce package` must be run from inside `extension/` folder
- VS Code only opens one Extension Development Host window per source window — use .vsix for second test window
- Temp sync file saved at `/tmp/codesync-<roomcode>.txt` on the joiner's machine
- Free tier dev license: any key starting with `CODESYNC-DEV-` works without DB
