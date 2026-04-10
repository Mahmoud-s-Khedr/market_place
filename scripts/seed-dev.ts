import { parseDevSeedInput, runDevSeed } from '../src/dev/dev-seeder';

async function main(): Promise<void> {
  const input = parseDevSeedInput(process.env);
  const result = await runDevSeed(input);

  console.log('Dev seed completed successfully');
  console.log(`Logs directory: ${result.logDir}`);
  console.log(`Summary: ${JSON.stringify(result.summary)}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Dev seed failed: ${message}`);
  process.exit(1);
});
