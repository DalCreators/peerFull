/**
 * database.ts
 * PostgreSQL connection via Neon.tech serverless driver.
 * Creates schema on first run if tables don't exist.
 */

import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon> | null = null;

export async function setupDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL not set');
  }

  sql = neon(dbUrl);

  // Create tables if they don't exist
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email       TEXT UNIQUE NOT NULL,
      license_key TEXT UNIQUE,
      tier        TEXT NOT NULL DEFAULT 'free',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rooms (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_code   CHAR(6) UNIQUE NOT NULL,
      created_by  UUID REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id    UUID REFERENCES rooms(id),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at   TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS license_keys (
      key        TEXT PRIMARY KEY,
      user_id    UUID REFERENCES users(id),
      tier       TEXT NOT NULL DEFAULT 'pro',
      is_active  BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  console.log('[DB] Schema ready');
}

export function getDb() {
  if (!sql) throw new Error('Database not initialized');
  return sql;
}

/** Check if a license key is valid and active */
export async function validateLicenseKey(key: string): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql`
    SELECT is_active FROM license_keys WHERE key = ${key}
  `;
  const result = rows as { is_active: boolean }[];
  return result.length > 0 && result[0].is_active === true;
}
