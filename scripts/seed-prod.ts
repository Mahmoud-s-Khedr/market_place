import { Pool } from 'pg';
import { parseProdSeedInput, runProdSeed } from '../src/prod/prod-seeder';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const input = parseProdSeedInput(process.env);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const summary = await runProdSeed(client, input);
    await client.query('COMMIT');
    console.log(`Prod seed completed successfully: ${JSON.stringify(summary)}`);
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
  console.error(`Prod seed failed: ${message}`);
  process.exit(1);
});
