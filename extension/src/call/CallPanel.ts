/**
 * CallPanel.ts
 * VS Code WebviewPanel for the call.
 * - Joins as a receive-only "panel" participant — no getUserMedia needed
 * - Displays video/audio streams from browser participants
 * - If mic/cam available (VS Code), also sends own stream
 */

import * as vscode from 'vscode';
import { YjsSync } from '../sync/YjsSync';

export class CallPanel {
  private static _instance: CallPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;

  static open(
    context: vscode.ExtensionContext,
    yjsSync: YjsSync,
    roomCode: string,
    username: string
  ) {
    if (CallPanel._instance) {
      CallPanel._instance._panel.reveal(vscode.ViewColumn.Two);
      return;
    }
    new CallPanel(context, yjsSync, roomCode, username);
  }

  static close() {
    CallPanel._instance?._dispose();
  }

  private constructor(
    context: vscode.ExtensionContext,
    yjsSync: YjsSync,
    roomCode: string,
    username: string
  ) {
    this._panel = vscode.window.createWebviewPanel(
      'peersyncCall',
      '🎙 PeerSync Call',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );

    const simplePeerUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'simplepeer.min.js')
    );

    this._panel.webview.html = this._buildHtml(simplePeerUri, roomCode, username);

    // Webview → extension → server
    this._panel.webview.onDidReceiveMessage((msg) => {
      if (this._disposed) return;
      switch (msg.type) {
        case 'ready':
          this._panel.webview.postMessage({ type: 'start' });
          // Join as panel — server tells browser tabs to initiate WebRTC toward us
          yjsSync.joinCall(true);
          break;
        case 'webrtcSignal':
          yjsSync.forwardSignal(msg.peerId, msg.signal);
          break;
        case 'leaveCall':
          yjsSync.leaveCall();
          yjsSync.forceEndCall();
          this._dispose();
          break;
        case 'permissionDenied':
          vscode.window.showInformationMessage(
            'PeerSync: Grant camera/microphone access to VS Code or Cursor in System Preferences → Privacy & Security.',
            'Open Privacy Settings'
          ).then(choice => {
            if (choice === 'Open Privacy Settings') {
              vscode.env.openExternal(vscode.Uri.parse('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'));
            }
          });
          break;
      }
    });

    // Server → extension → panel
    yjsSync.onSignal((peerId, signal) => {
      if (!this._disposed) {
        this._panel.webview.postMessage({ type: 'webrtcSignal', peerId, signal });
      }
    });

    yjsSync.onCallEvent((event) => {
      if (!this._disposed) {
        this._panel.webview.postMessage({ type: 'callEvent', event });
      }
    });

    this._panel.onDidDispose(() => {
      yjsSync.leaveCall();
      this._disposed = true;
      CallPanel._instance = undefined;
    });

    CallPanel._instance = this;
  }

  private _dispose() {
    this._disposed = true;
    CallPanel._instance = undefined;
    this._panel.dispose();
  }

  private _buildHtml(simplePeerUri: vscode.Uri, roomCode: string, username: string): string {
    const nonce = getNonce();
    const webview = this._panel.webview;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      script-src 'nonce-${nonce}' ${webview.cspSource};
      style-src 'unsafe-inline';
      media-src *;
      connect-src *;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>PeerSync Call</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }

    /* ── Status bar ── */
    #statusbar {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; font-size: 12px; opacity: 0.7;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      flex-shrink: 0;
    }
    #statusbar.error { color: #f87171; opacity: 1; }

    /* ── Video grid ── */
    #video-grid {
      flex: 1; display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 6px; padding: 10px; overflow-y: auto;
      align-content: start;
    }
    .video-tile {
      position: relative; background: #000;
      border-radius: 8px; overflow: hidden;
      aspect-ratio: 16/9; border: 2px solid transparent;
    }
    .video-tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile-label {
      position: absolute; bottom: 5px; left: 7px;
      font-size: 11px; color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9); font-weight: 600;
    }
    .no-video {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: #1a1a1a;
    }
    .avatar-circle {
      width: 52px; height: 52px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; color: #fff;
    }
    #self-tile video { transform: scaleX(-1); }

    /* ── Empty state ── */
    #empty {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 12px; opacity: 0.6;
    }
    #empty.hidden { display: none; }
    #empty p { font-size: 13px; text-align: center; max-width: 260px; line-height: 1.5; }

    /* ── Controls ── */
    #controls {
      display: flex; align-items: center; justify-content: center;
      gap: 10px; padding: 10px 12px;
      border-top: 1px solid var(--vscode-panel-border, #333); flex-shrink: 0;
    }
    .ctrl-btn {
      width: 40px; height: 40px; border-radius: 50%; border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; font-size: 16px; background: var(--vscode-input-background, #2a2a2a);
      color: var(--vscode-foreground, #ccc); transition: background 0.15s;
    }
    .ctrl-btn:hover { filter: brightness(1.2); }
    .ctrl-btn.off { background: #dc2626; }
    #leave-btn { background: #dc2626; color: #fff; }
    #mic-btn, #cam-btn { display: none; }

  </style>
</head>
<body>
  <div id="statusbar">Initialising…</div>

  <div id="video-grid"></div>

  <div id="empty">
    <div style="font-size:48px;">🎙</div>
    <p>Waiting for participants to join the call…<br/>Click <strong>Open in browser</strong> above to share your camera and mic.</p>
  </div>

  <div id="controls">
    <button class="ctrl-btn" id="mic-btn" title="Mute">🎤</button>
    <button class="ctrl-btn" id="cam-btn" title="Camera off">📷</button>
    <button class="ctrl-btn" id="leave-btn" title="Leave">📵</button>
  </div>

  <script nonce="${nonce}" src="${simplePeerUri}"></script>
  <script nonce="${nonce}">
  (function() {
    const vscode = acquireVsCodeApi();
    const username = ${JSON.stringify(username)};
    const COLORS = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2'];
    let colorIdx = 0;

    // Panel is RECEIVE-ONLY by default; if getUserMedia succeeds we also send
    let localStream = null;
    let micOn = true, camOn = true;
    const peers = {};
    let pendingSignals = []; // signals before stream attempt finishes

    const statusbar  = document.getElementById('statusbar');
    const grid       = document.getElementById('video-grid');
    const empty      = document.getElementById('empty');
    const controls   = document.getElementById('controls');
    const micBtn   = document.getElementById('mic-btn');
    const camBtn   = document.getElementById('cam-btn');
    const leaveBtn = document.getElementById('leave-btn');

    function log(msg, isError) {
      statusbar.textContent = msg;
      statusbar.className = isError ? 'error' : '';
    }

    function showEmpty(show) { empty.classList.toggle('hidden', !show); }

    // ── Video tile helpers ─────────────────────────────────────────────

    function addTile(id, name, stream, isSelf) {
      if (document.getElementById('tile-' + id)) return;
      showEmpty(false);

      const tile = document.createElement('div');
      tile.className = 'video-tile'; tile.id = 'tile-' + id;
      if (isSelf) tile.classList.add('self-tile');

      _setTileContent(tile, stream, isSelf);

      const label = document.createElement('div');
      label.className = 'tile-label';
      label.textContent = name + (isSelf ? ' (you)' : '');
      tile.appendChild(label);
      grid.appendChild(tile);

      // Auto-enter PiP on first tile
      if (!pipActive) enterPip();
    }

    function _setTileContent(tile, stream, isSelf) {
      const hasVideo = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;
      const old = tile.querySelector('video, .no-video');
      if (old) old.remove();

      if (hasVideo) {
        const video = document.createElement('video');
        video.autoplay = true; video.playsInline = true;
        if (isSelf) { video.muted = true; video.style.transform = 'scaleX(-1)'; }
        video.srcObject = stream;
        tile.insertBefore(video, tile.querySelector('.tile-label'));
      } else {
        const noVid = document.createElement('div');
        noVid.className = 'no-video';
        const av = document.createElement('div');
        av.className = 'avatar-circle';
        av.style.background = COLORS[colorIdx++ % COLORS.length];
        av.textContent = ((tile.querySelector('.tile-label')?.textContent || '?')[0]).toUpperCase();
        noVid.appendChild(av);
        tile.insertBefore(noVid, tile.querySelector('.tile-label'));
      }
    }

    function updateTileStream(id, stream) {
      const tile = document.getElementById('tile-' + id);
      if (!tile) { addTile(id, id.slice(0,6), stream, false); return; }
      _setTileContent(tile, stream, tile.classList.contains('self-tile'));
    }

    function removeTile(id) {
      document.getElementById('tile-' + id)?.remove();
      if (!grid.querySelector('.video-tile')) showEmpty(true);
    }

    // ── Start ──────────────────────────────────────────────────────────

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'start': startPanel(); break;
        case 'webrtcSignal': handleSignal(msg.peerId, msg.signal); break;
        case 'callEvent': handleCallEvent(msg.event); break;
      }
    });

    vscode.postMessage({ type: 'ready' });

    // ── Picture-in-Picture (canvas composite, works on Mac + Windows) ────

    const pipCanvas = document.createElement('canvas');
    pipCanvas.width = 640; pipCanvas.height = 360;
    const pipCtx = pipCanvas.getContext('2d');
    let pipVideo = null;
    let pipRafId = null;
    let pipActive = false;

    function drawPipFrame() {
      const videos = [...grid.querySelectorAll('video')];
      pipCtx.fillStyle = '#111';
      pipCtx.fillRect(0, 0, 640, 360);
      if (videos.length > 0) {
        const cols = Math.ceil(Math.sqrt(videos.length));
        const rows = Math.ceil(videos.length / cols);
        const w = 640 / cols, h = 360 / rows;
        videos.forEach((v, i) => {
          try { pipCtx.drawImage(v, (i % cols) * w, Math.floor(i / cols) * h, w, h); } catch(_) {}
        });
      }
      pipRafId = requestAnimationFrame(drawPipFrame);
    }

    async function enterPip() {
      if (pipActive || !document.pictureInPictureEnabled) return;
      pipActive = true;
      drawPipFrame();
      pipVideo = document.createElement('video');
      pipVideo.muted = true;
      pipVideo.srcObject = pipCanvas.captureStream(25);
      pipVideo.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;';
      document.body.appendChild(pipVideo);
      try {
        await pipVideo.play();
        await pipVideo.requestPictureInPicture();
        // Re-enter PiP if user closes it — call should always float
        pipVideo.addEventListener('leavepictureinpicture', () => {
          setTimeout(() => {
            if (!pipVideo) return;
            pipVideo.requestPictureInPicture().catch(() => {});
          }, 300);
        });
      } catch(e) {
        console.error('[PeerSync] PiP failed:', e.name, e.message);
        pipActive = false;
      }
    }

    function exitPip() {
      if (pipRafId) { cancelAnimationFrame(pipRafId); pipRafId = null; }
      if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); }
      pipVideo?.remove(); pipVideo = null; pipActive = false;
    }

    async function startPanel() {
      log('Joining call…');

      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        log('In call 🎙');
        micBtn.style.display = 'flex';
        camBtn.style.display = 'flex';
        addTile('__me__', username, localStream, true);
      } catch (e1) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          log('In call (audio only) 🎙');
          micBtn.style.display = 'flex';
          addTile('__me__', username, localStream, true);
        } catch (e2) {
          if (e2.name === 'NotAllowedError' || e2.name === 'PermissionDeniedError') {
            log('Camera/mic blocked — check notification', true);
            vscode.postMessage({ type: 'permissionDenied' });
          } else {
            log('No mic/cam — viewing only');
          }
        }
      }

      pendingSignals.forEach(({ peerId, signal }) => _applySignal(peerId, signal));
      pendingSignals = [];
    }

    // ── Call event handling ────────────────────────────────────────────

    function handleCallEvent(event) {
      if (event.type === 'callParticipants') {
        // Panel is NEVER the initiator — browsers initiate toward us via call-panel-joined
        log(event.participants.length ? 'Waiting for peers to connect…' : 'In call — waiting for others…');
      } else if (event.type === 'callPeerLeft') {
        cleanupPeer(event.peerId);
        removeTile(event.peerId);
        log('Peer left the call');
      }
    }

    // ── WebRTC (panel is always non-initiator) ─────────────────────────

    function handleSignal(peerId, signal) {
      // Buffer if we haven't finished the getUserMedia attempt yet
      if (localStream === null && pendingSignals !== null) {
        pendingSignals.push({ peerId, signal });
        return;
      }
      _applySignal(peerId, signal);
    }

    function _applySignal(peerId, signal) {
      if (!peers[peerId]) {
        // Non-initiator — we receive the stream from the browser
        const peer = new SimplePeer({
          initiator: false,
          trickle: true,
          stream: localStream || undefined  // send our stream if we have one
        });
        _setupPeer(peerId, peer);
      }
      peers[peerId].signal(signal);
    }

    function _setupPeer(peerId, peer) {
      peers[peerId] = peer;

      peer.on('signal', data => {
        vscode.postMessage({ type: 'webrtcSignal', peerId, signal: data });
      });

      peer.on('connect', () => {
        log('Connected 🔊');
        if (!document.getElementById('tile-' + peerId)) {
          addTile(peerId, peerId.slice(0, 6), null, false);
        }
      });

      peer.on('stream', stream => {
        log('Receiving stream 🎥');
        updateTileStream(peerId, stream);
      });

      peer.on('close', () => { cleanupPeer(peerId); removeTile(peerId); });
      peer.on('error', e => { console.error('[PeerSync]', e); cleanupPeer(peerId); });
    }

    function cleanupPeer(peerId) {
      if (!peers[peerId]) return;
      try { peers[peerId].destroy(); } catch(_) {}
      delete peers[peerId];
    }

    // ── Controls ──────────────────────────────────────────────────────

    micBtn.addEventListener('click', () => {
      micOn = !micOn;
      localStream?.getAudioTracks().forEach(t => { t.enabled = micOn; });
      micBtn.textContent = micOn ? '🎤' : '🔇';
      micBtn.classList.toggle('off', !micOn);
    });

    camBtn.addEventListener('click', () => {
      camOn = !camOn;
      localStream?.getVideoTracks().forEach(t => { t.enabled = camOn; });
      camBtn.textContent = camOn ? '📷' : '🚫';
      camBtn.classList.toggle('off', !camOn);
      // Update self tile
      const selfTile = document.getElementById('tile-__me__');
      if (selfTile) _setTileContent(selfTile, localStream, true);
    });

    leaveBtn.addEventListener('click', () => {
      exitPip();
      localStream?.getTracks().forEach(t => t.stop());
      Object.values(peers).forEach(p => { try { p.destroy(); } catch(_) {} });
      vscode.postMessage({ type: 'leaveCall' });
    });

  })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
