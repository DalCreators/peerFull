/**
 * email.ts
 * Sends zipped room files to subscribers when a room closes.
 * Requires SMTP env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

import * as nodemailer from 'nodemailer';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
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

/** Send room files to all subscribers. Silently fails if SMTP not configured. */
export async function sendFilesToSubscribers(
  subscribers: string[],
  snapshot: Record<string, string>,
  folderName: string,
  roomCode: string
): Promise<void> {
  if (subscribers.length === 0) return;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Email] SMTP not configured — skipping subscriber emails');
    return;
  }

  let zipBuffer: Buffer;
  try {
    zipBuffer = await buildZip(snapshot, folderName);
  } catch (err) {
    console.error('[Email] Failed to build ZIP:', err);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `PeerSync Room ${roomCode} — Your Files`;
  const text = `Hi!\n\nAttached are all the files from your PeerSync session (Room ${roomCode}).\n\nHappy coding!\n— PeerSync`;

  for (const email of subscribers) {
    try {
      await transporter.sendMail({
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
