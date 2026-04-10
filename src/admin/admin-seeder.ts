import { createHash } from 'crypto';
import { PoolClient } from 'pg';

export const ADMIN_PHONE_REGEX = /^\+?[1-9]\d{7,15}$/;
export const ADMIN_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export type AdminSeedInput = {
  phone: string;
  password: string;
};

export function parseAdminSeedInput(env: NodeJS.ProcessEnv): AdminSeedInput {
  const phone = (env.ADMIN_PHONE ?? '').trim();
  const password = env.ADMIN_PASSWORD ?? '';

  if (!phone) {
    throw new Error('ADMIN_PHONE is required');
  }
  if (!ADMIN_PHONE_REGEX.test(phone)) {
    throw new Error('ADMIN_PHONE must be a valid E.164-like phone number');
  }
  if (!password) {
    throw new Error('ADMIN_PASSWORD is required');
  }
  if (password.length < 8 || password.length > 64) {
    throw new Error('ADMIN_PASSWORD must be between 8 and 64 characters');
  }
  if (!ADMIN_PASSWORD_REGEX.test(password)) {
    throw new Error('ADMIN_PASSWORD must contain letters and numbers');
  }

  return { phone, password };
}

function buildBootstrapSsn(phone: string): string {
  const digest = createHash('sha256').update(phone).digest('hex').slice(0, 20);
  return `ADM${digest}`;
}

export async function seedAdminUser(
  client: Pick<PoolClient, 'query'>,
  phone: string,
  passwordHash: string,
): Promise<{ id: number; phone: string; created: boolean }> {
  const existing = await client.query<{ id: number }>('SELECT id FROM users WHERE phone = $1 LIMIT 1', [phone]);
  const created = !existing.rowCount;

  if (!existing.rowCount) {
    await client.query(
      `INSERT INTO users (name, ssn, phone, password_hash, status, is_admin)
       VALUES ($1, $2, $3, $4, 'active', true)`,
      ['Primary Admin', buildBootstrapSsn(phone), phone, passwordHash],
    );
  }

  const updated = await client.query<{ id: number; phone: string }>(
    `UPDATE users
     SET password_hash = $1,
         status = 'active',
         is_admin = true,
         updated_at = NOW()
     WHERE phone = $2
     RETURNING id, phone`,
    [passwordHash, phone],
  );

  if (!updated.rowCount) {
    throw new Error('Failed to seed admin user');
  }

  return { id: updated.rows[0].id, phone: updated.rows[0].phone, created };
}
