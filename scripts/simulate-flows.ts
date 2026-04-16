/**
 * scripts/simulate-flows.ts
 *
 * End-to-end API/feature simulator for development mode.
 * - Covers all REST endpoints and key WebSocket chat events
 * - Runs happy paths + focused negative checks
 * - Performs real Cloudinary direct upload with generated fake images
 * - Produces flow logs + coverage artifacts
 *
 * Usage (example):
 *   NODE_ENV=development OTP_DEV_MODE=true npm run simulate
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { io, Socket } from 'socket.io-client';

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const CONFIG = {
  baseUrl: process.env.BASE_URL ?? 'http://localhost:800',
  timeoutMs: parsePositiveInt(process.env.SIM_TIMEOUT_MS, 12000),
  retry429WaitMs: parsePositiveInt(process.env.SIM_429_RETRY_WAIT_MS, 65000),
  retry429Attempts: parsePositiveInt(process.env.SIM_429_RETRY_ATTEMPTS, 1),
  negativeTests: parseBool(process.env.SIM_NEGATIVE_TESTS, true),
  realUpload: parseBool(process.env.SIM_REAL_UPLOAD, true),
  continueOnFail: parseBool(process.env.SIM_CONTINUE_ON_FAIL, true),
  concurrentUsers: parsePositiveInt(process.env.SIM_CONCURRENT_USERS, 10),
  chatPairs: parsePositiveInt(process.env.SIM_CHAT_PAIRS, 4),
  concurrentMessagesPerPair: parsePositiveInt(process.env.SIM_CONCURRENT_MESSAGES_PER_PAIR, 3),
  concurrentStaggerMs: parsePositiveInt(process.env.SIM_CONCURRENT_STAGGER_MS, 100),
  enableConcurrentFlow: parseBool(process.env.SIM_ENABLE_CONCURRENT_FLOW, true),
  adminPhone: process.env.ADMIN_PHONE ?? '+201000000000',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'ChangeMe123',
};

function ensureConcurrentConfig(): void {
  if (CONFIG.concurrentUsers < 10) {
    throw new Error('SIM_CONCURRENT_USERS must be >= 10.');
  }
  if (CONFIG.chatPairs < 1) {
    throw new Error('SIM_CHAT_PAIRS must be >= 1.');
  }
  if (CONFIG.chatPairs * 2 > CONFIG.concurrentUsers) {
    throw new Error('Invalid config: SIM_CHAT_PAIRS * 2 must be <= SIM_CONCURRENT_USERS.');
  }
}

function ensurePreflight(): void {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('NODE_ENV must be exactly "development" for this simulator.');
  }
  if (process.env.OTP_DEV_MODE !== 'true') {
    throw new Error(
      'OTP_DEV_MODE must be "true" on both server and simulator shell. Example:\n' +
      '  OTP_DEV_MODE=true NODE_ENV=development npm run start:dev\n' +
      '  OTP_DEV_MODE=true NODE_ENV=development npm run simulate',
    );
  }
  ensureConcurrentConfig();
}

function makeRunId(): string {
  const forced = process.env.SIM_RUN_ID?.trim();
  if (forced) return forced;
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${iso}-${rand}`;
}

const RUN_ID = makeRunId();
const RUN_TS = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
const LOG_DIR = path.join(process.cwd(), 'logs', `simulation-${RUN_TS}-${RUN_ID}`);

function phoneFromSeed(seed: number, middle: string): string {
  const suffix = String(seed % 10_000_000).padStart(7, '0');
  return `+201${middle}${suffix}`;
}

function ssnFromSeed(seed: number): string {
  return String((seed % 90_000_000) + 10_000_000);
}

function numericSeedFromRunId(runId: string): number {
  const digits = runId.replace(/\D/g, '');
  if (!digits) return Date.now();
  return Number(digits.slice(-12));
}

const seed = numericSeedFromRunId(RUN_ID);

const ALICE_PHONE = phoneFromSeed(seed + 101, '1');
const BOB_PHONE = phoneFromSeed(seed + 202, '2');
const NEG_PHONE = phoneFromSeed(seed + 303, '3');
const ALICE_PASSWORD = 'SimPass123';
const BOB_PASSWORD = 'SimPass456';
const ALICE_SSN = ssnFromSeed(seed + 1111);
const BOB_SSN = ssnFromSeed(seed + 2222);
const NEG_SSN = ssnFromSeed(seed + 3333);

// -----------------------------------------------------------------------------
// Coverage registry
// -----------------------------------------------------------------------------

type CoverageStatus = 'covered' | 'failed' | 'not_executed';

type RestEndpoint =
  | 'GET /health/live'
  | 'GET /health/ready'
  | 'GET /categories'
  | 'GET /search/products'
  | 'POST /auth/register'
  | 'POST /auth/register/resend-otp'
  | 'POST /auth/register/verify'
  | 'POST /auth/login'
  | 'POST /auth/password/request-otp'
  | 'POST /auth/password/reset'
  | 'POST /auth/refresh'
  | 'POST /auth/logout'
  | 'GET /me'
  | 'PATCH /me'
  | 'PATCH /me/password'
  | 'GET /me/contacts'
  | 'POST /me/contacts'
  | 'PATCH /me/contacts/:id'
  | 'DELETE /me/contacts/:id'
  | 'GET /users/:id'
  | 'POST /blocks/:userId'
  | 'DELETE /blocks/:userId'
  | 'GET /blocks'
  | 'POST /files/upload-intent'
  | 'PATCH /files/:id/mark-uploaded'
  | 'GET /files/:id'
  | 'POST /products'
  | 'GET /products/:id'
  | 'PATCH /products/:id'
  | 'DELETE /products/:id'
  | 'PATCH /products/:id/status'
  | 'GET /my/products'
  | 'POST /favorites/:productId'
  | 'DELETE /favorites/:productId'
  | 'GET /favorites'
  | 'POST /chat/conversations'
  | 'GET /chat/conversations'
  | 'GET /chat/conversations/:id'
  | 'GET /chat/conversations/:id/messages'
  | 'POST /ratings'
  | 'GET /ratings/:userId'
  | 'POST /reports'
  | 'GET /reports/me'
  | 'GET /admin/users'
  | 'GET /admin/admins'
  | 'POST /admin/admins/:id'
  | 'DELETE /admin/admins/:id'
  | 'PATCH /admin/users/:id/status'
  | 'POST /admin/warnings'
  | 'GET /admin/reports'
  | 'PATCH /admin/reports/:id'
  | 'POST /admin/categories'
  | 'DELETE /admin/categories/:id';

type WsEndpoint = 'conversation.join' | 'message.send' | 'message.read';

const REST_ENDPOINTS: RestEndpoint[] = [
  'GET /health/live',
  'GET /health/ready',
  'GET /categories',
  'GET /search/products',
  'POST /auth/register',
  'POST /auth/register/resend-otp',
  'POST /auth/register/verify',
  'POST /auth/login',
  'POST /auth/password/request-otp',
  'POST /auth/password/reset',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /me',
  'PATCH /me',
  'PATCH /me/password',
  'GET /me/contacts',
  'POST /me/contacts',
  'PATCH /me/contacts/:id',
  'DELETE /me/contacts/:id',
  'GET /users/:id',
  'POST /blocks/:userId',
  'DELETE /blocks/:userId',
  'GET /blocks',
  'POST /files/upload-intent',
  'PATCH /files/:id/mark-uploaded',
  'GET /files/:id',
  'POST /products',
  'GET /products/:id',
  'PATCH /products/:id',
  'DELETE /products/:id',
  'PATCH /products/:id/status',
  'GET /my/products',
  'POST /favorites/:productId',
  'DELETE /favorites/:productId',
  'GET /favorites',
  'POST /chat/conversations',
  'GET /chat/conversations',
  'GET /chat/conversations/:id',
  'GET /chat/conversations/:id/messages',
  'POST /ratings',
  'GET /ratings/:userId',
  'POST /reports',
  'GET /reports/me',
  'GET /admin/users',
  'GET /admin/admins',
  'POST /admin/admins/:id',
  'DELETE /admin/admins/:id',
  'PATCH /admin/users/:id/status',
  'POST /admin/warnings',
  'GET /admin/reports',
  'PATCH /admin/reports/:id',
  'POST /admin/categories',
  'DELETE /admin/categories/:id',
];

const WS_ENDPOINTS: WsEndpoint[] = ['conversation.join', 'message.send', 'message.read'];

function initCoverage<T extends string>(keys: T[]): Record<T, CoverageStatus> {
  const out = {} as Record<T, CoverageStatus>;
  for (const k of keys) out[k] = 'not_executed';
  return out;
}

const restCoverage = initCoverage(REST_ENDPOINTS);
const wsCoverage = initCoverage(WS_ENDPOINTS);

function markCoverage<T extends string>(map: Record<T, CoverageStatus>, key: T, ok: boolean): void {
  if (ok) {
    map[key] = 'covered';
    return;
  }
  if (map[key] !== 'covered') map[key] = 'failed';
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface UserState {
  phone: string;
  password: string;
  ssn: string;
  token: string | null;
  refreshToken: string | null;
  userId: number | null;
}

interface ConcurrentMetrics {
  registered: number;
  loggedIn: number;
  throttled: number;
  skipped: number;
  chatPairsOk: number;
  messagesSent: number;
  messagesRead: number;
  errors: string[];
}

interface VirtualUserState extends UserState {
  key: string;
  index: number;
}

interface SimState {
  totalCalls: number;
  successes: number;
  failures: number;
  flowTotals: Record<string, { total: number; failures: number }>;
  assertionFailures: Array<{
    flow: string;
    step: string;
    expected: number[];
    actual: number;
    responseSnippet: string;
  }>;
  adminToken: string | null;
  adminRefreshToken: string | null;
  alice: UserState;
  bob: UserState;
  productCategoryId: number | null;
  categoryParentId: number | null;
  categoryLeafId: number | null;
  aliceProductId: number | null;
  aliceProduct2Id: number | null;
  conversationId: number | null;
  lastMessageId: number | null;
  reportId: number | null;
  aliceContactId: number | null;
  avatarFileId: number | null;
  productImageFileId: number | null;
  concurrentUsers: number;
  chatPairs: number;
  concurrentMetrics: ConcurrentMetrics;
}

interface LogEntry {
  flow: string;
  step: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  expectedStatus: number[];
  statusCode: number;
  matchedExpected: boolean;
  responseBody: unknown;
  durationMs: number;
  timestamp: string;
}

interface ApiCallOpts {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  token?: string | null;
  step: string;
  flow: string;
  state: SimState;
  expectedStatus?: number | number[];
  coverageKey?: RestEndpoint;
  critical?: boolean;
}

interface ApiCallResult {
  statusCode: number;
  body: unknown;
  matchedExpected: boolean;
}

// -----------------------------------------------------------------------------
// Logging helpers
// -----------------------------------------------------------------------------

let currentSectionEntries: LogEntry[] = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function printSection(name: string): void {
  console.log(`\n${CYAN}── ${name} ──${RESET}`);
  currentSectionEntries = [];
}

function printStep(ok: boolean, step: string, status: number, durationMs: number): void {
  const icon = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const statusColour = ok ? GREEN : RED;
  console.log(`  ${icon} [${statusColour}${status}${RESET}] ${step} (${durationMs}ms)`);
}

function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠  ${msg}${RESET}`);
}

function asArray(value: number | number[] | undefined): number[] {
  if (!value) return [200, 201];
  return Array.isArray(value) ? value : [value];
}

function textSnippet(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length <= 220 ? s : `${s.slice(0, 220)}...`;
}

function toId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function noteFlowStats(state: SimState, flow: string, failed: boolean): void {
  if (!state.flowTotals[flow]) state.flowTotals[flow] = { total: 0, failures: 0 };
  state.flowTotals[flow].total += 1;
  if (failed) state.flowTotals[flow].failures += 1;
}

async function flushSection(fileName: string): Promise<void> {
  const filePath = path.join(LOG_DIR, fileName);
  await fs.writeFile(filePath, JSON.stringify(currentSectionEntries, null, 2));
}

async function waitForServerReadiness(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CONFIG.baseUrl}/health/live`);
      if (res.status === 200) return;
    } catch {
      // keep retrying
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not become ready within 30s at ${CONFIG.baseUrl}/health/live`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeCoverageArtifacts(): Promise<void> {
  const coverage = {
    rest: restCoverage,
    ws: wsCoverage,
    totals: {
      restTotal: REST_ENDPOINTS.length,
      restCovered: REST_ENDPOINTS.filter((k) => restCoverage[k] === 'covered').length,
      restFailed: REST_ENDPOINTS.filter((k) => restCoverage[k] === 'failed').length,
      restNotExecuted: REST_ENDPOINTS.filter((k) => restCoverage[k] === 'not_executed').length,
      wsTotal: WS_ENDPOINTS.length,
      wsCovered: WS_ENDPOINTS.filter((k) => wsCoverage[k] === 'covered').length,
      wsFailed: WS_ENDPOINTS.filter((k) => wsCoverage[k] === 'failed').length,
      wsNotExecuted: WS_ENDPOINTS.filter((k) => wsCoverage[k] === 'not_executed').length,
    },
  };
  await fs.writeFile(path.join(LOG_DIR, 'coverage.json'), JSON.stringify(coverage, null, 2));
}

async function summarize(state: SimState): Promise<void> {
  const rate = state.totalCalls > 0
    ? `${Math.round((state.successes / state.totalCalls) * 100)}%`
    : 'N/A';

  const summary = {
    runAt: new Date().toISOString(),
    runId: RUN_ID,
    baseUrl: CONFIG.baseUrl,
    config: {
      timeoutMs: CONFIG.timeoutMs,
      negativeTests: CONFIG.negativeTests,
      realUpload: CONFIG.realUpload,
      continueOnFail: CONFIG.continueOnFail,
      enableConcurrentFlow: CONFIG.enableConcurrentFlow,
      concurrentUsers: CONFIG.concurrentUsers,
      chatPairs: CONFIG.chatPairs,
      concurrentMessagesPerPair: CONFIG.concurrentMessagesPerPair,
      concurrentStaggerMs: CONFIG.concurrentStaggerMs,
    },
    users: {
      alicePhone: ALICE_PHONE,
      bobPhone: BOB_PHONE,
      negativePhone: NEG_PHONE,
    },
    totals: {
      totalCalls: state.totalCalls,
      successes: state.successes,
      failures: state.failures,
      successRate: rate,
    },
    endpointCoverage: {
      rest: restCoverage,
      ws: wsCoverage,
      restSummary: {
        total: REST_ENDPOINTS.length,
        covered: REST_ENDPOINTS.filter((k) => restCoverage[k] === 'covered').length,
        failed: REST_ENDPOINTS.filter((k) => restCoverage[k] === 'failed').length,
        notExecuted: REST_ENDPOINTS.filter((k) => restCoverage[k] === 'not_executed').length,
      },
      wsSummary: {
        total: WS_ENDPOINTS.length,
        covered: WS_ENDPOINTS.filter((k) => wsCoverage[k] === 'covered').length,
        failed: WS_ENDPOINTS.filter((k) => wsCoverage[k] === 'failed').length,
        notExecuted: WS_ENDPOINTS.filter((k) => wsCoverage[k] === 'not_executed').length,
      },
    },
    flowFailures: state.flowTotals,
    assertionFailures: state.assertionFailures,
    concurrent: {
      users: state.concurrentUsers,
      chatPairs: state.chatPairs,
      metrics: state.concurrentMetrics,
    },
  };

  await fs.writeFile(path.join(LOG_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeCoverageArtifacts();

  const bar = '═'.repeat(64);
  console.log(`\n${bar}`);
  const colour = state.failures === 0 ? GREEN : state.successes > state.failures ? YELLOW : RED;
  console.log(`  Results: ${colour}${state.successes}/${state.totalCalls} matched expected${RESET} (${rate})`);
  console.log(`  Logs: ${LOG_DIR}`);
  console.log(`${bar}\n`);
}

// -----------------------------------------------------------------------------
// HTTP helper
// -----------------------------------------------------------------------------

async function apiCall(opts: ApiCallOpts): Promise<ApiCallResult> {
  const {
    method,
    path: urlPath,
    body,
    token,
    step,
    flow,
    state,
    expectedStatus,
    coverageKey,
    critical,
  } = opts;

  const expected = asArray(expectedStatus);
  const url = CONFIG.baseUrl + urlPath;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let statusCode = 0;
  let responseBody: unknown = null;
  const t0 = Date.now();

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      statusCode = response.status;
      const text = await response.text();
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { _raw: text };
      }
    } catch (err) {
      responseBody = { _networkError: err instanceof Error ? err.message : String(err) };
      statusCode = 0;
    } finally {
      clearTimeout(timeout);
    }

    const shouldRetry429 = statusCode === 429
      && !asArray(expectedStatus).includes(429)
      && attempt < CONFIG.retry429Attempts;
    if (!shouldRetry429) break;

    const waitMs = CONFIG.retry429WaitMs;
    warn(`429 received for ${step}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${CONFIG.retry429Attempts})`);
    await new Promise((r) => setTimeout(r, waitMs));
    attempt += 1;
  }

  const durationMs = Date.now() - t0;
  const matchedExpected = expected.includes(statusCode);

  const logHeaders = { ...headers };
  if (logHeaders.Authorization) logHeaders.Authorization = 'Bearer [REDACTED]';

  currentSectionEntries.push({
    flow,
    step,
    method,
    url,
    requestHeaders: logHeaders,
    requestBody: body ?? null,
    expectedStatus: expected,
    statusCode,
    matchedExpected,
    responseBody,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  state.totalCalls += 1;
  if (matchedExpected) state.successes += 1;
  else state.failures += 1;
  noteFlowStats(state, flow, !matchedExpected);

  printStep(matchedExpected, step, statusCode, durationMs);

  if (coverageKey) markCoverage(restCoverage, coverageKey, matchedExpected);

  if (!matchedExpected) {
    state.assertionFailures.push({
      flow,
      step,
      expected,
      actual: statusCode,
      responseSnippet: textSnippet(responseBody),
    });
    if (critical || !CONFIG.continueOnFail) {
      throw new Error(
        `Expected [${expected.join(', ')}], got [${statusCode}] at ${step}. ` +
        `Response: ${textSnippet(responseBody)}`,
      );
    }
  }

  return { statusCode, body: responseBody, matchedExpected };
}

// -----------------------------------------------------------------------------
// WebSocket helper
// -----------------------------------------------------------------------------

function connectWs(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${CONFIG.baseUrl}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`WebSocket connection timeout (${CONFIG.timeoutMs}ms)`));
    }, CONFIG.timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// -----------------------------------------------------------------------------
// Real upload helper
// -----------------------------------------------------------------------------

function fakePngBuffer(): Buffer {
  // Minimal valid 1x1 PNG
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+3WQAAAAASUVORK5CYII=';
  return Buffer.from(base64, 'base64');
}

async function uploadToCloudinary(intentBody: unknown): Promise<{ ok: boolean; response: unknown; statusCode: number }> {
  const parsed = intentBody as {
    upload?: {
      method?: string;
      url?: string;
      fields?: Record<string, string>;
      headers?: Record<string, string>;
    };
  };

  const upload = parsed.upload;
  if (!upload?.url) {
    return { ok: false, response: { error: 'Missing upload.url in upload intent response' }, statusCode: 0 };
  }

  const method = (upload.method ?? 'POST').toUpperCase();
  const headers: Record<string, string> = upload.headers ?? {};

  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields ?? {})) {
    form.append(k, String(v));
  }
  const png = fakePngBuffer();
  const arr = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  const blob = new Blob([arr], { type: 'image/png' });
  form.append('file', blob, `sim-${RUN_ID}.png`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

  try {
    const res = await fetch(upload.url, {
      method,
      headers,
      body: form,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = { _raw: text };
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw
    }

    const b = body as { secure_url?: string; public_id?: string; url?: string };
    const shapeOk = Boolean(b.public_id) && (Boolean(b.secure_url) || Boolean(b.url));
    return { ok: res.status >= 200 && res.status < 300 && shapeOk, response: body, statusCode: res.status };
  } catch (err) {
    return {
      ok: false,
      response: { _networkError: err instanceof Error ? err.message : String(err) },
      statusCode: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// -----------------------------------------------------------------------------
// Flows
// -----------------------------------------------------------------------------

async function flow01_anonymous(state: SimState): Promise<void> {
  printSection('01 — Anonymous + Discovery');
  const flow = '01-anonymous';

  await apiCall({
    method: 'GET',
    path: '/health/live',
    step: 'GET /health/live',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /health/live',
    critical: true,
  });

  await apiCall({
    method: 'GET',
    path: '/health/ready',
    step: 'GET /health/ready',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /health/ready',
    critical: true,
  });

  const catRes = await apiCall({
    method: 'GET',
    path: '/categories',
    step: 'GET /categories',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /categories',
  });

  if (catRes.matchedExpected) {
    const cats = (catRes.body as {
      categories?: Array<{ id: number; parent?: { id?: number } | null }>;
    }).categories ?? [];
    const parentIds = new Set(
      cats.map((c) => c.parent?.id ?? null).filter((id): id is number => id !== null),
    );
    const leaf = cats.find((c) => !parentIds.has(c.id)) ?? cats[cats.length - 1];
    if (leaf) {
      state.productCategoryId = toId(leaf.id);
      console.log(`  → productCategoryId (existing leaf) = ${state.productCategoryId}`);
    }
  }

  await apiCall({
    method: 'GET',
    path: '/search/products',
    step: 'GET /search/products',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /search/products',
  });

  await flushSection('01-anonymous.json');
}

async function registerUser(
  state: SimState,
  flow: string,
  label: string,
  phone: string,
  ssn: string,
  password: string,
  saveTo: UserState,
  withResend: boolean,
): Promise<void> {
  const regRes = await apiCall({
    method: 'POST',
    path: '/auth/register',
    body: { name: `${label} ${RUN_ID}`, phone, ssn, password },
    step: `POST /auth/register (${label})`,
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/register',
    critical: true,
  });

  let otp = (regRes.body as { otp?: string }).otp;
  if (!otp) throw new Error('Missing otp in /auth/register response. Ensure OTP_DEV_MODE=true on server.');

  if (withResend) {
    const resendRes = await apiCall({
      method: 'POST',
      path: '/auth/register/resend-otp',
      body: { phone },
      step: `POST /auth/register/resend-otp (${label})`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /auth/register/resend-otp',
    });
    const resent = (resendRes.body as { otp?: string }).otp;
    if (resent) otp = resent;
  }

  const verifyRes = await apiCall({
    method: 'POST',
    path: '/auth/register/verify',
    body: { phone, otp },
    step: `POST /auth/register/verify (${label})`,
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/register/verify',
    critical: true,
  });

  const vb = verifyRes.body as { accessToken?: string; refreshToken?: string; user?: { id?: number } };
  saveTo.token = vb.accessToken ?? null;
  saveTo.refreshToken = vb.refreshToken ?? null;
  saveTo.userId = toId(vb.user?.id);
}

async function flow02_registerUsers(state: SimState): Promise<void> {
  printSection('02 — Registration (Alice + Bob)');
  const flow = '02-registration';

  await registerUser(state, flow, 'alice', ALICE_PHONE, ALICE_SSN, ALICE_PASSWORD, state.alice, true);
  await registerUser(state, flow, 'bob', BOB_PHONE, BOB_SSN, BOB_PASSWORD, state.bob, false);

  await flushSection('02-registration.json');
}

async function flow03_adminBootstrap(state: SimState): Promise<void> {
  printSection('03 — Admin Login + Categories');
  const flow = '03-admin-bootstrap';

  const loginRes = await apiCall({
    method: 'POST',
    path: '/auth/login',
    body: { phone: CONFIG.adminPhone, password: CONFIG.adminPassword },
    step: 'POST /auth/login (admin)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/login',
    critical: true,
  });

  const b = loginRes.body as { accessToken?: string; refreshToken?: string };
  state.adminToken = b.accessToken ?? null;
  state.adminRefreshToken = b.refreshToken ?? null;

  const parentRes = await apiCall({
    method: 'POST',
    path: '/admin/categories',
    body: { name: `Electronics-${RUN_ID}` },
    token: state.adminToken,
    step: 'POST /admin/categories (parent)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /admin/categories',
    critical: true,
  });
  state.categoryParentId = toId((parentRes.body as { category?: { id?: unknown } }).category?.id);

  const leafRes = await apiCall({
    method: 'POST',
    path: '/admin/categories',
    body: { name: `Phones-${RUN_ID}`, parentId: state.categoryParentId },
    token: state.adminToken,
    step: 'POST /admin/categories (leaf)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /admin/categories',
    critical: true,
  });
  state.categoryLeafId = toId((leafRes.body as { category?: { id?: unknown } }).category?.id) ?? state.categoryLeafId;

  await flushSection('03-admin-bootstrap.json');
}

async function flow04_tokenLifecycle(state: SimState): Promise<void> {
  printSection('04 — Token Lifecycle');
  const flow = '04-token-lifecycle';

  const refreshRes = await apiCall({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken: state.alice.refreshToken },
    step: 'POST /auth/refresh (alice)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/refresh',
  });
  if (refreshRes.matchedExpected) {
    const rb = refreshRes.body as { accessToken?: string; refreshToken?: string };
    state.alice.token = rb.accessToken ?? state.alice.token;
    state.alice.refreshToken = rb.refreshToken ?? state.alice.refreshToken;
  }

  await apiCall({
    method: 'POST',
    path: '/auth/logout',
    body: { refreshToken: state.alice.refreshToken },
    token: state.alice.token,
    step: 'POST /auth/logout (alice)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/logout',
  });

  const reloginRes = await apiCall({
    method: 'POST',
    path: '/auth/login',
    body: { phone: state.alice.phone, password: state.alice.password },
    step: 'POST /auth/login (alice after logout)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/login',
  });
  if (reloginRes.matchedExpected) {
    const b = reloginRes.body as { accessToken?: string; refreshToken?: string };
    state.alice.token = b.accessToken ?? state.alice.token;
    state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
  }

  await flushSection('04-token-lifecycle.json');
}

async function flow05_passwordReset(state: SimState): Promise<void> {
  printSection('05 — Password Reset');
  const flow = '05-password-reset';

  const newPassword = `SimReset-${String(seed).slice(-4)}A1`;

  const reqRes = await apiCall({
    method: 'POST',
    path: '/auth/password/request-otp',
    body: { phone: state.alice.phone },
    step: 'POST /auth/password/request-otp (alice)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/password/request-otp',
  });

  const otp = (reqRes.body as { otp?: string }).otp;
  if (!otp) {
    warn('No otp in password request response; skipping reset step.');
    await flushSection('05-password-reset.json');
    return;
  }

  const resetRes = await apiCall({
    method: 'POST',
    path: '/auth/password/reset',
    body: { phone: state.alice.phone, otp, newPassword, confirmPassword: newPassword },
    step: 'POST /auth/password/reset (alice)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/password/reset',
  });

  if (resetRes.matchedExpected) {
    state.alice.password = newPassword;
    const rb = resetRes.body as { accessToken?: string; refreshToken?: string };
    state.alice.token = rb.accessToken ?? state.alice.token;
    state.alice.refreshToken = rb.refreshToken ?? state.alice.refreshToken;
  }

  await flushSection('05-password-reset.json');
}

async function flow06_uploadsAndProfile(state: SimState): Promise<void> {
  printSection('06 — Uploads + Profile');
  const flow = '06-uploads-profile';

  const avatarIntentRes = await apiCall({
    method: 'POST',
    path: '/files/upload-intent',
    body: {
      ownerType: 'user',
      purpose: 'avatar',
      filename: `avatar-${RUN_ID}.png`,
      mimeType: 'image/png',
      fileSizeBytes: fakePngBuffer().byteLength,
    },
    token: state.alice.token,
    step: 'POST /files/upload-intent (avatar)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /files/upload-intent',
  });

  state.avatarFileId = toId((avatarIntentRes.body as { file?: { id?: unknown } }).file?.id);

  if (CONFIG.realUpload && avatarIntentRes.matchedExpected) {
    const uploadRes = await uploadToCloudinary(avatarIntentRes.body);
    const ok = uploadRes.ok;
    const status = uploadRes.statusCode;
    printStep(ok, 'Cloudinary direct upload (avatar)', status, 0);
    noteFlowStats(state, flow, !ok);
    state.totalCalls += 1;
    if (ok) state.successes += 1;
    else {
      state.failures += 1;
      state.assertionFailures.push({
        flow,
        step: 'Cloudinary direct upload (avatar)',
        expected: [200, 201],
        actual: status,
        responseSnippet: textSnippet(uploadRes.response),
      });
      if (!CONFIG.continueOnFail) {
        throw new Error(`Cloudinary upload failed: ${textSnippet(uploadRes.response)}`);
      }
    }

    currentSectionEntries.push({
      flow,
      step: 'Cloudinary direct upload (avatar)',
      method: 'POST',
      url: 'cloudinary-direct-upload',
      requestHeaders: {},
      requestBody: { runId: RUN_ID },
      expectedStatus: [200, 201],
      statusCode: status,
      matchedExpected: ok,
      responseBody: uploadRes.response,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
  }

  if (state.avatarFileId) {
    await apiCall({
      method: 'PATCH',
      path: `/files/${state.avatarFileId}/mark-uploaded`,
      body: {},
      token: state.alice.token,
      step: `PATCH /files/${state.avatarFileId}/mark-uploaded`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /files/:id/mark-uploaded',
    });

    await apiCall({
      method: 'GET',
      path: `/files/${state.avatarFileId}`,
      token: state.alice.token,
      step: `GET /files/${state.avatarFileId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /files/:id',
    });
  }

  const productIntentRes = await apiCall({
    method: 'POST',
    path: '/files/upload-intent',
    body: {
      ownerType: 'user',
      purpose: 'product_image',
      filename: `product-${RUN_ID}.png`,
      mimeType: 'image/png',
      fileSizeBytes: fakePngBuffer().byteLength,
    },
    token: state.alice.token,
    step: 'POST /files/upload-intent (product image)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /files/upload-intent',
  });
  state.productImageFileId = toId((productIntentRes.body as { file?: { id?: unknown } }).file?.id);

  if (CONFIG.realUpload && productIntentRes.matchedExpected) {
    const uploadRes = await uploadToCloudinary(productIntentRes.body);
    const ok = uploadRes.ok;
    const status = uploadRes.statusCode;
    printStep(ok, 'Cloudinary direct upload (product image)', status, 0);
    noteFlowStats(state, flow, !ok);
    state.totalCalls += 1;
    if (ok) state.successes += 1;
    else {
      state.failures += 1;
      state.assertionFailures.push({
        flow,
        step: 'Cloudinary direct upload (product image)',
        expected: [200, 201],
        actual: status,
        responseSnippet: textSnippet(uploadRes.response),
      });
      if (!CONFIG.continueOnFail) {
        throw new Error(`Cloudinary upload failed: ${textSnippet(uploadRes.response)}`);
      }
    }

    currentSectionEntries.push({
      flow,
      step: 'Cloudinary direct upload (product image)',
      method: 'POST',
      url: 'cloudinary-direct-upload',
      requestHeaders: {},
      requestBody: { runId: RUN_ID },
      expectedStatus: [200, 201],
      statusCode: status,
      matchedExpected: ok,
      responseBody: uploadRes.response,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
  }

  if (state.productImageFileId) {
    await apiCall({
      method: 'PATCH',
      path: `/files/${state.productImageFileId}/mark-uploaded`,
      body: {},
      token: state.alice.token,
      step: `PATCH /files/${state.productImageFileId}/mark-uploaded`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /files/:id/mark-uploaded',
    });

    await apiCall({
      method: 'GET',
      path: `/files/${state.productImageFileId}`,
      token: state.alice.token,
      step: `GET /files/${state.productImageFileId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /files/:id',
    });
  }

  await apiCall({
    method: 'GET',
    path: '/me',
    token: state.alice.token,
    step: 'GET /me',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /me',
  });

  await apiCall({
    method: 'PATCH',
    path: '/me',
    body: {
      name: `Alice ${RUN_ID}`,
      avatarFileId: state.avatarFileId ?? undefined,
    },
    token: state.alice.token,
    step: 'PATCH /me (set avatarFileId)',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'PATCH /me',
  });

  const changedPassword = `SimFinal-${String(seed).slice(-4)}A1`;
  const pwdRes = await apiCall({
    method: 'PATCH',
    path: '/me/password',
    body: { oldPassword: state.alice.password, newPassword: changedPassword },
    token: state.alice.token,
    step: 'PATCH /me/password',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'PATCH /me/password',
  });

  if (pwdRes.matchedExpected) {
    state.alice.password = changedPassword;
    const reloginRes = await apiCall({
      method: 'POST',
      path: '/auth/login',
      body: { phone: state.alice.phone, password: state.alice.password },
      step: 'POST /auth/login (alice after change-password)',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /auth/login',
    });
    if (reloginRes.matchedExpected) {
      const b = reloginRes.body as { accessToken?: string; refreshToken?: string };
      state.alice.token = b.accessToken ?? state.alice.token;
      state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
    }
  }

  await flushSection('06-uploads-profile.json');
}

async function flow07_contacts(state: SimState): Promise<void> {
  printSection('07 — Contacts');
  const flow = '07-contacts';

  await apiCall({
    method: 'GET',
    path: '/me/contacts',
    token: state.alice.token,
    step: 'GET /me/contacts',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /me/contacts',
  });

  const createRes = await apiCall({
    method: 'POST',
    path: '/me/contacts',
    body: { contactType: 'phone', value: '+201666666666', isPrimary: true },
    token: state.alice.token,
    step: 'POST /me/contacts',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /me/contacts',
  });
  state.aliceContactId = toId((createRes.body as { contact?: { id?: unknown } }).contact?.id);

  if (state.aliceContactId) {
    await apiCall({
      method: 'PATCH',
      path: `/me/contacts/${state.aliceContactId}`,
      body: { value: '+201777777777' },
      token: state.alice.token,
      step: `PATCH /me/contacts/${state.aliceContactId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /me/contacts/:id',
    });

    await apiCall({
      method: 'DELETE',
      path: `/me/contacts/${state.aliceContactId}`,
      token: state.alice.token,
      step: `DELETE /me/contacts/${state.aliceContactId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'DELETE /me/contacts/:id',
    });
  }

  await flushSection('07-contacts.json');
}

async function flow08_seller(state: SimState): Promise<void> {
  printSection('08 — Seller Journey');
  const flow = '08-seller';

  const categoryId = state.productCategoryId ?? state.categoryLeafId ?? 1;
  const imageFileIds = state.productImageFileId ? [state.productImageFileId] : undefined;

  const p1 = await apiCall({
    method: 'POST',
    path: '/products',
    body: {
      categoryId,
      name: `Used Laptop ${RUN_ID}`,
      description: 'Simulation listing for integration testing.',
      price: 1500,
      city: 'Cairo',
      addressText: '10 Tahrir Square',
      details: { condition: 'used', source: 'simulate-flows' },
      isNegotiable: true,
      preferredContactMethod: 'both',
      imageFileIds,
    },
    token: state.alice.token,
    step: 'POST /products (product 1)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /products',
    critical: true,
  });
  state.aliceProductId = toId((p1.body as { product?: { id?: unknown } }).product?.id);

  const p2 = await apiCall({
    method: 'POST',
    path: '/products',
    body: {
      categoryId,
      name: `Vintage Camera ${RUN_ID}`,
      description: 'Simulation listing for buyer/admin flows.',
      price: 850,
      city: 'Alexandria',
      addressText: '5 Corniche Road',
      details: { condition: 'used', source: 'simulate-flows' },
      isNegotiable: false,
      preferredContactMethod: 'chat',
      imageFileIds,
    },
    token: state.alice.token,
    step: 'POST /products (product 2)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /products',
    critical: true,
  });
  state.aliceProduct2Id = toId((p2.body as { product?: { id?: unknown } }).product?.id);

  if (state.aliceProductId) {
    await apiCall({
      method: 'PATCH',
      path: `/products/${state.aliceProductId}`,
      body: {
        price: 1400,
        name: `Used Laptop Updated ${RUN_ID}`,
        isNegotiable: false,
        preferredContactMethod: 'phone',
      },
      token: state.alice.token,
      step: `PATCH /products/${state.aliceProductId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /products/:id',
    });

    await apiCall({
      method: 'PATCH',
      path: `/products/${state.aliceProductId}/status`,
      body: { status: 'sold' },
      token: state.alice.token,
      step: `PATCH /products/${state.aliceProductId}/status`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /products/:id/status',
    });

    await apiCall({
      method: 'DELETE',
      path: `/products/${state.aliceProductId}`,
      token: state.alice.token,
      step: `DELETE /products/${state.aliceProductId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'DELETE /products/:id',
    });
  }

  await apiCall({
    method: 'GET',
    path: '/my/products',
    token: state.alice.token,
    step: 'GET /my/products',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /my/products',
  });

  await apiCall({
    method: 'GET',
    path: '/my/products?status=sold',
    token: state.alice.token,
    step: 'GET /my/products?status=sold',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /my/products',
  });

  await apiCall({
    method: 'GET',
    path: '/my/products?status=archived',
    token: state.alice.token,
    step: 'GET /my/products?status=archived',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /my/products',
  });

  await flushSection('08-seller.json');
}

async function flow09_buyerAndChat(state: SimState): Promise<void> {
  printSection('09 — Buyer + Chat REST');
  const flow = '09-buyer-chat-rest';

  await apiCall({
    method: 'GET',
    path: '/search/products',
    step: 'GET /search/products (buyer)',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /search/products',
  });

  await apiCall({
    method: 'GET',
    path: '/search/products?sortBy=price&sortDir=asc&limit=5',
    token: state.bob.token,
    step: 'GET /search/products (authed personalization)',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /search/products',
  });

  if (state.aliceProduct2Id) {
    await apiCall({
      method: 'GET',
      path: `/products/${state.aliceProduct2Id}`,
      step: `GET /products/${state.aliceProduct2Id}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /products/:id',
    });

    await apiCall({
      method: 'GET',
      path: `/products/${state.aliceProduct2Id}`,
      token: state.bob.token,
      step: `GET /products/${state.aliceProduct2Id} (authed personalization)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /products/:id',
    });

    await apiCall({
      method: 'POST',
      path: `/favorites/${state.aliceProduct2Id}`,
      token: state.bob.token,
      step: `POST /favorites/${state.aliceProduct2Id}`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /favorites/:productId',
    });

    await apiCall({
      method: 'GET',
      path: '/favorites?sortBy=created&sortDir=desc&limit=10',
      token: state.bob.token,
      step: 'GET /favorites',
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /favorites',
    });
  }

  if (state.alice.userId) {
    await apiCall({
      method: 'GET',
      path: `/ratings/${state.alice.userId}`,
      step: `GET /ratings/${state.alice.userId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /ratings/:userId',
    });

    const conv = await apiCall({
      method: 'POST',
      path: '/chat/conversations',
      body: { participantId: state.alice.userId, productId: state.aliceProduct2Id ?? undefined },
      token: state.bob.token,
      step: 'POST /chat/conversations',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /chat/conversations',
    });
    state.conversationId = toId((conv.body as { conversation?: { id?: unknown } }).conversation?.id);

    await apiCall({
      method: 'GET',
      path: `/users/${state.alice.userId}`,
      step: `GET /users/${state.alice.userId} (public)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /users/:id',
    });

    await apiCall({
      method: 'GET',
      path: `/users/${state.alice.userId}?limit=5&offset=0`,
      token: state.bob.token,
      step: `GET /users/${state.alice.userId} (authed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /users/:id',
    });
  }

  await apiCall({
    method: 'GET',
    path: '/chat/conversations',
    token: state.bob.token,
    step: 'GET /chat/conversations',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /chat/conversations',
  });

  await apiCall({
    method: 'GET',
    path: '/chat/conversations?scope=buy',
    token: state.bob.token,
    step: 'GET /chat/conversations?scope=buy',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /chat/conversations',
  });

  await apiCall({
    method: 'GET',
    path: '/chat/conversations?scope=sell',
    token: state.alice.token,
    step: 'GET /chat/conversations?scope=sell',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /chat/conversations',
  });

  if (state.conversationId) {
    await apiCall({
      method: 'GET',
      path: `/chat/conversations/${state.conversationId}`,
      token: state.bob.token,
      step: `GET /chat/conversations/${state.conversationId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations/:id',
    });

    await apiCall({
      method: 'GET',
      path: `/chat/conversations/${state.conversationId}/messages`,
      token: state.bob.token,
      step: `GET /chat/conversations/${state.conversationId}/messages`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations/:id/messages',
    });
  }

  if (state.aliceProduct2Id) {
    await apiCall({
      method: 'DELETE',
      path: `/favorites/${state.aliceProduct2Id}`,
      token: state.bob.token,
      step: `DELETE /favorites/${state.aliceProduct2Id}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'DELETE /favorites/:productId',
    });
  }

  await flushSection('09-buyer-chat-rest.json');
}

async function flow10_websocket(state: SimState): Promise<void> {
  printSection('10 — WebSocket Chat');
  const flow = '10-websocket';

  if (!state.conversationId || !state.alice.token || !state.bob.token) {
    warn('Missing conversation/tokens; skipping WebSocket coverage.');
    await flushSection('10-websocket.json');
    return;
  }

  let bobSocket: Socket | null = null;
  let aliceSocket: Socket | null = null;

  try {
    bobSocket = await connectWs(state.bob.token);
    aliceSocket = await connectWs(state.alice.token);

    const bobJoin = await bobSocket.emitWithAck('conversation.join', {
      conversationId: state.conversationId,
    }) as Record<string, unknown>;
    const bobJoinOk = Boolean(bobJoin.success);
    markCoverage(wsCoverage, 'conversation.join', bobJoinOk);
    state.totalCalls += 1;
    noteFlowStats(state, flow, !bobJoinOk);
    if (bobJoinOk) state.successes += 1;
    else state.failures += 1;

    const aliceJoin = await aliceSocket.emitWithAck('conversation.join', {
      conversationId: state.conversationId,
    }) as Record<string, unknown>;
    const aliceJoinOk = Boolean(aliceJoin.success);
    markCoverage(wsCoverage, 'conversation.join', aliceJoinOk);
    state.totalCalls += 1;
    noteFlowStats(state, flow, !aliceJoinOk);
    if (aliceJoinOk) state.successes += 1;
    else state.failures += 1;

    const sendAck = await bobSocket.emitWithAck('message.send', {
      conversationId: state.conversationId,
      text: `Hello from simulation ${RUN_ID}`,
    }) as Record<string, unknown>;

    const sentMessageId = toId((sendAck as { message?: { id?: unknown } }).message?.id);
    const sendOk = sentMessageId !== null;
    markCoverage(wsCoverage, 'message.send', sendOk);
    state.totalCalls += 1;
    noteFlowStats(state, flow, !sendOk);
    if (sendOk) {
      state.successes += 1;
      state.lastMessageId = sentMessageId;
    } else {
      state.failures += 1;
    }

    if (state.lastMessageId) {
      const readAck = await aliceSocket.emitWithAck('message.read', {
        messageId: state.lastMessageId,
      }) as Record<string, unknown>;

      const readOk = Boolean(readAck.message);
      markCoverage(wsCoverage, 'message.read', readOk);
      state.totalCalls += 1;
      noteFlowStats(state, flow, !readOk);
      if (readOk) state.successes += 1;
      else state.failures += 1;
    }

    currentSectionEntries.push({
      flow,
      step: 'WebSocket /chat session',
      method: 'WS',
      url: `${CONFIG.baseUrl}/chat`,
      requestHeaders: { auth: 'Bearer [REDACTED]' },
      requestBody: { conversationId: state.conversationId },
      expectedStatus: [200],
      statusCode: 200,
      matchedExpected: true,
      responseBody: {
        conversationJoin: wsCoverage['conversation.join'],
        messageSend: wsCoverage['message.send'],
        messageRead: wsCoverage['message.read'],
      },
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`WebSocket flow failed: ${msg}`);
    state.totalCalls += 1;
    state.failures += 1;
    noteFlowStats(state, flow, true);
    state.assertionFailures.push({
      flow,
      step: 'WebSocket /chat session',
      expected: [200],
      actual: 0,
      responseSnippet: msg,
    });
  } finally {
    bobSocket?.disconnect();
    aliceSocket?.disconnect();
  }

  await flushSection('10-websocket.json');
}

async function flow11_ratings(state: SimState): Promise<void> {
  printSection('11 — Ratings');
  const flow = '11-ratings';

  if (state.alice.userId) {
    await apiCall({
      method: 'POST',
      path: '/ratings',
      body: { ratedUserId: state.alice.userId, ratingValue: 4, comment: 'Good seller.' },
      token: state.bob.token,
      step: 'POST /ratings (bob rates alice)',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /ratings',
    });

    await apiCall({
      method: 'GET',
      path: `/ratings/${state.alice.userId}`,
      step: `GET /ratings/${state.alice.userId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /ratings/:userId',
    });
  }

  if (state.bob.userId) {
    await apiCall({
      method: 'POST',
      path: '/ratings',
      body: { ratedUserId: state.bob.userId, ratingValue: 5, comment: 'Great buyer.' },
      token: state.alice.token,
      step: 'POST /ratings (alice rates bob)',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /ratings',
    });
  }

  await flushSection('11-ratings.json');
}

async function flow11_blocksAndSafety(state: SimState): Promise<void> {
  printSection('11 — Blocks + Enforcement');
  const flow = '11-blocks-safety';

  if (!state.alice.userId || !state.bob.userId) {
    warn('Missing user IDs; skipping block flow.');
    await flushSection('11-blocks-safety.json');
    return;
  }

  await apiCall({
    method: 'POST',
    path: `/blocks/${state.alice.userId}`,
    token: state.bob.token,
    step: `POST /blocks/${state.alice.userId} (bob blocks alice)`,
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /blocks/:userId',
  });

  await apiCall({
    method: 'GET',
    path: '/blocks',
    token: state.bob.token,
    step: 'GET /blocks (bob)',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /blocks',
  });

  await apiCall({
    method: 'POST',
    path: '/chat/conversations',
    body: { participantId: state.bob.userId, productId: state.aliceProduct2Id ?? undefined },
    token: state.alice.token,
    step: 'POST /chat/conversations while blocked (forbidden expected)',
    flow,
    state,
    expectedStatus: 403,
    coverageKey: 'POST /chat/conversations',
  });

  await apiCall({
    method: 'GET',
    path: `/users/${state.alice.userId}`,
    token: state.bob.token,
    step: `GET /users/${state.alice.userId} while blocked (not found expected)`,
    flow,
    state,
    expectedStatus: 404,
    coverageKey: 'GET /users/:id',
  });

  await apiCall({
    method: 'DELETE',
    path: `/blocks/${state.alice.userId}`,
    token: state.bob.token,
    step: `DELETE /blocks/${state.alice.userId} (bob unblocks alice)`,
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'DELETE /blocks/:userId',
  });

  await flushSection('11-blocks-safety.json');
}

async function flow12_reportsAndAdmin(state: SimState): Promise<void> {
  printSection('12 — Reports + Admin');
  const flow = '12-reports-admin';

  if (state.alice.userId) {
    const reportRes = await apiCall({
      method: 'POST',
      path: '/reports',
      body: {
        reportedUserId: state.alice.userId,
        reason: `Simulated report ${RUN_ID}`,
      },
      token: state.bob.token,
      step: 'POST /reports (bob reports alice)',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /reports',
    });
    state.reportId = toId((reportRes.body as { report?: { id?: unknown } }).report?.id);
  }

  await apiCall({
    method: 'GET',
    path: '/reports/me',
    token: state.bob.token,
    step: 'GET /reports/me',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /reports/me',
  });

  await apiCall({
    method: 'GET',
    path: '/admin/users',
    token: state.adminToken,
    step: 'GET /admin/users',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /admin/users',
  });

  await apiCall({
    method: 'GET',
    path: '/admin/admins',
    token: state.adminToken,
    step: 'GET /admin/admins',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /admin/admins',
  });

  if (state.alice.userId) {
    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${state.alice.userId}/status`,
      body: { status: 'paused' },
      token: state.adminToken,
      step: `PATCH /admin/users/${state.alice.userId}/status → paused`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /admin/users/:id/status',
    });

    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${state.alice.userId}/status`,
      body: { status: 'active' },
      token: state.adminToken,
      step: `PATCH /admin/users/${state.alice.userId}/status → active`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /admin/users/:id/status',
    });

    await apiCall({
      method: 'POST',
      path: '/admin/warnings',
      body: { targetUserId: state.alice.userId, message: `Simulation warning ${RUN_ID}` },
      token: state.adminToken,
      step: `POST /admin/warnings (alice)`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /admin/warnings',
    });

    await apiCall({
      method: 'POST',
      path: `/admin/admins/${state.alice.userId}`,
      token: state.adminToken,
      step: `POST /admin/admins/${state.alice.userId}`,
      flow,
      state,
      expectedStatus: [200, 201],
      coverageKey: 'POST /admin/admins/:id',
    });

    await apiCall({
      method: 'DELETE',
      path: `/admin/admins/${state.alice.userId}`,
      token: state.adminToken,
      step: `DELETE /admin/admins/${state.alice.userId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'DELETE /admin/admins/:id',
    });

    // Promote/demote bumps token_version; re-login alice for subsequent flows.
    const reloginAlice = await apiCall({
      method: 'POST',
      path: '/auth/login',
      body: { phone: state.alice.phone, password: state.alice.password },
      step: 'POST /auth/login (alice after admin role toggle)',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /auth/login',
    });
    if (reloginAlice.matchedExpected) {
      const b = reloginAlice.body as { accessToken?: string; refreshToken?: string };
      state.alice.token = b.accessToken ?? state.alice.token;
      state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
    }
  }

  await apiCall({
    method: 'GET',
    path: '/admin/reports',
    token: state.adminToken,
    step: 'GET /admin/reports',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /admin/reports',
  });

  if (state.reportId) {
    await apiCall({
      method: 'PATCH',
      path: `/admin/reports/${state.reportId}`,
      body: { status: 'reviewing' },
      token: state.adminToken,
      step: `PATCH /admin/reports/${state.reportId} → reviewing`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /admin/reports/:id',
    });

    await apiCall({
      method: 'PATCH',
      path: `/admin/reports/${state.reportId}`,
      body: { status: 'resolved' },
      token: state.adminToken,
      step: `PATCH /admin/reports/${state.reportId} → resolved`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /admin/reports/:id',
    });
  }

  await flushSection('12-reports-admin.json');
}

async function flow13_negativeChecks(state: SimState): Promise<void> {
  printSection('13 — Negative Checks');
  const flow = '13-negative-checks';

  if (!CONFIG.negativeTests) {
    warn('Negative tests disabled by SIM_NEGATIVE_TESTS=false');
    await flushSection('13-negative-checks.json');
    return;
  }

  // 1) Invalid login
  await apiCall({
    method: 'POST',
    path: '/auth/login',
    body: { phone: state.alice.phone, password: 'WrongPassword999' },
    step: 'POST /auth/login (invalid credentials)',
    flow,
    state,
    expectedStatus: 401,
    coverageKey: 'POST /auth/login',
  });

  // 2) Invalid OTP verify
  await apiCall({
    method: 'POST',
    path: '/auth/register',
    body: { name: `Negative ${RUN_ID}`, phone: NEG_PHONE, ssn: NEG_SSN, password: 'NegPass123' },
    step: 'POST /auth/register (negative user)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /auth/register',
  });

  await apiCall({
    method: 'POST',
    path: '/auth/register/verify',
    body: { phone: NEG_PHONE, otp: '111111' },
    step: 'POST /auth/register/verify (wrong otp)',
    flow,
    state,
    expectedStatus: 400,
    coverageKey: 'POST /auth/register/verify',
  });

  // 3) Duplicate register for existing phone
  await apiCall({
    method: 'POST',
    path: '/auth/register',
    body: { name: `Alice Duplicate ${RUN_ID}`, phone: state.alice.phone, ssn: ALICE_SSN, password: state.alice.password },
    step: 'POST /auth/register (duplicate)',
    flow,
    state,
    expectedStatus: 409,
    coverageKey: 'POST /auth/register',
  });

  // 4) File ownership check (bob reads alice file)
  if (state.avatarFileId) {
    await apiCall({
      method: 'GET',
      path: `/files/${state.avatarFileId}`,
      token: state.bob.token,
      step: `GET /files/${state.avatarFileId} as bob (forbidden expected)`,
      flow,
      state,
      expectedStatus: 403,
      coverageKey: 'GET /files/:id',
    });
  }

  // 5) Product ownership check
  if (state.aliceProduct2Id) {
    await apiCall({
      method: 'PATCH',
      path: `/products/${state.aliceProduct2Id}`,
      body: { name: 'Bob unauthorized edit' },
      token: state.bob.token,
      step: `PATCH /products/${state.aliceProduct2Id} as bob (forbidden expected)`,
      flow,
      state,
      expectedStatus: 403,
      coverageKey: 'PATCH /products/:id',
    });

    await apiCall({
      method: 'DELETE',
      path: `/products/${state.aliceProduct2Id}`,
      token: state.bob.token,
      step: `DELETE /products/${state.aliceProduct2Id} as bob (forbidden expected)`,
      flow,
      state,
      expectedStatus: 403,
      coverageKey: 'DELETE /products/:id',
    });
  }

  // 6) Non-admin call to admin API
  await apiCall({
    method: 'GET',
    path: '/admin/users',
    token: state.alice.token,
    step: 'GET /admin/users as alice (forbidden expected)',
    flow,
    state,
    expectedStatus: [401, 403],
    coverageKey: 'GET /admin/users',
  });

  // 7) Duplicate report conflict
  if (state.alice.userId) {
    await apiCall({
      method: 'POST',
      path: '/reports',
      body: { reportedUserId: state.alice.userId, reason: `Duplicate report check ${RUN_ID}` },
      token: state.bob.token,
      step: 'POST /reports duplicate (conflict expected)',
      flow,
      state,
      expectedStatus: [201, 409],
      coverageKey: 'POST /reports',
    });
  }

  await flushSection('13-negative-checks.json');
}

async function flow14_cleanup(state: SimState): Promise<void> {
  printSection('14 — Cleanup');
  const flow = '14-cleanup';

  if (state.aliceProduct2Id) {
    await apiCall({
      method: 'DELETE',
      path: `/products/${state.aliceProduct2Id}`,
      token: state.alice.token,
      step: `DELETE /products/${state.aliceProduct2Id} (cleanup)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'DELETE /products/:id',
    });
  }

  // Category delete requires leaf first, then parent.
  if (state.categoryLeafId) {
    await apiCall({
      method: 'DELETE',
      path: `/admin/categories/${state.categoryLeafId}`,
      token: state.adminToken,
      step: `DELETE /admin/categories/${state.categoryLeafId} (leaf cleanup)`,
      flow,
      state,
      expectedStatus: [200, 409],
      coverageKey: 'DELETE /admin/categories/:id',
    });
  }

  if (state.categoryParentId) {
    await apiCall({
      method: 'DELETE',
      path: `/admin/categories/${state.categoryParentId}`,
      token: state.adminToken,
      step: `DELETE /admin/categories/${state.categoryParentId} (parent cleanup)`,
      flow,
      state,
      expectedStatus: [200, 409],
      coverageKey: 'DELETE /admin/categories/:id',
    });
  }

  await flushSection('14-cleanup.json');
}

function noteWsOutcome(
  state: SimState,
  flow: string,
  step: string,
  ok: boolean,
  response: unknown,
): void {
  state.totalCalls += 1;
  noteFlowStats(state, flow, !ok);
  if (ok) {
    state.successes += 1;
    return;
  }
  state.failures += 1;
  state.assertionFailures.push({
    flow,
    step,
    expected: [200],
    actual: 0,
    responseSnippet: textSnippet(response),
  });
}

function buildConcurrentUsers(): VirtualUserState[] {
  const users: VirtualUserState[] = [];
  for (let i = 1; i <= CONFIG.concurrentUsers; i += 1) {
    users.push({
      key: `vu-${String(i).padStart(2, '0')}`,
      index: i,
      phone: phoneFromSeed(seed + 50_000 + i * 37, String((i + 3) % 10)),
      ssn: ssnFromSeed(seed + 70_000 + i * 53),
      password: `VuPass${String(i).padStart(2, '0')}A!`,
      token: null,
      refreshToken: null,
      userId: null,
    });
  }
  return users;
}

async function runConcurrentUserBaseline(
  state: SimState,
  flow: string,
  vu: VirtualUserState,
): Promise<void> {
  const label = vu.key;

  try {
    const regRes = await apiCall({
      method: 'POST',
      path: '/auth/register',
      body: { name: `${label} ${RUN_ID}`, phone: vu.phone, ssn: vu.ssn, password: vu.password },
      step: `POST /auth/register (${label})`,
      flow,
      state,
      expectedStatus: [201, 429],
      coverageKey: 'POST /auth/register',
    });

    if (regRes.statusCode === 429) {
      state.concurrentMetrics.throttled += 1;
      state.concurrentMetrics.skipped += 1;
      warn(`Concurrent user ${label} throttled on register; skipping remaining baseline steps`);
      return;
    }

    const otp = (regRes.body as { otp?: string }).otp;
    if (!otp) throw new Error(`Missing OTP for ${label}. Ensure OTP_DEV_MODE=true.`);

    const verifyRes = await apiCall({
      method: 'POST',
      path: '/auth/register/verify',
      body: { phone: vu.phone, otp },
      step: `POST /auth/register/verify (${label})`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /auth/register/verify',
    });
    if (verifyRes.matchedExpected) {
      const vb = verifyRes.body as { accessToken?: string; refreshToken?: string; user?: { id?: unknown } };
      vu.token = vb.accessToken ?? null;
      vu.refreshToken = vb.refreshToken ?? null;
      vu.userId = toId(vb.user?.id);
      state.concurrentMetrics.registered += 1;
    }

    const loginRes = await apiCall({
      method: 'POST',
      path: '/auth/login',
      body: { phone: vu.phone, password: vu.password },
      step: `POST /auth/login (${label})`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /auth/login',
    });
    if (loginRes.matchedExpected) {
      const lb = loginRes.body as { accessToken?: string; refreshToken?: string; user?: { id?: unknown } };
      vu.token = lb.accessToken ?? vu.token;
      vu.refreshToken = lb.refreshToken ?? vu.refreshToken;
      vu.userId = toId(lb.user?.id) ?? vu.userId;
      state.concurrentMetrics.loggedIn += 1;
    }

    if (!vu.token) return;

    await apiCall({
      method: 'GET',
      path: '/me',
      token: vu.token,
      step: `GET /me (${label})`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /me',
    });

    const intentRes = await apiCall({
      method: 'POST',
      path: '/files/upload-intent',
      body: {
        ownerType: 'user',
        purpose: 'avatar',
        filename: `${label}-${RUN_ID}.png`,
        mimeType: 'image/png',
        fileSizeBytes: fakePngBuffer().byteLength,
      },
      token: vu.token,
      step: `POST /files/upload-intent (${label})`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /files/upload-intent',
    });

    const fileId = toId((intentRes.body as { file?: { id?: unknown } }).file?.id);

    if (CONFIG.realUpload && intentRes.matchedExpected) {
      const uploadRes = await uploadToCloudinary(intentRes.body);
      const ok = uploadRes.ok;
      const status = uploadRes.statusCode;
      printStep(ok, `Cloudinary direct upload (${label})`, status, 0);
      noteFlowStats(state, flow, !ok);
      state.totalCalls += 1;
      if (ok) state.successes += 1;
      else {
        state.failures += 1;
        const err = `Cloudinary upload failed for ${label}: ${textSnippet(uploadRes.response)}`;
        state.concurrentMetrics.errors.push(err);
        state.assertionFailures.push({
          flow,
          step: `Cloudinary direct upload (${label})`,
          expected: [200, 201],
          actual: status,
          responseSnippet: textSnippet(uploadRes.response),
        });
        if (!CONFIG.continueOnFail) throw new Error(err);
      }

      currentSectionEntries.push({
        flow,
        step: `Cloudinary direct upload (${label})`,
        method: 'POST',
        url: 'cloudinary-direct-upload',
        requestHeaders: {},
        requestBody: { runId: RUN_ID },
        expectedStatus: [200, 201],
        statusCode: status,
        matchedExpected: ok,
        responseBody: uploadRes.response,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });
    }

    if (fileId) {
      await apiCall({
        method: 'PATCH',
        path: `/files/${fileId}/mark-uploaded`,
        body: {},
        token: vu.token,
        step: `PATCH /files/${fileId}/mark-uploaded (${label})`,
        flow,
        state,
        expectedStatus: 200,
        coverageKey: 'PATCH /files/:id/mark-uploaded',
      });

      await apiCall({
        method: 'GET',
        path: `/files/${fileId}`,
        token: vu.token,
        step: `GET /files/${fileId} (${label})`,
        flow,
        state,
        expectedStatus: 200,
        coverageKey: 'GET /files/:id',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.concurrentMetrics.errors.push(`${label}: ${msg}`);
    warn(`Concurrent user ${label} failed: ${msg}`);
    if (!CONFIG.continueOnFail) throw err;
  }
}

async function runConcurrentChatPair(
  state: SimState,
  flow: string,
  pairIndex: number,
  userA: VirtualUserState,
  userB: VirtualUserState,
): Promise<void> {
  let socketA: Socket | null = null;
  let socketB: Socket | null = null;
  const pairLabel = `pair-${pairIndex}-${userA.key}<->${userB.key}`;

  try {
    if (!userA.token || !userB.token || !userA.userId || !userB.userId) {
      throw new Error(`Missing token/user IDs for ${pairLabel}`);
    }

    const convRes = await apiCall({
      method: 'POST',
      path: '/chat/conversations',
      body: { participantId: userB.userId },
      token: userA.token,
      step: `POST /chat/conversations (${pairLabel})`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /chat/conversations',
    });

    const conversationId = toId((convRes.body as { conversation?: { id?: unknown } }).conversation?.id);
    if (!conversationId) throw new Error(`Conversation creation did not return id for ${pairLabel}`);

    await apiCall({
      method: 'GET',
      path: '/chat/conversations',
      token: userA.token,
      step: `GET /chat/conversations (${pairLabel})`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations',
    });

    await apiCall({
      method: 'GET',
      path: `/chat/conversations/${conversationId}/messages`,
      token: userA.token,
      step: `GET /chat/conversations/${conversationId}/messages (${pairLabel})`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations/:id/messages',
    });

    socketA = await connectWs(userA.token);
    socketB = await connectWs(userB.token);

    const joinA = await socketA.emitWithAck('conversation.join', {
      conversationId,
    }) as Record<string, unknown>;
    const joinAOk = Boolean(joinA.success);
    markCoverage(wsCoverage, 'conversation.join', joinAOk);
    noteWsOutcome(state, flow, `conversation.join (${pairLabel} userA)`, joinAOk, joinA);

    const joinB = await socketB.emitWithAck('conversation.join', {
      conversationId,
    }) as Record<string, unknown>;
    const joinBOk = Boolean(joinB.success);
    markCoverage(wsCoverage, 'conversation.join', joinBOk);
    noteWsOutcome(state, flow, `conversation.join (${pairLabel} userB)`, joinBOk, joinB);

    let pairOk = joinAOk && joinBOk;

    for (let i = 0; i < CONFIG.concurrentMessagesPerPair; i += 1) {
      const senderSocket = i % 2 === 0 ? socketA : socketB;
      const readerSocket = i % 2 === 0 ? socketB : socketA;
      const sender = i % 2 === 0 ? userA : userB;
      const sendAck = await senderSocket.emitWithAck('message.send', {
        conversationId,
        text: `[${pairLabel}] msg-${i + 1} from ${sender.key} ${RUN_ID}`,
      }) as Record<string, unknown>;

      const messageId = toId((sendAck as { message?: { id?: unknown } }).message?.id);
      const sendOk = messageId !== null;
      markCoverage(wsCoverage, 'message.send', sendOk);
      noteWsOutcome(state, flow, `message.send (${pairLabel} #${i + 1})`, sendOk, sendAck);
      if (sendOk) state.concurrentMetrics.messagesSent += 1;
      pairOk = pairOk && sendOk;

      if (!messageId) continue;

      const readAck = await readerSocket.emitWithAck('message.read', {
        messageId,
      }) as Record<string, unknown>;
      const readOk = Boolean(readAck.message);
      markCoverage(wsCoverage, 'message.read', readOk);
      noteWsOutcome(state, flow, `message.read (${pairLabel} #${i + 1})`, readOk, readAck);
      if (readOk) state.concurrentMetrics.messagesRead += 1;
      pairOk = pairOk && readOk;
    }

    if (pairOk) state.concurrentMetrics.chatPairsOk += 1;

    currentSectionEntries.push({
      flow,
      step: `WebSocket /chat session (${pairLabel})`,
      method: 'WS',
      url: `${CONFIG.baseUrl}/chat`,
      requestHeaders: { auth: 'Bearer [REDACTED]' },
      requestBody: { pair: pairLabel, conversationId },
      expectedStatus: [200],
      statusCode: pairOk ? 200 : 0,
      matchedExpected: pairOk,
      responseBody: {
        messagesPerPair: CONFIG.concurrentMessagesPerPair,
        pairOk,
      },
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.concurrentMetrics.errors.push(`${pairLabel}: ${msg}`);
    warn(`Concurrent chat ${pairLabel} failed: ${msg}`);
    state.totalCalls += 1;
    state.failures += 1;
    noteFlowStats(state, flow, true);
    state.assertionFailures.push({
      flow,
      step: `WebSocket /chat session (${pairLabel})`,
      expected: [200],
      actual: 0,
      responseSnippet: msg,
    });
    if (!CONFIG.continueOnFail) throw err;
  } finally {
    socketA?.disconnect();
    socketB?.disconnect();
  }
}

async function flow15_concurrentUsersAndChat(state: SimState): Promise<void> {
  printSection('15 — Concurrent Users + Chat');
  const flow = '15-concurrent-users-chat';

  if (!CONFIG.enableConcurrentFlow) {
    warn('Concurrent flow disabled by SIM_ENABLE_CONCURRENT_FLOW=false');
    await flushSection('15-concurrent-users-chat.json');
    return;
  }

  const virtualUsers = buildConcurrentUsers();
  state.concurrentUsers = virtualUsers.length;
  state.chatPairs = CONFIG.chatPairs;

  await Promise.all(
    virtualUsers.map(async (vu, idx) => {
      await sleep(idx * CONFIG.concurrentStaggerMs);
      await runConcurrentUserBaseline(state, flow, vu);
    }),
  );

  const eligible = virtualUsers.filter((vu) => vu.token && vu.userId);
  const neededUsers = CONFIG.chatPairs * 2;
  if (eligible.length < neededUsers) {
    const msg = `Insufficient eligible users for requested chat pairs: need ${neededUsers}, got ${eligible.length}`;
    warn(msg);
    state.concurrentMetrics.errors.push(msg);
  }

  const usersForChat = eligible.slice(0, Math.min(neededUsers, eligible.length));
  const pairTasks: Array<Promise<void>> = [];
  for (let i = 0; i + 1 < usersForChat.length; i += 2) {
    const pairIndex = i / 2 + 1;
    pairTasks.push(runConcurrentChatPair(state, flow, pairIndex, usersForChat[i], usersForChat[i + 1]));
  }
  await Promise.all(pairTasks);

  await flushSection('15-concurrent-users-chat.json');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

const state: SimState = {
  totalCalls: 0,
  successes: 0,
  failures: 0,
  flowTotals: {},
  assertionFailures: [],
  adminToken: null,
  adminRefreshToken: null,
  alice: {
    phone: ALICE_PHONE,
    password: ALICE_PASSWORD,
    ssn: ALICE_SSN,
    token: null,
    refreshToken: null,
    userId: null,
  },
  bob: {
    phone: BOB_PHONE,
    password: BOB_PASSWORD,
    ssn: BOB_SSN,
    token: null,
    refreshToken: null,
    userId: null,
  },
  productCategoryId: null,
  categoryParentId: null,
  categoryLeafId: null,
  aliceProductId: null,
  aliceProduct2Id: null,
  conversationId: null,
  lastMessageId: null,
  reportId: null,
  aliceContactId: null,
  avatarFileId: null,
  productImageFileId: null,
  concurrentUsers: 0,
  chatPairs: 0,
  concurrentMetrics: {
    registered: 0,
    loggedIn: 0,
    throttled: 0,
    skipped: 0,
    chatPairsOk: 0,
    messagesSent: 0,
    messagesRead: 0,
    errors: [],
  },
};

async function main(): Promise<void> {
  ensurePreflight();
  await waitForServerReadiness();

  const bar = '═'.repeat(72);
  console.log(`\n${bar}`);
  console.log('  Market Place — Full Flow Simulation (Dev Mode)');
  console.log(`  Run ID : ${RUN_ID}`);
  console.log(`  Target : ${CONFIG.baseUrl}`);
  console.log(`  Logs   : ${LOG_DIR}`);
  console.log(
    '  Flags  : ' +
    `negative=${CONFIG.negativeTests} ` +
    `realUpload=${CONFIG.realUpload} ` +
    `continueOnFail=${CONFIG.continueOnFail} ` +
    `concurrentFlow=${CONFIG.enableConcurrentFlow} ` +
    `concurrentUsers=${CONFIG.concurrentUsers} ` +
    `chatPairs=${CONFIG.chatPairs} ` +
    `messagesPerPair=${CONFIG.concurrentMessagesPerPair} ` +
    `staggerMs=${CONFIG.concurrentStaggerMs}`,
  );
  console.log(`${bar}`);

  await fs.mkdir(LOG_DIR, { recursive: true });

  await flow01_anonymous(state);
  await flow02_registerUsers(state);
  await flow03_adminBootstrap(state);
  await flow04_tokenLifecycle(state);
  await flow05_passwordReset(state);
  await flow06_uploadsAndProfile(state);
  await flow07_contacts(state);
  await flow08_seller(state);
  await flow09_buyerAndChat(state);
  await flow10_websocket(state);
  await flow11_blocksAndSafety(state);
  await flow11_ratings(state);
  await flow12_reportsAndAdmin(state);
  await flow13_negativeChecks(state);
  await flow14_cleanup(state);
  await flow15_concurrentUsersAndChat(state);

  await summarize(state);

  if (state.failures > 0) {
    process.exitCode = 1;
  }
}

void main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${RED}[FATAL]${RESET} ${msg}`);
  await summarize(state).catch(() => {});
  process.exit(1);
});
