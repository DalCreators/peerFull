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
type RunOutputCallback = (data: { chunk: string; isError?: boolean; done?: boolean; username?: string }) => void;

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
  private _runOutputCbs: ((data: { chunk: string; isError?: boolean; done?: boolean; username?: string }) => void)[] = [];

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

    // Disconnect any existing socket before creating a new one
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (val: boolean) => {
        if (!resolved) { resolved = true; resolve(val); }
      };

      this._connect(serverUrl, username);

      this._socket!.once('connect_error', (err) => {
        vscode.window.showErrorMessage(`PeerSync: Cannot reach server at ${serverUrl} — ${err.message}`);
        safeResolve(false);
      });

      // Wait for connection before emitting join-room
      this._socket!.once('connect', () => {
        this._socket!.emit('join-room', { roomCode, username, isPro }, async (response: {
          success?: boolean; error?: string; initialContent?: string;
          folderName?: string; snapshot?: Record<string, string>;
        }) => {
          if (response.success) {
            this._roomCode = roomCode;
            this._initYjs();

            // Create a local temp folder mirroring the host's workspace
            const tmpDir = path.join(os.tmpdir(), `peersync-${roomCode}`);
            fs.mkdirSync(tmpDir, { recursive: true });

            // Write all snapshot files into the temp folder
            const snapshot = response.snapshot || {};
            for (const [relPath, content] of Object.entries(snapshot)) {
              const absPath = path.join(tmpDir, relPath);
              fs.mkdirSync(path.dirname(absPath), { recursive: true });
              fs.writeFileSync(absPath, content, 'utf8');
            }

            const tmpUri = vscode.Uri.file(tmpDir);
            this._syncFolderUri = tmpUri;

            this._startFileWatcher();

            // Open the first snapshot file so the joiner sees something immediately
            const firstFile = Object.keys(snapshot)[0];
            if (firstFile) {
              const fileUri = vscode.Uri.file(path.join(tmpDir, firstFile));
              vscode.window.showTextDocument(fileUri, { preview: false }).then(() => {}, () => {});
            }

            safeResolve(true);
          } else {
            vscode.window.showErrorMessage(`PeerSync: Room "${roomCode}" not found or is full.`);
            safeResolve(false);
          }
        });
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

    // Compute path relative to the sync folder so host and joiner use the same Yjs key.
    // vscode.workspace.asRelativePath prepends the workspace folder name when there are
    // multiple folders, which breaks key matching between host and joiner.
    const fileKey = this._syncFolderUri
      ? path.relative(this._syncFolderUri.fsPath, editor.document.uri.fsPath)
      : vscode.workspace.asRelativePath(editor.document.uri);

    // Tell everyone which file we just opened
    this._socket?.emit('file-focus', { roomCode: this._roomCode, relativePath: fileKey });

    // Each file gets its own YText keyed by relative path
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

    // Observe remote changes for THIS file — apply precise delta edits (no full replace)
    this._ytextObserver = async (event: Y.YTextEvent) => {
      if (!this._editor || event.transaction.local) return;
      if (this._editor.document !== editor.document) return;

      const doc = this._editor.document;
      const wsEdit = new vscode.WorkspaceEdit();
      let offset = 0;

      for (const op of event.changes.delta) {
        if (op.retain !== undefined) {
          offset += op.retain;
        } else if (op.insert !== undefined) {
          const insertText = typeof op.insert === 'string' ? op.insert : '';
          if (insertText) {
            wsEdit.insert(doc.uri, doc.positionAt(offset), insertText);
            offset += insertText.length;
          }
        } else if (op.delete !== undefined) {
          const start = doc.positionAt(offset);
          const end = doc.positionAt(offset + op.delete);
          wsEdit.delete(doc.uri, new vscode.Range(start, end));
        }
      }

      this._applyingRemoteCount++;
      await vscode.workspace.applyEdit(wsEdit);
      this._applyingRemoteCount--;
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
  onRunOutput(cb: (data: { chunk: string; isError?: boolean; done?: boolean; username?: string }) => void) {
    this._runOutputCbs.push(cb);
  }

  broadcastRunOutput(chunk: string, isError: boolean, done: boolean) {
    this._socket?.emit('run-output', { roomCode: this._roomCode, chunk, isError, done });
  }

  async shareActiveFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this._roomCode) return;

    const fileKey = this._syncFolderUri
      ? path.relative(this._syncFolderUri.fsPath, editor.document.uri.fsPath)
      : vscode.workspace.asRelativePath(editor.document.uri);

    const content = editor.document.getText();
    this._socket?.emit('share-file', { roomCode: this._roomCode, relativePath: fileKey, content });

    // Bind Yjs to this file so edits sync immediately
    this.bindEditor(editor);
  }

  joinCall(isPanel = false) { this._socket?.emit('call-join', { roomCode: this._roomCode, isPanel }); }
  leaveCall() { this._socket?.emit('call-leave', { roomCode: this._roomCode }); }
  forceEndCall() { this._socket?.emit('call-force-end', { roomCode: this._roomCode }); }
  controlCallMedia(mic?: boolean, cam?: boolean) {
    this._socket?.emit('call-media-control', { roomCode: this._roomCode, mic, cam });
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _connect(serverUrl: string, username: string) {
    this._myUsername = username;
    this._socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
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

    // Remote file focus — open the file on this user's screen
    this._socket.on('user-file-focus', async (data: { userId: string; username: string; relativePath: string }) => {
      if (!this._syncFolderUri) return;
      const fileUri = vscode.Uri.joinPath(this._syncFolderUri, data.relativePath);
      try {
        await vscode.window.showTextDocument(fileUri, { preview: false, preserveFocus: false });
      } catch {
        // file may not exist yet in this user's workspace — ignore
      }
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

    // A participant shared a file — write it locally and open it
    this._socket.on('file-shared', async (data: { relativePath: string; content: string }) => {
      if (!this._syncFolderUri) return;
      const fileUri = vscode.Uri.joinPath(this._syncFolderUri, data.relativePath);
      this._remoteCreatedFiles.add(fileUri.fsPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fileUri.fsPath)));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(data.content, 'utf8'));
      const editor = await vscode.window.showTextDocument(fileUri, { preview: false });
      this.bindEditor(editor);
      setTimeout(() => this._remoteCreatedFiles.delete(fileUri.fsPath), 500);
    });

    // When a new peer joins, re-broadcast the currently open file so they open it immediately
    this._socket.on('peer-joined', () => {
      if (this._editor && this._roomCode && this._syncFolderUri) {
        const fileKey = path.relative(this._syncFolderUri.fsPath, this._editor.document.uri.fsPath);
        this._socket?.emit('file-focus', { roomCode: this._roomCode, relativePath: fileKey });
      }
    });

    this._socket.on('run-output', (data: { chunk: string; isError?: boolean; done?: boolean; username?: string }) => {
      this._runOutputCbs.forEach(cb => cb(data));
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

    // Dispose old decorations for this user
    const old = this._cursors.get(data.userId);
    old?.dispose();

    const doc = this._editor.document;
    const startPos = doc.positionAt(data.position);

    // For the dot to render, `after` needs a non-empty range.
    // If there's no selection, extend to the next character on the line.
    // If at end of line/file, keep it as-is (VS Code renders `after` on empty lines too).
    let endPos = doc.positionAt(data.position + data.length);
    if (data.length === 0) {
      const line = doc.lineAt(startPos.line);
      if (startPos.character < line.text.length) {
        endPos = new vscode.Position(startPos.line, startPos.character + 1);
      }
    }

    // Cursor bar — thin colored line on the left edge
    const cursorDecoration = vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: data.color,
      // Small colored dot floats after the cursor position
      after: {
        contentText: ' ● ',
        backgroundColor: data.color,
        color: '#ffffff',
        fontWeight: '600',
        margin: '0 0 0 4px',
      }
    });

    // Selection highlight (only when text is actually selected)
    const selectionDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: `${data.color}33`,
    });

    this._cursors.set(data.userId, cursorDecoration);

    this._editor.setDecorations(cursorDecoration, [new vscode.Range(startPos, endPos)]);

    // Apply selection highlight separately if there's an actual selection
    if (data.length > 0) {
      this._editor.setDecorations(selectionDecoration, [new vscode.Range(startPos, doc.positionAt(data.position + data.length))]);
    }

    // Clean up the selection decoration alongside the cursor decoration
    const originalDispose = cursorDecoration.dispose.bind(cursorDecoration);
    (cursorDecoration as any).dispose = () => {
      originalDispose();
      selectionDecoration.dispose();
    };
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
      || 'https://awake-solace-production-bb18.up.railway.app';
  }
}
