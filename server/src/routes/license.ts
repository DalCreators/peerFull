/**
 * license.ts
 * REST endpoint for license key validation (called by the VS Code extension).
 */

import { Router, Request, Response } from 'express';
import { validateLicenseKey } from '../database';

export const licenseRouter = Router();

licenseRouter.post('/validate', async (req: Request, res: Response) => {
  const { licenseKey } = req.body as { licenseKey?: string };

  if (!licenseKey || typeof licenseKey !== 'string') {
    res.status(400).json({ valid: false, error: 'licenseKey is required' });
    return;
  }

  try {
    const valid = await validateLicenseKey(licenseKey.trim());
    res.json({ valid });
  } catch (err) {
    console.error('[License] Validation error:', err);
    // If DB is down fall back to offline check (simple prefix for dev/testing)
    const offlineValid = licenseKey.startsWith('CODESYNC-DEV-');
    res.json({ valid: offlineValid });
  }
});
