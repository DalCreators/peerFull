/**
 * panelHtml.ts
 * Generates the full HTML for the CodeSync sidebar webview.
 * Includes the UI for users list, chat, voice call controls.
 */

import * as vscode from 'vscode';

export function getSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri, socketUri: vscode.Uri): string {
  const nonce = getNonce();

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none';
      script-src 'nonce-${nonce}' ${webview.cspSource};
      style-src 'unsafe-inline';
      media-src *;
      connect-src *;
      img-src * data:;"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeSync</title>
  <style>
    /* ── Reset & Variables ───────────────────────────── */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e1e);
      --fg: var(--vscode-foreground, #ccc);
      --accent: #7c3aed;
      --accent-hover: #6d28d9;
      --border: var(--vscode-panel-border, #333);
      --input-bg: var(--vscode-input-background, #2a2a2a);
      --btn-bg: var(--vscode-button-background, #7c3aed);
      --btn-fg: var(--vscode-button-foreground, #fff);
      --chat-bg: var(--vscode-editor-background, #1a1a1a);
      --user-bubble: #2e3440;
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: 13px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Sections ────────────────────────────────────── */
    .section { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      margin-bottom: 8px;
    }

    /* ── Header ──────────────────────────────────────── */
    #header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }
    #header .logo {
      width: 24px; height: 24px;
      background: var(--accent);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #fff; flex-shrink: 0;
    }
    #header .title { font-weight: 600; font-size: 14px; }
    #header .pro-badge {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #000;
      font-size: 9px; font-weight: 700;
      padding: 2px 5px; border-radius: 4px;
      margin-left: auto;
    }

    /* ── Lobby (not in room) ─────────────────────────── */
    #lobby { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    #lobby input {
      width: 100%;
      padding: 7px 10px;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--fg);
      font-size: 13px;
      outline: none;
    }
    #lobby input:focus { border-color: var(--accent); }
    .btn {
      width: 100%;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: background 0.15s;
    }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.05); }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .divider { text-align: center; opacity: 0.4; font-size: 11px; }
    .pro-upsell {
      background: rgba(124,58,237,0.15);
      border: 1px solid rgba(124,58,237,0.4);
      border-radius: 8px;
      padding: 10px;
      text-align: center;
      font-size: 12px;
    }
    .pro-upsell strong { color: #a78bfa; }
    .pro-upsell ul { text-align: left; margin: 6px 0 8px 16px; opacity: 0.8; }

    /* ── Room View ───────────────────────────────────── */
    #room-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

    /* Room header bar */
    #room-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
    }
    #room-code-display {
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 8px;
      font-family: monospace;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #a78bfa;
      cursor: pointer;
      title: 'Click to copy';
    }
    #room-code-display:hover { border-color: var(--accent); }
    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }
    #leave-btn {
      margin-left: auto;
      padding: 4px 8px;
      font-size: 11px;
      width: auto;
    }

    /* Timer */
    #session-timer {
      padding: 4px 12px;
      font-size: 11px;
      opacity: 0.6;
      display: none;
    }
    #session-timer.warning { color: #f59e0b; opacity: 1; }

    /* Users list */
    #users-list { display: flex; flex-direction: column; gap: 6px; }
    .user-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 6px;
    }
    .user-avatar {
      width: 28px; height: 28px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 12px; color: #fff;
      flex-shrink: 0;
      border: 2px solid transparent;
    }
    .user-name { font-size: 12px; }
    .user-host-badge {
      font-size: 9px; opacity: 0.6;
      margin-left: auto;
    }

    /* ── Call ────────────────────────────────────────── */
    .call-avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: #fff;
      position: relative;
      border: 2px solid transparent;
    }
    .call-avatar.speaking { border-color: #22c55e; }
    .call-avatar.muted::after {
      content: '🔇';
      position: absolute; bottom: -4px; right: -4px;
      font-size: 10px; background: var(--bg); border-radius: 50%;
    }
    #call-active-controls { display: flex; }

    .icon-btn {
      flex: 1;
      padding: 6px;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--fg);
      cursor: pointer;
      font-size: 16px;
      text-align: center;
    }
    .icon-btn:hover { border-color: var(--accent); }
    .icon-btn.active { background: #dc2626; border-color: #dc2626; }

    /* Chat */
    #chat-section { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    #chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .chat-msg { display: flex; flex-direction: column; gap: 2px; }
    .chat-msg .meta { font-size: 10px; opacity: 0.5; }
    .chat-msg .meta .sender { font-weight: 600; opacity: 1; }
    .chat-msg .bubble {
      background: var(--user-bubble);
      border-radius: 0 8px 8px 8px;
      padding: 5px 9px;
      font-size: 12px;
      line-height: 1.4;
      max-width: 90%;
      word-break: break-word;
    }
    .chat-msg.self .bubble {
      background: rgba(124,58,237,0.3);
      border-radius: 8px 0 8px 8px;
      align-self: flex-end;
    }
    .chat-msg.self .meta { align-self: flex-end; }
    #chat-input-row {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid var(--border);
    }
    #chat-input {
      flex: 1;
      padding: 6px 10px;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--fg);
      font-size: 12px;
      outline: none;
    }
    #chat-input:focus { border-color: var(--accent); }
    #send-btn {
      padding: 6px 10px;
      width: auto;
      font-size: 16px;
    }

    /* Misc */
    .hidden { display: none !important; }
    .error-msg { color: #f87171; font-size: 12px; text-align: center; }
    .spinner {
      text-align: center;
      opacity: 0.5;
      font-size: 12px;
      padding: 20px;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div id="header">
    <div class="logo">⚡</div>
    <span class="title">CodeSync</span>
    <span id="pro-badge" class="pro-badge hidden">PRO</span>
  </div>

  <!-- ── LOBBY VIEW (not connected to a room) ── -->
  <div id="lobby">
    <div>
      <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:4px;">Your name</label>
      <input id="username-input" type="text" placeholder="e.g. Alex" maxlength="24" />
    </div>

    <button class="btn btn-primary" id="create-btn">⚡ Create Room</button>
    <div class="divider">── or ──</div>

    <div>
      <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:4px;">Room code</label>
      <input id="join-code-input" type="text" placeholder="ABC123" maxlength="6"
        style="text-transform:uppercase;letter-spacing:0.1em;font-family:monospace;" />
    </div>
    <button class="btn btn-secondary" id="join-btn">→ Join Room</button>

    <div id="error-area" class="error-msg hidden"></div>

    <!-- Pro upsell for free users -->
    <div id="pro-upsell" class="pro-upsell">
      <strong>🚀 CodeSync Pro</strong>
      <ul>
        <li>Voice &amp; audio calling</li>
        <li>Up to 5 people</li>
        <li>Unlimited session time</li>
        <li>Session recording</li>
      </ul>
      <button class="btn btn-primary" id="activate-license-btn" style="font-size:12px;">
        Activate License Key
      </button>
    </div>
  </div>

  <!-- ── ROOM VIEW (connected) ── -->
  <div id="room-view" class="hidden">
    <!-- Room header -->
    <div id="room-header">
      <span class="status-dot"></span>
      <span id="room-code-display" title="Click to copy room code">••••••</span>
      <button class="btn btn-danger" id="leave-btn">Leave</button>
    </div>

    <!-- Session timer (free tier) -->
    <div id="session-timer">⏱ <span id="timer-text">30:00</span> remaining</div>

    <!-- Scrollable room content -->
    <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;">

      <!-- Users section -->
      <div class="section">
        <div class="section-title">Participants</div>
        <div id="users-list">
          <div class="spinner">Connecting…</div>
        </div>
      </div>

      <!-- Voice Call section -->
      <div id="call-section" class="section">
        <div class="section-title">Voice Call</div>
        <div id="call-actions">
          <button class="btn btn-primary" id="join-call-btn" style="font-size:12px;">🎙 Join Call</button>
        </div>
        <div id="call-active-controls" class="hidden">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;display:inline-block;"></span>
            <span style="font-size:11px;opacity:0.8;">Call active</span>
          </div>
          <button class="btn btn-danger" id="leave-call-btn" style="font-size:11px;width:100%;">End Call</button>
        </div>
      </div>

      <!-- Chat section -->
      <div id="chat-section">
        <div class="section-title" style="padding:8px 12px 0;">Chat</div>
        <div id="chat-messages"></div>
        <div id="chat-input-row">
          <input id="chat-input" type="text" placeholder="Type a message…" maxlength="500" />
          <button class="btn btn-primary" id="send-btn">↑</button>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Scripts ── -->
  <script nonce="${nonce}">
  (function() {
    'use strict';

    // ── VS Code API ──────────────────────────────────────────────────────
    const vscode = acquireVsCodeApi();

    // ── State ────────────────────────────────────────────────────────────
    let currentRoomCode = null;
    let myUsername = '';
    let mySocketId = null;
    let isPro = false;
    let timerInterval = null;
    let secondsLeft = 1800; // 30 min default
    let inCall = false;
    let callPeers = {};

    // ── DOM refs ─────────────────────────────────────────────────────────
    const lobby             = document.getElementById('lobby');
    const roomView          = document.getElementById('room-view');
    const usernameInput     = document.getElementById('username-input');
    const joinCodeInput     = document.getElementById('join-code-input');
    const createBtn         = document.getElementById('create-btn');
    const joinBtn           = document.getElementById('join-btn');
    const leaveBtn          = document.getElementById('leave-btn');
    const roomCodeDisp      = document.getElementById('room-code-display');
    const usersList         = document.getElementById('users-list');
    const chatMessages      = document.getElementById('chat-messages');
    const chatInput         = document.getElementById('chat-input');
    const sendBtn           = document.getElementById('send-btn');
    const errorArea         = document.getElementById('error-area');
    const proBadge          = document.getElementById('pro-badge');
    const proUpsell         = document.getElementById('pro-upsell');
    const sessionTimer      = document.getElementById('session-timer');
    const timerText         = document.getElementById('timer-text');
    const callSection       = document.getElementById('call-section');
    const callAvatars       = document.getElementById('call-avatars');
    const callActions       = document.getElementById('call-actions');
    const joinCallBtn       = document.getElementById('join-call-btn');
    const leaveCallBtn      = document.getElementById('leave-call-btn');
    const callActiveControls = document.getElementById('call-active-controls');
    const activeLicBtn      = document.getElementById('activate-license-btn');

    // ── Init: tell extension webview is ready ───────────────────────────
    vscode.postMessage({ type: 'ready' });

    // ── Message handler from extension ──────────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {

        case 'init':
          isPro = msg.isPro;
          myUsername = msg.username || '';
          usernameInput.value = myUsername;
          _applyProState();
          break;

        case 'roomJoined':
          currentRoomCode = msg.roomCode;
          isPro = msg.isPro;
          _showRoom();
          _applyProState();
          if (!isPro) _startTimer();
          break;

        case 'roomLeft':
          _showLobby();
          break;

        case 'usersChanged':
          _renderUsers(msg.users);
          // Capture own socket ID for call avatar labelling
          const me = msg.users.find(u => u.isMe);
          if (me) mySocketId = me.id;
          break;

        case 'chatMessage':
          _appendChat(msg.msg);
          break;

        case 'proStatusChanged':
          isPro = msg.isPro;
          _applyProState();
          if (currentRoomCode && isPro) {
            clearInterval(timerInterval);
            sessionTimer.style.display = 'none';
          }
          break;

        case 'sessionWarning':
          _updateTimer(msg.secondsLeft);
          break;

        case 'callEvent':
          _handleCallEvent(msg.event);
          break;

        case 'error':
          _showError(msg.message);
          break;
      }
    });

    // ── Button handlers ──────────────────────────────────────────────────

    createBtn.addEventListener('click', () => {
      _saveUsername();
      vscode.postMessage({ type: 'createRoom' });
    });

    joinBtn.addEventListener('click', () => {
      const code = joinCodeInput.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        _showError('Enter a valid 6-character room code');
        return;
      }
      _saveUsername();
      vscode.postMessage({ type: 'joinRoom', roomCode: code });
    });

    joinCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinBtn.click();
    });

    leaveBtn.addEventListener('click', () => {
      _cleanup();
      vscode.postMessage({ type: 'leaveRoom' });
    });

    roomCodeDisp.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyRoomCode', code: currentRoomCode });
    });

    sendBtn.addEventListener('click', _sendChat);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _sendChat();
      }
    });

    activeLicBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'activateLicense' });
    });

    joinCallBtn.addEventListener('click', async () => {
      await _joinCall();
    });

    leaveCallBtn.addEventListener('click', () => {
      _leaveCall();
    });

    // ── Voice call helpers ───────────────────────────────────────────────

    function _joinCall() {
      // Voice calls open in the browser (VS Code webviews can't access the mic)
      inCall = true;
      callActions.classList.add('hidden');
      callActiveControls.classList.remove('hidden');
      const statusEl = document.getElementById('call-status');
      if (statusEl) { statusEl.textContent = '🌐 Call opened in browser'; statusEl.style.display = 'block'; }
      vscode.postMessage({ type: 'joinCall' });
    }

    function _leaveCall() {
      inCall = false;
      callPeers = {};
      callActions.classList.remove('hidden');
      callActiveControls.classList.add('hidden');
      callAvatars.innerHTML = '';
      const statusEl = document.getElementById('call-status');
      if (statusEl) statusEl.style.display = 'none';
      vscode.postMessage({ type: 'leaveCall' });
    }

    function _handleCallEvent(event) {
      if (event.type === 'callPeerJoined') {
        _addCallAvatar(event.peerId, event.peerId.slice(0,4), '#7c3aed');
      } else if (event.type === 'callPeerLeft') {
        document.getElementById(\`call-av-\${event.peerId}\`)?.remove();
      }
    }

    function _addCallAvatar(peerId, label, color) {
      if (document.getElementById(\`call-av-\${peerId}\`)) return;
      const div = document.createElement('div');
      div.id = \`call-av-\${peerId}\`;
      div.className = 'call-avatar';
      div.style.background = color || '#7c3aed';
      div.textContent = (label || '?')[0].toUpperCase();
      div.title = label || peerId;
      callAvatars.appendChild(div);
    }

    // ── UI helpers ───────────────────────────────────────────────────────

    function _showRoom() {
      lobby.classList.add('hidden');
      roomView.classList.remove('hidden');
      roomCodeDisp.textContent = currentRoomCode || '------';
      errorArea.classList.add('hidden');
    }

    function _showLobby() {
      roomView.classList.add('hidden');
      lobby.classList.remove('hidden');
      currentRoomCode = null;
      usersList.innerHTML = '<div class="spinner">Connecting…</div>';
      chatMessages.innerHTML = '';
      clearInterval(timerInterval);
      sessionTimer.style.display = 'none';
    }

    function _applyProState() {
      proBadge.classList.toggle('hidden', !isPro);
      proUpsell.classList.toggle('hidden', isPro);
    }

    function _startTimer() {
      secondsLeft = 1800;
      sessionTimer.style.display = 'block';
      _updateTimer(secondsLeft);
      timerInterval = setInterval(() => {
        secondsLeft--;
        _updateTimer(secondsLeft);
        if (secondsLeft <= 0) {
          clearInterval(timerInterval);
          _cleanup();
          vscode.postMessage({ type: 'leaveRoom' });
        }
      }, 1000);
    }

    function _updateTimer(secs) {
      secondsLeft = secs;
      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = (secs % 60).toString().padStart(2, '0');
      timerText.textContent = m + ':' + s;
      sessionTimer.classList.toggle('warning', secs <= 300);
    }

    function _renderUsers(users) {
      usersList.innerHTML = '';
      users.forEach((u, i) => {
        const colors = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626'];
        const color = colors[i % colors.length];
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = \`
          <div class="user-avatar" style="background:\${color};\${u.isMe ? 'border-color:#7c3aed;' : ''}">
            \${(u.username || '?')[0].toUpperCase()}
          </div>
          <span class="user-name">\${u.username}\${u.isMe ? ' (you)' : ''}</span>
          \${u.isHost ? '<span class="user-host-badge">host</span>' : ''}
        \`;
        usersList.appendChild(div);
      });
    }

    function _appendChat(msg) {
      const div = document.createElement('div');
      div.className = 'chat-msg' + (msg.isMe ? ' self' : '');
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = \`
        <div class="meta"><span class="sender">\${msg.username}</span> · \${time}</div>
        <div class="bubble">\${_escapeHtml(msg.text)}</div>
      \`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function _sendChat() {
      const text = chatInput.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'sendChat', text });
      chatInput.value = '';
    }

    function _showError(msg) {
      errorArea.textContent = msg;
      errorArea.classList.remove('hidden');
      setTimeout(() => errorArea.classList.add('hidden'), 4000);
    }

    function _saveUsername() {
      myUsername = usernameInput.value.trim() || 'Anonymous';
      vscode.postMessage({ type: 'setUsername', username: myUsername });
    }

    function _escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function _cleanup() {
      clearInterval(timerInterval);
      if (inCall) _leaveCall();
      callPeers = {};
    }
  })();
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
