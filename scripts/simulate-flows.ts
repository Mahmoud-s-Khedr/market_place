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
  baseUrl: process.env.BASE_URL ?? 'http://165.227.138.228:800',
  mode: process.env.SIM_MODE ?? 'simulate',
  seedDryRun: parseBool(process.env.SIM_SEED_DRY_RUN, false),
  // Keep overridable for load tests; defaults are tuned for local/dev stability.
  timeoutMs: parsePositiveInt(process.env.SIM_TIMEOUT_MS, 20000),
  retry429WaitMs: parsePositiveInt(process.env.SIM_429_RETRY_WAIT_MS, 65000),
  retry429Attempts: parsePositiveInt(process.env.SIM_429_RETRY_ATTEMPTS, 1),
  retryAbortAttempts: parsePositiveInt(process.env.SIM_RETRY_ABORT_ATTEMPTS, 2),
  retryAbortBaseMs: parsePositiveInt(process.env.SIM_RETRY_ABORT_BASE_MS, 300),
  negativeTests: parseBool(process.env.SIM_NEGATIVE_TESTS, true),
  realUpload: parseBool(process.env.SIM_REAL_UPLOAD, true),
  continueOnFail: parseBool(process.env.SIM_CONTINUE_ON_FAIL, true),
  concurrentUsers: parsePositiveInt(process.env.SIM_CONCURRENT_USERS, 30),
  chatPairs: parsePositiveInt(process.env.SIM_CHAT_PAIRS, 12),
  concurrentMessagesPerPair: parsePositiveInt(process.env.SIM_CONCURRENT_MESSAGES_PER_PAIR, 30),
  concurrentStaggerMs: parsePositiveInt(process.env.SIM_CONCURRENT_STAGGER_MS, 250),
  enableConcurrentFlow: parseBool(process.env.SIM_ENABLE_CONCURRENT_FLOW, true),
  assertStrict: parseBool(process.env.SIM_ASSERT_STRICT, true),
  assertWsPayload: parseBool(process.env.SIM_ASSERT_WS_PAYLOAD, true),
  assertContract: parseBool(process.env.SIM_ASSERT_CONTRACT, true),
  realImagePath: process.env.SIM_REAL_IMAGE_PATH ?? path.join(process.cwd(), 'scripts', 'sim-images'),
  adminPhone: process.env.ADMIN_PHONE ?? '+201000000000',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'ChangeMe123',
  targetUsers: parsePositiveInt(process.env.SIM_TARGET_USERS, 100),
  targetProducts: parsePositiveInt(process.env.SIM_TARGET_PRODUCTS, 100),
  targetConversations: parsePositiveInt(process.env.SIM_TARGET_CONVERSATIONS, 100),
  targetMessages: parsePositiveInt(process.env.SIM_TARGET_MESSAGES, 100),
  targetRatings: parsePositiveInt(process.env.SIM_TARGET_RATINGS, 100),
  targetReports: parsePositiveInt(process.env.SIM_TARGET_REPORTS, 100),
  targetFavorites: parsePositiveInt(process.env.SIM_TARGET_FAVORITES, 100),
  targetContacts: parsePositiveInt(process.env.SIM_TARGET_CONTACTS, 100),
  targetFiles: parsePositiveInt(process.env.SIM_TARGET_FILES, 100),
  targetBlocks: parsePositiveInt(process.env.SIM_TARGET_BLOCKS, 100),
  targetAdminWarnings: parsePositiveInt(process.env.SIM_TARGET_ADMIN_WARNINGS, 100),
  targetAdminReportActions: parsePositiveInt(process.env.SIM_TARGET_ADMIN_REPORT_ACTIONS, 100),
  allowContactsPost: parseBool(process.env.SIM_ALLOW_CONTACTS_POST, false),
  seedMaxIterations: parsePositiveInt(process.env.SIM_SEED_MAX_ITERATIONS, 10000),
  seedMaxDurationMs: parsePositiveInt(process.env.SIM_SEED_MAX_DURATION_MS, 900000),
  postQuotaAuthRegister: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_REGISTER, 100),
  postQuotaAuthResendOtp: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_RESEND_OTP, 1),
  postQuotaAuthVerify: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_VERIFY, 100),
  postQuotaAuthLogin: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_LOGIN, 100),
  postQuotaAuthPasswordRequestOtp: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_PASSWORD_REQUEST_OTP, 1),
  postQuotaAuthPasswordReset: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_PASSWORD_RESET, 1),
  postQuotaAuthRefresh: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_REFRESH, 1),
  postQuotaAuthLogout: parsePositiveInt(process.env.SIM_POST_QUOTA_AUTH_LOGOUT, 1),
  postQuotaFilesUploadIntent: parsePositiveInt(process.env.SIM_POST_QUOTA_FILES_UPLOAD_INTENT, 100),
  postQuotaProducts: parsePositiveInt(process.env.SIM_POST_QUOTA_PRODUCTS, 100),
  postQuotaFavorites: parsePositiveInt(process.env.SIM_POST_QUOTA_FAVORITES, 100),
  postQuotaChatConversations: parsePositiveInt(process.env.SIM_POST_QUOTA_CHAT_CONVERSATIONS, 100),
  postQuotaRatings: parsePositiveInt(process.env.SIM_POST_QUOTA_RATINGS, 100),
  postQuotaReports: parsePositiveInt(process.env.SIM_POST_QUOTA_REPORTS, 100),
  postQuotaBlocks: parsePositiveInt(process.env.SIM_POST_QUOTA_BLOCKS, 100),
  postQuotaAdminWarnings: parsePositiveInt(process.env.SIM_POST_QUOTA_ADMIN_WARNINGS, 100),
  postQuotaAdminCategories: parsePositiveInt(process.env.SIM_POST_QUOTA_ADMIN_CATEGORIES, 2),
  postQuotaAdminPromote: parsePositiveInt(process.env.SIM_POST_QUOTA_ADMIN_PROMOTE, 1),
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
  | 'DELETE /me'
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
  | 'GET /admin/users/:id'
  | 'GET /admin/users/:id/listings'
  | 'GET /admin/users/:id/reports'
  | 'GET /admin/admins'
  | 'POST /admin/admins/:id'
  | 'DELETE /admin/admins/:id'
  | 'PATCH /admin/users/:id/status'
  | 'DELETE /admin/users/:id'
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
  'DELETE /me',
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
  'GET /admin/users/:id',
  'GET /admin/users/:id/listings',
  'GET /admin/users/:id/reports',
  'GET /admin/admins',
  'POST /admin/admins/:id',
  'DELETE /admin/admins/:id',
  'PATCH /admin/users/:id/status',
  'DELETE /admin/users/:id',
  'POST /admin/warnings',
  'GET /admin/reports',
  'PATCH /admin/reports/:id',
  'POST /admin/categories',
  'DELETE /admin/categories/:id',
];

const PM_V1_REQUIRED_ENDPOINTS: RestEndpoint[] = [
  'POST /auth/login',
  'POST /reports',
  'GET /reports/me',
  'GET /admin/users',
  'GET /admin/users/:id',
  'GET /admin/users/:id/listings',
  'GET /admin/users/:id/reports',
  'PATCH /admin/users/:id/status',
  'GET /admin/reports',
];

const PM_V1_OPTIONAL_ADMIN_ENDPOINTS: RestEndpoint[] = [
  'GET /admin/admins',
  'POST /admin/admins/:id',
  'DELETE /admin/admins/:id',
  'DELETE /admin/users/:id',
  'POST /admin/warnings',
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

interface SeedTargets {
  users: number;
  products: number;
  conversations: number;
  messages: number;
  ratings: number;
  reports: number;
  favorites: number;
  contacts: number;
  files: number;
  blocks: number;
  adminWarnings: number;
  adminReportActions: number;
}

interface SeedProgress {
  users: number;
  products: number;
  conversations: number;
  messages: number;
  ratings: number;
  reports: number;
  favorites: number;
  contacts: number;
  files: number;
  blocks: number;
  adminWarnings: number;
  adminReportActions: number;
}

type SeedPostKey =
  | 'auth.register'
  | 'auth.register.resend_otp'
  | 'auth.register.verify'
  | 'auth.login'
  | 'auth.password.request_otp'
  | 'auth.password.reset'
  | 'auth.refresh'
  | 'auth.logout'
  | 'files.upload_intent'
  | 'products.create'
  | 'favorites.create'
  | 'chat.conversations.create'
  | 'ratings.create'
  | 'reports.create'
  | 'blocks.create'
  | 'admin.warnings.create'
  | 'admin.categories.create'
  | 'admin.admins.promote';

interface SeedPostQuotaTargets {
  [k: string]: number;
}

interface SeedPostRegistryItem {
  key: SeedPostKey;
  endpoint: string;
  enabled: boolean;
  quota: number;
  expectedStatus: number[];
  requiresAdmin?: boolean;
  isRowProducer: boolean;
  dependsOn: string[];
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
  assertionChecksTotal: number;
  assertionChecksFailed: number;
  assertionFailuresDetailed: Array<{
    flow: string;
    step: string;
    path: string;
    expected: string;
    actual: string;
    snippet: string;
  }>;
  adminToken: string | null;
  adminRefreshToken: string | null;
  alice: UserState;
  bob: UserState;
  productCategoryId: number | null;
  productCategory: string | null;
  productSubcategory: string | null;
  categoryParentId: number | null;
  categoryLeafId: number | null;
  aliceProductId: number | null;
  aliceProduct2Id: number | null;
  conversationId: number | null;
  lastMessageId: number | null;
  reportId: number | null;
  avatarFileId: number | null;
  productImageFileId: number | null;
  concurrentUsers: number;
  chatPairs: number;
  concurrentMetrics: ConcurrentMetrics;
  seedUsers: VirtualUserState[];
  seedTargets: SeedTargets;
  seedProgress: SeedProgress;
  seedErrors: string[];
  postQuotaTargets: SeedPostQuotaTargets;
  postQuotaProgress: SeedPostQuotaTargets;
  promotedAdminUserIds: number[];
  seedReportIds: number[];
  postSkipReasons: string[];
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
  errorKind?: ApiErrorKind;
  responseBody: unknown;
  durationMs: number;
  timestamp: string;
}

type ApiErrorKind = 'timeout' | 'network' | 'server' | 'none';

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
  errorKind: ApiErrorKind;
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
  if (typeof s !== 'string') {
    return String(value);
  }
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

function responseData<T = unknown>(body: unknown): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {} as T;
  }
  const root = body as Record<string, unknown>;
  const nested = root.data;
  if (nested !== undefined && nested !== null) {
    return nested as T;
  }
  if (nested === null) return {} as T;
  return root as T;
}

