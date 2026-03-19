/**
 * YjsSync.ts
 * Handles real-time collaborative editing using Yjs + Socket.io as the provider.
 * Manages cursor decorations for each remote participant.
 */

import * as vscode from 'vscode';
import * as Y from 'yjs';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { io, Socket } from 'socket.io-client';

interface RemoteUser {
  id: string;
  username: string;
  color: string;
  isHost: boolean;
  isMe?: boolean;
}

type UsersChangedCallback = (users: RemoteUser[]) => void;
type SignalCallback = (peerId: string, signal: unknown) => void;
type SessionWarningCallback = (secondsLeft: number) => void;
type CallEventCallback = (event: { type: string; [key: string]: unknown }) => void;

// Palette of cursor colors for participants
const CURSOR_COLORS = [
  '#7c3aed', '#2563eb', '#16a34a', '#d97706',
  '#dc2626', '#0891b2', '#be185d', '#0d9488'
];

export class YjsSync {
  private _socket: Socket | null = null;
  private _ydoc: Y.Doc | null = null;
  private _ytext: Y.Text | null = null;
  private _ytextObserver: ((e: Y.YTextEvent) => void) | null = null;
  private _editor: vscode.TextEditor | null = null;
  private _applyingRemoteCount = 0;
  private _roomCode: string | null = null;
  private _myId: string | null = null;
  private _myUsername = 'Anonymous';
  private _cursors = new Map<string, vscode.TextEditorDecorationType>();
  private _remoteCreatedFiles = new Set<string>(); // guard against echo
  private _syncFolderUri: vscode.Uri | null = null; // folder being watched/written to
  private _isHost = false;
  private _editorDisposables: vscode.Disposable[] = [];
  private _usersChangedCbs: UsersChangedCallback[] = [];
  private _signalCbs: SignalCallback[] = [];
  private _sessionWarningCbs: SessionWarningCallback[] = [];
  private _callEventCbs: CallEventCallback[] = [];

  constructor(private readonly _context: vscode.ExtensionContext) {}

  // ── Connection ────────────────────────────────────────────────────────

  async createRoom(username: string, isPro: boolean): Promise<string | undefined> {
    const serverUrl = this._getServerUrl();
    this._isHost = true;
    this._syncFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri ?? null;

    // Scan workspace for initial folder snapshot
    const folderName = this._syncFolderUri ? path.basename(this._syncFolderUri.fsPath) : 'workspace';
    const snapshot = this._syncFolderUri ? await this._buildSnapshot(this._syncFolderUri) : {};

    return new Promise((resolve) => {
      this._connect(serverUrl, username);
      this._socket!.once('connect_error', (err) => {
        vscode.window.showErrorMessage(`PeerSync: Cannot reach server at ${serverUrl} — ${err.message}`);
        resolve(undefined);
      });
      this._socket!.emit('create-room', { username, isPro, folderName, snapshot }, (response: { roomCode?: string; error?: string }) => {
        if (response.roomCode) {
          this._roomCode = response.roomCode;
          this._initYjs();
          this._startFileWatcher();
          resolve(response.roomCode);
        } else {
          resolve(undefined);
        }
      });
    });
  }

