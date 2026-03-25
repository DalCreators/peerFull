/**
 * SidebarProvider
 * Renders the CodeSync webview panel in the VS Code activity bar.
 * Handles messages from the webview and coordinates sync/chat/pro features.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { YjsSync } from '../sync/YjsSync';
import { runFile } from '../runner/CodeRunner';
import { ChatManager, ChatMessage } from '../chat/ChatManager';
import { LicenseManager } from '../auth/LicenseManager';
import { getSidebarHtml } from './panelHtml';
import { CallPanel } from '../call/CallPanel';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _stopRun?: () => void;

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _yjsSync: YjsSync,
    private readonly _chatManager: ChatManager,
    private readonly _licenseManager: LicenseManager
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._context.extensionUri, 'media')
      ]
    };

    const socketUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'socket.io.min.js')
    );
    const simplePeerUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'simplepeer.min.js')
    );
    webviewView.webview.html = getSidebarHtml(webviewView.webview, this._context.extensionUri, socketUri, simplePeerUri);

    // Handle messages sent from the webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'createRoom':
          await this.createRoom(msg.username);
          break;

        case 'joinRoom':
          await this.joinRoom(msg.roomCode, msg.username);
          break;

        case 'leaveRoom':
          this.leaveRoom();
          break;

        case 'sendChat':
          this._chatManager.sendMessage(msg.text);
          break;

        case 'activateLicense':
          vscode.commands.executeCommand('codesync.activateLicense');
          break;

        case 'copyRoomCode':
          if (msg.code) {
            vscode.env.clipboard.writeText(msg.code);
            vscode.window.showInformationMessage('Room code copied!');
          }
          break;

        case 'setUsername':
          vscode.workspace.getConfiguration('codesync').update('username', msg.username, true);
          break;

        case 'joinCall': {
          const roomCode = this._yjsSync.getRoomCode();
          const username = this._getUsername();
          if (roomCode) {
            const serverUrl = this._yjsSync.getServerUrl();
            const callUrl = `${serverUrl}/call/${roomCode}?u=${encodeURIComponent(username)}&minimal=1`;
            CallPanel.open(this._context, this._yjsSync, roomCode, username);
            openMinimalCallBrowser(callUrl);
          }
          break;
        }

        case 'leaveCall':
          this._yjsSync.forceEndCall();
          CallPanel.close();
          break;

        case 'shareFile':
          this._yjsSync.shareActiveFile();
          break;

        case 'runCode': {
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            this._post({ type: 'runOutput', chunk: 'No active file to run.\n', isError: true, done: true });
            break;
          }
          // Save the file first
          await editor.document.save();
          const filePath = editor.document.uri.fsPath;
          this._post({ type: 'runOutput', chunk: `▶ Running ${path.basename(filePath)}...\n`, isError: false, done: false });
          this._yjsSync.broadcastRunOutput(`▶ Running ${path.basename(filePath)}...\n`, false, false);

          this._stopRun?.();
          this._stopRun = runFile(
            filePath,
            (chunk, isError) => {
              this._post({ type: 'runOutput', chunk, isError, done: false });
              this._yjsSync.broadcastRunOutput(chunk, isError, false);
            },
            () => {
              this._post({ type: 'runOutput', chunk: '', isError: false, done: true });
              this._yjsSync.broadcastRunOutput('', false, true);
              this._stopRun = undefined;
            }
          );
          break;
        }

        case 'stopRun':
          this._stopRun?.();
          this._stopRun = undefined;
          break;

        case 'ready':
          // Webview finished loading — send initial state
          this._sendInitialState();
          break;
      }
    });

    // Forward chat messages to the webview
    this._chatManager.onMessage((msg: ChatMessage) => {
      this._post({ type: 'chatMessage', msg });
    });

    // Forward user presence updates to the webview
    this._yjsSync.onUsersChanged((users) => {
      this._post({ type: 'usersChanged', users });
    });

    // Forward incoming WebRTC signals to the webview
    this._yjsSync.onSignal((peerId: string, signal: unknown) => {
      this._post({ type: 'webrtcSignal', peerId, signal });
    });

    // Forward session timer events
    this._yjsSync.onSessionWarning((secondsLeft: number) => {
      this._post({ type: 'sessionWarning', secondsLeft });
    });

    this._yjsSync.onCallEvent((event) => {
      this._post({ type: 'callEvent', event });
    });

    this._yjsSync.onRunOutput((data) => {
      this._post({ type: 'runOutput', ...data });
    });
  }

  // ─── Public API (called from commands) ───────────────────────────────────

  async createRoom(username?: string): Promise<string | undefined> {
    const name = username?.trim() || this._getUsername();
    const isPro = this._licenseManager.isPro();
    const roomCode = await this._yjsSync.createRoom(name, isPro);
    if (roomCode) {
      this._post({ type: 'roomJoined', roomCode, isHost: true, isPro });
      this._chatManager.connect(this._yjsSync.getSocket()!);
    }
    return roomCode;
  }

  async joinRoom(roomCode: string, username?: string): Promise<void> {
    const name = username?.trim() || this._getUsername();
    const isPro = this._licenseManager.isPro();
    const success = await this._yjsSync.joinRoom(roomCode, name, isPro);
    if (success) {
      this._post({ type: 'roomJoined', roomCode, isHost: false, isPro });
      this._chatManager.connect(this._yjsSync.getSocket()!);
      // Editor binding is handled inside YjsSync.joinRoom — it opens an
      // untitled doc pre-filled with the host's content automatically.
    } else {
      this._post({ type: 'error', message: 'Failed to join room. Check the code and try again.' });
    }
  }

  leaveRoom(): void {
    this._yjsSync.forceEndCall();
    this._post({ type: 'stopCall' });
    this._yjsSync.disconnect().then(() => {
      this._post({ type: 'roomLeft' });
    });
    this._chatManager.disconnect();
  }

  refreshProStatus(): void {
    const isPro = this._licenseManager.isPro();
    this._post({ type: 'proStatusChanged', isPro });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _post(message: Record<string, unknown>) {
    this._view?.webview.postMessage(message);
  }

  private _getUsername(): string {
    const configured = vscode.workspace.getConfiguration('codesync').get<string>('username');
    return configured?.trim() || vscode.env.machineId.slice(0, 8);
  }

  private _sendInitialState() {
    const isPro = this._licenseManager.isPro();
    const username = vscode.workspace.getConfiguration('codesync').get<string>('username') || '';
    this._post({ type: 'init', isPro, username });
  }
}

/**
 * Opens the call URL in a minimal Chrome/Edge app-mode window (no address bar,
 * no tabs, ~300×160px). Falls back to vscode.env.openExternal if no Chromium
 * browser is found.
 */