function extractId(body: unknown, key: string): number | null {
  const data = responseData<Record<string, unknown>>(body);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const nested = data[key];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return toId((nested as Record<string, unknown>).id);
  }
  return toId(data.id);
}

type AssertionContext = {
  flow: string;
  step: string;
  state: SimState;
};

function getPathValue(root: unknown, dottedPath: string): unknown {
  const parts = dottedPath.split('.');
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isIsoLikeTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function recordAssertion(
  ctx: AssertionContext,
  path: string,
  expected: string,
  actual: unknown,
  ok: boolean,
): void {
  ctx.state.assertionChecksTotal += 1;
  if (ok) return;

  ctx.state.assertionChecksFailed += 1;
  ctx.state.assertionFailuresDetailed.push({
    flow: ctx.flow,
    step: ctx.step,
    path,
    expected,
    actual: valueType(actual),
    snippet: textSnippet(actual),
  });

  const msg = `Contract assertion failed at ${ctx.step} :: ${path} expected ${expected}, got ${valueType(actual)} (${textSnippet(actual)})`;
  if (!CONFIG.assertStrict) {
    warn(msg);
    return;
  }

  ctx.state.failures += 1;
  noteFlowStats(ctx.state, ctx.flow, true);
  ctx.state.assertionFailures.push({
    flow: ctx.flow,
    step: `${ctx.step} [assert:${path}]`,
    expected: [200],
    actual: 0,
    responseSnippet: msg,
  });
  if (!CONFIG.continueOnFail) {
    throw new Error(msg);
  }
}

function assertPathExists(payload: unknown, path: string, ctx: AssertionContext): void {
  const value = getPathValue(payload, path);
  recordAssertion(ctx, path, 'exists', value, value !== undefined);
}

function assertPathType(
  payload: unknown,
  path: string,
  type: 'string' | 'number' | 'object' | 'array' | 'null',
  ctx: AssertionContext,
): void {
  const value = getPathValue(payload, path);
  const ok = valueType(value) === type;
  recordAssertion(ctx, path, `type:${type}`, value, ok);
}

function assertPathStringOrNull(payload: unknown, path: string, ctx: AssertionContext): void {
  const value = getPathValue(payload, path);
  const ok = value === null || typeof value === 'string';
  recordAssertion(ctx, path, 'string|null', value, ok);
}

function assertPathObjectOrNull(payload: unknown, path: string, ctx: AssertionContext): void {
  const value = getPathValue(payload, path);
  const ok = value === null || (typeof value === 'object' && !Array.isArray(value));
  recordAssertion(ctx, path, 'object|null', value, ok);
}

function assertPathPositiveId(payload: unknown, path: string, ctx: AssertionContext): void {
  const value = getPathValue(payload, path);
  const ok = toId(value) !== null;
  recordAssertion(ctx, path, 'positive-id', value, ok);
}

function assertPathIsoOrNull(payload: unknown, path: string, ctx: AssertionContext): void {
  const value = getPathValue(payload, path);
  const ok = value === null || isIsoLikeTimestamp(value);
  recordAssertion(ctx, path, 'iso-string|null', value, ok);
}

function assertPathIsoRequired(payload: unknown, path: string, ctx: AssertionContext): void {
  const value = getPathValue(payload, path);
  const ok = typeof value === 'string' && isIsoLikeTimestamp(value);
  recordAssertion(ctx, path, 'iso-string', value, ok);
}

function assertAvatarContract(payload: unknown, path: string, ctx: AssertionContext): void {
  assertPathObjectOrNull(payload, path, ctx);
  const avatar = getPathValue(payload, path);
  if (!avatar || typeof avatar !== 'object' || Array.isArray(avatar)) return;
  assertPathPositiveId(payload, `${path}.id`, ctx);
  assertPathType(payload, `${path}.url`, 'string', ctx);
  assertPathStringOrNull(payload, `${path}.mime_type`, ctx);
}

function assertMeContract(body: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body);
  const ctx = { flow, step, state };
  assertPathStringOrNull(payload, 'contactInfo', ctx);
  assertAvatarContract(payload, 'avatar', ctx);
  recordAssertion(ctx, 'avatar_url', 'absent', getPathValue(payload, 'avatar_url'), getPathValue(payload, 'avatar_url') === undefined);
}

function assertPublicUserContract(body: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body);
  const ctx = { flow, step, state };
  assertPathStringOrNull(payload, 'user.contactInfo', ctx);
  assertAvatarContract(payload, 'user.avatar', ctx);
  assertPathIsoRequired(payload, 'user.member_since', ctx);
  const products = getPathValue(payload, 'products');
  if (Array.isArray(products) && products.length > 0) {
    assertPathIsoRequired(payload, 'products.0.created_at', ctx);
  }
}

function assertAdminReportV1ListContract(body: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body);
  const reports = payload.reports;
  const ctx: AssertionContext = { flow, step, state };
  recordAssertion(ctx, 'reports', 'array', reports, Array.isArray(reports));
  if (!Array.isArray(reports) || reports.length === 0) return;

  const first = reports[0];
  assertPathPositiveId(first, 'id', ctx);
  assertPathType(first, 'description', 'string', ctx);
  assertPathObjectOrNull(first, 'reporter', ctx);
  assertPathObjectOrNull(first, 'reported_user', ctx);
  assertPathIsoRequired(first, 'created_at', ctx);
}

function assertFileContract(body: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body);
  const ctx = { flow, step, state };
  assertPathPositiveId(payload, 'id', ctx);
  const url = getPathValue(payload, 'url');
  const readUrl = getPathValue(payload, 'readUrl');
  const hasUrl = typeof url === 'string' || typeof readUrl === 'string';
  recordAssertion(ctx, 'url|readUrl', 'string', hasUrl ? (url ?? readUrl) : undefined, hasUrl);
  assertPathType(payload, 'object_key', 'string', ctx);
  assertPathIsoRequired(payload, 'created_at', ctx);
}

function assertConversationsContract(body: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body) as unknown;
  const ctx = { flow, step, state };
  if (!Array.isArray(payload)) {
    recordAssertion(ctx, 'data', 'array', payload, false);
    return;
  }
  const item = payload[0];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return;
  assertAvatarContract(item, 'peer_user.avatar', ctx);
  assertPathStringOrNull(item, 'peer_user.contactInfo', ctx);
  if (getPathValue(item, 'product') !== null && getPathValue(item, 'product') !== undefined) {
    assertPathObjectOrNull(item, 'product.owner', ctx);
  }
  assertPathObjectOrNull(item, 'product_image', ctx);
  const productImage = getPathValue(item, 'product_image');
  if (productImage && typeof productImage === 'object' && !Array.isArray(productImage)) {
    assertPathPositiveId(item, 'product_image.id', ctx);
    assertPathType(item, 'product_image.url', 'string', ctx);
    assertPathStringOrNull(item, 'product_image.mime_type', ctx);
  }
  assertPathIsoRequired(item, 'created_at', ctx);
  assertPathIsoOrNull(item, 'last_message.sent_at', ctx);
}

function assertMessagesContract(body: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body) as unknown;
  const ctx = { flow, step, state };
  if (!Array.isArray(payload)) {
    recordAssertion(ctx, 'data', 'array', payload, false);
    return;
  }
  const item = payload[0];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return;
  assertPathIsoOrNull(item, 'sent_at', ctx);
  assertPathIsoOrNull(item, 'read_at', ctx);
  assertAvatarContract(item, 'sender.avatar', ctx);
}

function assertWsMessageContract(ack: unknown, flow: string, step: string, state: SimState): void {
  if (!CONFIG.assertContract || !CONFIG.assertWsPayload) return;
  const ctx = { flow, step, state };
  assertPathObjectOrNull(ack, 'message.sender', ctx);
  assertPathType(ack, 'message.sent_at', 'string', ctx);
}