  async joinRoom(roomCode: string, username: string, isPro: boolean): Promise<boolean> {
    const serverUrl = this._getServerUrl();
    this._isHost = false;

    return new Promise((resolve) => {
      this._connect(serverUrl, username);
      this._socket!.once('connect_error', (err) => {
        vscode.window.showErrorMessage(`PeerSync: Cannot reach server at ${serverUrl} — ${err.message}`);
        resolve(false);
      });
      this._socket!.emit('join-room', { roomCode, username, isPro }, async (response: {
        success?: boolean; error?: string; initialContent?: string;
        folderName?: string; snapshot?: Record<string, string>;
      }) => {
        if (response.success) {
          this._roomCode = roomCode;
          this._initYjs();

          // Create a local temp folder mirroring the host's workspace
          const folderName = response.folderName || `peersync-${roomCode}`;
          const tmpDir = path.join(os.tmpdir(), `peersync-${roomCode}`);
          fs.mkdirSync(tmpDir, { recursive: true });

          // Write all snapshot files into the temp folder
          const snapshot = response.snapshot || {};
          for (const [relPath, content] of Object.entries(snapshot)) {
            const absPath = path.join(tmpDir, relPath);
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            fs.writeFileSync(absPath, content, 'utf8');
          }

          // Add temp folder to workspace so it appears in the explorer
          const tmpUri = vscode.Uri.file(tmpDir);
          this._syncFolderUri = tmpUri;
          vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length ?? 0, 0,
            { uri: tmpUri, name: `PeerSync: ${folderName}` }
          );

          this._startFileWatcher();
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  async disconnect() {
    this._cleanupDecorations();
    this._editorDisposables.forEach(d => d.dispose());
    this._editorDisposables = [];
    if (this._ytext && this._ytextObserver) {
      this._ytext.unobserve(this._ytextObserver);
      this._ytextObserver = null;
    }
    this._ydoc?.destroy();
    this._ydoc = null;
    this._ytext = null;
    this._socket?.disconnect();
    this._socket = null;
    this._roomCode = null;
    this._editor = null;

    // Remove temp workspace folder and close all its open files (participants only)
    if (!this._isHost && this._syncFolderUri) {
      const syncPath = this._syncFolderUri.fsPath;

      // Close all tabs belonging to the temp folder
      const tabsToClose: vscode.Tab[] = [];
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText &&
              tab.input.uri.fsPath.startsWith(syncPath)) {
            tabsToClose.push(tab);
          }
        }
      }
      if (tabsToClose.length > 0) {
        await vscode.window.tabGroups.close(tabsToClose);
      }

      // Remove the folder from workspace
      const folders = vscode.workspace.workspaceFolders;
      if (folders) {
        const idx = folders.findIndex(f => f.uri.fsPath === syncPath);
        if (idx !== -1) {
          vscode.workspace.updateWorkspaceFolders(idx, 1);
        }
      }
    }
    this._syncFolderUri = null;
  }

  isInRoom(): boolean {
    return this._roomCode !== null;
  }

  getSocket(): Socket | null {
    return this._socket;
  }

  getRoomCode(): string | null {
    return this._roomCode;
  }

  getServerUrl(): string {
    return this._getServerUrl();
  }

  forwardSignal(peerId: string, signal: unknown) {
    this._socket?.emit('webrtc-signal', { to: peerId, signal });
  }

  // ── Editor binding ────────────────────────────────────────────────────

  bindEditor(editor: vscode.TextEditor) {
    if (!this._ydoc) return;

    // Dispose previous editor listeners
    this._editorDisposables.forEach(d => d.dispose());
    this._editorDisposables = [];

    // Unobserve previous file's YText
    if (this._ytext && this._ytextObserver) {
      this._ytext.unobserve(this._ytextObserver);
      this._ytextObserver = null;
    }

    this._editor = editor;

    // Each file gets its own YText keyed by relative path
    const fileKey = vscode.workspace.asRelativePath(editor.document.uri);
    this._ytext = this._ydoc.getText(fileKey);

    const yjsContent = this._ytext.toString();
    const editorContent = editor.document.getText();

    if (yjsContent === '' && editorContent !== '') {
      // First open of this file — push editor content into Yjs
      this._ydoc.transact(() => {
        this._ytext!.insert(0, editorContent);
      });
    } else if (yjsContent !== '' && yjsContent !== editorContent) {
      // Yjs has edits from the other window — apply them to this editor now
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        editor.document.uri,
        new vscode.Range(new vscode.Position(0, 0), editor.document.positionAt(editorContent.length)),
        yjsContent
      );
      this._applyingRemoteCount++;
      vscode.workspace.applyEdit(edit).then(() => { this._applyingRemoteCount--; });
    }

    // Observe remote changes for THIS file — replace full doc with Yjs state
    this._ytextObserver = async (event: Y.YTextEvent) => {
      if (!this._editor || event.transaction.local) return;
      if (this._editor.document !== editor.document) return;

      const newContent = this._ytext!.toString();
      const currentContent = this._editor.document.getText();
      if (newContent === currentContent) return;

      const selections = this._editor.selections;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        this._editor.document.uri,
        new vscode.Range(new vscode.Position(0, 0), this._editor.document.positionAt(currentContent.length)),
        newContent
      );

      this._applyingRemoteCount++;
      await vscode.workspace.applyEdit(edit);
      this._applyingRemoteCount--;

      if (this._editor) {
        const docLen = this._editor.document.getText().length;
        this._editor.selections = selections.map(sel => {
          const s = this._editor!.document.positionAt(Math.min(this._editor!.document.offsetAt(sel.start), docLen));
          const e = this._editor!.document.positionAt(Math.min(this._editor!.document.offsetAt(sel.end), docLen));
          return new vscode.Selection(s, e);
        });
      }
    };
    this._ytext.observe(this._ytextObserver);

    // Send local edits into this file's YText
    this._editorDisposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== editor.document) return;
        if (this._applyingRemoteCount > 0) return;

