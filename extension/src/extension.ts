/**
 * CodeSync Extension - Main Entry Point
 * Registers commands, sidebar, and manages extension lifecycle.
 */

import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar/SidebarProvider';
import { YjsSync } from './sync/YjsSync';
import { ChatManager } from './chat/ChatManager';
import { LicenseManager } from './auth/LicenseManager';

let sidebarProvider: SidebarProvider;
let yjsSync: YjsSync;
let chatManager: ChatManager;
let licenseManager: LicenseManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeSync extension activated');
  _enableMediaPermissions();

  // Initialize managers
  licenseManager = new LicenseManager(context);
  yjsSync = new YjsSync(context);
  chatManager = new ChatManager();

  // Register the sidebar webview provider
  sidebarProvider = new SidebarProvider(context, yjsSync, chatManager, licenseManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codesync.sidebar', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codesync.createRoom', async () => {
      const roomCode = await sidebarProvider.createRoom();
      if (roomCode) {
        vscode.window.showInformationMessage(
          `Room created! Code: ${roomCode}`,
          'Copy Code'
        ).then(action => {
          if (action === 'Copy Code') {
            vscode.env.clipboard.writeText(roomCode);
          }
        });
      }
    }),

    vscode.commands.registerCommand('codesync.joinRoom', async () => {
      const code = await vscode.window.showInputBox({
        prompt: 'Enter the 6-character room code',
        placeHolder: 'ABC123',
        validateInput: (value) => {
          if (!/^[A-Z0-9]{6}$/.test(value.toUpperCase())) {
            return 'Room code must be 6 alphanumeric characters';
          }
          return null;
        }
      });
      if (code) {
        sidebarProvider.joinRoom(code.toUpperCase());
      }
    }),

    vscode.commands.registerCommand('codesync.leaveRoom', () => {
      sidebarProvider.leaveRoom();
    }),

    vscode.commands.registerCommand('codesync.activateLicense', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your CodeSync Pro license key',
        placeHolder: 'CODESYNC-XXXX-XXXX-XXXX',
        password: true
      });
      if (key) {
        const valid = await licenseManager.activateLicense(key);
        if (valid) {
          vscode.window.showInformationMessage('CodeSync Pro activated! Enjoy premium features.');
          sidebarProvider.refreshProStatus();
        } else {
          vscode.window.showErrorMessage('Invalid license key. Please check and try again.');
        }
      }
    })
  );

  // Listen for active editor changes — sync the new file with Yjs
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && yjsSync.isInRoom()) {
        yjsSync.bindEditor(editor);
      }
    })
  );

  // Warn if user tries to open a folder while in a room (it would reload the window and disconnect)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (yjsSync.isInRoom()) {
        vscode.window.showWarningMessage(
          'PeerSync: Opening a new folder will reload VS Code and disconnect you from the room.',
          'Rejoin Room'
        ).then(action => {
          if (action === 'Rejoin Room') {
            const code = yjsSync.getRoomCode();
            if (code) vscode.env.clipboard.writeText(code);
            vscode.window.showInformationMessage(`Room code ${code} copied — paste it to rejoin after the folder opens.`);
          }
        });
      }
    })
  );
}

export function deactivate() {
  yjsSync?.disconnect();
  chatManager?.disconnect();
}

/**
 * Attempts to hook into Electron's session permission handler so that
 * microphone access is granted for extension webviews without a user prompt.
 * Works by trying several ways to reach the Electron session API, since
 * VS Code and Cursor expose it differently across versions.
 */
function _enableMediaPermissions(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ElectronSession = { defaultSession: any };

  const getSession = (): ElectronSession | null => {
    const attempts: Array<() => ElectronSession> = [
      // VS Code / Cursor newer builds — main-process session via remote
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      () => require('@electron/remote').session,
      // Older builds — electron.remote
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      () => (require('electron') as any).remote?.session,
      // Some builds expose session directly in renderer context
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      () => (require('electron') as any).session,
    ];

    for (const attempt of attempts) {
      try {
        const s = attempt();
        if (s?.defaultSession) { return s; }
      } catch (_) { /* try next */ }
    }
    return null;
  };

  const s = getSession();
  if (!s) {
    console.log('[PeerSync] Electron session not accessible — media permissions rely on OS grant');
    return;
  }

  try {
    // Allow microphone (and camera) permission requests from extension webviews
    s.defaultSession.setPermissionRequestHandler(
      (_webContents: unknown, permission: string, callback: (granted: boolean) => void) => {
        const isMedia = permission === 'media' || permission === 'microphone' || permission === 'camera';
        callback(isMedia);
      }
    );

    // setPermissionCheckHandler controls whether the browser considers a
    // permission already granted (used by getUserMedia before showing the prompt)
    s.defaultSession.setPermissionCheckHandler(
      (_webContents: unknown, permission: string) => {
        return permission === 'media' || permission === 'microphone' || permission === 'camera';
      }
    );

    console.log('[PeerSync] Electron media permission handler registered ✓');
  } catch (err) {
    console.warn('[PeerSync] Could not register permission handler:', err);
  }
}
