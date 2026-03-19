/**
 * SidebarProvider
 * Renders the CodeSync webview panel in the VS Code activity bar.
 * Handles messages from the webview and coordinates sync/chat/pro features.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { YjsSync } from '../sync/YjsSync';
import { ChatManager, ChatMessage } from '../chat/ChatManager';
import { LicenseManager } from '../auth/LicenseManager';
import { getSidebarHtml } from './panelHtml';
import { CallPanel } from '../call/CallPanel';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

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
    webviewView.webview.html = getSidebarHtml(webviewView.webview, this._context.extensionUri, socketUri);

    // Handle messages sent from the webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'createRoom':
          await this.createRoom();
          break;

        case 'joinRoom':
          await this.joinRoom(msg.roomCode);
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

        case 'webrtcSignal':
          // Forward WebRTC signaling data (offer/answer/ice) via the sync layer
          this._yjsSync.forwardSignal(msg.peerId, msg.signal);
          break;

        case 'joinCall': {
          const roomCode = this._yjsSync.getRoomCode();
          const username = this._getUsername();
          if (roomCode) {
            CallPanel.open(this._context, this._yjsSync, roomCode, username);
          }
          break;
        }

        case 'leaveCall':
          CallPanel.close();
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
  }

  // ─── Public API (called from commands) ───────────────────────────────────

  async createRoom(): Promise<string | undefined> {
    const username = this._getUsername();
    const isPro = this._licenseManager.isPro();
    const roomCode = await this._yjsSync.createRoom(username, isPro);
    if (roomCode) {
      this._post({ type: 'roomJoined', roomCode, isHost: true, isPro });
      this._chatManager.connect(this._yjsSync.getSocket()!);
    }
    return roomCode;
  }

  async joinRoom(roomCode: string): Promise<void> {
    const username = this._getUsername();
    const isPro = this._licenseManager.isPro();
    const success = await this._yjsSync.joinRoom(roomCode, username, isPro);
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
    CallPanel.close();
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