        this._ydoc!.transact(() => {
          const changes = [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
          for (const change of changes) {
            if (change.rangeLength > 0) this._ytext!.delete(change.rangeOffset, change.rangeLength);
            if (change.text)            this._ytext!.insert(change.rangeOffset, change.text);
          }
        });

        this._broadcastCursor(editor);
      })
    );

    this._editorDisposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor !== editor) return;
        this._broadcastCursor(editor);
      })
    );
  }

  // ── Callbacks ─────────────────────────────────────────────────────────

  onUsersChanged(cb: UsersChangedCallback) { this._usersChangedCbs.push(cb); }
  onSignal(cb: SignalCallback) { this._signalCbs.push(cb); }
  onSessionWarning(cb: SessionWarningCallback) { this._sessionWarningCbs.push(cb); }
  onCallEvent(cb: CallEventCallback) { this._callEventCbs.push(cb); }

  joinCall(isPanel = false) { this._socket?.emit('call-join', { roomCode: this._roomCode, isPanel }); }
  leaveCall() { this._socket?.emit('call-leave', { roomCode: this._roomCode }); }

  // ── Private helpers ───────────────────────────────────────────────────

  private _connect(serverUrl: string, username: string) {
    this._myUsername = username;
    this._socket = io(serverUrl, {
      transports: ['polling', 'websocket'],
      timeout: 10000
    });

    this._socket.on('connect', () => {
      this._myId = this._socket!.id ?? null;
    });

    // Receive Yjs updates from other clients
    this._socket.on('yjs-update', (update: Uint8Array) => {
      if (this._ydoc) {
        Y.applyUpdate(this._ydoc, new Uint8Array(update));
      }
    });

    // Room user list changed
    this._socket.on('users-changed', (users: RemoteUser[]) => {
      const withMe = users.map(u => ({
        ...u,
        isMe: u.id === this._myId
      }));
      this._usersChangedCbs.forEach(cb => cb(withMe));
    });

    // Remote cursor update
    this._socket.on('cursor-update', (data: { userId: string; color: string; position: number; length: number }) => {
      this._renderRemoteCursor(data);
    });

    // WebRTC signaling forwarded from server
    this._socket.on('webrtc-signal', (data: { from: string; signal: unknown }) => {
      this._signalCbs.forEach(cb => cb(data.from, data.signal));
    });

    // Session timer warning from server (free tier)
    this._socket.on('session-warning', (data: { secondsLeft: number }) => {
      this._sessionWarningCbs.forEach(cb => cb(data.secondsLeft));
    });

    // Voice call events
    this._socket.on('call-participants', (data: { participants: string[] }) => {
      this._callEventCbs.forEach(cb => cb({ type: 'callParticipants', participants: data.participants }));
    });
    this._socket.on('call-peer-joined', (data: { peerId: string }) => {
      this._callEventCbs.forEach(cb => cb({ type: 'callPeerJoined', peerId: data.peerId }));
    });
    this._socket.on('call-peer-left', (data: { peerId: string }) => {
      this._callEventCbs.forEach(cb => cb({ type: 'callPeerLeft', peerId: data.peerId }));
    });

    // Remote file creation — write into the sync folder
    this._socket.on('file-created', async (data: { relativePath: string; content: string }) => {
      if (!this._syncFolderUri) return;
      const fileUri = vscode.Uri.joinPath(this._syncFolderUri, data.relativePath);
      this._remoteCreatedFiles.add(fileUri.fsPath);
      // Ensure parent directory exists
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fileUri.fsPath)));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(data.content, 'utf8'));
      await vscode.window.showTextDocument(fileUri, { preview: false });
      setTimeout(() => this._remoteCreatedFiles.delete(fileUri.fsPath), 500);
    });

    // Remote folder creation
    this._socket.on('folder-created', async (data: { relativePath: string }) => {
      if (!this._syncFolderUri) return;
      const folderUri = vscode.Uri.joinPath(this._syncFolderUri, data.relativePath);
      this._remoteCreatedFiles.add(folderUri.fsPath);
      await vscode.workspace.fs.createDirectory(folderUri);
      setTimeout(() => this._remoteCreatedFiles.delete(folderUri.fsPath), 500);
    });

    this._socket.on('disconnect', () => {
      this._cleanupDecorations();
    });
  }

  private _initYjs() {
    this._ydoc = new Y.Doc();
    // Broadcast all Yjs updates to the room — works for all YTexts in this doc
    this._ydoc.on('update', (update: Uint8Array) => {
      this._socket?.emit('yjs-update', { roomCode: this._roomCode, update: Array.from(update) });
    });
  }

  private _broadcastCursor(editor: vscode.TextEditor) {
    if (!this._socket || !this._myId) return;
    const selection = editor.selection;
    const startOffset = editor.document.offsetAt(selection.start);
    const endOffset = editor.document.offsetAt(selection.end);
    this._socket.emit('cursor-update', {
      roomCode: this._roomCode,
      position: startOffset,
      length: endOffset - startOffset
    });
  }

  private _renderRemoteCursor(data: { userId: string; username?: string; color: string; position: number; length: number }) {
    if (!this._editor) return;

    // Dispose old decoration for this user
    const old = this._cursors.get(data.userId);
    old?.dispose();

    const label = data.username ?? data.userId.slice(0, 6);
    const decorationType = vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: data.color,
      backgroundColor: `${data.color}22`,
      before: {
        contentText: ` ${label} `,
        backgroundColor: data.color,
        color: '#ffffff',
        fontWeight: 'bold',
        margin: '0 4px 0 0',
      }
    });
    this._cursors.set(data.userId, decorationType);

    const doc = this._editor.document;
    const startPos = doc.positionAt(data.position);
    const endPos = doc.positionAt(data.position + data.length);
    this._editor.setDecorations(decorationType, [new vscode.Range(startPos, endPos)]);
  }

  private _cleanupDecorations() {
    this._cursors.forEach(d => d.dispose());
    this._cursors.clear();
  }

  private _startFileWatcher() {
    if (!this._syncFolderUri) return;
    const syncRoot = this._syncFolderUri;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(syncRoot, '**/*')
    );

    watcher.onDidCreate(async (uri) => {
      if (!this._socket || !this._roomCode) return;
      if (this._remoteCreatedFiles.has(uri.fsPath)) return;

      const relativePath = path.relative(syncRoot.fsPath, uri.fsPath);

      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          this._socket.emit('folder-created', { roomCode: this._roomCode, relativePath });
          return;
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString('utf8');
        this._socket.emit('file-created', { roomCode: this._roomCode, relativePath, content });
      } catch {
        // unreadable or disappeared, skip
      }
    });

    this._context.subscriptions.push(watcher);
  }

  private async _buildSnapshot(folderUri: vscode.Uri): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    const SKIP = new Set(['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.vscode']);
    const MAX_FILE_BYTES = 100 * 1024;
    const MAX_DEPTH = 4;

    const scan = async (uri: vscode.Uri, depth: number) => {
      if (depth > MAX_DEPTH) return;
      let entries: [string, vscode.FileType][];
      try { entries = await vscode.workspace.fs.readDirectory(uri); } catch { return; }

      for (const [name, type] of entries) {
        if (SKIP.has(name)) continue;
        const child = vscode.Uri.joinPath(uri, name);
        if (type === vscode.FileType.Directory) {
          await scan(child, depth + 1);
        } else if (type === vscode.FileType.File) {
          try {
            const bytes = await vscode.workspace.fs.readFile(child);
            if (bytes.byteLength > MAX_FILE_BYTES) continue;
            const rel = path.relative(folderUri.fsPath, child.fsPath);
            snapshot[rel] = Buffer.from(bytes).toString('utf8');
          } catch { /* skip */ }
        }
      }
    };

    await scan(folderUri, 0);
    return snapshot;
  }

  private _getServerUrl(): string {
    return vscode.workspace.getConfiguration('codesync').get<string>('serverUrl')
      || 'https://peersync-production.up.railway.app';
  }
}