/**
 * Opens the call URL as a minimal 300×160 app-mode window.
 * Uses direct binary spawn so --window-size is respected even when the
 * browser is already running. Falls back to vscode.env.openExternal.
 */
function openMinimalCallBrowser(url: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require('child_process') as typeof import('child_process');
  const minimalUrl = `${url}${url.includes('?') ? '&' : '?'}minimal=1`;
  const spawnArgs = [`--app=${minimalUrl}`, '--window-size=300,160', '--window-position=40,40', '--new-window'];

  const trySpawn = (bins: string[], fallback: () => void) => {
    const next = (i: number): void => {
      if (i >= bins.length) { fallback(); return; }
      const child = cp.spawn(bins[i], spawnArgs, { detached: true, stdio: 'ignore' });
      child.on('error', () => next(i + 1));
      child.unref();
    };
    next(0);
  };

  if (process.platform === 'darwin') {
    trySpawn([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ], () => vscode.env.openExternal(vscode.Uri.parse(url)));
  } else if (process.platform === 'win32') {
    const local  = process.env['LOCALAPPDATA'] ?? '';
    const prog86 = process.env['ProgramFiles(x86)'] ?? process.env['ProgramFiles'] ?? '';
    trySpawn([
      `${local}\\Google\\Chrome\\Application\\chrome.exe`,
      `${prog86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${prog86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${local}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ], () => vscode.env.openExternal(vscode.Uri.parse(url)));
  } else {
    trySpawn(
      ['google-chrome', 'chromium-browser', 'chromium'],
      () => vscode.env.openExternal(vscode.Uri.parse(url))
    );
  }
}
