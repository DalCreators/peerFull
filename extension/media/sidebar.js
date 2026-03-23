(function() {
  'use strict';

  const vscode = acquireVsCodeApi();

  // State
  let currentRoomCode = null;
  let myUsername = '';
  let mySocketId = null;
  let isPro = false;
  let timerInterval = null;
  let secondsLeft = 1800;
  let inCall = false;
  let callPeers = {};

  // ── PiP / WebRTC (runs inside sidebar webview, no separate tab needed) ──
  var ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };
  var pipCanvas = document.createElement('canvas');
  pipCanvas.width = 640; pipCanvas.height = 360;
  var pipCtx = pipCanvas.getContext('2d');
  var pipVideoEl = null;
  var pipRafId = null;
  var pipActive = false;
  var remoteStreams = {}; // peerId -> MediaStream

  function _drawPip() {
    var streams = Object.values(remoteStreams);
    pipCtx.fillStyle = '#111';
    pipCtx.fillRect(0, 0, 640, 360);
    if (streams.length > 0) {
      var cols = Math.ceil(Math.sqrt(streams.length));
      var rows = Math.ceil(streams.length / cols);
      var w = 640 / cols, h = 360 / rows;
      streams.forEach(function(s, i) {
        var v = s._pipVideo;
        if (v && v.readyState >= 2) {
          try { pipCtx.drawImage(v, (i % cols) * w, Math.floor(i / cols) * h, w, h); } catch(_) {}
        }
      });
    }
    pipRafId = requestAnimationFrame(_drawPip);
  }

  function _enterPip() {
    if (pipActive || !document.pictureInPictureEnabled) return;
    pipActive = true;
    _drawPip();
    pipVideoEl = document.createElement('video');
    pipVideoEl.muted = true;
    pipVideoEl.srcObject = pipCanvas.captureStream(25);
    pipVideoEl.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;';
    document.body.appendChild(pipVideoEl);
    pipVideoEl.play().then(function() {
      return pipVideoEl.requestPictureInPicture();
    }).then(function() {
      pipVideoEl.addEventListener('leavepictureinpicture', function() {
        setTimeout(function() {
          if (pipVideoEl) pipVideoEl.requestPictureInPicture().catch(function(){});
        }, 300);
      });
    }).catch(function() { pipActive = false; });
  }

  function _exitPip() {
    if (pipRafId) { cancelAnimationFrame(pipRafId); pipRafId = null; }
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function(){});
    if (pipVideoEl) { pipVideoEl.remove(); pipVideoEl = null; }
    pipActive = false;
    Object.keys(remoteStreams).forEach(function(k) {
      var s = remoteStreams[k];
      if (s._pipVideo) s._pipVideo.remove();
    });
    remoteStreams = {};
  }

  function _attachStream(peerId, stream) {
    // Create a hidden video element to decode the stream for canvas drawing
    var v = document.createElement('video');
    v.autoplay = true; v.playsInline = true; v.muted = true;
    v.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;';
    v.srcObject = stream;
    v.play().catch(function(){});
    document.body.appendChild(v);
    stream._pipVideo = v;
    remoteStreams[peerId] = stream;
    if (!pipActive) _enterPip();
  }

  function _setupCallPeer(peerId, peer) {
    callPeers[peerId] = peer;
    peer.on('signal', function(data) {
      vscode.postMessage({ type: 'webrtcSignal', peerId: peerId, signal: data });
    });
    peer.on('stream', function(stream) { _attachStream(peerId, stream); });
    peer.on('track', function(track, stream) {
      if (track.kind === 'video') _attachStream(peerId, stream);
    });
    peer.on('connect', function() { if (!pipActive) _enterPip(); });
    peer.on('close', function() {
      if (remoteStreams[peerId] && remoteStreams[peerId]._pipVideo) {
        remoteStreams[peerId]._pipVideo.remove();
      }
      delete remoteStreams[peerId];
      delete callPeers[peerId];
    });
    peer.on('error', function() {
      if (remoteStreams[peerId] && remoteStreams[peerId]._pipVideo) {
        remoteStreams[peerId]._pipVideo.remove();
      }
      delete remoteStreams[peerId];
      delete callPeers[peerId];
    });
  }

  function _applyCallSignal(peerId, signal) {
    if (!callPeers[peerId]) {
      var peer = new SimplePeer({ initiator: false, trickle: true, config: ICE_CONFIG });
      _setupCallPeer(peerId, peer);
    }
    try { callPeers[peerId].signal(signal); } catch(_) {}
  }

  // DOM refs
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
  const callAvatars       = document.getElementById('call-avatars');
  const callActions       = document.getElementById('call-actions');
  const joinCallBtn       = document.getElementById('join-call-btn');
  const leaveCallBtn      = document.getElementById('leave-call-btn');
  const callActiveControls = document.getElementById('call-active-controls');
  const activeLicBtn      = document.getElementById('activate-license-btn');
  const runBtn            = document.getElementById('run-btn');
  const stopBtn           = document.getElementById('stop-btn');
  const runOutput         = document.getElementById('run-output');

  // Tell extension webview is ready
  vscode.postMessage({ type: 'ready' });

  // Message handler from extension
  window.addEventListener('message', function(event) {
    var msg = event.data;
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

      case 'startCall':
        inCall = true;
        _enterPip();
        break;

      case 'stopCall':
        inCall = false;
        _exitPip();
        Object.keys(callPeers).forEach(function(id) {
          try { callPeers[id].destroy(); } catch(_) {}
          delete callPeers[id];
        });
        break;

      case 'webrtcSignal':
        _applyCallSignal(msg.peerId, msg.signal);
        break;

      case 'callPeerLeft':
        if (callPeers[msg.peerId]) {
          try { callPeers[msg.peerId].destroy(); } catch(_) {}
          delete callPeers[msg.peerId];
        }
        if (remoteStreams[msg.peerId]) {
          if (remoteStreams[msg.peerId]._pipVideo) remoteStreams[msg.peerId]._pipVideo.remove();
          delete remoteStreams[msg.peerId];
        }
        break;

      case 'usersChanged':
        _renderUsers(msg.users);
        var me = msg.users.find(function(u) { return u.isMe; });
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

      case 'runOutput':
        _appendRunOutput(msg.chunk, msg.isError, msg.done);
        break;

      case 'error':
        _showError(msg.message);
        break;
    }
  });

  // Button handlers
  createBtn.addEventListener('click', function() {
    var username = usernameInput.value.trim() || 'Anonymous';
    vscode.postMessage({ type: 'createRoom', username: username });
  });

  joinBtn.addEventListener('click', function() {
    var code = joinCodeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      _showError('Enter a valid 6-character room code');
      return;
    }
    var username = usernameInput.value.trim() || 'Anonymous';
    vscode.postMessage({ type: 'joinRoom', roomCode: code, username: username });
  });

  joinCodeInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') joinBtn.click();
  });

  leaveBtn.addEventListener('click', function() {
    _cleanup();
    vscode.postMessage({ type: 'leaveRoom' });
  });

  roomCodeDisp.addEventListener('click', function() {
    vscode.postMessage({ type: 'copyRoomCode', code: currentRoomCode });
  });

  sendBtn.addEventListener('click', _sendChat);
  chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _sendChat();
    }
  });

  activeLicBtn.addEventListener('click', function() {
    vscode.postMessage({ type: 'activateLicense' });
  });

  var shareFileBtn = document.getElementById('share-file-btn');
  var shareFileMsg = document.getElementById('share-file-msg');

  shareFileBtn.addEventListener('click', function() {
    vscode.postMessage({ type: 'shareFile' });
    shareFileMsg.style.display = 'block';
    setTimeout(function() { shareFileMsg.style.display = 'none'; }, 2000);
  });

  runBtn.addEventListener('click', function() {
    runOutput.innerHTML = '';
    runOutput.style.display = 'block';
    runBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    vscode.postMessage({ type: 'runCode' });
  });

  stopBtn.addEventListener('click', function() {
    vscode.postMessage({ type: 'stopRun' });
    stopBtn.style.display = 'none';
    runBtn.style.display = 'inline-block';
  });

  joinCallBtn.addEventListener('click', function() {
    _joinCall();
  });

  leaveCallBtn.addEventListener('click', function() {
    _leaveCall();
  });

  // Voice call helpers
  function _joinCall() {
    inCall = true;
    callActions.classList.add('hidden');
    callActiveControls.classList.remove('hidden');
    vscode.postMessage({ type: 'joinCall' });
  }

  function _leaveCall() {
    inCall = false;
    callPeers = {};
    callActions.classList.remove('hidden');
    callActiveControls.classList.add('hidden');
    if (callAvatars) callAvatars.innerHTML = '';
    vscode.postMessage({ type: 'leaveCall' });
  }

  function _handleCallEvent(event) {
    if (event.type === 'callPeerJoined') {
      _addCallAvatar(event.peerId, event.peerId.slice(0, 4), '#7c3aed');
    } else if (event.type === 'callPeerLeft') {
      var el = document.getElementById('call-av-' + event.peerId);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  function _addCallAvatar(peerId, label, color) {
    if (document.getElementById('call-av-' + peerId)) return;
    var div = document.createElement('div');
    div.id = 'call-av-' + peerId;
    div.className = 'call-avatar';
    div.style.background = color || '#7c3aed';
    div.textContent = (label || '?')[0].toUpperCase();
    div.title = label || peerId;
    if (callAvatars) callAvatars.appendChild(div);
  }

  // UI helpers
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
    usersList.innerHTML = '<div class="spinner">Connecting...</div>';
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
    timerInterval = setInterval(function() {
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
    var m = Math.floor(secs / 60).toString().padStart(2, '0');
    var s = (secs % 60).toString().padStart(2, '0');
    timerText.textContent = m + ':' + s;
    sessionTimer.classList.toggle('warning', secs <= 300);
  }

  function _renderUsers(users) {
    usersList.innerHTML = '';
    users.forEach(function(u) {
      var div = document.createElement('div');
      div.className = 'user-item';
      div.style.borderLeftColor = u.color || '#7c3aed';

      var avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.style.background = u.color || '#7c3aed';
      avatar.textContent = (u.username || '?')[0].toUpperCase();

      var info = document.createElement('div');
      info.className = 'user-info';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'user-name';
      nameSpan.textContent = u.username || '';
      if (u.isMe) {
        var youTag = document.createElement('span');
        youTag.textContent = ' (you)';
        youTag.style.cssText = 'opacity:0.5;font-size:10px;';
        nameSpan.appendChild(youTag);
      }
      info.appendChild(nameSpan);

      if (u.currentFile) {
        var fileName = u.currentFile.split('/').pop();
        var fileSpan = document.createElement('span');
        fileSpan.className = 'user-file';
        fileSpan.textContent = fileName;
        info.appendChild(fileSpan);
      }

      div.appendChild(avatar);
      div.appendChild(info);

      if (u.isHost) {
        var hostBadge = document.createElement('span');
        hostBadge.className = 'user-host-badge';
        hostBadge.textContent = 'host';
        div.appendChild(hostBadge);
      }

      usersList.appendChild(div);
    });
  }

  function _appendRunOutput(chunk, isError, done) {
    if (chunk) {
      var span = document.createElement('span');
      span.style.color = isError ? '#f87171' : 'inherit';
      span.textContent = chunk;
      runOutput.appendChild(span);
      runOutput.scrollTop = runOutput.scrollHeight;
    }
    if (done) {
      stopBtn.style.display = 'none';
      runBtn.style.display = 'inline-block';
      var end = document.createElement('span');
      end.style.opacity = '0.4';
      end.textContent = '\n- done -';
      runOutput.appendChild(end);
      runOutput.scrollTop = runOutput.scrollHeight;
    }
  }

  function _appendChat(msg) {
    var div = document.createElement('div');
    div.className = 'chat-msg' + (msg.isMe ? ' self' : '');
    var time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    var meta = document.createElement('div');
    meta.className = 'meta';
    var sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = msg.username;
    meta.appendChild(sender);
    meta.appendChild(document.createTextNode(' - ' + time));

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = _escapeHtml(msg.text);

    div.appendChild(meta);
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function _sendChat() {
    var text = chatInput.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'sendChat', text: text });
    chatInput.value = '';
  }

  function _showError(msg) {
    errorArea.textContent = msg;
    errorArea.classList.remove('hidden');
    setTimeout(function() { errorArea.classList.add('hidden'); }, 4000);
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
