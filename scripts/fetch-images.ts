import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function parseArgs(argv: string[]): { outputDir: string; inputs: string[] } {
  let outputDir = path.join(process.cwd(), 'downloads', 'cloudinary-images');
  const inputs: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --out');
      }
      outputDir = path.resolve(next);
      i += 1;
      continue;
    }
    inputs.push(arg);
  }

  if (inputs.length === 0) {
    throw new Error('Usage: npm run fetch:images -- <json-file-or-dir> [more paths] [--out <directory>]');
  }

  return { outputDir, inputs };
}

async function listJsonFiles(inputPath: string): Promise<string[]> {
  const abs = path.resolve(inputPath);
  const stats = await fs.stat(abs);

  if (stats.isFile()) {
    return abs.endsWith('.json') ? [abs] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(abs, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => listJsonFiles(path.join(abs, entry.name))),
  );

  return nested.flat();
}

function isCloudinaryUrl(value: string): boolean {
  return /^https?:\/\/res\.cloudinary\.com\//i.test(value);
}

function toCanonicalHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function getCloudinaryAssetKey(urlString: string): string | null {
  try {
    const parsed = new URL(urlString);
    const m = parsed.pathname.match(/\/upload\/(?:v\d+\/)?(.+)/);
    if (!m) return null;
    return m[1];
  } catch {
    return null;
  }
}

function hasVersionSegment(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return /\/upload\/v\d+\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function walk(value: JsonValue, found: Set<string>): void {
  if (typeof value === 'string') {
    if (isCloudinaryUrl(value)) {
      const canonical = toCanonicalHttpsUrl(value);
      if (canonical) {
        found.add(canonical);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, found);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      walk(nestedValue, found);
    }
  }
}

async function readUrlsFromJson(jsonFile: string): Promise<string[]> {
  const raw = await fs.readFile(jsonFile, 'utf8');
  const data = JSON.parse(raw) as JsonValue;
  const found = new Set<string>();
  walk(data, found);
  return [...found];
}

function extensionFromUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString);
    const ext = path.extname(parsed.pathname);
    return ext && ext.length <= 8 ? ext : '.bin';
  } catch {
    return '.bin';
  }
}

function safeFileBase(urlString: string): string {
  try {
    const parsed = new URL(urlString);
    const withoutLeadingSlash = parsed.pathname.replace(/^\/+/, '');
    return withoutLeadingSlash.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/[\/]/g, '__');
  } catch {
    return `image_${Date.now()}`;
  }
}

async function downloadFile(url: string, outputDir: string, index: number): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed ${response.status} ${response.statusText}`);
  }

  const arr = await response.arrayBuffer();
  const ext = extensionFromUrl(url);
  const base = safeFileBase(url);
  const fileName = `${String(index).padStart(3, '0')}_${base}${ext}`;
  const filePath = path.join(outputDir, fileName);

  await fs.writeFile(filePath, Buffer.from(arr));
  return filePath;
}

async function main(): Promise<void> {
  const { outputDir, inputs } = parseArgs(process.argv.slice(2));
  await fs.mkdir(outputDir, { recursive: true });
  const failureLogPath = path.join(outputDir, 'failed-fetches.log');
  await fs.writeFile(failureLogPath, '');

  const jsonFilesNested = await Promise.all(inputs.map((input) => listJsonFiles(input)));
  const jsonFiles = [...new Set(jsonFilesNested.flat())].sort();

  if (jsonFiles.length === 0) {
    console.log('No JSON files found from provided input paths.');
    return;
  }

  const allUrls = new Set<string>();
  for (const file of jsonFiles) {
    const urls = await readUrlsFromJson(file);
    for (const url of urls) {
      allUrls.add(url);
    }
  }

  const preferredByAssetKey = new Map<string, string>();
  const passthroughUrls = new Set<string>();
  let sawVersionedUrl = false;

  for (const url of allUrls) {
    const assetKey = getCloudinaryAssetKey(url);
    if (!assetKey) {
      passthroughUrls.add(url);
      continue;
    }
    if (hasVersionSegment(url)) {
      sawVersionedUrl = true;
    }
    const existing = preferredByAssetKey.get(assetKey);
    if (!existing) {
      preferredByAssetKey.set(assetKey, url);
      continue;
    }

    const incomingVersioned = hasVersionSegment(url);
    const existingVersioned = hasVersionSegment(existing);
    if (incomingVersioned && !existingVersioned) {
      preferredByAssetKey.set(assetKey, url);
      continue;
    }
    if (incomingVersioned === existingVersioned && url.length < existing.length) {
      preferredByAssetKey.set(assetKey, url);
    }
  }

  const urls = [...preferredByAssetKey.values(), ...passthroughUrls]
    .filter((url) => (sawVersionedUrl ? hasVersionSegment(url) : true))
    .sort();
  if (urls.length === 0) {
    console.log('No Cloudinary URLs found in provided JSON files.');
    return;
  }

  console.log(`Found ${urls.length} unique Cloudinary URL(s). Downloading to ${outputDir}`);

  let successCount = 0;
  const failures: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      const filePath = await downloadFile(url, outputDir, i + 1);
      console.log(`OK   ${url} -> ${filePath}`);
      successCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${url} -> ${message}`);
      failures.push(`${new Date().toISOString()} ${url} :: ${message}`);
    }
  }

  if (failures.length > 0) {
    await fs.appendFile(failureLogPath, `${failures.join('\n')}\n`, 'utf8');
    console.log(`Failure log written: ${failureLogPath}`);
  }
  console.log(`Done. Downloaded ${successCount}/${urls.length} file(s).`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
