/**
 * LicenseManager.ts
 * Validates and stores the CodeSync Pro license key.
 * License keys are verified against the backend server.
 */

import * as vscode from 'vscode';

const LICENSE_KEY_SECRET = 'codesync.licenseKey';
const PRO_STATUS_KEY = 'codesync.isPro';

export class LicenseManager {
  private _isPro = false;

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Restore pro status from persisted storage
    this._isPro = this._context.globalState.get<boolean>(PRO_STATUS_KEY, false);
  }

  isPro(): boolean {
    return this._isPro;
  }

  /**
   * Validate the license key against the backend.
   * Returns true if valid, false otherwise.
   */
  async activateLicense(key: string): Promise<boolean> {
    try {
      const serverUrl = vscode.workspace.getConfiguration('codesync').get<string>('serverUrl')
        || 'https://peersync-production.up.railway.app';

      const response = await fetch(`${serverUrl}/api/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key })
      });

      if (!response.ok) return false;

      const data = await response.json() as { valid: boolean };

      if (data.valid) {
        // Store the key in VS Code's secret storage (encrypted)
        await this._context.secrets.store(LICENSE_KEY_SECRET, key);
        this._isPro = true;
        await this._context.globalState.update(PRO_STATUS_KEY, true);
        return true;
      }

      return false;
    } catch (err) {
      console.error('License validation error:', err);
      return false;
    }
  }

  /** Retrieve the stored license key (used when reconnecting) */
  async getLicenseKey(): Promise<string | undefined> {
    return this._context.secrets.get(LICENSE_KEY_SECRET);
  }

  async deactivate() {
    await this._context.secrets.delete(LICENSE_KEY_SECRET);
    this._isPro = false;
    await this._context.globalState.update(PRO_STATUS_KEY, false);
  }
}
