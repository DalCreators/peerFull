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
        retainContextWhenHidden: true, // keep webview alive when tab is hidden so PiP survives
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
        case 'mediaControl':
          yjsSync.controlCallMedia(msg.mic, msg.cam);
          break;
        case 'leaveCall':
          yjsSync.leaveCall();
          yjsSync.forceEndCall();
          this._dispose();
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
      yjsSync.forceEndCall(); // close the companion Chrome window too
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

  private _buildHtml(simplePeerUri: vscode.Uri, _roomCode: string, username: string): string {
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
    .ctrl-btn.off { background: #dc2626; color: #fff; }
    #leave-btn { background: #dc2626; color: #fff; }
    #pip-btn { position: relative; }
    #pip-btn.pulse::after {
      content: '';
      position: absolute; inset: -3px; border-radius: 50%;
      border: 2px solid #7c3aed;
      animation: pip-ring 1s ease-out infinite;
    }
    @keyframes pip-ring {
      0%   { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.6); }
    }

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
    <button class="ctrl-btn" id="mic-btn" title="Mute mic">🎤</button>
    <button class="ctrl-btn" id="cam-btn" title="Turn off camera">📷</button>
    <button class="ctrl-btn" id="pip-btn" title="Float video (Picture-in-Picture)">📺</button>
    <button class="ctrl-btn" id="leave-btn" title="Leave call">📵</button>
  </div>

  <script nonce="${nonce}" src="${simplePeerUri}"></script>
  <script nonce="${nonce}">
  (function() {
    const vscode = acquireVsCodeApi();
    const username = ${JSON.stringify(username)};
    const COLORS = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2'];
    let colorIdx = 0;

    // Panel is display-only — mic/cam handled by the companion mini-browser window
    const peers = {};
    let pendingSignals = [];
    let panelReady = false;

    const ICE_CONFIG = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ]
    };

    const statusbar = document.getElementById('statusbar');
    const grid      = document.getElementById('video-grid');
    const empty     = document.getElementById('empty');
    const micBtn    = document.getElementById('mic-btn');
    const camBtn    = document.getElementById('cam-btn');
    const pipBtn    = document.getElementById('pip-btn');
    const leaveBtn  = document.getElementById('leave-btn');
    let micOn = true, camOn = true;

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

      // Pulse the 📺 button to tell the user to click it for PiP
      if (!pipActive) pipBtn.classList.add('pulse');
    }

    function _setTileContent(tile, stream, isSelf) {
      // Only check track existence, not .enabled — remote tracks may report enabled=false
      const hasVideo = stream && stream.getVideoTracks().length > 0;
      const old = tile.querySelector('video, .no-video');
      if (old) old.remove();

      if (hasVideo) {
        const video = document.createElement('video');
        video.autoplay = true; video.playsInline = true; video.muted = true;
        if (isSelf) video.style.transform = 'scaleX(-1)';
        video.srcObject = stream;
        // Explicit play() required — Electron webview autoplay policy may block it
        video.play().catch(() => {});
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
            pipVideo.requestPictureInPicture().catch(() => {
              // Re-enter failed — reset button so user can try again
              pipActive = false;
              pipBtn.textContent = '📺';
              pipBtn.title = 'Float video (Picture-in-Picture)';
              pipBtn.classList.add('pulse');
            });
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

    function startPanel() {
      log('In call 🎙');
      panelReady = true;
      // Show local "You" placeholder — camera is in the companion mini-browser window
      addTile('__me__', username + ' (you)', null, true);
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
      if (!panelReady) {
        pendingSignals.push({ peerId, signal });
        return;
      }
      _applySignal(peerId, signal);
    }

    function _applySignal(peerId, signal) {
      if (!peers[peerId]) {
        const peer = new SimplePeer({ initiator: false, trickle: true, config: ICE_CONFIG });
        _setupPeer(peerId, peer);
      }
      try { peers[peerId].signal(signal); } catch(e) { console.error('[PeerSync signal]', e); }
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

      // 'track' fires per-track and is more reliable than 'stream' in Electron webviews
      peer.on('track', (track, stream) => {
        if (track.kind === 'video') {
          log('Receiving video 🎥');
          updateTileStream(peerId, stream);
        }
      });

      peer.on('close', () => { cleanupPeer(peerId); removeTile(peerId); });
      peer.on('error', e => { log('Connection error: ' + e.message, true); cleanupPeer(peerId); removeTile(peerId); });
    }

    function cleanupPeer(peerId) {
      if (!peers[peerId]) return;
      try { peers[peerId].destroy(); } catch(_) {}
      delete peers[peerId];
    }

    // ── Controls ──────────────────────────────────────────────────────

    micBtn.addEventListener('click', () => {
      micOn = !micOn;
      micBtn.textContent = micOn ? '🎤' : '🔇';
      micBtn.classList.toggle('off', !micOn);
      vscode.postMessage({ type: 'mediaControl', mic: micOn });
    });

    camBtn.addEventListener('click', () => {
      camOn = !camOn;
      camBtn.textContent = camOn ? '📷' : '🚫';
      camBtn.classList.toggle('off', !camOn);
      vscode.postMessage({ type: 'mediaControl', cam: camOn });
    });

    pipBtn.addEventListener('click', async () => {
      if (pipActive) {
        exitPip();
        pipBtn.textContent = '📺';
        pipBtn.title = 'Float video (Picture-in-Picture)';
      } else {
        pipBtn.classList.remove('pulse');
        await enterPip();
        if (pipActive) {
          pipBtn.textContent = '⊡';
          pipBtn.title = 'Exit float';
        }
      }
    });

    leaveBtn.addEventListener('click', () => {
      exitPip();
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
