/**
 * scripts/simulate-flows.ts
 *
 * Simulates every user flow documented in docs/user-flows.md and saves
 * structured JSON logs (request + response) for each API call.
 *
 * PRE-CONDITIONS (must all be true before running):
 *   1. Server is running (npm run start:dev  OR  docker-compose up)
 *   2. Database schema applied: npm run db:schema
 *   3. Admin seeded: npm run seed:admin
 *   4. OTP_DEV_MODE=true set on BOTH the server AND this shell
 *   5. Fresh database — Alice/Bob phone numbers must not already exist.
 *      If re-running, reset the database or use different ALICE_PHONE / BOB_PHONE.
 *
 * USAGE:
 *   OTP_DEV_MODE=true npm run simulate
 *
 * ENV VARS (all optional — sensible defaults provided):
 *   BASE_URL        API base URL              (default: http://localhost:3000)
 *   ADMIN_PHONE     Admin phone from seed     (default: +201000000000)
 *   ADMIN_PASSWORD  Admin password from seed  (default: ChangeMe123)
 *   ALICE_PHONE     Simulated user 1 phone    (default: +201111111111)
 *   BOB_PHONE       Simulated user 2 phone    (default: +202222222222)
 *
 * OUTPUT:
 *   logs/simulation-<timestamp>/
 *     01-anonymous.json … 14-reports-and-admin.json
 *     summary.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { io, Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost';
const ADMIN_PHONE = '+201000000000';
const ADMIN_PASSWORD = 'ChangeMe123';
const ALICE_PHONE = '+201111111111';
const ALICE_PASSWORD = 'SimPass123';  // letters + digits → passes /^(?=.*[A-Za-z])(?=.*\d).+$/
const ALICE_SSN = '12345678';         // 8 chars — satisfies Length(8, 32)
const BOB_PHONE = '+202222222222';
const BOB_PASSWORD = 'SimPass456';
const BOB_SSN = '98765432';

// Guard: OTP_DEV_MODE must be 'true' so OTP appears in API responses.
if (process.env.OTP_DEV_MODE !== 'true') {
  console.error('\n[ERROR] OTP_DEV_MODE must be set to "true" to run this script.');
  console.error('        Set it on BOTH the server and this shell:\n');
  console.error('        OTP_DEV_MODE=true npm run start:dev   # server terminal');
  console.error('        OTP_DEV_MODE=true npm run simulate    # this terminal\n');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface LogEntry {
  flow: string;
  step: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  statusCode: number;
  responseBody: unknown;
  durationMs: number;
  timestamp: string;
}

interface UserState {
  phone: string;
  password: string;
  ssn: string;
  token: string | null;
  refreshToken: string | null;
  userId: number | null;
}

interface SimState {
  totalCalls: number;
  successes: number;
  failures: number;
  adminToken: string | null;
  adminRefreshToken: string | null;
  alice: UserState;
  bob: UserState;
  categoryId: number | null;
  aliceProductId: number | null;
  aliceProduct2Id: number | null;
  conversationId: number | null;
  lastMessageId: number | null;
  reportId: number | null;
  aliceContactId: number | null;
  fileIntentId: number | null;
}

interface ApiCallOpts {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  token?: string | null;
  step: string;
  flow: string;
  state: SimState;
  criticalOnFailure?: boolean;
}

interface ApiCallResult {
  statusCode: number;
  body: unknown;
  ok: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG INFRASTRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

const RUN_TS = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
const LOG_DIR = path.join(process.cwd(), 'logs', `simulation-${RUN_TS}`);

let currentSectionEntries: LogEntry[] = [];

// ANSI colours
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

async function flushSection(fileName: string): Promise<void> {
  const filePath = path.join(LOG_DIR, fileName);
  await fs.writeFile(filePath, JSON.stringify(currentSectionEntries, null, 2));
}

async function summarize(state: SimState): Promise<void> {
  const rate = state.totalCalls > 0
    ? `${Math.round((state.successes / state.totalCalls) * 100)}%`
    : 'N/A';

  const summary = {
    runAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    totalCalls: state.totalCalls,
    successes: state.successes,
    failures: state.failures,
    successRate: rate,
  };

  await fs.writeFile(
    path.join(LOG_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );

  const bar = '═'.repeat(52);
  console.log(`\n${bar}`);
  const colour = state.failures === 0 ? GREEN : state.successes > state.failures ? YELLOW : RED;
  console.log(`  Results: ${colour}${state.successes}/${state.totalCalls} passed${RESET} (${rate})`);
  console.log(`  Logs: ${LOG_DIR}`);
  console.log(`${bar}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

async function apiCall(opts: ApiCallOpts): Promise<ApiCallResult> {
  const { method, path: urlPath, body, token, step, flow, state, criticalOnFailure } = opts;
  const url = BASE_URL + urlPath;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const t0 = Date.now();
  let statusCode = 0;
  let responseBody: unknown = null;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
  }

  const durationMs = Date.now() - t0;
  const ok = statusCode >= 200 && statusCode < 300;

  // Redact the Bearer value from logs
  const logHeaders: Record<string, string> = { ...headers };
  if (logHeaders['Authorization']) logHeaders['Authorization'] = 'Bearer [REDACTED]';

  currentSectionEntries.push({
    flow,
    step,
    method,
    url,
    requestHeaders: logHeaders,
    requestBody: body ?? null,
    statusCode,
    responseBody,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  state.totalCalls++;
  if (ok) state.successes++;
  else state.failures++;

  printStep(ok, step, statusCode, durationMs);

  if (!ok && criticalOnFailure) {
    throw new Error(
      `Critical step failed [${statusCode}] ${step}\n` +
      `Response: ${JSON.stringify(responseBody, null, 2)}`,
    );
  }

  return { statusCode, body: responseBody, ok };
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET HELPER
// ─────────────────────────────────────────────────────────────────────────────

function connectWs(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${BASE_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('WebSocket connection timeout (5 s)'));
    }, 5000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(socket); });
    socket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 01 — ANONYMOUS VISITOR
// ─────────────────────────────────────────────────────────────────────────────

async function flow01_anonymous(state: SimState): Promise<void> {
  printSection('01 — Anonymous Visitor');
  const flow = '01-anonymous';

  await apiCall({ method: 'GET', path: '/health/live',  step: 'GET /health/live',  flow, state });
  await apiCall({ method: 'GET', path: '/health/ready', step: 'GET /health/ready', flow, state });

  // Categories — extract a leaf categoryId for use in the seller journey
  const catRes = await apiCall({ method: 'GET', path: '/categories', step: 'GET /categories', flow, state });
  if (catRes.ok) {
    const cats = (catRes.body as { categories?: Array<{ id: number; parent_id: number | null }> }).categories ?? [];
    const parentIds = new Set(cats.map((c) => c.parent_id).filter(Boolean));
    const leaf = cats.find((c) => !parentIds.has(c.id)) ?? cats[cats.length - 1];
    if (leaf) {
      state.categoryId = leaf.id;
      console.log(`  → categoryId=${state.categoryId}`);
    } else {
      warn('No categories found — seller journey will use categoryId=1 as fallback');
      state.categoryId = 1;
    }
  }

  // Public product search (empty result is fine at this stage)
  await apiCall({ method: 'GET', path: '/search/products', step: 'GET /search/products (public)', flow, state });

  await flushSection('01-anonymous.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 02 — AUTH: ALICE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

async function flow02_authAlice(state: SimState): Promise<void> {
  printSection('02 — Auth: Alice Registration');
  const flow = '02-auth-alice';

  // Request registration OTP
  const regRes = await apiCall({
    method: 'POST',
    path: '/auth/register',
    body: { name: 'Alice Sim', ssn: ALICE_SSN, phone: ALICE_PHONE, password: ALICE_PASSWORD },
    step: 'POST /auth/register (alice)',
    flow,
    state,
    criticalOnFailure: true,
  });

  let otp = (regRes.body as { otp?: string }).otp;
  if (!otp) {
    throw new Error(
      'OTP field missing from /auth/register response.\n' +
      'Ensure OTP_DEV_MODE=true is set on the SERVER as well as this shell.',
    );
  }
  console.log(`  → OTP: ${otp}`);

  // Resend OTP (demonstrates the endpoint; use its OTP if returned)
  const resendRes = await apiCall({
    method: 'POST',
    path: '/auth/register/resend-otp',
    body: { phone: ALICE_PHONE },
    step: 'POST /auth/register/resend-otp (alice)',
    flow,
    state,
  });
  if (resendRes.ok) {
    const resendOtp = (resendRes.body as { otp?: string }).otp;
    if (resendOtp) {
      otp = resendOtp;
      console.log(`  → Resent OTP: ${otp}`);
    }
  }

  // Verify OTP — use the most recent OTP
  const verifyRes = await apiCall({
    method: 'POST',
    path: '/auth/register/verify',
    body: { phone: ALICE_PHONE, otp },
    step: 'POST /auth/register/verify (alice)',
    flow,
    state,
    criticalOnFailure: true,
  });

  const vb = verifyRes.body as { accessToken?: string; refreshToken?: string; user?: { id?: number } };
  state.alice.token = vb.accessToken ?? null;
  state.alice.refreshToken = vb.refreshToken ?? null;
  state.alice.userId = vb.user?.id ?? null;
  console.log(`  → alice.userId=${state.alice.userId}`);

  await flushSection('02-auth-alice.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 03 — AUTH: BOB REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

async function flow03_authBob(state: SimState): Promise<void> {
  printSection('03 — Auth: Bob Registration');
  const flow = '03-auth-bob';

  const regRes = await apiCall({
    method: 'POST',
    path: '/auth/register',
    body: { name: 'Bob Sim', ssn: BOB_SSN, phone: BOB_PHONE, password: BOB_PASSWORD },
    step: 'POST /auth/register (bob)',
    flow,
    state,
    criticalOnFailure: true,
  });

  const otp = (regRes.body as { otp?: string }).otp;
  if (!otp) {
    throw new Error(
      'OTP field missing from /auth/register response.\n' +
      'Ensure OTP_DEV_MODE=true is set on the SERVER as well as this shell.',
    );
  }
  console.log(`  → OTP: ${otp}`);

  const verifyRes = await apiCall({
    method: 'POST',
    path: '/auth/register/verify',
    body: { phone: BOB_PHONE, otp },
    step: 'POST /auth/register/verify (bob)',
    flow,
    state,
    criticalOnFailure: true,
  });

  const vb = verifyRes.body as { accessToken?: string; refreshToken?: string; user?: { id?: number } };
  state.bob.token = vb.accessToken ?? null;
  state.bob.refreshToken = vb.refreshToken ?? null;
  state.bob.userId = vb.user?.id ?? null;
  console.log(`  → bob.userId=${state.bob.userId}`);

  await flushSection('03-auth-bob.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 04 — AUTH: ADMIN LOGIN
// ─────────────────────────────────────────────────────────────────────────────

async function flow04_adminLogin(state: SimState): Promise<void> {
  printSection('04 — Auth: Admin Login');
  const flow = '04-admin-login';

  const res = await apiCall({
    method: 'POST',
    path: '/auth/login',
    body: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
    step: 'POST /auth/login (admin)',
    flow,
    state,
    criticalOnFailure: true,
  });

  const b = res.body as { accessToken?: string; refreshToken?: string };
  state.adminToken = b.accessToken ?? null;
  state.adminRefreshToken = b.refreshToken ?? null;
  console.log(`  → adminToken obtained`);

  // Seed categories so the seller journey has a valid leaf category to use.
  const parentRes = await apiCall({
    method: 'POST',
    path: '/admin/categories',
    body: { name: 'Electronics' },
    token: state.adminToken,
    step: 'POST /admin/categories (Electronics — parent)',
    flow,
    state,
    criticalOnFailure: true,
  });
  const parentCatId = (parentRes.body as { category?: { id?: number } }).category?.id ?? null;
  console.log(`  → parentCategoryId=${parentCatId}`);

  const leafRes = await apiCall({
    method: 'POST',
    path: '/admin/categories',
    body: { name: 'Mobile Phones', parentId: parentCatId },
    token: state.adminToken,
    step: 'POST /admin/categories (Mobile Phones — leaf)',
    flow,
    state,
    criticalOnFailure: true,
  });
  const leafCatId = (leafRes.body as { category?: { id?: number } }).category?.id ?? null;
  console.log(`  → leafCategoryId=${leafCatId}`);

  if (leafCatId) {
    state.categoryId = leafCatId;
  }

  await flushSection('04-admin-login.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 05 — AUTH: TOKEN LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

async function flow05_tokenLifecycle(state: SimState): Promise<void> {
  printSection('05 — Auth: Token Lifecycle');
  const flow = '05-token-lifecycle';

  // Refresh alice's tokens
  const refreshRes = await apiCall({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken: state.alice.refreshToken },
    step: 'POST /auth/refresh (alice)',
    flow,
    state,
  });
  if (refreshRes.ok) {
    const b = refreshRes.body as { accessToken?: string; refreshToken?: string };
    state.alice.token = b.accessToken ?? state.alice.token;
    state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
    console.log(`  → alice tokens refreshed`);
  }

  // Logout alice (revokes refresh token)
  await apiCall({
    method: 'POST',
    path: '/auth/logout',
    body: { refreshToken: state.alice.refreshToken },
    token: state.alice.token,
    step: 'POST /auth/logout (alice)',
    flow,
    state,
  });

  // Re-login to restore a valid token
  const reloginRes = await apiCall({
    method: 'POST',
    path: '/auth/login',
    body: { phone: ALICE_PHONE, password: state.alice.password },
    step: 'POST /auth/login (alice re-login after logout)',
    flow,
    state,
  });
  if (reloginRes.ok) {
    const b = reloginRes.body as { accessToken?: string; refreshToken?: string };
    state.alice.token = b.accessToken ?? state.alice.token;
    state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
    console.log(`  → alice re-logged in`);
  }

  await flushSection('05-token-lifecycle.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 06 — AUTH: PASSWORD RESET
// ─────────────────────────────────────────────────────────────────────────────

async function flow06_passwordReset(state: SimState): Promise<void> {
  printSection('06 — Auth: Password Reset');
  const flow = '06-password-reset';

  const newPassword = 'SimReset78';

  const reqRes = await apiCall({
    method: 'POST',
    path: '/auth/password/request-otp',
    body: { phone: ALICE_PHONE },
    step: 'POST /auth/password/request-otp (alice)',
    flow,
    state,
  });

  const resetOtp = (reqRes.body as { otp?: string }).otp;
  if (!resetOtp) {
    warn('No OTP in /auth/password/request-otp response — skipping reset steps.');
    await flushSection('06-password-reset.json');
    return;
  }
  console.log(`  → Reset OTP: ${resetOtp}`);

  const resetRes = await apiCall({
    method: 'POST',
    path: '/auth/password/reset',
    body: { phone: ALICE_PHONE, otp: resetOtp, newPassword, confirmPassword: newPassword },
    step: 'POST /auth/password/reset (alice)',
    flow,
    state,
  });

  if (resetRes.ok) {
    const b = resetRes.body as { accessToken?: string; refreshToken?: string };
    state.alice.token = b.accessToken ?? state.alice.token;
    state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
    state.alice.password = newPassword;
    console.log(`  → alice password reset, new tokens stored`);
  }

  await flushSection('06-password-reset.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 07 — PROFILE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function flow07_profileManagement(state: SimState): Promise<void> {
  printSection('07 — Profile Management (Alice)');
  const flow = '07-profile-management';

  await apiCall({
    method: 'GET',
    path: '/me',
    token: state.alice.token,
    step: 'GET /me (alice)',
    flow,
    state,
  });

  await apiCall({
    method: 'PATCH',
    path: '/me',
    body: { name: 'Alice Updated' },
    token: state.alice.token,
    step: 'PATCH /me (alice)',
    flow,
    state,
  });

  const newPassword = 'SimFinal99';
  const pwdRes = await apiCall({
    method: 'PATCH',
    path: '/me/password',
    body: { oldPassword: state.alice.password, newPassword },
    token: state.alice.token,
    step: 'PATCH /me/password (alice)',
    flow,
    state,
  });

  if (pwdRes.ok) {
    state.alice.password = newPassword;
    // Password change may invalidate existing tokens — re-login to be safe
    const reloginRes = await apiCall({
      method: 'POST',
      path: '/auth/login',
      body: { phone: ALICE_PHONE, password: state.alice.password },
      step: 'POST /auth/login (alice after password change)',
      flow,
      state,
    });
    if (reloginRes.ok) {
      const b = reloginRes.body as { accessToken?: string; refreshToken?: string };
      state.alice.token = b.accessToken ?? state.alice.token;
      state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
      console.log(`  → alice re-logged in after password change`);
    }
  }

  await flushSection('07-profile-management.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 08 — CONTACT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function flow08_contactManagement(state: SimState): Promise<void> {
  printSection('08 — Contact Management (Alice)');
  const flow = '08-contact-management';

  const createRes = await apiCall({
    method: 'POST',
    path: '/me/contacts',
    body: { type: 'phone', value: '+201555555555', isPrimary: true },
    token: state.alice.token,
    step: 'POST /me/contacts (alice)',
    flow,
    state,
  });
  if (createRes.ok) {
    state.aliceContactId = (createRes.body as { contact?: { id?: number } }).contact?.id ?? null;
    console.log(`  → aliceContactId=${state.aliceContactId}`);
  }

  await apiCall({
    method: 'GET',
    path: '/me/contacts',
    token: state.alice.token,
    step: 'GET /me/contacts (alice)',
    flow,
    state,
  });

  if (state.aliceContactId) {
    await apiCall({
      method: 'PATCH',
      path: `/me/contacts/${state.aliceContactId}`,
      body: { value: '+201666666666' },
      token: state.alice.token,
      step: `PATCH /me/contacts/${state.aliceContactId} (alice)`,
      flow,
      state,
    });

    await apiCall({
      method: 'DELETE',
      path: `/me/contacts/${state.aliceContactId}`,
      token: state.alice.token,
      step: `DELETE /me/contacts/${state.aliceContactId} (alice)`,
      flow,
      state,
    });
  }

  await flushSection('08-contact-management.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 09 — FILE UPLOAD INTENT
// ─────────────────────────────────────────────────────────────────────────────

async function flow09_fileUploadIntent(state: SimState): Promise<void> {
  printSection('09 — File Upload Intent (Alice)');
  const flow = '09-file-upload-intent';

  const intentRes = await apiCall({
    method: 'POST',
    path: '/files/upload-intent',
    body: {
      ownerType: 'user',
      purpose: 'avatar',
      filename: 'avatar.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 204800,
    },
    token: state.alice.token,
    step: 'POST /files/upload-intent (alice)',
    flow,
    state,
  });

  if (intentRes.ok) {
    state.fileIntentId = (intentRes.body as { file?: { id?: number } }).file?.id ?? null;
    const uploadUrl = (intentRes.body as { upload?: { url?: string } }).upload?.url;
    console.log(`  → fileIntentId=${state.fileIntentId}`);
    console.log(`  → Cloudinary upload URL: ${uploadUrl ?? 'n/a'}`);
  }

  if (state.fileIntentId) {
    // GET /files/:id — shows file in pending state
    await apiCall({
      method: 'GET',
      path: `/files/${state.fileIntentId}`,
      token: state.alice.token,
      step: `GET /files/${state.fileIntentId} (alice — status=pending)`,
      flow,
      state,
    });

    // mark-uploaded: the server does not verify actual Cloudinary presence —
    // it simply flips status to 'uploaded', so this is safe to call in simulation.
    await apiCall({
      method: 'PATCH',
      path: `/files/${state.fileIntentId}/mark-uploaded`,
      body: {},
      token: state.alice.token,
      step: `PATCH /files/${state.fileIntentId}/mark-uploaded (alice)`,
      flow,
      state,
    });

    // Confirm status is now 'uploaded'
    await apiCall({
      method: 'GET',
      path: `/files/${state.fileIntentId}`,
      token: state.alice.token,
      step: `GET /files/${state.fileIntentId} (alice — status=uploaded)`,
      flow,
      state,
    });
  }

  await flushSection('09-file-upload-intent.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 10 — SELLER JOURNEY
// ─────────────────────────────────────────────────────────────────────────────

async function flow10_sellerJourney(state: SimState): Promise<void> {
  printSection('10 — Seller Journey (Alice)');
  const flow = '10-seller-journey';

  const catId = state.categoryId ?? 1;

  // Create product 1 (will be marked sold then deleted)
  const p1Res = await apiCall({
    method: 'POST',
    path: '/products',
    body: {
      categoryId: catId,
      name: 'Used Laptop Sim',
      description: 'Good condition simulation laptop. Testing purposes only.',
      price: 1500,
      city: 'Cairo',
      addressText: '10 Tahrir Square, Downtown Cairo',
    },
    token: state.alice.token,
    step: 'POST /products (alice — product 1)',
    flow,
    state,
    criticalOnFailure: true,
  });
  state.aliceProductId = (p1Res.body as { product?: { id?: number } }).product?.id ?? null;
  console.log(`  → aliceProductId=${state.aliceProductId}`);

  // Create product 2 (survives for buyer/admin flows)
  const p2Res = await apiCall({
    method: 'POST',
    path: '/products',
    body: {
      categoryId: catId,
      name: 'Vintage Camera Sim',
      description: 'Rare vintage camera in excellent condition, barely used.',
      price: 850,
      city: 'Alexandria',
      addressText: '5 Corniche Road, Alexandria',
    },
    token: state.alice.token,
    step: 'POST /products (alice — product 2)',
    flow,
    state,
  });
  state.aliceProduct2Id = (p2Res.body as { product?: { id?: number } }).product?.id ?? null;
  console.log(`  → aliceProduct2Id=${state.aliceProduct2Id}`);

  // Update product 1
  if (state.aliceProductId) {
    await apiCall({
      method: 'PATCH',
      path: `/products/${state.aliceProductId}`,
      body: { name: 'Used Laptop Sim (Updated)', price: 1400 },
      token: state.alice.token,
      step: `PATCH /products/${state.aliceProductId} (alice)`,
      flow,
      state,
    });
  }

  // List own products
  await apiCall({
    method: 'GET',
    path: '/my/products',
    token: state.alice.token,
    step: 'GET /my/products (alice)',
    flow,
    state,
  });

  // Mark product 1 as sold
  if (state.aliceProductId) {
    await apiCall({
      method: 'PATCH',
      path: `/products/${state.aliceProductId}/status`,
      body: { status: 'sold' },
      token: state.alice.token,
      step: `PATCH /products/${state.aliceProductId}/status → sold`,
      flow,
      state,
    });
  }

  // Soft-delete product 1
  if (state.aliceProductId) {
    await apiCall({
      method: 'DELETE',
      path: `/products/${state.aliceProductId}`,
      token: state.alice.token,
      step: `DELETE /products/${state.aliceProductId} (alice)`,
      flow,
      state,
    });
  }

  await flushSection('10-seller-journey.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 11 — BUYER JOURNEY
// ─────────────────────────────────────────────────────────────────────────────

async function flow11_buyerJourney(state: SimState): Promise<void> {
  printSection('11 — Buyer Journey (Bob)');
  const flow = '11-buyer-journey';

  // Public product search
  await apiCall({
    method: 'GET',
    path: '/search/products',
    step: 'GET /search/products (bob)',
    flow,
    state,
  });

  // Inspect product 2 details
  if (state.aliceProduct2Id) {
    await apiCall({
      method: 'GET',
      path: `/products/${state.aliceProduct2Id}`,
      step: `GET /products/${state.aliceProduct2Id} (bob)`,
      flow,
      state,
    });
  }

  // Evaluate Alice's seller reputation (public)
  if (state.alice.userId) {
    await apiCall({
      method: 'GET',
      path: `/ratings/${state.alice.userId}`,
      step: `GET /ratings/${state.alice.userId} (alice's public rating)`,
      flow,
      state,
    });
  }

  // Start a conversation with Alice
  if (state.alice.userId) {
    const convRes = await apiCall({
      method: 'POST',
      path: '/chat/conversations',
      body: { participantId: state.alice.userId },
      token: state.bob.token,
      step: 'POST /chat/conversations (bob → alice)',
      flow,
      state,
    });
    if (convRes.ok) {
      state.conversationId = (convRes.body as { conversation?: { id?: number } }).conversation?.id ?? null;
      console.log(`  → conversationId=${state.conversationId}`);
    }
  }

  // List bob's conversations
  await apiCall({
    method: 'GET',
    path: '/chat/conversations',
    token: state.bob.token,
    step: 'GET /chat/conversations (bob)',
    flow,
    state,
  });

  // Fetch messages (empty at this point)
  if (state.conversationId) {
    await apiCall({
      method: 'GET',
      path: `/chat/conversations/${state.conversationId}/messages`,
      token: state.bob.token,
      step: `GET /chat/conversations/${state.conversationId}/messages (bob)`,
      flow,
      state,
    });
  }

  await flushSection('11-buyer-journey.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 12 — WEBSOCKET CHAT
// ─────────────────────────────────────────────────────────────────────────────

async function flow12_websocketChat(state: SimState): Promise<void> {
  printSection('12 — WebSocket Chat');
  const flow = '12-websocket-chat';

  if (!state.conversationId || !state.bob.token || !state.alice.token) {
    warn('Missing conversationId or tokens — skipping WebSocket chat flow');
    currentSectionEntries.push({
      flow,
      step: 'SKIPPED — missing conversationId or tokens',
      method: 'WS',
      url: `${BASE_URL}/chat`,
      requestHeaders: {},
      requestBody: null,
      statusCode: 0,
      responseBody: { skipped: true },
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
    await flushSection('12-websocket-chat.json');
    return;
  }

  type WsEvent = { label: string; event: string; data: unknown; ts: string };
  const wsEvents: WsEvent[] = [];
  let bobSocket: Socket | null = null;
  let aliceSocket: Socket | null = null;
  const t0 = Date.now();

  const trackEvents = (socket: Socket, label: string): void => {
    ['message.received', 'message.read', 'error'].forEach((ev) => {
      socket.on(ev, (data: unknown) => {
        wsEvents.push({ label, event: ev, data, ts: new Date().toISOString() });
        console.log(`  [WS] ${label} ← ${ev}: ${JSON.stringify(data).slice(0, 100)}`);
      });
    });
  };

  try {
    // Connect Bob
    console.log('  Connecting Bob to /chat …');
    bobSocket = await connectWs(state.bob.token);
    console.log(`  ${GREEN}✓${RESET} Bob connected (id=${bobSocket.id})`);
    trackEvents(bobSocket, 'bob');

    // Bob joins the conversation room
    const bobJoinAck = await bobSocket.emitWithAck('conversation.join', {
      conversationId: state.conversationId,
    }) as Record<string, unknown>;
    wsEvents.push({ label: 'bob', event: 'conversation.join ack', data: bobJoinAck, ts: new Date().toISOString() });
    state.totalCalls++;
    if (bobJoinAck?.success) { state.successes++; console.log(`  ${GREEN}✓${RESET} [WS] bob joined room`); }
    else { state.failures++; console.log(`  ${RED}✗${RESET} [WS] bob join failed`); }

    // Connect Alice
    console.log('  Connecting Alice to /chat …');
    aliceSocket = await connectWs(state.alice.token);
    console.log(`  ${GREEN}✓${RESET} Alice connected (id=${aliceSocket.id})`);
    trackEvents(aliceSocket, 'alice');

    // Alice joins the conversation room
    const aliceJoinAck = await aliceSocket.emitWithAck('conversation.join', {
      conversationId: state.conversationId,
    }) as Record<string, unknown>;
    wsEvents.push({ label: 'alice', event: 'conversation.join ack', data: aliceJoinAck, ts: new Date().toISOString() });
    state.totalCalls++;
    if (aliceJoinAck?.success) { state.successes++; console.log(`  ${GREEN}✓${RESET} [WS] alice joined room`); }
    else { state.failures++; console.log(`  ${RED}✗${RESET} [WS] alice join failed`); }

    // Bob sends a message
    const sendAck = await bobSocket.emitWithAck('message.send', {
      conversationId: state.conversationId,
      text: 'Hello Alice! Is the camera still available?',
    }) as Record<string, unknown>;
    wsEvents.push({ label: 'bob', event: 'message.send ack', data: sendAck, ts: new Date().toISOString() });
    state.totalCalls++;
    if (sendAck?.id) {
      state.lastMessageId = sendAck.id as number;
      state.successes++;
      console.log(`  ${GREEN}✓${RESET} [WS] bob sent message — lastMessageId=${state.lastMessageId}`);
    } else {
      state.failures++;
      console.log(`  ${RED}✗${RESET} [WS] bob message.send failed`);
    }

    // Allow message.received to propagate to both sockets
    await new Promise((r) => setTimeout(r, 400));

    // Alice marks the message as read
    if (state.lastMessageId) {
      const readAck = await aliceSocket.emitWithAck('message.read', {
        messageId: state.lastMessageId,
      }) as Record<string, unknown>;
      wsEvents.push({ label: 'alice', event: 'message.read ack', data: readAck, ts: new Date().toISOString() });
      state.totalCalls++;
      const readOk = !!(readAck?.message);
      if (readOk) { state.successes++; console.log(`  ${GREEN}✓${RESET} [WS] alice marked message as read`); }
      else { state.failures++; console.log(`  ${RED}✗${RESET} [WS] alice message.read failed`); }
    }

    // Allow message.read event to propagate
    await new Promise((r) => setTimeout(r, 400));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`WebSocket flow error: ${msg}`);
    wsEvents.push({ label: 'error', event: 'flow_error', data: msg, ts: new Date().toISOString() });
    state.totalCalls++;
    state.failures++;
  } finally {
    bobSocket?.disconnect();
    aliceSocket?.disconnect();
  }

  const durationMs = Date.now() - t0;

  // Capture the entire WS session as a single log entry
  currentSectionEntries.push({
    flow,
    step: 'WebSocket /chat — full session (Bob + Alice)',
    method: 'WS',
    url: `${BASE_URL}/chat`,
    requestHeaders: { auth: 'Bearer [REDACTED]' },
    requestBody: { conversationId: state.conversationId },
    statusCode: wsEvents.some((e) => e.event === 'flow_error') ? 0 : 200,
    responseBody: { events: wsEvents },
    durationMs,
    timestamp: new Date().toISOString(),
  });

  await flushSection('12-websocket-chat.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 13 — RATINGS
// ─────────────────────────────────────────────────────────────────────────────

async function flow13_ratings(state: SimState): Promise<void> {
  printSection('13 — Ratings');
  const flow = '13-ratings';

  if (state.alice.userId) {
    await apiCall({
      method: 'POST',
      path: '/ratings',
      body: { ratedUserId: state.alice.userId, ratingValue: 4, comment: 'Great seller, smooth transaction!' },
      token: state.bob.token,
      step: `POST /ratings (bob rates alice 4/5)`,
      flow,
      state,
    });
  }

  if (state.bob.userId) {
    await apiCall({
      method: 'POST',
      path: '/ratings',
      body: { ratedUserId: state.bob.userId, ratingValue: 5, comment: 'Excellent buyer, very responsive.' },
      token: state.alice.token,
      step: `POST /ratings (alice rates bob 5/5)`,
      flow,
      state,
    });
  }

  if (state.alice.userId) {
    await apiCall({
      method: 'GET',
      path: `/ratings/${state.alice.userId}`,
      step: `GET /ratings/${state.alice.userId} (alice's summary)`,
      flow,
      state,
    });
  }

  if (state.bob.userId) {
    await apiCall({
      method: 'GET',
      path: `/ratings/${state.bob.userId}`,
      step: `GET /ratings/${state.bob.userId} (bob's summary)`,
      flow,
      state,
    });
  }

  await flushSection('13-ratings.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 14 — REPORTS & ADMIN
// ─────────────────────────────────────────────────────────────────────────────

async function flow14_reportsAndAdmin(state: SimState): Promise<void> {
  printSection('14 — Reports & Admin');
  const flow = '14-reports-and-admin';

  // ── Reports ────────────────────────────────────────────────────────────────

  // Bob submits a report against Alice
  if (state.alice.userId) {
    const reportRes = await apiCall({
      method: 'POST',
      path: '/reports',
      body: {
        reportedUserId: state.alice.userId,
        reason: 'Simulated abuse report for integration testing. Not a real violation.',
      },
      token: state.bob.token,
      step: `POST /reports (bob reports alice)`,
      flow,
      state,
    });
    if (reportRes.ok) {
      state.reportId = (reportRes.body as { report?: { id?: number } }).report?.id ?? null;
      console.log(`  → reportId=${state.reportId}`);
    }
  }

  // Bob views his own submitted reports
  await apiCall({
    method: 'GET',
    path: '/reports/me',
    token: state.bob.token,
    step: 'GET /reports/me (bob)',
    flow,
    state,
  });

  // ── Admin — User Moderation ────────────────────────────────────────────────

  await apiCall({
    method: 'GET',
    path: '/admin/users',
    token: state.adminToken,
    step: 'GET /admin/users',
    flow,
    state,
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
    });

    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${state.alice.userId}/status`,
      body: { status: 'active' },
      token: state.adminToken,
      step: `PATCH /admin/users/${state.alice.userId}/status → active`,
      flow,
      state,
    });

    await apiCall({
      method: 'POST',
      path: '/admin/warnings',
      body: {
        targetUserId: state.alice.userId,
        message: 'Simulated warning for integration testing. No real violation.',
      },
      token: state.adminToken,
      step: `POST /admin/warnings (warn alice)`,
      flow,
      state,
    });
  }

  if (state.bob.userId) {
    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${state.bob.userId}/status`,
      body: { status: 'banned' },
      token: state.adminToken,
      step: `PATCH /admin/users/${state.bob.userId}/status → banned`,
      flow,
      state,
    });

    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${state.bob.userId}/status`,
      body: { status: 'active' },
      token: state.adminToken,
      step: `PATCH /admin/users/${state.bob.userId}/status → active (reactivate)`,
      flow,
      state,
    });
  }

  // ── Admin — Admin Management ───────────────────────────────────────────────

  await apiCall({
    method: 'GET',
    path: '/admin/admins',
    token: state.adminToken,
    step: 'GET /admin/admins',
    flow,
    state,
  });

  if (state.alice.userId) {
    await apiCall({
      method: 'POST',
      path: `/admin/admins/${state.alice.userId}`,
      token: state.adminToken,
      step: `POST /admin/admins/${state.alice.userId} (promote alice)`,
      flow,
      state,
    });

    await apiCall({
      method: 'DELETE',
      path: `/admin/admins/${state.alice.userId}`,
      token: state.adminToken,
      step: `DELETE /admin/admins/${state.alice.userId} (demote alice)`,
      flow,
      state,
    });
  }

  // ── Admin — Report Review ──────────────────────────────────────────────────

  await apiCall({
    method: 'GET',
    path: '/admin/reports',
    token: state.adminToken,
    step: 'GET /admin/reports',
    flow,
    state,
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
    });

    await apiCall({
      method: 'PATCH',
      path: `/admin/reports/${state.reportId}`,
      body: { status: 'resolved' },
      token: state.adminToken,
      step: `PATCH /admin/reports/${state.reportId} → resolved`,
      flow,
      state,
    });
  }

  await flushSection('14-reports-and-admin.json');
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE + MAIN
// ─────────────────────────────────────────────────────────────────────────────

const state: SimState = {
  totalCalls: 0,
  successes: 0,
  failures: 0,
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
  categoryId: null,
  aliceProductId: null,
  aliceProduct2Id: null,
  conversationId: null,
  lastMessageId: null,
  reportId: null,
  aliceContactId: null,
  fileIntentId: null,
};

async function main(): Promise<void> {
  const bar = '═'.repeat(52);
  console.log(`\n${bar}`);
  console.log('  Market Place — Flow Simulation');
  console.log(`  Target : ${BASE_URL}`);
  console.log(`  Logs   : ${LOG_DIR}`);
  console.log(`${bar}`);

  await fs.mkdir(LOG_DIR, { recursive: true });

  await flow01_anonymous(state);
  await flow02_authAlice(state);
  await flow03_authBob(state);
  await flow04_adminLogin(state);
  await flow05_tokenLifecycle(state);
  await flow06_passwordReset(state);
  await flow07_profileManagement(state);
  await flow08_contactManagement(state);
  await flow09_fileUploadIntent(state);
  await flow10_sellerJourney(state);
  await flow11_buyerJourney(state);
  await flow12_websocketChat(state);
  await flow13_ratings(state);
  await flow14_reportsAndAdmin(state);

  await summarize(state);
}

void main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${RED}[FATAL]${RESET} ${msg}`);
  await summarize(state).catch(() => {});
  process.exit(1);
});
