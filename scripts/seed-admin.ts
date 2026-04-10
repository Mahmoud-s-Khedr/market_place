import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { BCRYPT_ROUNDS } from '../src/common/constants';
import { parseAdminSeedInput, seedAdminUser } from '../src/admin/admin-seeder';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const { phone, password } = parseAdminSeedInput(process.env);
  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await seedAdminUser(client, phone, passwordHash);
    await client.query('COMMIT');
    const action = result.created ? 'created' : 'updated';
    console.log(`Admin seed completed: ${action} admin user ${result.phone} (id=${result.id})`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Admin seed failed: ${message}`);
  process.exit(1);
});