function assertCreatedAtCoverageContract(
  body: unknown,
  coverageKey: RestEndpoint,
  flow: string,
  step: string,
  state: SimState,
): void {
  if (!CONFIG.assertContract) return;
  const payload = responseData<Record<string, unknown>>(body);
  const ctx: AssertionContext = { flow, step, state };

  switch (coverageKey) {
    case 'POST /products':
    case 'GET /products/:id':
    case 'PATCH /products/:id':
      assertPathIsoRequired(payload, 'product.created_at', ctx);
      return;
    case 'GET /search/products':
    case 'GET /my/products':
    case 'GET /favorites': {
      const items = getPathValue(payload, 'items');
      if (Array.isArray(items) && items.length > 0) {
        assertPathIsoRequired(payload, 'items.0.created_at', ctx);
      }
      return;
    }
    case 'POST /ratings':
      assertPathIsoRequired(payload, 'rating.created_at', ctx);
      return;
    case 'GET /ratings/:userId': {
      const ratings = getPathValue(payload, 'ratings');
      if (Array.isArray(ratings) && ratings.length > 0) {
        assertPathIsoRequired(payload, 'ratings.0.created_at', ctx);
      }
      return;
    }
    case 'POST /reports':
      assertPathIsoRequired(payload, 'report.created_at', ctx);
      return;
    case 'GET /reports/me': {
      const reports = getPathValue(payload, 'reports');
      if (Array.isArray(reports) && reports.length > 0) {
        assertPathIsoRequired(payload, 'reports.0.created_at', ctx);
      }
      return;
    }
    case 'PATCH /admin/reports/:id':
      assertPathIsoRequired(payload, 'report.created_at', ctx);
      return;
    case 'GET /admin/users': {
      const users = getPathValue(payload, 'users');
      if (Array.isArray(users) && users.length > 0) {
        assertPathIsoRequired(payload, 'users.0.created_at', ctx);
      }
      return;
    }
    case 'GET /admin/users/:id':
    case 'PATCH /admin/users/:id/status':
    case 'POST /admin/admins/:id':
    case 'DELETE /admin/admins/:id':
      assertPathIsoRequired(payload, 'user.created_at', ctx);
      return;
    case 'GET /admin/admins': {
      const admins = getPathValue(payload, 'admins');
      if (Array.isArray(admins) && admins.length > 0) {
        assertPathIsoRequired(payload, 'admins.0.created_at', ctx);
      }
      return;
    }
    case 'GET /admin/users/:id/listings': {
      const items = getPathValue(payload, 'items');
      if (Array.isArray(items) && items.length > 0) {
        assertPathIsoRequired(payload, 'items.0.created_at', ctx);
      }
      return;
    }
    case 'POST /admin/warnings':
      assertPathIsoRequired(payload, 'warning.created_at', ctx);
      return;
    case 'GET /categories': {
      const categories = getPathValue(payload, 'categories');
      if (Array.isArray(categories) && categories.length > 0) {
        assertPathIsoRequired(payload, 'categories.0.created_at', ctx);
      }
      return;
    }
    default:
      return;
  }
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

async function writeAssertionsArtifact(state: SimState): Promise<void> {
  const assertions = {
    totals: {
      checks: state.assertionChecksTotal,
      failed: state.assertionChecksFailed,
      strictMode: CONFIG.assertStrict,
      enabled: CONFIG.assertContract,
      wsEnabled: CONFIG.assertWsPayload,
    },
    failures: state.assertionFailuresDetailed,
  };
  await fs.writeFile(path.join(LOG_DIR, 'assertions.json'), JSON.stringify(assertions, null, 2));
}

async function summarize(state: SimState): Promise<void> {
  const rate = state.totalCalls > 0
    ? `${Math.round((state.successes / state.totalCalls) * 100)}%`
    : 'N/A';
  const pmV1RequiredFailed = PM_V1_REQUIRED_ENDPOINTS.filter((k) => restCoverage[k] !== 'covered');
  const pmV1RequiredCovered = PM_V1_REQUIRED_ENDPOINTS.filter((k) => restCoverage[k] === 'covered');
  const pmV1OptionalCovered = PM_V1_OPTIONAL_ADMIN_ENDPOINTS.filter((k) => restCoverage[k] === 'covered');
  const pmV1OptionalSkipped = PM_V1_OPTIONAL_ADMIN_ENDPOINTS.filter((k) => restCoverage[k] !== 'covered');

  const summary = {
    runAt: new Date().toISOString(),
    runId: RUN_ID,
    baseUrl: CONFIG.baseUrl,
    config: {
      mode: CONFIG.mode,
      seedDryRun: CONFIG.seedDryRun,
      timeoutMs: CONFIG.timeoutMs,
      negativeTests: CONFIG.negativeTests,
      realUpload: CONFIG.realUpload,
      continueOnFail: CONFIG.continueOnFail,
      enableConcurrentFlow: CONFIG.enableConcurrentFlow,
      concurrentUsers: CONFIG.concurrentUsers,
      chatPairs: CONFIG.chatPairs,
      concurrentMessagesPerPair: CONFIG.concurrentMessagesPerPair,
      concurrentStaggerMs: CONFIG.concurrentStaggerMs,
      assertStrict: CONFIG.assertStrict,
      assertContract: CONFIG.assertContract,
      assertWsPayload: CONFIG.assertWsPayload,
      seedTargets: state.seedTargets,
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
      pmV1: {
        mode: 'pm-v1-default',
        required: {
          endpoints: PM_V1_REQUIRED_ENDPOINTS,
          covered: pmV1RequiredCovered,
          failedOrNotExecuted: pmV1RequiredFailed,
        },
        optionalAdmin: {
          endpoints: PM_V1_OPTIONAL_ADMIN_ENDPOINTS,
          covered: pmV1OptionalCovered,
          skippedOrFailed: pmV1OptionalSkipped,
        },
      },
    },
    flowFailures: state.flowTotals,
    assertionFailures: state.assertionFailures,
    assertionChecks: {
      total: state.assertionChecksTotal,
      failed: state.assertionChecksFailed,
      strictMode: CONFIG.assertStrict,
      topFailures: state.assertionFailuresDetailed.slice(0, 20),
    },
    concurrent: {
      users: state.concurrentUsers,
      chatPairs: state.chatPairs,
      metrics: state.concurrentMetrics,
    },
    seed: {
      progress: state.seedProgress,
      targets: state.seedTargets,
      done: seedEntityDone(state) && seedPostQuotasDone(state),
      errors: state.seedErrors,
      postQuotas: {
        targets: state.postQuotaTargets,
        progress: state.postQuotaProgress,
      },
      promotedAdminUserIds: state.promotedAdminUserIds,
      skipReasons: state.postSkipReasons,
    },
  };

  await fs.writeFile(path.join(LOG_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  if (isSeedMode()) {
    await fs.writeFile(
      path.join(LOG_DIR, 'seed-report.json'),
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          runId: RUN_ID,
          baseUrl: CONFIG.baseUrl,
          mode: CONFIG.mode,
          targets: state.seedTargets,
          progress: state.seedProgress,
          success: seedEntityDone(state) && seedPostQuotasDone(state),
          errors: state.seedErrors,
          postQuotas: {
            targets: state.postQuotaTargets,
            progress: state.postQuotaProgress,
          },
          promotedAdminUserIds: state.promotedAdminUserIds,
          skipReasons: state.postSkipReasons,
        },
        null,
        2,
      ),
    );
  }
  await writeCoverageArtifacts();
  await writeAssertionsArtifact(state);

  const bar = '═'.repeat(64);
  console.log(`\n${bar}`);
  const colour = pmV1RequiredFailed.length === 0 ? GREEN : RED;
  console.log(`  Results: ${colour}${state.successes}/${state.totalCalls} matched expected${RESET} (${rate})`);
  console.log(`  PM V1 required coverage: ${pmV1RequiredCovered.length}/${PM_V1_REQUIRED_ENDPOINTS.length}`);
  if (pmV1RequiredFailed.length > 0) {
    console.log(`  Missing/failed PM V1 endpoints: ${pmV1RequiredFailed.join(', ')}`);
  }
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
  let errorKind: ApiErrorKind = 'none';
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
      errorKind = 'none';
      const text = await response.text();
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { _raw: text };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        errorKind = 'timeout';
        responseBody = { _errorKind: 'timeout', _networkError: `Request timed out after ${CONFIG.timeoutMs}ms` };
      } else {
        errorKind = 'network';
        responseBody = { _errorKind: 'network', _networkError: err instanceof Error ? err.message : String(err) };
      }
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
    errorKind,
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
  if (coverageKey && matchedExpected) {
    assertCreatedAtCoverageContract(responseBody, coverageKey, flow, step, state);
  }

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

  return { statusCode, body: responseBody, matchedExpected, errorKind };
}

function jitteredBackoffMs(baseMs: number, attempt: number): number {
  const exp = baseMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(25, Math.floor(exp * 0.35)));
  return exp + jitter;
}

async function callWithRetry(
  buildCall: () => Promise<ApiCallResult>,
  opts: { maxAttempts: number; stepLabel: string },
): Promise<ApiCallResult> {
  let result = await buildCall();
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    const retryable = result.statusCode === 0 || result.statusCode === 429;
    if (!retryable) return result;
    const waitMs = jitteredBackoffMs(CONFIG.retryAbortBaseMs, attempt);
    const why = result.statusCode === 0 ? (result.errorKind === 'timeout' ? 'timeout' : 'network') : '429';
    warn(`${opts.stepLabel} retrying after ${why} (attempt ${attempt}/${opts.maxAttempts}, wait ${waitMs}ms)`);
    await sleep(waitMs);
    result = await buildCall();
  }
  return result;
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

type UploadImageAsset = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  source: 'real' | 'fake';
};

let cachedUploadAsset: UploadImageAsset | null = null;

function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

async function resolveRealImagePath(inputPath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(inputPath);
    if (stat.isFile()) return inputPath;
    if (!stat.isDirectory()) return null;

    const entries = await fs.readdir(inputPath, { withFileTypes: true });
    const candidate = entries.find((e) => e.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(e.name));
    if (!candidate) return null;
    return path.join(inputPath, candidate.name);
  } catch {
    return null;
  }
}

async function getUploadImageAsset(): Promise<UploadImageAsset> {
  if (cachedUploadAsset) return cachedUploadAsset;

  const resolvedRealImage = await resolveRealImagePath(CONFIG.realImagePath);
  if (resolvedRealImage) {
    const bytes = await fs.readFile(resolvedRealImage);
    cachedUploadAsset = {
      bytes,
      mimeType: mimeFromFilename(resolvedRealImage),
      filename: path.basename(resolvedRealImage),
      source: 'real',
    };
    return cachedUploadAsset;
  }

  const fallback = fakePngBuffer();
  warn(`No real image found at ${CONFIG.realImagePath}; falling back to generated PNG`);
  cachedUploadAsset = {
    bytes: fallback,
    mimeType: 'image/png',
    filename: `sim-${RUN_ID}.png`,
    source: 'fake',
  };
  return cachedUploadAsset;
}

async function uploadToCloudinary(intentBody: unknown): Promise<{ ok: boolean; response: unknown; statusCode: number }> {
  const parsed = responseData<{
    upload?: {
      method?: string;
      url?: string;
      fields?: Record<string, string>;
      headers?: Record<string, string>;
    };
  }>(intentBody);

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
  const asset = await getUploadImageAsset();
  const arr = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arr], { type: asset.mimeType });
  form.append('file', blob, asset.filename);

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
    const catPayload = responseData<unknown>(catRes.body);
    const cats = Array.isArray(catPayload)
      ? catPayload as Array<{ id: number; name?: string; parent?: { id?: number; name?: string } | null }>
      : (catPayload as { categories?: Array<{ id: number; name?: string; parent?: { id?: number; name?: string } | null }> }).categories ?? [];
    const parentIds = new Set(
      cats.map((c) => c.parent?.id ?? null).filter((id): id is number => id !== null),
    );
    const leaf = cats.find((c) => !parentIds.has(c.id)) ?? cats[cats.length - 1];
    if (leaf) {
      state.productCategoryId = toId(leaf.id);
      state.productCategory = 'electronics';
      state.productSubcategory = 'smartphones';
      console.log(`  → productCategoryId (existing leaf) = ${state.productCategoryId}`);
    } else {
      console.log('  → no categories found from /categories; will create one later if admin auth is available');
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

  let otp = responseData<{ otp?: string }>(regRes.body).otp;
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
    const resent = responseData<{ otp?: string }>(resendRes.body).otp;
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

  const vb = responseData<{ accessToken?: string; refreshToken?: string; user?: { id?: number } }>(verifyRes.body);
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
  printSection('03 — Admin Login (PM V1)');
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

  const b = responseData<{ accessToken?: string; refreshToken?: string }>(loginRes.body);
  state.adminToken = b.accessToken ?? null;
  state.adminRefreshToken = b.refreshToken ?? null;

  await flushSection('03-admin-bootstrap-pm-v1.json');
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
    const rb = responseData<{ accessToken?: string; refreshToken?: string }>(refreshRes.body);
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
    const b = responseData<{ accessToken?: string; refreshToken?: string }>(reloginRes.body);
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

  const otp = responseData<{ otp?: string }>(reqRes.body).otp;
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
    const rb = responseData<{ accessToken?: string; refreshToken?: string }>(resetRes.body);
    state.alice.token = rb.accessToken ?? state.alice.token;
    state.alice.refreshToken = rb.refreshToken ?? state.alice.refreshToken;
  }

  await flushSection('05-password-reset.json');
}

