/**
 * panelHtml.ts
 * Generates the HTML shell for the CodeSync sidebar webview.
 * The JavaScript logic lives in media/sidebar.js (loaded via script src).
 */

import * as vscode from 'vscode';

export function getSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri, socketUri: vscode.Uri, simplePeerUri: vscode.Uri): string {
  const nonce = getNonce();

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.js')
  );

  return `<!DOCTYPE html>
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
    .section { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      margin-bottom: 8px;
    }
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
    #room-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
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
    }
    #room-code-display:hover { border-color: var(--accent); }
    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }
    #leave-btn { margin-left: auto; padding: 4px 8px; font-size: 11px; width: auto; }
    #session-timer { padding: 4px 12px; font-size: 11px; opacity: 0.6; display: none; }
    #session-timer.warning { color: #f59e0b; opacity: 1; }
    #users-list { display: flex; flex-direction: column; gap: 6px; }
    .user-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 6px 5px 8px;
      border-radius: 6px;
      border-left: 3px solid transparent;
      background: rgba(255,255,255,0.03);
      margin-bottom: 2px;
    }
    .user-avatar {
      width: 26px; height: 26px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 11px; color: #fff;
      flex-shrink: 0;
    }
    .user-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .user-name { font-size: 12px; font-weight: 500; }
    .user-file { font-size: 10px; opacity: 0.5; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user-host-badge { font-size: 9px; opacity: 0.5; flex-shrink: 0; }
    .call-avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: #fff;
      position: relative;
      border: 2px solid transparent;
    }
    .call-avatar.speaking { border-color: #22c55e; }
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
    #send-btn { padding: 6px 10px; width: auto; font-size: 16px; }
    .hidden { display: none !important; }
    .error-msg { color: #f87171; font-size: 12px; text-align: center; }
    .spinner { text-align: center; opacity: 0.5; font-size: 12px; padding: 20px; }
  </style>
</head>
<body>
  <!-- Header -->
  <div id="header">
    <div class="logo">P</div>
    <span class="title">PeerSync</span>
    <span id="pro-badge" class="pro-badge hidden">PRO</span>
  </div>

  <!-- LOBBY VIEW -->
  <div id="lobby">
    <div>
      <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:4px;">Your name</label>
      <input id="username-input" type="text" placeholder="e.g. Alex" maxlength="24" />
    </div>

    <button class="btn btn-primary" id="create-btn">Create Room</button>
    <div class="divider">-- or --</div>

    <div>
      <label style="font-size:11px;opacity:0.6;display:block;margin-bottom:4px;">Room code</label>
      <input id="join-code-input" type="text" placeholder="ABC123" maxlength="6"
        style="text-transform:uppercase;letter-spacing:0.1em;font-family:monospace;" />
    </div>
    <button class="btn btn-secondary" id="join-btn">Join Room</button>

    <div id="error-area" class="error-msg hidden"></div>

    <div id="pro-upsell" class="pro-upsell">
      <strong>CodeSync Pro</strong>
      <ul>
        <li>Voice &amp; audio calling</li>
        <li>Up to 5 people</li>
        <li>Unlimited session time</li>
      </ul>
      <button class="btn btn-primary" id="activate-license-btn" style="font-size:12px;">
        Activate License Key
      </button>
    </div>
  </div>

  <!-- ROOM VIEW -->
  <div id="room-view" class="hidden">
    <div id="room-header">
      <span class="status-dot"></span>
      <span id="room-code-display" title="Click to copy room code">------</span>
      <button class="btn btn-danger" id="leave-btn">Leave</button>
    </div>

    <div id="session-timer">Timer: <span id="timer-text">30:00</span> remaining</div>

    <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;">

      <!-- Users -->
      <div class="section">
        <div class="section-title">Participants</div>
        <div id="users-list">
          <div class="spinner">Connecting...</div>
        </div>
      </div>

      <!-- Share File -->
      <div class="section">
        <button id="share-file-btn" class="btn btn-secondary" style="font-size:12px;">Share Active File with Everyone</button>
        <div id="share-file-msg" style="font-size:10px;opacity:0.6;text-align:center;margin-top:4px;display:none;">File shared!</div>
      </div>

      <!-- Run -->
      <div class="section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div class="section-title" style="margin-bottom:0;">Run</div>
          <div style="display:flex;gap:4px;">
            <button id="run-btn" class="btn btn-primary" style="width:auto;padding:3px 10px;font-size:11px;">Run</button>
            <button id="stop-btn" class="btn btn-danger" style="width:auto;padding:3px 8px;font-size:11px;display:none;">Stop</button>
          </div>
        </div>
        <div id="run-output" style="font-family:monospace;font-size:11px;line-height:1.5;background:var(--chat-bg);border-radius:6px;padding:6px 8px;max-height:160px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;display:none;border:1px solid var(--border);"></div>
      </div>

      <!-- Call -->
      <div id="call-section" class="section">
        <div class="section-title">Voice Call</div>
        <div id="call-actions">
          <button class="btn btn-primary" id="join-call-btn" style="font-size:12px;">Join Call</button>
        </div>
        <div id="call-active-controls" class="hidden">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;display:inline-block;"></span>
            <span style="font-size:11px;opacity:0.8;">Call active</span>
          </div>
          <button class="btn btn-danger" id="leave-call-btn" style="font-size:11px;width:100%;">End Call</button>
        </div>
      </div>

      <!-- Chat -->
      <div id="chat-section">
        <div class="section-title" style="padding:8px 12px 0;">Chat</div>
        <div id="chat-messages"></div>
        <div id="chat-input-row">
          <input id="chat-input" type="text" placeholder="Type a message..." maxlength="500" />
          <button class="btn btn-primary" id="send-btn">Send</button>
        </div>
      </div>

    </div>
  </div>

  <script nonce="${nonce}" src="${socketUri}"></script>
  <script nonce="${nonce}" src="${simplePeerUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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
