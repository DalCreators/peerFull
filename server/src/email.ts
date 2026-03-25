/**
 * email.ts
 * Sends zipped room files to subscribers when a room closes.
 * Requires: RESEND_API_KEY env var (get one free at resend.com)
 */

import { Resend } from 'resend';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

/** Build an in-memory ZIP buffer from a file snapshot. */
async function buildZip(snapshot: Record<string, string>, folderName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver.create('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const pass = new PassThrough();

    pass.on('data', (chunk) => chunks.push(chunk));
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);

    archive.pipe(pass);
    archive.on('error', reject);

    for (const [relPath, content] of Object.entries(snapshot)) {
      archive.append(content, { name: `${folderName}/${relPath}` });
    }

    archive.finalize();
  });
}

/** Send room files to all subscribers. Silently fails if Resend not configured. */
export async function sendFilesToSubscribers(
  subscribers: string[],
  snapshot: Record<string, string>,
  folderName: string,
  roomCode: string
): Promise<void> {
  if (subscribers.length === 0) return;

  const resend = getResend();
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY not configured — skipping subscriber emails');
    return;
  }

  let zipBuffer: Buffer;
  try {
    zipBuffer = await buildZip(snapshot, folderName);
  } catch (err) {
    console.error('[Email] Failed to build ZIP:', err);
    return;
  }

  const from = process.env.EMAIL_FROM || 'PeerSync <onboarding@resend.dev>';
  const subject = `PeerSync Room ${roomCode} — Your Files`;
  const text = `Hi!\n\nAttached are all the files from your PeerSync session (Room ${roomCode}).\n\nHappy coding!\n— PeerSync`;

  for (const email of subscribers) {
    try {
      await resend.emails.send({
        from,
        to: email,
        subject,
        text,
        attachments: [{
          filename: `peersync-${roomCode}.zip`,
          content: zipBuffer,
          contentType: 'application/zip'
        }]
      });
      console.log(`[Email] Sent files to ${email}`);
    } catch (err) {
      console.error(`[Email] Failed to send to ${email}:`, err);
    }
  }
}