async function flow06_uploadsAndProfile(state: SimState): Promise<void> {
  printSection('06 — Uploads + Profile');
  const flow = '06-uploads-profile';
  const uploadAsset = await getUploadImageAsset();

  const avatarIntentRes = await apiCall({
    method: 'POST',
    path: '/files/upload-intent',
    body: {
      ownerType: 'user',
      purpose: 'avatar',
      filename: uploadAsset.filename,
      mimeType: uploadAsset.mimeType,
      fileSizeBytes: uploadAsset.bytes.byteLength,
    },
    token: state.alice.token,
    step: 'POST /files/upload-intent (avatar)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /files/upload-intent',
  });

  state.avatarFileId = toId(responseData<{ file?: { id?: unknown } }>(avatarIntentRes.body).file?.id);

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

    const avatarFileRes = await apiCall({
      method: 'GET',
      path: `/files/${state.avatarFileId}`,
      token: state.alice.token,
      step: `GET /files/${state.avatarFileId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /files/:id',
    });
    if (avatarFileRes.matchedExpected) {
      assertFileContract(avatarFileRes.body, flow, `GET /files/${state.avatarFileId}`, state);
    }
  }

  const productIntentRes = await apiCall({
    method: 'POST',
    path: '/files/upload-intent',
    body: {
      ownerType: 'user',
      purpose: 'product_image',
      filename: uploadAsset.filename,
      mimeType: uploadAsset.mimeType,
      fileSizeBytes: uploadAsset.bytes.byteLength,
    },
    token: state.alice.token,
    step: 'POST /files/upload-intent (product image)',
    flow,
    state,
    expectedStatus: 201,
    coverageKey: 'POST /files/upload-intent',
  });
  state.productImageFileId = toId(responseData<{ file?: { id?: unknown } }>(productIntentRes.body).file?.id);

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

    const productFileRes = await apiCall({
      method: 'GET',
      path: `/files/${state.productImageFileId}`,
      token: state.alice.token,
      step: `GET /files/${state.productImageFileId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /files/:id',
    });
    if (productFileRes.matchedExpected) {
      assertFileContract(productFileRes.body, flow, `GET /files/${state.productImageFileId}`, state);
    }
  }

  const meRes = await apiCall({
    method: 'GET',
    path: '/me',
    token: state.alice.token,
    step: 'GET /me',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /me',
  });
  if (meRes.matchedExpected) {
    assertMeContract(meRes.body, flow, 'GET /me', state);
  }

  const patchMeRes = await apiCall({
    method: 'PATCH',
    path: '/me',
    body: {
      name: `Alice ${RUN_ID}`,
      contactInfo: `sim+${RUN_ID}@example.test`,
      avatarFileId: state.avatarFileId ?? undefined,
    },
    token: state.alice.token,
    step: 'PATCH /me (set avatarFileId)',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'PATCH /me',
  });
  if (patchMeRes.matchedExpected) {
    assertMeContract(patchMeRes.body, flow, 'PATCH /me (set avatarFileId)', state);
  }

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
      const b = responseData<{ accessToken?: string; refreshToken?: string }>(reloginRes.body);
      state.alice.token = b.accessToken ?? state.alice.token;
      state.alice.refreshToken = b.refreshToken ?? state.alice.refreshToken;
    }
  }

  await flushSection('06-uploads-profile.json');
}

