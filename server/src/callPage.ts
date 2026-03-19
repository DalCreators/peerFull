/**
 * callPage.ts
 * Browser-based video+audio call page served from the signaling server.
 * Handles getUserMedia, WebRTC via SimplePeer, and video tile grid.
 */

export function getCallPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>PeerSync Call</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #111; color: #ccc;
      font-family: 'Segoe UI', sans-serif;
      display: flex; flex-direction: column;
      height: 100vh; overflow: hidden;
    }

    /* ── Header ── */
    #header {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; background: #1a1a1a;
      border-bottom: 1px solid #333; flex-shrink: 0;
    }
    #header h1 { font-size: 15px; color: #a78bfa; }
    #room-tag { font-family: monospace; font-size: 12px; opacity: 0.5; margin-left: auto; }
    #status { font-size: 12px; opacity: 0.7; }

    /* ── Video grid ── */
    #video-grid {
      flex: 1; display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 8px; padding: 12px; overflow-y: auto;
      align-content: start;
    }
    .video-tile {
      position: relative; background: #000;
      border-radius: 10px; overflow: hidden;
      aspect-ratio: 16/9; border: 2px solid transparent;
      transition: border-color 0.2s;
    }
    .video-tile.speaking { border-color: #22c55e; }
    .video-tile video {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .video-tile .tile-label {
      position: absolute; bottom: 6px; left: 8px;
      font-size: 11px; color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9);
      font-weight: 600;
    }
    .video-tile .no-video {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: #1a1a1a;
    }
    .avatar-circle {
      width: 56px; height: 56px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 700; color: #fff;
    }
    #self-tile video { transform: scaleX(-1); } /* mirror self */

    /* ── Controls ── */
    #controls {
      display: flex; align-items: center; justify-content: center;
      gap: 12px; padding: 12px 16px;
      background: #1a1a1a; border-top: 1px solid #333; flex-shrink: 0;
    }
    .ctrl-btn {
      width: 44px; height: 44px; border-radius: 50%; border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; font-size: 18px; transition: background 0.15s;
      background: #2a2a2a; color: #fff;
    }
    .ctrl-btn:hover { background: #3a3a3a; }
    .ctrl-btn.off { background: #dc2626; }
    #leave-btn { background: #dc2626; }
    #leave-btn:hover { background: #b91c1c; }
    #error { color: #f87171; font-size: 13px; padding: 8px 16px; display: none; }
  </style>
</head>
<body>
  <div id="header">
    <h1>🎙 PeerSync</h1>
    <span id="status">Connecting…</span>
    <span id="room-tag"></span>
  </div>

  <div id="error"></div>
  <div id="video-grid"></div>

  <div id="controls" style="display:none">
    <button class="ctrl-btn" id="mic-btn" title="Mute mic">🎤</button>
    <button class="ctrl-btn" id="cam-btn" title="Turn off camera">📷</button>
    <button class="ctrl-btn" id="leave-btn" title="Leave call">📵</button>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="https://unpkg.com/simple-peer@9/simplepeer.min.js"></script>
  <script>
    const params   = new URLSearchParams(location.search);
    const roomCode = location.pathname.split('/').pop().toUpperCase();
    const username = params.get('u') || 'Anonymous';
    document.getElementById('room-tag').textContent = 'Room: ' + roomCode;

    const socket = io();
    let localStream = null;
    let micOn = true, camOn = true;
    const peers = {};
    let pendingPeers = [];
    let pendingSignals = [];

    const statusEl  = document.getElementById('status');
    const grid      = document.getElementById('video-grid');
    const controls  = document.getElementById('controls');
    const micBtn    = document.getElementById('mic-btn');
    const camBtn    = document.getElementById('cam-btn');
    const leaveBtn  = document.getElementById('leave-btn');
    const errorEl   = document.getElementById('error');

    const COLORS = ['#7c3aed','#2563eb','#16a34a','#d97706','#dc2626','#0891b2'];
    let colorIdx = 0;

    function log(msg) { statusEl.textContent = msg; }
    function showError(msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }

    // ── Video tile helpers ───────────────────────────────────────────────

    function addTile(id, name, stream, isSelf) {
      if (document.getElementById('tile-' + id)) return;
      const tile = document.createElement('div');
      tile.className = 'video-tile'; tile.id = 'tile-' + id;
      if (isSelf) tile.id = 'self-tile';

      const hasVideo = stream && stream.getVideoTracks().length > 0;
      if (hasVideo) {
        const video = document.createElement('video');
        video.autoplay = true; video.playsInline = true;
        if (isSelf) video.muted = true;
        video.srcObject = stream;
        tile.appendChild(video);
      } else {
        const noVid = document.createElement('div');
        noVid.className = 'no-video';
        const av = document.createElement('div');
        av.className = 'avatar-circle';
        av.style.background = COLORS[colorIdx++ % COLORS.length];
        av.textContent = (name || '?')[0].toUpperCase();
        noVid.appendChild(av); tile.appendChild(noVid);
      }

      const label = document.createElement('div');
      label.className = 'tile-label';
      label.textContent = name + (isSelf ? ' (you)' : '');
      tile.appendChild(label);
      grid.appendChild(tile);
    }

    function updateTileStream(id, stream) {
      const tile = document.getElementById('tile-' + id);
      if (!tile) return;
      const existing = tile.querySelector('video');
      if (existing) { existing.srcObject = stream; return; }
      // Replace no-video div with video
      const noVid = tile.querySelector('.no-video');
      if (noVid) {
        const video = document.createElement('video');
        video.autoplay = true; video.playsInline = true;
        video.srcObject = stream;
        tile.insertBefore(video, noVid); noVid.remove();
      }
    }

    function removeTile(id) {
      document.getElementById('tile-' + id)?.remove();
    }

    // ── Start call ───────────────────────────────────────────────────────

    async function start() {
      log('Requesting camera & microphone…');
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (e) {
        // Try audio-only fallback
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          showError('Camera not available — audio only');
        } catch (e2) {
          showError('Microphone denied: ' + e2.message);
          log('Could not access microphone.');
          return;
        }
      }

      log('Joining call…');
      socket.emit('call-join-voice', { roomCode, username }, (res) => {
        if (res && res.error) { showError(res.error); return; }
        log('In call');
        controls.style.display = 'flex';
        addTile('__me__', username, localStream, true);

        // Process any events that arrived before stream was ready
        pendingPeers.forEach(id => initiatePeer(id));
        pendingPeers = [];
        pendingSignals.forEach(({ peerId, signal }) => handleSignal(peerId, signal));
        pendingSignals = [];
      });
    }

    // ── Socket events ────────────────────────────────────────────────────

    socket.on('call-participants', ({ participants }) => {
      log(participants.length ? 'Connecting to ' + participants.length + ' peer(s)…' : 'In call — waiting for others…');
      if (localStream) participants.forEach(id => initiatePeer(id));
      else pendingPeers.push(...participants);
    });

    socket.on('call-peer-joined', ({ peerId }) => {
      // New voice peer joined — they will initiate toward us via call-participants
      log('Peer joining…');
    });

    // Panel joined as display-only — WE initiate (we have the stream)
    socket.on('call-panel-joined', ({ peerId }) => {
      log('VS Code panel connected');
      if (localStream) initiatePeer(peerId);
      else pendingPeers.push(peerId);
    });

    socket.on('call-peer-left', ({ peerId }) => {
      cleanupPeer(peerId); removeTile(peerId); log('Peer left');
    });

    socket.on('webrtc-signal', ({ from, signal }) => {
      if (!localStream) { pendingSignals.push({ peerId: from, signal }); return; }
      handleSignal(from, signal);
    });

    // ── WebRTC ───────────────────────────────────────────────────────────

    function initiatePeer(peerId) {
      if (peers[peerId] || !localStream) return;
      const peer = new SimplePeer({ initiator: true, trickle: true, stream: localStream });
      setupPeer(peerId, peer, true);
    }

    function handleSignal(peerId, signal) {
      if (!peers[peerId]) {
        const peer = new SimplePeer({ initiator: false, trickle: true, stream: localStream });
        setupPeer(peerId, peer, false);
      }
      peers[peerId].signal(signal);
    }

    function setupPeer(peerId, peer, isInitiator) {
      peers[peerId] = peer;
      const color = COLORS[colorIdx++ % COLORS.length];

      peer.on('signal', data => socket.emit('webrtc-signal', { to: peerId, signal: data }));

      peer.on('stream', stream => {
        log('Connected 🔊');
        updateTileStream(peerId, stream);
      });

      peer.on('connect', () => {
        // Add placeholder tile until stream arrives
        if (!document.getElementById('tile-' + peerId)) {
          addTile(peerId, peerId.slice(0, 6), null, false);
        }
      });

      peer.on('close', () => { cleanupPeer(peerId); removeTile(peerId); });
      peer.on('error', e => { console.error(e); cleanupPeer(peerId); });
    }

    function cleanupPeer(peerId) {
      if (!peers[peerId]) return;
      try { peers[peerId].destroy(); } catch(_) {}
      delete peers[peerId];
    }

    // ── Controls ─────────────────────────────────────────────────────────

    micBtn.addEventListener('click', () => {
      micOn = !micOn;
      localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
      micBtn.textContent = micOn ? '🎤' : '🔇';
      micBtn.classList.toggle('off', !micOn);
    });

    camBtn.addEventListener('click', () => {
      camOn = !camOn;
      localStream.getVideoTracks().forEach(t => { t.enabled = camOn; });
      camBtn.textContent = camOn ? '📷' : '🚫';
      camBtn.classList.toggle('off', !camOn);
    });

    leaveBtn.addEventListener('click', () => {
      socket.emit('call-leave-voice', { roomCode });
      localStream?.getTracks().forEach(t => t.stop());
      Object.values(peers).forEach(p => { try { p.destroy(); } catch(_) {} });
      window.close();
    });

    socket.on('connect', start);
  </script>
</body>
</html>`;
}