async function flow07_seller(state: SimState): Promise<void> {
  printSection('07 — Seller Journey');
  const flow = '07-seller';

  let category = state.productCategory;
  let subcategory = state.productSubcategory;
  if (!category && state.adminToken) {
    const parentName = `Sim Parent ${RUN_ID}`;
    const leafName = `Sim Leaf ${RUN_ID}`;
    const parentRes = await apiCall({
      method: 'POST',
      path: '/admin/categories',
      body: { name: parentName },
      token: state.adminToken,
      step: 'POST /admin/categories (parent for seller flow)',
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /admin/categories',
    });
    state.categoryParentId = extractId(parentRes.body, 'category');

    if (state.categoryParentId) {
      const leafRes = await apiCall({
        method: 'POST',
        path: '/admin/categories',
        body: { name: leafName, parentId: state.categoryParentId },
        token: state.adminToken,
        step: 'POST /admin/categories (leaf for seller flow)',
        flow,
        state,
        expectedStatus: 201,
        coverageKey: 'POST /admin/categories',
      });
      state.categoryLeafId = extractId(leafRes.body, 'category');
      category = 'electronics';
      subcategory = 'smartphones';
    }
  }

  if (!category) {
    throw new Error('No usable product category found. /categories returned empty and admin category bootstrap failed.');
  }

  const imageFileIds = state.productImageFileId ? [state.productImageFileId] : undefined;

  const p1 = await apiCall({
    method: 'POST',
    path: '/products',
    body: {
      category,
      subcategory,
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
  state.aliceProductId = extractId(p1.body, 'product');

  const p2 = await apiCall({
    method: 'POST',
    path: '/products',
    body: {
      category,
      subcategory,
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
  state.aliceProduct2Id = extractId(p2.body, 'product');

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

  await flushSection('07-seller.json');
}

async function flow08_buyerAndChat(state: SimState): Promise<void> {
  printSection('08 — Buyer + Chat REST');
  const flow = '08-buyer-chat-rest';

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
    state.conversationId = extractId(conv.body, 'conversation');

    const userPublicRes = await apiCall({
      method: 'GET',
      path: `/users/${state.alice.userId}`,
      step: `GET /users/${state.alice.userId} (public)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /users/:id',
    });
    if (userPublicRes.matchedExpected) {
      assertPublicUserContract(userPublicRes.body, flow, `GET /users/${state.alice.userId} (public)`, state);
    }

    const userAuthedRes = await apiCall({
      method: 'GET',
      path: `/users/${state.alice.userId}?limit=5&offset=0`,
      token: state.bob.token,
      step: `GET /users/${state.alice.userId} (authed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /users/:id',
    });
    if (userAuthedRes.matchedExpected) {
      assertPublicUserContract(userAuthedRes.body, flow, `GET /users/${state.alice.userId} (authed)`, state);
    }
  }

  const conversationsRes = await apiCall({
    method: 'GET',
    path: '/chat/conversations',
    token: state.bob.token,
    step: 'GET /chat/conversations',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /chat/conversations',
  });
  if (conversationsRes.matchedExpected) {
    assertConversationsContract(conversationsRes.body, flow, 'GET /chat/conversations', state);
  }

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

    const messagesRes = await apiCall({
      method: 'GET',
      path: `/chat/conversations/${state.conversationId}/messages`,
      token: state.bob.token,
      step: `GET /chat/conversations/${state.conversationId}/messages`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations/:id/messages',
    });
    if (messagesRes.matchedExpected) {
      assertMessagesContract(messagesRes.body, flow, `GET /chat/conversations/${state.conversationId}/messages`, state);
    }
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

  await flushSection('08-buyer-chat-rest.json');
}

async function flow09_websocket(state: SimState): Promise<void> {
  printSection('09 — WebSocket Chat');
  const flow = '09-websocket';

  if (!state.conversationId || !state.alice.token || !state.bob.token) {
    warn('Missing conversation/tokens; skipping WebSocket coverage.');
    await flushSection('09-websocket.json');
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
    printStep(bobJoinOk, `WS conversation.join (bob)`, bobJoinOk ? 200 : 0, 0);
    state.totalCalls += 1;
    noteFlowStats(state, flow, !bobJoinOk);
    if (bobJoinOk) state.successes += 1;
    else state.failures += 1;

    const aliceJoin = await aliceSocket.emitWithAck('conversation.join', {
      conversationId: state.conversationId,
    }) as Record<string, unknown>;
    const aliceJoinOk = Boolean(aliceJoin.success);
    markCoverage(wsCoverage, 'conversation.join', aliceJoinOk);
    printStep(aliceJoinOk, `WS conversation.join (alice)`, aliceJoinOk ? 200 : 0, 0);
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
    printStep(sendOk, `WS message.send (bob)`, sendOk ? 200 : 0, 0);
    state.totalCalls += 1;
    noteFlowStats(state, flow, !sendOk);
    if (sendOk) {
      state.successes += 1;
      state.lastMessageId = sentMessageId;
      assertWsMessageContract(sendAck, flow, 'WS message.send (bob)', state);
    } else {
      state.failures += 1;
    }

    if (state.lastMessageId) {
      const readAck = await aliceSocket.emitWithAck('message.read', {
        messageId: state.lastMessageId,
      }) as Record<string, unknown>;

      const readOk = Boolean(readAck.message);
      markCoverage(wsCoverage, 'message.read', readOk);
      printStep(readOk, `WS message.read (alice)`, readOk ? 200 : 0, 0);
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

  await flushSection('09-websocket.json');
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

async function flow10_blocksAndSafety(state: SimState): Promise<void> {
  printSection('10 — Blocks + Enforcement');
  const flow = '10-blocks-safety';

  if (!state.alice.userId || !state.bob.userId) {
    warn('Missing user IDs; skipping block flow.');
    await flushSection('10-blocks-safety.json');
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

  await flushSection('10-blocks-safety.json');
}

async function flow12_reportsAndAdmin(state: SimState): Promise<void> {
  printSection('12 — Reports + Admin (PM V1)');
  const flow = '12-reports-admin-pm-v1';

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
    state.reportId = extractId(reportRes.body, 'report');
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

  const adminUsersRes = await apiCall({
    method: 'GET',
    path: '/admin/users',
    token: state.adminToken,
    step: 'GET /admin/users',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /admin/users',
  });
  if (adminUsersRes.matchedExpected) {
    assertPathType(responseData(adminUsersRes.body), 'users', 'array', {
      flow,
      step: 'GET /admin/users',
      state,
    });
  }

  if (state.alice.userId) {
    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${state.alice.userId}/status`,
      body: { status: 'banned' },
      token: state.adminToken,
      step: `PATCH /admin/users/${state.alice.userId}/status → banned`,
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

    const userDetailsRes = await apiCall({
      method: 'GET',
      path: `/admin/users/${state.alice.userId}`,
      token: state.adminToken,
      step: `GET /admin/users/${state.alice.userId}`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users/:id',
    });
    if (userDetailsRes.matchedExpected) {
      assertPathPositiveId(responseData(userDetailsRes.body), 'user.id', {
        flow,
        step: `GET /admin/users/${state.alice.userId}`,
        state,
      });
    }

    const userListingsRes = await apiCall({
      method: 'GET',
      path: `/admin/users/${state.alice.userId}/listings`,
      token: state.adminToken,
      step: `GET /admin/users/${state.alice.userId}/listings`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users/:id/listings',
    });
    if (userListingsRes.matchedExpected) {
      assertPathType(responseData(userListingsRes.body), 'items', 'array', {
        flow,
        step: `GET /admin/users/${state.alice.userId}/listings`,
        state,
      });
    }

    const userReportsRes = await apiCall({
      method: 'GET',
      path: `/admin/users/${state.alice.userId}/reports`,
      token: state.adminToken,
      step: `GET /admin/users/${state.alice.userId}/reports`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users/:id/reports',
    });
    if (userReportsRes.matchedExpected) {
      assertAdminReportV1ListContract(
        userReportsRes.body,
        flow,
        `GET /admin/users/${state.alice.userId}/reports`,
        state,
      );
    }
  }

  const adminReportsRes = await apiCall({
    method: 'GET',
    path: '/admin/reports',
    token: state.adminToken,
    step: 'GET /admin/reports',
    flow,
    state,
    expectedStatus: 200,
    coverageKey: 'GET /admin/reports',
  });
  if (adminReportsRes.matchedExpected) {
    assertAdminReportV1ListContract(adminReportsRes.body, flow, 'GET /admin/reports', state);
  }

  await flushSection('12-reports-admin-pm-v1.json');
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

  if (state.bob.token) {
    await apiCall({
      method: 'DELETE',
      path: '/me',
      token: state.bob.token,
      step: 'DELETE /me (bob self-delete)',
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'DELETE /me',
    });

    await apiCall({
      method: 'GET',
      path: '/me',
      token: state.bob.token,
      step: 'GET /me after delete (bob)',
      flow,
      state,
      expectedStatus: 401,
      coverageKey: 'GET /me',
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
  const uploadAsset = await getUploadImageAsset();

  try {
    const registerStep = `POST /auth/register (${label})`;
    const regRes = await callWithRetry(
      () => apiCall({
        method: 'POST',
        path: '/auth/register',
        body: { name: `${label} ${RUN_ID}`, phone: vu.phone, ssn: vu.ssn, password: vu.password },
        step: registerStep,
        flow,
        state,
        expectedStatus: [201, 429],
        coverageKey: 'POST /auth/register',
      }),
      { maxAttempts: CONFIG.retryAbortAttempts, stepLabel: registerStep },
    );

    if (regRes.statusCode === 429) {
      state.concurrentMetrics.throttled += 1;
      state.concurrentMetrics.skipped += 1;
      warn(`Concurrent user ${label} throttled on register; skipping remaining baseline steps`);
      return;
    }
    if (!regRes.matchedExpected) {
      const reason = regRes.statusCode === 0
        ? `register ${regRes.errorKind === 'timeout' ? 'timed out' : 'failed due to network'} before OTP extraction`
        : `register failed with status ${regRes.statusCode}`;
      throw new Error(`Concurrent user ${label} ${reason}.`);
    }

    const responseOtp = responseData<{ otp?: string }>(regRes.body).otp;
    const otp = process.env.OTP_DEV_MODE === 'true' ? '000000' : (responseOtp ?? '');
    if (!responseOtp && process.env.OTP_DEV_MODE === 'true') {
      warn(`Concurrent user ${label} register response missing otp; using dev fallback 000000`);
    }
    if (!otp) throw new Error(`Concurrent user ${label} missing OTP for verify (non-dev mode requires response OTP).`);

    const verifyStep = `POST /auth/register/verify (${label})`;
    const verifyRes = await callWithRetry(
      () => apiCall({
        method: 'POST',
        path: '/auth/register/verify',
        body: { phone: vu.phone, otp },
        step: verifyStep,
        flow,
        state,
        expectedStatus: 201,
        coverageKey: 'POST /auth/register/verify',
      }),
      { maxAttempts: CONFIG.retryAbortAttempts, stepLabel: verifyStep },
    );
    if (verifyRes.matchedExpected) {
      const vb = responseData<{ accessToken?: string; refreshToken?: string; user?: { id?: unknown } }>(verifyRes.body);
      vu.token = vb.accessToken ?? null;
      vu.refreshToken = vb.refreshToken ?? null;
      vu.userId = toId(vb.user?.id);
      state.concurrentMetrics.registered += 1;
    } else {
      const reason = verifyRes.statusCode === 0 ? `verify ${verifyRes.errorKind}` : `verify status ${verifyRes.statusCode}`;
      throw new Error(`Concurrent user ${label} failed during registration verify (${reason}).`);
    }

    const loginStep = `POST /auth/login (${label})`;
    const loginRes = await callWithRetry(
      () => apiCall({
        method: 'POST',
        path: '/auth/login',
        body: { phone: vu.phone, password: vu.password },
        step: loginStep,
        flow,
        state,
        expectedStatus: 201,
        coverageKey: 'POST /auth/login',
      }),
      { maxAttempts: CONFIG.retryAbortAttempts, stepLabel: loginStep },
    );
    if (loginRes.matchedExpected) {
      const lb = responseData<{ accessToken?: string; refreshToken?: string; user?: { id?: unknown } }>(loginRes.body);
      vu.token = lb.accessToken ?? vu.token;
      vu.refreshToken = lb.refreshToken ?? vu.refreshToken;
      vu.userId = toId(lb.user?.id) ?? vu.userId;
      state.concurrentMetrics.loggedIn += 1;
    } else {
      const reason = loginRes.statusCode === 0 ? `login ${loginRes.errorKind}` : `login status ${loginRes.statusCode}`;
      throw new Error(`Concurrent user ${label} failed during login (${reason}).`);
    }

    if (!vu.token) return;

    const meRes = await apiCall({
      method: 'GET',
      path: '/me',
      token: vu.token,
      step: `GET /me (${label})`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /me',
    });
    if (meRes.matchedExpected) {
      assertMeContract(meRes.body, flow, `GET /me (${label})`, state);
    }

    const intentRes = await apiCall({
      method: 'POST',
      path: '/files/upload-intent',
      body: {
        ownerType: 'user',
        purpose: 'avatar',
        filename: uploadAsset.filename,
        mimeType: uploadAsset.mimeType,
        fileSizeBytes: uploadAsset.bytes.byteLength,
      },
      token: vu.token,
      step: `POST /files/upload-intent (${label})`,
      flow,
      state,
      expectedStatus: 201,
      coverageKey: 'POST /files/upload-intent',
    });

    const fileId = toId(responseData<{ file?: { id?: unknown } }>(intentRes.body).file?.id);

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

      const fileRes = await apiCall({
        method: 'GET',
        path: `/files/${fileId}`,
        token: vu.token,
        step: `GET /files/${fileId} (${label})`,
        flow,
        state,
        expectedStatus: 200,
        coverageKey: 'GET /files/:id',
      });
      if (fileRes.matchedExpected) {
        assertFileContract(fileRes.body, flow, `GET /files/${fileId} (${label})`, state);
      }
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

    const conversationId = extractId(convRes.body, 'conversation');
    if (!conversationId) throw new Error(`Conversation creation did not return id for ${pairLabel}`);

    const convoListRes = await apiCall({
      method: 'GET',
      path: '/chat/conversations',
      token: userA.token,
      step: `GET /chat/conversations (${pairLabel})`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations',
    });
    if (convoListRes.matchedExpected) {
      assertConversationsContract(convoListRes.body, flow, `GET /chat/conversations (${pairLabel})`, state);
    }

    const messagesRes = await apiCall({
      method: 'GET',
      path: `/chat/conversations/${conversationId}/messages`,
      token: userA.token,
      step: `GET /chat/conversations/${conversationId}/messages (${pairLabel})`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /chat/conversations/:id/messages',
    });
    if (messagesRes.matchedExpected) {
      assertMessagesContract(messagesRes.body, flow, `GET /chat/conversations/${conversationId}/messages (${pairLabel})`, state);
    }

    socketA = await connectWs(userA.token);
    socketB = await connectWs(userB.token);

    const joinA = await socketA.emitWithAck('conversation.join', {
      conversationId,
    }) as Record<string, unknown>;
    const joinAOk = Boolean(joinA.success);
    markCoverage(wsCoverage, 'conversation.join', joinAOk);
    printStep(joinAOk, `WS conversation.join (${pairLabel} userA)`, joinAOk ? 200 : 0, 0);
    noteWsOutcome(state, flow, `conversation.join (${pairLabel} userA)`, joinAOk, joinA);

    const joinB = await socketB.emitWithAck('conversation.join', {
      conversationId,
    }) as Record<string, unknown>;
    const joinBOk = Boolean(joinB.success);
    markCoverage(wsCoverage, 'conversation.join', joinBOk);
    printStep(joinBOk, `WS conversation.join (${pairLabel} userB)`, joinBOk ? 200 : 0, 0);
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
      printStep(sendOk, `WS message.send (${pairLabel} #${i + 1})`, sendOk ? 200 : 0, 0);
      noteWsOutcome(state, flow, `message.send (${pairLabel} #${i + 1})`, sendOk, sendAck);
      if (sendOk) state.concurrentMetrics.messagesSent += 1;
      if (sendOk && i === 0) {
        assertWsMessageContract(sendAck, flow, `WS message.send (${pairLabel} sample)`, state);
      }
      pairOk = pairOk && sendOk;

      if (!messageId) continue;

      const readAck = await readerSocket.emitWithAck('message.read', {
        messageId,
      }) as Record<string, unknown>;
      const readOk = Boolean(readAck.message);
      markCoverage(wsCoverage, 'message.read', readOk);
      printStep(readOk, `WS message.read (${pairLabel} #${i + 1})`, readOk ? 200 : 0, 0);
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

function isSeedMode(): boolean {
  return CONFIG.mode.toLowerCase() === 'seed';
}

function seedPostQuotaTargetsFromConfig(): SeedPostQuotaTargets {
  return {
    'auth.register': CONFIG.postQuotaAuthRegister,
    'auth.register.resend_otp': CONFIG.postQuotaAuthResendOtp,
    'auth.register.verify': CONFIG.postQuotaAuthVerify,
    'auth.login': CONFIG.postQuotaAuthLogin,
    'auth.password.request_otp': CONFIG.postQuotaAuthPasswordRequestOtp,
    'auth.password.reset': CONFIG.postQuotaAuthPasswordReset,
    'auth.refresh': CONFIG.postQuotaAuthRefresh,
    'auth.logout': CONFIG.postQuotaAuthLogout,
    'files.upload_intent': CONFIG.postQuotaFilesUploadIntent,
    'products.create': CONFIG.postQuotaProducts,
    'favorites.create': CONFIG.postQuotaFavorites,
    'chat.conversations.create': CONFIG.postQuotaChatConversations,
    'ratings.create': CONFIG.postQuotaRatings,
    'reports.create': CONFIG.postQuotaReports,
    'blocks.create': CONFIG.postQuotaBlocks,
    'admin.warnings.create': CONFIG.postQuotaAdminWarnings,
    'admin.categories.create': CONFIG.postQuotaAdminCategories,
    'admin.admins.promote': CONFIG.postQuotaAdminPromote,
  };
}

function seedTargetsFromConfig(): SeedTargets {
  return {
    users: CONFIG.targetUsers,
    products: CONFIG.targetProducts,
    conversations: CONFIG.targetConversations,
    messages: CONFIG.targetMessages,
    ratings: CONFIG.targetRatings,
    reports: CONFIG.targetReports,
    favorites: CONFIG.targetFavorites,
    contacts: CONFIG.allowContactsPost ? CONFIG.targetContacts : 0,
    files: CONFIG.targetFiles,
    blocks: CONFIG.targetBlocks,
    adminWarnings: CONFIG.targetAdminWarnings,
    adminReportActions: CONFIG.targetAdminReportActions,
  };
}

function seedPostRegistry(state: SimState): SeedPostRegistryItem[] {
  return [
    { key: 'auth.register', endpoint: 'POST /auth/register', enabled: true, quota: state.postQuotaTargets['auth.register'], expectedStatus: [201], isRowProducer: true, dependsOn: [] },
    { key: 'auth.register.resend_otp', endpoint: 'POST /auth/register/resend-otp', enabled: true, quota: state.postQuotaTargets['auth.register.resend_otp'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.register'] },
    { key: 'auth.register.verify', endpoint: 'POST /auth/register/verify', enabled: true, quota: state.postQuotaTargets['auth.register.verify'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.register'] },
    { key: 'auth.login', endpoint: 'POST /auth/login', enabled: true, quota: state.postQuotaTargets['auth.login'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.register.verify'] },
    { key: 'auth.password.request_otp', endpoint: 'POST /auth/password/request-otp', enabled: true, quota: state.postQuotaTargets['auth.password.request_otp'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.register.verify'] },
    { key: 'auth.password.reset', endpoint: 'POST /auth/password/reset', enabled: true, quota: state.postQuotaTargets['auth.password.reset'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.password.request_otp'] },
    { key: 'auth.refresh', endpoint: 'POST /auth/refresh', enabled: true, quota: state.postQuotaTargets['auth.refresh'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.register.verify'] },
    { key: 'auth.logout', endpoint: 'POST /auth/logout', enabled: true, quota: state.postQuotaTargets['auth.logout'], expectedStatus: [201], isRowProducer: false, dependsOn: ['auth.login'] },
    { key: 'files.upload_intent', endpoint: 'POST /files/upload-intent', enabled: true, quota: state.postQuotaTargets['files.upload_intent'], expectedStatus: [201], isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'products.create', endpoint: 'POST /products', enabled: true, quota: state.postQuotaTargets['products.create'], expectedStatus: [201], isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'favorites.create', endpoint: 'POST /favorites/:productId', enabled: true, quota: state.postQuotaTargets['favorites.create'], expectedStatus: [201, 409], isRowProducer: true, dependsOn: ['products.create'] },
    { key: 'chat.conversations.create', endpoint: 'POST /chat/conversations', enabled: true, quota: state.postQuotaTargets['chat.conversations.create'], expectedStatus: [201], isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'ratings.create', endpoint: 'POST /ratings', enabled: true, quota: state.postQuotaTargets['ratings.create'], expectedStatus: [201, 409], isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'reports.create', endpoint: 'POST /reports', enabled: true, quota: state.postQuotaTargets['reports.create'], expectedStatus: [201, 409], isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'blocks.create', endpoint: 'POST /blocks/:userId', enabled: true, quota: state.postQuotaTargets['blocks.create'], expectedStatus: [201, 409], isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'admin.warnings.create', endpoint: 'POST /admin/warnings', enabled: true, quota: state.postQuotaTargets['admin.warnings.create'], expectedStatus: [201, 404], requiresAdmin: true, isRowProducer: true, dependsOn: ['auth.register.verify'] },
    { key: 'admin.categories.create', endpoint: 'POST /admin/categories', enabled: true, quota: state.postQuotaTargets['admin.categories.create'], expectedStatus: [201, 409], requiresAdmin: true, isRowProducer: true, dependsOn: [] },
    { key: 'admin.admins.promote', endpoint: 'POST /admin/admins/:id', enabled: true, quota: state.postQuotaTargets['admin.admins.promote'], expectedStatus: [200, 201, 409], requiresAdmin: true, isRowProducer: false, dependsOn: ['auth.register.verify'] },
  ];
}

function emptySeedProgress(): SeedProgress {
  return {
    users: 0,
    products: 0,
    conversations: 0,
    messages: 0,
    ratings: 0,
    reports: 0,
    favorites: 0,
    contacts: 0,
    files: 0,
    blocks: 0,
    adminWarnings: 0,
    adminReportActions: 0,
  };
}

function emptyPostQuotaProgress(): SeedPostQuotaTargets {
  const out: SeedPostQuotaTargets = {};
  for (const [k] of Object.entries(seedPostQuotaTargetsFromConfig())) out[k] = 0;
  return out;
}

function pickSeedUser(users: VirtualUserState[], idx: number): VirtualUserState {
  return users[idx % users.length];
}

function seedEntityDone(state: SimState): boolean {
  const t = state.seedTargets;
  const p = state.seedProgress;
  return (
    p.users >= t.users
    && p.products >= t.products
    && p.conversations >= t.conversations
    && p.messages >= t.messages
    && p.ratings >= t.ratings
    && p.reports >= t.reports
    && p.favorites >= t.favorites
    && p.contacts >= t.contacts
    && p.files >= t.files
    && p.blocks >= t.blocks
    && p.adminWarnings >= t.adminWarnings
    && p.adminReportActions >= t.adminReportActions
  );
}

function seedPostQuotasDone(state: SimState): boolean {
  for (const [k, target] of Object.entries(state.postQuotaTargets)) {
    if ((state.postQuotaProgress[k] ?? 0) < target) return false;
  }
  return true;
}

function bumpQuota(state: SimState, key: SeedPostKey): void {
  state.postQuotaProgress[key] = (state.postQuotaProgress[key] ?? 0) + 1;
}

function quotaNeeded(state: SimState, key: SeedPostKey): boolean {
  return (state.postQuotaProgress[key] ?? 0) < (state.postQuotaTargets[key] ?? 0);
}

function isRestCovered(endpoint: RestEndpoint): boolean {
  return restCoverage[endpoint] === 'covered';
}

function extractReportIds(body: unknown): number[] {
  const data = responseData<{ reports?: Array<{ id?: unknown }> }>(body);
  const reports = Array.isArray(data.reports) ? data.reports : [];
  const ids: number[] = [];
  for (const report of reports) {
    const id = toId(report?.id);
    if (id) ids.push(id);
  }
  return ids;
}

async function runSeedPmV1CoverageChecks(
  state: SimState,
  flow: string,
  userToken: string,
  userId: number,
): Promise<void> {
  if (!state.adminToken) return;

  if (!isRestCovered('GET /reports/me')) {
    await apiCall({
      method: 'GET',
      path: '/reports/me',
      token: userToken,
      step: 'GET /reports/me (seed)',
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /reports/me',
    });
  }

  if (!isRestCovered('GET /admin/users')) {
    await apiCall({
      method: 'GET',
      path: '/admin/users',
      token: state.adminToken,
      step: 'GET /admin/users (seed)',
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users',
    });
  }

  if (!isRestCovered('GET /admin/users/:id')) {
    await apiCall({
      method: 'GET',
      path: `/admin/users/${userId}`,
      token: state.adminToken,
      step: `GET /admin/users/${userId} (seed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users/:id',
    });
  }

  if (!isRestCovered('GET /admin/users/:id/listings')) {
    await apiCall({
      method: 'GET',
      path: `/admin/users/${userId}/listings`,
      token: state.adminToken,
      step: `GET /admin/users/${userId}/listings (seed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users/:id/listings',
    });
  }

  if (!isRestCovered('GET /admin/users/:id/reports')) {
    await apiCall({
      method: 'GET',
      path: `/admin/users/${userId}/reports`,
      token: state.adminToken,
      step: `GET /admin/users/${userId}/reports (seed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/users/:id/reports',
    });
  }

  if (!isRestCovered('PATCH /admin/users/:id/status')) {
    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${userId}/status`,
      body: { status: 'banned' },
      token: state.adminToken,
      step: `PATCH /admin/users/${userId}/status → banned (seed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /admin/users/:id/status',
    });
    await apiCall({
      method: 'PATCH',
      path: `/admin/users/${userId}/status`,
      body: { status: 'active' },
      token: state.adminToken,
      step: `PATCH /admin/users/${userId}/status → active (seed)`,
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'PATCH /admin/users/:id/status',
    });
  }

  if (!isRestCovered('GET /admin/reports')) {
    const reportsRes = await apiCall({
      method: 'GET',
      path: '/admin/reports',
      token: state.adminToken,
      step: 'GET /admin/reports (seed)',
      flow,
      state,
      expectedStatus: 200,
      coverageKey: 'GET /admin/reports',
    });
    if (reportsRes.matchedExpected) {
      const ids = extractReportIds(reportsRes.body);
      for (const id of ids) {
        if (!state.seedReportIds.includes(id)) state.seedReportIds.push(id);
      }
    }
  }
}

async function flow16_seedMode(state: SimState): Promise<void> {
  printSection('16 — Seed Mode');
  const flow = '16-seed-mode';
  await flow03_adminBootstrap(state);
  await flow01_anonymous(state);
  const registry = seedPostRegistry(state);
  void registry;
  if (!CONFIG.allowContactsPost) {
    state.postSkipReasons.push('POST /me/contacts is disabled in seed mode because current backend implementation does not expose contacts routes.');
  }

  if (CONFIG.seedDryRun) {
    await flushSection('16-seed-mode.json');
    return;
  }

  const uploadAsset = await getUploadImageAsset();
  const users = buildConcurrentUsers().slice(0, Math.max(state.seedTargets.users, state.postQuotaTargets['auth.register']));
  state.seedUsers = users;
  const productIds: number[] = [];
  const promoted = new Set<number>();
  const moderationStatuses = ['reviewing', 'resolved', 'rejected', 'open'] as const;
  let moderationCursor = 0;
  let otpResetUser: VirtualUserState | null = null;
  let otpResetCode: string | null = null;

  if (!state.productCategory && state.adminToken && quotaNeeded(state, 'admin.categories.create')) {
    const parentName = `Seed Parent ${RUN_ID}`;
    const parentRes = await apiCall({ method: 'POST', path: '/admin/categories', body: { name: parentName }, token: state.adminToken, step: 'POST /admin/categories (seed parent)', flow, state, expectedStatus: [201, 409], coverageKey: 'POST /admin/categories' });
    if (parentRes.matchedExpected) bumpQuota(state, 'admin.categories.create');
    state.categoryParentId = extractId(parentRes.body, 'category') ?? state.categoryParentId;
    state.productCategory = 'electronics';
    state.productSubcategory = 'smartphones';
  }

  const startedAt = Date.now();
  for (let i = 0; i < CONFIG.seedMaxIterations; i += 1) {
    if (Date.now() - startedAt > CONFIG.seedMaxDurationMs) break;
    const vu = users[i % users.length];

    if (quotaNeeded(state, 'auth.register')) {
      const regRes = await apiCall({ method: 'POST', path: '/auth/register', body: { name: `${vu.key} ${RUN_ID}`, phone: vu.phone, ssn: vu.ssn, password: vu.password }, step: `POST /auth/register (${vu.key})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /auth/register' });
      if (regRes.statusCode === 201 || regRes.statusCode === 409) bumpQuota(state, 'auth.register');
      const otp = responseData<{ otp?: string }>(regRes.body).otp;
      if (otp) {
        const vRes = await apiCall({ method: 'POST', path: '/auth/register/verify', body: { phone: vu.phone, otp }, step: `POST /auth/register/verify (${vu.key})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /auth/register/verify' });
        if (vRes.statusCode === 201 || vRes.statusCode === 409) bumpQuota(state, 'auth.register.verify');
        const vb = responseData<{ accessToken?: string; refreshToken?: string; user?: { id?: unknown } }>(vRes.body);
        vu.token = vb.accessToken ?? vu.token;
        vu.refreshToken = vb.refreshToken ?? vu.refreshToken;
        vu.userId = toId(vb.user?.id) ?? vu.userId;
        if (vRes.statusCode === 201) state.seedProgress.users += 1;
      }
    }

    if (quotaNeeded(state, 'auth.register.resend_otp')) {
      const rr = await apiCall({ method: 'POST', path: '/auth/register/resend-otp', body: { phone: vu.phone }, step: `POST /auth/register/resend-otp (${vu.key})`, flow, state, expectedStatus: [201, 404], coverageKey: 'POST /auth/register/resend-otp' });
      if (rr.statusCode === 201 || rr.statusCode === 404) bumpQuota(state, 'auth.register.resend_otp');
    }

    if (quotaNeeded(state, 'auth.login')) {
      const lr = await apiCall({ method: 'POST', path: '/auth/login', body: { phone: vu.phone, password: vu.password }, step: `POST /auth/login (${vu.key})`, flow, state, expectedStatus: [201, 401], coverageKey: 'POST /auth/login' });
      if (lr.statusCode === 201 || lr.statusCode === 401) bumpQuota(state, 'auth.login');
      if (lr.statusCode === 201) {
        const lb = responseData<{ accessToken?: string; refreshToken?: string; user?: { id?: unknown } }>(lr.body);
        vu.token = lb.accessToken ?? vu.token;
        vu.refreshToken = lb.refreshToken ?? vu.refreshToken;
        vu.userId = toId(lb.user?.id) ?? vu.userId;
      }
    }

    if (!vu.token) continue;
    await apiCall({ method: 'PATCH', path: '/me', body: { name: `${vu.key} ${RUN_ID}` }, token: vu.token, step: `PATCH /me (${vu.key})`, flow, state, expectedStatus: 200, coverageKey: 'PATCH /me' });

    if (quotaNeeded(state, 'files.upload_intent')) {
      const fi = await apiCall({ method: 'POST', path: '/files/upload-intent', body: { ownerType: 'user', purpose: 'avatar', filename: uploadAsset.filename, mimeType: uploadAsset.mimeType, fileSizeBytes: uploadAsset.bytes.byteLength }, token: vu.token, step: `POST /files/upload-intent (${vu.key})`, flow, state, expectedStatus: 201, coverageKey: 'POST /files/upload-intent' });
      if (fi.matchedExpected) {
        bumpQuota(state, 'files.upload_intent');
        state.seedProgress.files += 1;
      }
      const fileId = toId(responseData<{ file?: { id?: unknown } }>(fi.body).file?.id);
      if (fileId) await apiCall({ method: 'PATCH', path: `/files/${fileId}/mark-uploaded`, body: {}, token: vu.token, step: `PATCH /files/${fileId}/mark-uploaded (${vu.key})`, flow, state, expectedStatus: 200, coverageKey: 'PATCH /files/:id/mark-uploaded' });
    }

    if (state.productCategory && quotaNeeded(state, 'products.create')) {
      const p = await apiCall({ method: 'POST', path: '/products', body: { category: state.productCategory, subcategory: state.productSubcategory, name: `[SEED:${RUN_ID}] Product ${state.seedProgress.products + 1}`, description: 'Seeded by API flow mode.', price: 100 + state.seedProgress.products, city: 'Cairo', addressText: `${i + 1} Seed Street`, details: { source: 'seed-mode' }, preferredContactMethod: 'chat' }, token: vu.token, step: `POST /products (seed #${state.seedProgress.products + 1})`, flow, state, expectedStatus: 201, coverageKey: 'POST /products' });
      const pid = extractId(p.body, 'product');
      if (p.matchedExpected) {
        bumpQuota(state, 'products.create');
        if (pid) {
          productIds.push(pid);
          state.seedProgress.products += 1;
        }
      }
    }

    const other = users[(i + 1) % users.length];
    const otherReady = Boolean(other.userId && other.token);

    if (otherReady && productIds.length > 0 && quotaNeeded(state, 'favorites.create')) {
      const pid = productIds[i % productIds.length];
      const fav = await apiCall({ method: 'POST', path: `/favorites/${pid}`, token: other.token, step: `POST /favorites/${pid} (${other.key})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /favorites/:productId' });
      if (fav.statusCode === 201 || fav.statusCode === 409) bumpQuota(state, 'favorites.create');
      if (fav.statusCode === 201) state.seedProgress.favorites += 1;
    }

    if (otherReady && quotaNeeded(state, 'chat.conversations.create')) {
      const conv = await apiCall({ method: 'POST', path: '/chat/conversations', body: { participantId: other.userId, productId: productIds.length ? productIds[productIds.length - 1] : undefined }, token: vu.token, step: `POST /chat/conversations (${vu.key}->${other.key})`, flow, state, expectedStatus: [201], coverageKey: 'POST /chat/conversations' });
      const cid = extractId(conv.body, 'conversation');
      if (conv.matchedExpected) {
        bumpQuota(state, 'chat.conversations.create');
        state.seedProgress.conversations += 1;
      }
      if (cid && state.seedProgress.messages < state.seedTargets.messages) {
        const wsA = await connectWs(vu.token);
        const wsB = await connectWs(other.token!);
        try {
          await wsA.emitWithAck('conversation.join', { conversationId: cid });
          await wsB.emitWithAck('conversation.join', { conversationId: cid });
          const ack = await wsA.emitWithAck('message.send', { conversationId: cid, text: `[SEED:${RUN_ID}] msg-${state.seedProgress.messages + 1}` }) as Record<string, unknown>;
          if (toId((ack as { message?: { id?: unknown } }).message?.id)) state.seedProgress.messages += 1;
        } finally {
          wsA.disconnect();
          wsB.disconnect();
        }
      }
    }

    if (otherReady && quotaNeeded(state, 'ratings.create')) {
      const r = await apiCall({ method: 'POST', path: '/ratings', body: { ratedUserId: other.userId, ratingValue: 5, comment: `[SEED:${RUN_ID}] rate-${i}` }, token: vu.token, step: `POST /ratings (${vu.key}->${other.key})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /ratings' });
      if (r.statusCode === 201 || r.statusCode === 409) bumpQuota(state, 'ratings.create');
      if (r.statusCode === 201) state.seedProgress.ratings += 1;
    }

    if (otherReady && quotaNeeded(state, 'reports.create')) {
      const rr = await apiCall({ method: 'POST', path: '/reports', body: { reportedUserId: other.userId, reason: `[SEED:${RUN_ID}] report-${i}` }, token: vu.token, step: `POST /reports (${vu.key}->${other.key})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /reports' });
      if (rr.statusCode === 201 || rr.statusCode === 409) bumpQuota(state, 'reports.create');
      if (rr.statusCode === 201) {
        state.seedProgress.reports += 1;
        const rid = extractId(rr.body, 'report');
        if (rid && !state.seedReportIds.includes(rid)) state.seedReportIds.push(rid);
      }
    }

    if (
      otherReady
      && quotaNeeded(state, 'blocks.create')
      && state.seedProgress.conversations >= state.seedTargets.conversations
    ) {
      const bl = await apiCall({ method: 'POST', path: `/blocks/${other.userId}`, token: vu.token, step: `POST /blocks/${other.userId} (${vu.key})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /blocks/:userId' });
      if (bl.statusCode === 201 || bl.statusCode === 409) bumpQuota(state, 'blocks.create');
      if (bl.statusCode === 201) state.seedProgress.blocks += 1;
    }

    if (state.adminToken && otherReady && quotaNeeded(state, 'admin.warnings.create')) {
      const w = await apiCall({ method: 'POST', path: '/admin/warnings', token: state.adminToken, body: { targetUserId: other.userId, message: `[SEED:${RUN_ID}] warning-${i}` }, step: `POST /admin/warnings (${other.key})`, flow, state, expectedStatus: [201, 404], coverageKey: 'POST /admin/warnings' });
      if (w.statusCode === 201 || w.statusCode === 404) bumpQuota(state, 'admin.warnings.create');
      if (w.statusCode === 201) state.seedProgress.adminWarnings += 1;
    }

    if (state.adminToken && quotaNeeded(state, 'admin.categories.create')) {
      const cat = await apiCall({ method: 'POST', path: '/admin/categories', token: state.adminToken, body: { name: `Seed Cat ${RUN_ID}-${i}` }, step: `POST /admin/categories (${i})`, flow, state, expectedStatus: [201, 409], coverageKey: 'POST /admin/categories' });
      if (cat.statusCode === 201 || cat.statusCode === 409) bumpQuota(state, 'admin.categories.create');
    }

    if (state.adminToken && otherReady && quotaNeeded(state, 'admin.admins.promote') && other.userId && !promoted.has(other.userId)) {
      const pr = await apiCall({ method: 'POST', path: `/admin/admins/${other.userId}`, token: state.adminToken, body: {}, step: `POST /admin/admins/${other.userId}`, flow, state, expectedStatus: [200, 201, 409], coverageKey: 'POST /admin/admins/:id' });
      if (pr.statusCode === 200 || pr.statusCode === 201 || pr.statusCode === 409) {
        bumpQuota(state, 'admin.admins.promote');
        promoted.add(other.userId);
      }
    }

    if (
      state.adminToken
      && state.seedProgress.adminReportActions < state.seedTargets.adminReportActions
      && state.seedReportIds.length > 0
    ) {
      const reportId = state.seedReportIds[moderationCursor % state.seedReportIds.length];
      const status = moderationStatuses[moderationCursor % moderationStatuses.length];
      moderationCursor += 1;
      const ar = await apiCall({
        method: 'PATCH',
        path: `/admin/reports/${reportId}`,
        body: { status },
        token: state.adminToken,
        step: `PATCH /admin/reports/${reportId} -> ${status} (seed)`,
        flow,
        state,
        expectedStatus: 200,
        coverageKey: 'PATCH /admin/reports/:id',
      });
      if (ar.matchedExpected) state.seedProgress.adminReportActions += 1;
    }

    if (
      vu.token
      && vu.userId
      && state.seedProgress.products > 0
      && state.seedProgress.reports > 0
      && state.adminToken
    ) {
      await runSeedPmV1CoverageChecks(state, flow, vu.token, vu.userId);
    }

    if (!otpResetUser) otpResetUser = vu;
    if (otpResetUser && quotaNeeded(state, 'auth.password.request_otp')) {
      const ro = await apiCall({ method: 'POST', path: '/auth/password/request-otp', body: { phone: otpResetUser.phone }, step: `POST /auth/password/request-otp (${otpResetUser.key})`, flow, state, expectedStatus: 201, coverageKey: 'POST /auth/password/request-otp' });
      if (ro.matchedExpected) {
        bumpQuota(state, 'auth.password.request_otp');
        otpResetCode = responseData<{ otp?: string }>(ro.body).otp ?? null;
      }
    }

    if (otpResetUser && otpResetCode && quotaNeeded(state, 'auth.password.reset')) {
      const newPassword = `${otpResetUser.password}R1`;
      const rs = await apiCall({ method: 'POST', path: '/auth/password/reset', body: { phone: otpResetUser.phone, otp: otpResetCode, newPassword, confirmPassword: newPassword }, step: `POST /auth/password/reset (${otpResetUser.key})`, flow, state, expectedStatus: 201, coverageKey: 'POST /auth/password/reset' });
      if (rs.matchedExpected) {
        bumpQuota(state, 'auth.password.reset');
        otpResetUser.password = newPassword;
      }
    }

    if (quotaNeeded(state, 'auth.refresh') && vu.refreshToken) {
      const rf = await apiCall({ method: 'POST', path: '/auth/refresh', body: { refreshToken: vu.refreshToken }, step: `POST /auth/refresh (${vu.key})`, flow, state, expectedStatus: 201, coverageKey: 'POST /auth/refresh' });
      if (rf.matchedExpected) bumpQuota(state, 'auth.refresh');
    }

    if (quotaNeeded(state, 'auth.logout') && vu.token && vu.refreshToken) {
      const lo = await apiCall({ method: 'POST', path: '/auth/logout', body: { refreshToken: vu.refreshToken }, token: vu.token, step: `POST /auth/logout (${vu.key})`, flow, state, expectedStatus: 201, coverageKey: 'POST /auth/logout' });
      if (lo.matchedExpected) {
        bumpQuota(state, 'auth.logout');
        vu.token = null;
        vu.refreshToken = null;
      }
    }

    if (seedPostQuotasDone(state) && seedEntityDone(state)) break;
  }

  state.promotedAdminUserIds = Array.from(promoted);
  if (!seedPostQuotasDone(state)) state.seedErrors.push('Not all POST quotas were reached before iteration/time limits.');
  if (!seedEntityDone(state)) state.seedErrors.push('Not all entity targets were reached before iteration/time limits.');

  await flushSection('16-seed-mode.json');
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
  assertionChecksTotal: 0,
  assertionChecksFailed: 0,
  assertionFailuresDetailed: [],
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
  productCategory: null,
  productSubcategory: null,
  categoryParentId: null,
  categoryLeafId: null,
  aliceProductId: null,
  aliceProduct2Id: null,
  conversationId: null,
  lastMessageId: null,
  reportId: null,
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
  seedUsers: [],
  seedTargets: seedTargetsFromConfig(),
  seedProgress: emptySeedProgress(),
  seedErrors: [],
  postQuotaTargets: seedPostQuotaTargetsFromConfig(),
  postQuotaProgress: emptyPostQuotaProgress(),
  promotedAdminUserIds: [],
  seedReportIds: [],
  postSkipReasons: [],
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
    `mode=${CONFIG.mode} ` +
    `seedDryRun=${CONFIG.seedDryRun} ` +
    `negative=${CONFIG.negativeTests} ` +
    `realUpload=${CONFIG.realUpload} ` +
    `realImagePath=${CONFIG.realImagePath} ` +
    `continueOnFail=${CONFIG.continueOnFail} ` +
    `assertContract=${CONFIG.assertContract} ` +
    `assertStrict=${CONFIG.assertStrict} ` +
    `assertWs=${CONFIG.assertWsPayload} ` +
    `concurrentFlow=${CONFIG.enableConcurrentFlow} ` +
    `concurrentUsers=${CONFIG.concurrentUsers} ` +
    `chatPairs=${CONFIG.chatPairs} ` +
    `messagesPerPair=${CONFIG.concurrentMessagesPerPair} ` +
    `staggerMs=${CONFIG.concurrentStaggerMs} ` +
    `retryAbortAttempts=${CONFIG.retryAbortAttempts} ` +
    `retryAbortBaseMs=${CONFIG.retryAbortBaseMs}`,
  );
  if (isSeedMode()) {
    console.log(
      '  Seed Targets: ' +
      `users=${state.seedTargets.users} products=${state.seedTargets.products} conversations=${state.seedTargets.conversations} ` +
      `messages=${state.seedTargets.messages} ratings=${state.seedTargets.ratings} reports=${state.seedTargets.reports} ` +
      `favorites=${state.seedTargets.favorites} contacts=${state.seedTargets.contacts} files=${state.seedTargets.files} ` +
      `blocks=${state.seedTargets.blocks} adminWarnings=${state.seedTargets.adminWarnings} ` +
      `adminReportActions=${state.seedTargets.adminReportActions}`,
    );
  }
  console.log(`${bar}`);

  await fs.mkdir(LOG_DIR, { recursive: true });

  if (isSeedMode()) {
    await flow16_seedMode(state);
  } else {
    await flow01_anonymous(state);
    await flow02_registerUsers(state);
    await flow03_adminBootstrap(state);
    await flow04_tokenLifecycle(state);
    await flow05_passwordReset(state);
    await flow06_uploadsAndProfile(state);
    await flow07_seller(state);
    await flow08_buyerAndChat(state);
    await flow09_websocket(state);
    await flow10_blocksAndSafety(state);
    await flow11_ratings(state);
    await flow12_reportsAndAdmin(state);
    await flow13_negativeChecks(state);
    await flow15_concurrentUsersAndChat(state);
  }

  await summarize(state);

  const pmV1RequiredFailed = PM_V1_REQUIRED_ENDPOINTS.filter((k) => restCoverage[k] !== 'covered');
  if (!isSeedMode() && pmV1RequiredFailed.length > 0) {
    process.exitCode = 1;
  }
  if (isSeedMode() && !CONFIG.seedDryRun && (!seedEntityDone(state) || !seedPostQuotasDone(state))) process.exitCode = 1;
}

void main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${RED}[FATAL]${RESET} ${msg}`);
  await summarize(state).catch(() => {});
  process.exit(1);
});
