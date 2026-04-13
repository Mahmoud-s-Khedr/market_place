import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { io, Socket } from 'socket.io-client';
import { ADMIN_PASSWORD_REGEX, ADMIN_PHONE_REGEX } from '../admin/admin-seeder';

const DEV_PROFILE = 'medium';
const DEFAULT_BASE_URL = 'http://localhost';
const DEFAULT_TIMEOUT_MS = 12_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 4;
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type ProductStatus = 'available' | 'sold' | 'archived';
type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';
type UserStatus = 'active' | 'paused' | 'banned';

export type DevSeedInput = {
  baseUrl: string;
  adminPhone: string;
  adminPassword: string;
  profile: typeof DEV_PROFILE;
  timeoutMs: number;
};

type RequestResult<T> = {
  statusCode: number;
  body: T;
};

type ApiCallLog = {
  method: HttpMethod;
  path: string;
  statusCode: number;
  durationMs: number;
  attempts: number;
  retried: boolean;
  requestBody: unknown;
  responseBody: unknown;
};

type SeedUserDef = {
  key: string;
  name: string;
  phone: string;
  ssn: string;
  password: string;
  city: string;
  address: string;
};

type SeedUserSession = {
  def: SeedUserDef;
  id: number;
  accessToken: string;
  refreshToken: string;
  created: boolean;
};

type CategoryDef = {
  key: string;
  name: string;
  parentKey: string | null;
};

type ProductDef = {
  key: string;
  ownerKey: string;
  categoryKey: string;
  name: string;
  description: string;
  price: number;
  city: string;
  addressText: string;
  status: ProductStatus;
};

type RatingDef = {
  key: string;
  raterKey: string;
  ratedKey: string;
  value: number;
  comment: string;
};

type ConversationDef = {
  key: string;
  a: string;
  b: string;
};

type ReportDef = {
  key: string;
  reporterKey: string;
  reportedKey: string;
  reason: string;
  targetStatus: ReportStatus;
};

type UserStateTarget = {
  key: string;
  status: UserStatus;
  warningMessage: string;
};

type EntityRecord = {
  id: number;
  state: 'created' | 'reused' | 'updated';
};

type SeedEntityMap = {
  users: Record<string, EntityRecord>;
  categories: Record<string, EntityRecord>;
  products: Record<string, EntityRecord>;
  conversations: Record<string, EntityRecord>;
  reports: Record<string, EntityRecord>;
  warnings: Record<string, EntityRecord>;
};

type SeedSummary = {
  runAt: string;
  baseUrl: string;
  profile: string;
  users: number;
  categories: number;
  products: {
    total: number;
    available: number;
    sold: number;
    archived: number;
  };
  conversations: {
    total: number;
    seededMessages: number;
  };
  ratings: number;
  reports: {
    total: number;
    byStatus: Record<ReportStatus, number>;
  };
  userStatuses: Record<UserStatus, number>;
};

type SeedRunArtifacts = {
  logDir: string;
  summary: SeedSummary;
};

type ApiErrorContext = {
  statusCode: number;
  body: unknown;
  path: string;
};

class ApiError extends Error {
  readonly context: ApiErrorContext;

  constructor(message: string, context: ApiErrorContext) {
    super(message);
    this.name = 'ApiError';
    this.context = context;
  }
}

function ensureString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : [];
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRetryableStatus(statusCode: number): boolean {
  return RETRYABLE_STATUSES.has(statusCode);
}

function delayMs(attempt: number): number {
  return 250 * 2 ** (attempt - 1);
}

export function parseDevSeedInput(env: NodeJS.ProcessEnv): DevSeedInput {
  const baseUrl = (env.BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  const adminPhone = (env.ADMIN_PHONE ?? '').trim();
  const adminPassword = env.ADMIN_PASSWORD ?? '';
  const profile = (env.SEED_PROFILE ?? DEV_PROFILE).trim();
  const timeoutRaw = (env.SEED_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS)).trim();

  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    throw new Error('BASE_URL must start with http:// or https://');
  }
  if (!adminPhone) {
    throw new Error('ADMIN_PHONE is required');
  }
  if (!ADMIN_PHONE_REGEX.test(adminPhone)) {
    throw new Error('ADMIN_PHONE must be a valid E.164-like phone number');
  }
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is required');
  }
  if (adminPassword.length < 8 || adminPassword.length > 64 || !ADMIN_PASSWORD_REGEX.test(adminPassword)) {
    throw new Error('ADMIN_PASSWORD must be 8-64 chars and contain letters and numbers');
  }
  if (profile !== DEV_PROFILE) {
    throw new Error(`SEED_PROFILE must be "${DEV_PROFILE}" for this version`);
  }

  const timeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error('SEED_TIMEOUT_MS must be a number between 1000 and 120000');
  }

  return {
    baseUrl,
    adminPhone,
    adminPassword,
    profile: DEV_PROFILE,
    timeoutMs,
  };
}

export class SeedApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logs: ApiCallLog[] = [];
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(input: { baseUrl: string; timeoutMs: number; sleepFn?: (ms: number) => Promise<void> }) {
    this.baseUrl = input.baseUrl;
    this.timeoutMs = input.timeoutMs;
    this.sleepFn = input.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get callLogs(): ApiCallLog[] {
    return this.logs;
  }

  async request<T>(
    method: HttpMethod,
    endpoint: string,
    options?: {
      token?: string;
      body?: unknown;
      expectedStatuses?: number[];
      retryable?: boolean;
    },
  ): Promise<RequestResult<T>> {
    const expectedStatuses = options?.expectedStatuses ?? [200, 201];
    const retryable = options?.retryable ?? true;
    let attempts = 0;
    let lastNetworkError = '';

    while (attempts < RETRY_ATTEMPTS) {
      attempts += 1;
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let statusCode = 0;
      let parsedBody: unknown = null;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (options?.token) {
          headers.Authorization = `Bearer ${options.token}`;
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method,
          headers,
          body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        statusCode = response.status;
        const raw = await response.text();
        try {
          parsedBody = raw ? JSON.parse(raw) : {};
        } catch {
          parsedBody = { raw };
        }

        const durationMs = Date.now() - start;
        this.logs.push({
          method,
          path: endpoint,
          statusCode,
          durationMs,
          attempts,
          retried: attempts > 1,
          requestBody: options?.body ?? null,
          responseBody: parsedBody,
        });

        if (expectedStatuses.includes(statusCode)) {
          return { statusCode, body: parsedBody as T };
        }

        if (retryable && attempts < RETRY_ATTEMPTS && isRetryableStatus(statusCode)) {
          await this.sleepFn(delayMs(attempts));
          continue;
        }

        throw new ApiError(`HTTP ${statusCode} on ${method} ${endpoint}`, {
          statusCode,
          body: parsedBody,
          path: endpoint,
        });
      } catch (error) {
        const durationMs = Date.now() - start;
        clearTimeout(timeout);

        if (error instanceof ApiError) {
          throw error;
        }

        lastNetworkError = error instanceof Error ? error.message : String(error);
        this.logs.push({
          method,
          path: endpoint,
          statusCode,
          durationMs,
          attempts,
          retried: attempts > 1,
          requestBody: options?.body ?? null,
          responseBody: { error: lastNetworkError },
        });

        if (!retryable || attempts >= RETRY_ATTEMPTS) {
          throw new Error(`Network failure on ${method} ${endpoint}: ${lastNetworkError}`);
        }

        await this.sleepFn(delayMs(attempts));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`Network failure on ${method} ${endpoint}: ${lastNetworkError}`);
  }
}

const DEV_USERS: SeedUserDef[] = [
  {
    key: 'user01',
    name: 'DEV User 01',
    phone: '+201550000101',
    ssn: 'DEV10001',
    password: 'DevUser01123',
    city: 'Cairo',
    address: 'Nasr City Block A',
  },
  {
    key: 'user02',
    name: 'DEV User 02',
    phone: '+201550000102',
    ssn: 'DEV10002',
    password: 'DevUser02123',
    city: 'Giza',
    address: 'Dokki District 2',
  },
  {
    key: 'user03',
    name: 'DEV User 03',
    phone: '+201550000103',
    ssn: 'DEV10003',
    password: 'DevUser03123',
    city: 'Alexandria',
    address: 'Sidi Gaber Area',
  },
  {
    key: 'user04',
    name: 'DEV User 04',
    phone: '+201550000104',
    ssn: 'DEV10004',
    password: 'DevUser04123',
    city: 'Mansoura',
    address: 'University Street 4',
  },
  {
    key: 'user05',
    name: 'DEV User 05',
    phone: '+201550000105',
    ssn: 'DEV10005',
    password: 'DevUser05123',
    city: 'Tanta',
    address: 'Central Market Road',
  },
  {
    key: 'user06',
    name: 'DEV User 06',
    phone: '+201550000106',
    ssn: 'DEV10006',
    password: 'DevUser06123',
    city: 'Ismailia',
    address: 'Canal View 6',
  },
  {
    key: 'user07',
    name: 'DEV User 07',
    phone: '+201550000107',
    ssn: 'DEV10007',
    password: 'DevUser07123',
    city: 'Asyut',
    address: 'El Gomhoureya Street 7',
  },
  {
    key: 'user08',
    name: 'DEV User 08',
    phone: '+201550000108',
    ssn: 'DEV10008',
    password: 'DevUser08123',
    city: 'Luxor',
    address: 'Karnak Road 8',
  },
];

const DEV_CATEGORIES: CategoryDef[] = [
  { key: 'root-electronics', name: '[DEV] Electronics', parentKey: null },
  { key: 'root-fashion', name: '[DEV] Fashion', parentKey: null },
  { key: 'root-home', name: '[DEV] Home', parentKey: null },
  { key: 'leaf-phones', name: '[DEV] Mobile Phones', parentKey: 'root-electronics' },
  { key: 'leaf-laptops', name: '[DEV] Laptops', parentKey: 'root-electronics' },
  { key: 'leaf-men', name: '[DEV] Men Clothing', parentKey: 'root-fashion' },
  { key: 'leaf-women', name: '[DEV] Women Clothing', parentKey: 'root-fashion' },
  { key: 'leaf-furniture', name: '[DEV] Furniture', parentKey: 'root-home' },
  { key: 'leaf-appliances', name: '[DEV] Appliances', parentKey: 'root-home' },
];

const PRODUCT_STATUS_MATRIX: Record<string, ProductStatus[]> = {
  user01: ['available', 'sold', 'archived'],
  user02: ['available', 'available', 'sold'],
  user03: ['available', 'available', 'archived'],
  user04: ['available', 'sold', 'available'],
  user05: ['available', 'available', 'archived'],
  user06: ['sold', 'available', 'available'],
  user07: ['archived', 'available', 'sold'],
  user08: ['available', 'available', 'sold'],
};

const RATING_DEFS: RatingDef[] = [
  { key: 'rate-01', raterKey: 'user01', ratedKey: 'user02', value: 5, comment: '[DEV-SEED:rate-01] Great buyer' },
  { key: 'rate-02', raterKey: 'user02', ratedKey: 'user01', value: 4, comment: '[DEV-SEED:rate-02] Smooth trade' },
  { key: 'rate-03', raterKey: 'user03', ratedKey: 'user04', value: 5, comment: '[DEV-SEED:rate-03] Excellent seller' },
  { key: 'rate-04', raterKey: 'user04', ratedKey: 'user03', value: 3, comment: '[DEV-SEED:rate-04] Item acceptable' },
  { key: 'rate-05', raterKey: 'user05', ratedKey: 'user06', value: 4, comment: '[DEV-SEED:rate-05] Good communication' },
  { key: 'rate-06', raterKey: 'user06', ratedKey: 'user05', value: 5, comment: '[DEV-SEED:rate-06] Fast payment' },
  { key: 'rate-07', raterKey: 'user07', ratedKey: 'user08', value: 2, comment: '[DEV-SEED:rate-07] Late responses' },
  { key: 'rate-08', raterKey: 'user08', ratedKey: 'user07', value: 4, comment: '[DEV-SEED:rate-08] Resolved quickly' },
  { key: 'rate-09', raterKey: 'user01', ratedKey: 'user03', value: 5, comment: '[DEV-SEED:rate-09] Trusted seller' },
  { key: 'rate-10', raterKey: 'user02', ratedKey: 'user04', value: 4, comment: '[DEV-SEED:rate-10] Good quality' },
  { key: 'rate-11', raterKey: 'user03', ratedKey: 'user05', value: 3, comment: '[DEV-SEED:rate-11] Average experience' },
  { key: 'rate-12', raterKey: 'user04', ratedKey: 'user06', value: 5, comment: '[DEV-SEED:rate-12] Highly recommended' },
];

const CONVERSATION_DEFS: ConversationDef[] = [
  { key: 'chat-01', a: 'user01', b: 'user02' },
  { key: 'chat-02', a: 'user03', b: 'user04' },
  { key: 'chat-03', a: 'user05', b: 'user06' },
  { key: 'chat-04', a: 'user07', b: 'user08' },
  { key: 'chat-05', a: 'user01', b: 'user05' },
  { key: 'chat-06', a: 'user02', b: 'user06' },
];

const REPORT_DEFS: ReportDef[] = [
  {
    key: 'report-01',
    reporterKey: 'user01',
    reportedKey: 'user07',
    reason: '[DEV-SEED:report-01] Repeated abusive language in chat',
    targetStatus: 'open',
  },
  {
    key: 'report-02',
    reporterKey: 'user02',
    reportedKey: 'user08',
    reason: '[DEV-SEED:report-02] Suspicious listing details mismatch',
    targetStatus: 'reviewing',
  },
  {
    key: 'report-03',
    reporterKey: 'user03',
    reportedKey: 'user07',
    reason: '[DEV-SEED:report-03] Spam behavior observed in marketplace',
    targetStatus: 'resolved',
  },
  {
    key: 'report-04',
    reporterKey: 'user04',
    reportedKey: 'user08',
    reason: '[DEV-SEED:report-04] Item authenticity concern raised',
    targetStatus: 'rejected',
  },
  {
    key: 'report-05',
    reporterKey: 'user05',
    reportedKey: 'user07',
    reason: '[DEV-SEED:report-05] Harassing follow-up messages',
    targetStatus: 'resolved',
  },
  {
    key: 'report-06',
    reporterKey: 'user06',
    reportedKey: 'user08',
    reason: '[DEV-SEED:report-06] Payment proof appears manipulated',
    targetStatus: 'reviewing',
  },
];

const USER_STATUS_TARGETS: UserStateTarget[] = [
  {
    key: 'user07',
    status: 'paused',
    warningMessage: '[DEV-SEED:warning-user07] Account paused due to repeated conduct violations',
  },
  {
    key: 'user08',
    status: 'banned',
    warningMessage: '[DEV-SEED:warning-user08] Account banned due to severe policy breach',
  },
];

function buildProductDefs(): ProductDef[] {
  const leafCycle = ['leaf-phones', 'leaf-laptops', 'leaf-men', 'leaf-women', 'leaf-furniture', 'leaf-appliances'];
  const defs: ProductDef[] = [];
  let categoryIndex = 0;
  let globalIndex = 0;

  for (const user of DEV_USERS) {
    const statuses = PRODUCT_STATUS_MATRIX[user.key];
    for (let i = 0; i < 3; i += 1) {
      globalIndex += 1;
      const key = `${user.key}-product-${i + 1}`;
      const categoryKey = leafCycle[categoryIndex % leafCycle.length];
      categoryIndex += 1;

      defs.push({
        key,
        ownerKey: user.key,
        categoryKey,
        name: `[DEV-SEED:${key}] Marketplace Item ${globalIndex}`,
        description: `[DEV-SEED:${key}] Deterministic seeded listing for ${user.key}`,
        price: 100 + globalIndex * 13,
        city: user.city,
        addressText: `[DEV-SEED:${key}] ${user.address}`,
        status: statuses[i],
      });
    }
  }

  return defs;
}

const PRODUCT_DEFS = buildProductDefs();

type WsAck<T> = {
  data: T;
};

function wsEmitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<WsAck<T>> {
  return new Promise((resolve, reject) => {
    socket.timeout(8_000).emit(event, payload, (error: Error | null, response: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ data: response });
    });
  });
}

async function connectChatSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('WebSocket connection timeout'));
    }, 8_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function performPreflightChecks(
  api: SeedApiClient,
  input: DevSeedInput,
): Promise<{ adminToken: string; adminUserId: number }> {
  await api.request('GET', '/health/live', { expectedStatuses: [200], retryable: false });
  await api.request('GET', '/health/ready', { expectedStatuses: [200], retryable: false });

  let adminLogin: RequestResult<unknown>;
  try {
    adminLogin = await api.request('POST', '/auth/login', {
      body: { phone: input.adminPhone, password: input.adminPassword },
      expectedStatuses: [201],
      retryable: false,
    });
  } catch (error) {
    if (error instanceof ApiError && error.context.statusCode === 401) {
      throw new Error('Admin login failed. Seed admin first with `npm run seed:admin`.');
    }
    throw error;
  }

  const loginBody = getObject(adminLogin.body);
  const adminToken = ensureString(loginBody.accessToken);
  const user = getObject(loginBody.user);
  const adminUserId = Number(user.id);

  if (!adminToken || !Number.isInteger(adminUserId) || adminUserId <= 0) {
    throw new Error('Admin login response missing access token or user id');
  }

  return { adminToken, adminUserId };
}

async function ensureUser(
  api: SeedApiClient,
  user: SeedUserDef,
  requireOtpVisibility: boolean,
): Promise<SeedUserSession> {
  try {
    const login = await api.request('POST', '/auth/login', {
      body: { phone: user.phone, password: user.password },
      expectedStatuses: [201],
      retryable: false,
    });
    const body = getObject(login.body);
    const authUser = getObject(body.user);
    const accessToken = ensureString(body.accessToken);
    const refreshToken = ensureString(body.refreshToken);
    const userId = Number(authUser.id);

    if (!accessToken || !refreshToken || !Number.isInteger(userId) || userId <= 0) {
      throw new Error(`Invalid login response for ${user.key}`);
    }

    return {
      def: user,
      id: userId,
      accessToken,
      refreshToken,
      created: false,
    };
  } catch (error) {
    if (error instanceof ApiError && error.context.statusCode !== 401) {
      throw error;
    }
  }

  const register = await api.request('POST', '/auth/register', {
    body: {
      name: user.name,
      ssn: user.ssn,
      phone: user.phone,
      password: user.password,
    },
    expectedStatuses: [201],
  });

  const registerBody = getObject(register.body);
  const otp = ensureString(registerBody.otp);
  if (requireOtpVisibility && !otp) {
    throw new Error('OTP_DEV_MODE check failed: /auth/register did not return otp. Set OTP_DEV_MODE=true on server.');
  }

  if (!otp) {
    throw new Error(`Registration OTP missing for ${user.key}. Ensure OTP_DEV_MODE=true on server.`);
  }

  const verify = await api.request('POST', '/auth/register/verify', {
    body: {
      phone: user.phone,
      otp,
    },
    expectedStatuses: [201],
  });

  const body = getObject(verify.body);
  const authUser = getObject(body.user);
  const accessToken = ensureString(body.accessToken);
  const refreshToken = ensureString(body.refreshToken);
  const userId = Number(authUser.id);

  if (!accessToken || !refreshToken || !Number.isInteger(userId) || userId <= 0) {
    throw new Error(`Invalid register verify response for ${user.key}`);
  }

  return {
    def: user,
    id: userId,
    accessToken,
    refreshToken,
    created: true,
  };
}

async function upsertCategories(
  api: SeedApiClient,
  adminToken: string,
  entityMap: SeedEntityMap,
): Promise<Record<string, number>> {
  const idsByKey: Record<string, number> = {};

  for (const category of DEV_CATEGORIES) {
    const parentId = category.parentKey ? idsByKey[category.parentKey] : null;

    try {
      const create = await api.request('POST', '/admin/categories', {
        token: adminToken,
        body: {
          name: category.name,
          ...(parentId ? { parentId } : {}),
        },
        expectedStatuses: [201],
      });

      const row = getObject(getObject(create.body).category);
      const categoryId = Number(row.id);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        throw new Error(`Invalid category response for ${category.key}`);
      }

      idsByKey[category.key] = categoryId;
      entityMap.categories[category.key] = { id: categoryId, state: 'created' };
      continue;
    } catch (error) {
      if (!(error instanceof ApiError) || error.context.statusCode !== 409) {
        throw error;
      }
    }

    const list = await api.request('GET', '/categories', { expectedStatuses: [200] });
    const categories = toArray(getObject(list.body).categories);
    const match = categories.find((row) => {
      const name = ensureString(row.name);
      const rowParentId = row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id);
      return name.toLowerCase() === category.name.toLowerCase() && rowParentId === parentId;
    });

    if (!match) {
      throw new Error(`Failed to resolve existing category for ${category.key}`);
    }

    const categoryId = Number(match.id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throw new Error(`Invalid existing category id for ${category.key}`);
    }

    idsByKey[category.key] = categoryId;
    entityMap.categories[category.key] = { id: categoryId, state: 'reused' };
  }

  return idsByKey;
}

async function upsertProfileAndContacts(api: SeedApiClient, session: SeedUserSession): Promise<void> {
  await api.request('PATCH', '/me', {
    token: session.accessToken,
    body: {
      name: session.def.name,
    },
    expectedStatuses: [200],
  });

  const contactsRes = await api.request('GET', '/me/contacts', {
    token: session.accessToken,
    expectedStatuses: [200],
  });

  const contacts = toArray(getObject(contactsRes.body).contacts);

  const desired = [
    {
      contactType: 'email',
      value: `dev.seed+${session.def.key}@example.test`,
      isPrimary: true,
      tag: `[DEV-SEED:${session.def.key}:email]`,
    },
    {
      contactType: 'address',
      value: `[DEV-SEED:${session.def.key}:address] ${session.def.address}`,
      isPrimary: true,
      tag: `[DEV-SEED:${session.def.key}:address]`,
    },
  ] as const;

  for (const item of desired) {
    const existing = contacts.find(
      (c) => ensureString(c.contact_type) === item.contactType && ensureString(c.value).includes(item.tag),
    );

    if (existing) {
      const contactId = Number(existing.id);
      if (!Number.isInteger(contactId) || contactId <= 0) {
        continue;
      }
      await api.request('PATCH', `/me/contacts/${contactId}`, {
        token: session.accessToken,
        body: {
          value: item.value,
          isPrimary: item.isPrimary,
        },
        expectedStatuses: [200],
      });
    } else {
      await api.request('POST', '/me/contacts', {
        token: session.accessToken,
        body: {
          contactType: item.contactType,
          value: item.value,
          isPrimary: item.isPrimary,
        },
        expectedStatuses: [201],
      });
    }
  }
}

async function createUploadedProductImage(api: SeedApiClient, token: string, key: string): Promise<number> {
  const intent = await api.request('POST', '/files/upload-intent', {
    token,
    body: {
      ownerType: 'product',
      purpose: 'product_image',
      filename: `${key}.jpg`,
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
    },
    expectedStatuses: [201],
  });

  const file = getObject(getObject(intent.body).file);
  const fileId = Number(file.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw new Error(`Upload intent response missing file id for ${key}`);
  }

  await api.request('PATCH', `/files/${fileId}/mark-uploaded`, {
    token,
    body: {
      checksumSha256: EMPTY_SHA256,
    },
    expectedStatuses: [200],
  });

  return fileId;
}

async function upsertProducts(
  api: SeedApiClient,
  sessions: Record<string, SeedUserSession>,
  categoryIds: Record<string, number>,
  entityMap: SeedEntityMap,
): Promise<void> {
  const defsByOwner = new Map<string, ProductDef[]>();
  for (const def of PRODUCT_DEFS) {
    if (!defsByOwner.has(def.ownerKey)) {
      defsByOwner.set(def.ownerKey, []);
    }
    defsByOwner.get(def.ownerKey)!.push(def);
  }

  for (const [ownerKey, defs] of defsByOwner.entries()) {
    const session = sessions[ownerKey];
    const listing = await api.request('GET', '/my/products?limit=100&offset=0', {
      token: session.accessToken,
      expectedStatuses: [200],
    });

    const existingItems = toArray(getObject(listing.body).items);

    for (const def of defs) {
      const existing = existingItems.find((row) => ensureString(row.name) === def.name);
      const categoryId = categoryIds[def.categoryKey];
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        throw new Error(`Missing category id for ${def.key}`);
      }

      const imageFileId = await createUploadedProductImage(api, session.accessToken, def.key);

      if (!existing) {
        const created = await api.request('POST', '/products', {
          token: session.accessToken,
          body: {
            categoryId,
            name: def.name,
            description: def.description,
            price: def.price,
            city: def.city,
            addressText: def.addressText,
            imageFileIds: [imageFileId],
          },
          expectedStatuses: [201],
        });

        const product = getObject(getObject(created.body).product);
        const productId = Number(product.id);
        if (!Number.isInteger(productId) || productId <= 0) {
          throw new Error(`Created product missing id for ${def.key}`);
        }

        if (def.status !== 'available') {
          await api.request('PATCH', `/products/${productId}/status`, {
            token: session.accessToken,
            body: { status: def.status },
            expectedStatuses: [200],
          });
        }

        entityMap.products[def.key] = { id: productId, state: 'created' };
      } else {
        const productId = Number(existing.id);
        if (!Number.isInteger(productId) || productId <= 0) {
          throw new Error(`Existing product missing id for ${def.key}`);
        }

        await api.request('PATCH', `/products/${productId}`, {
          token: session.accessToken,
          body: {
            categoryId,
            name: def.name,
            description: def.description,
            price: def.price,
            city: def.city,
            addressText: def.addressText,
            imageFileIds: [imageFileId],
          },
          expectedStatuses: [200],
        });

        const currentStatus = ensureString(existing.status) as ProductStatus;
        if (currentStatus !== def.status) {
          await api.request('PATCH', `/products/${productId}/status`, {
            token: session.accessToken,
            body: { status: def.status },
            expectedStatuses: [200],
          });
          entityMap.products[def.key] = { id: productId, state: 'updated' };
        } else {
          entityMap.products[def.key] = { id: productId, state: 'reused' };
        }
      }
    }
  }
}

async function upsertRatings(
  api: SeedApiClient,
  sessions: Record<string, SeedUserSession>,
): Promise<void> {
  for (const def of RATING_DEFS) {
    const rater = sessions[def.raterKey];
    const rated = sessions[def.ratedKey];
    await api.request('POST', '/ratings', {
      token: rater.accessToken,
      body: {
        ratedUserId: rated.id,
        ratingValue: def.value,
        comment: def.comment,
      },
      expectedStatuses: [201],
    });
  }
}

async function seedConversationMessages(
  api: SeedApiClient,
  baseUrl: string,
  conversationId: number,
  chatKey: string,
  first: SeedUserSession,
  second: SeedUserSession,
): Promise<number> {
  const historyRes = await api.request('GET', `/chat/conversations/${conversationId}/messages?limit=100`, {
    token: first.accessToken,
    expectedStatuses: [200],
  });
  const history = toArray(getObject(historyRes.body).messages);
  const existingByText = new Set(history.map((m) => ensureString(m.message_text)));

  const socketA = await connectChatSocket(baseUrl, first.accessToken);
  const socketB = await connectChatSocket(baseUrl, second.accessToken);

  try {
    await wsEmitWithAck(socketA, 'conversation.join', { conversationId });
    await wsEmitWithAck(socketB, 'conversation.join', { conversationId });

    let seeded = 0;
    let lastMessageId = 0;

    for (let i = 1; i <= 6; i += 1) {
      const sender = i % 2 === 1 ? first : second;
      const text = `[DEV-SEED:${chatKey}:m${i}] Deterministic chat message ${i}`;
      if (existingByText.has(text)) {
        continue;
      }

      const senderSocket = sender.def.key === first.def.key ? socketA : socketB;
      const response = await wsEmitWithAck<Record<string, unknown>>(senderSocket, 'message.send', {
        conversationId,
        text,
      });

      const message = getObject(getObject(response.data).message);
      const messageId = Number(message.id);
      if (Number.isInteger(messageId) && messageId > 0) {
        lastMessageId = messageId;
      }
      seeded += 1;
    }

    if (lastMessageId > 0) {
      const readerSocket = 6 % 2 === 0 ? socketA : socketB;
      await wsEmitWithAck(readerSocket, 'message.read', { messageId: lastMessageId });
    }

    return seeded;
  } finally {
    socketA.disconnect();
    socketB.disconnect();
  }
}

async function upsertConversations(
  api: SeedApiClient,
  baseUrl: string,
  sessions: Record<string, SeedUserSession>,
  entityMap: SeedEntityMap,
): Promise<number> {
  let totalSeededMessages = 0;

  for (const def of CONVERSATION_DEFS) {
    const first = sessions[def.a];
    const second = sessions[def.b];

    const created = await api.request('POST', '/chat/conversations', {
      token: first.accessToken,
      body: {
        participantId: second.id,
      },
      expectedStatuses: [201],
    });

    const conversation = getObject(getObject(created.body).conversation);
    const conversationId = Number(conversation.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new Error(`Conversation id missing for ${def.key}`);
    }

    const state: EntityRecord['state'] = entityMap.conversations[def.key] ? 'reused' : 'created';
    entityMap.conversations[def.key] = { id: conversationId, state };

    const seededMessages = await seedConversationMessages(api, baseUrl, conversationId, def.key, first, second);
    totalSeededMessages += seededMessages;
  }

  return totalSeededMessages;
}

async function upsertReportsAndModeration(
  api: SeedApiClient,
  adminToken: string,
  adminUserId: number,
  sessions: Record<string, SeedUserSession>,
  entityMap: SeedEntityMap,
): Promise<void> {
  const adminReports = await api.request('GET', '/admin/reports', {
    token: adminToken,
    expectedStatuses: [200],
  });
  const allReports = toArray(getObject(adminReports.body).reports);

  for (const def of REPORT_DEFS) {
    let report = allReports.find((row) => ensureString(row.reason) === def.reason);
    const reporter = sessions[def.reporterKey];
    const target = sessions[def.reportedKey];

    if (!report) {
      const myReports = await api.request('GET', '/reports/me', {
        token: reporter.accessToken,
        expectedStatuses: [200],
      });
      const myRows = toArray(getObject(myReports.body).reports);
      report = myRows.find((row) => ensureString(row.reason) === def.reason);

      if (!report) {
        const created = await api.request('POST', '/reports', {
          token: reporter.accessToken,
          body: {
            reportedUserId: target.id,
            reason: def.reason,
          },
          expectedStatuses: [201],
        });

        report = getObject(getObject(created.body).report);
      }
    }

    const reportId = Number(report.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new Error(`Invalid report id for ${def.key}`);
    }

    const currentStatus = ensureString(report.status) as ReportStatus;
    if (currentStatus !== def.targetStatus) {
      await api.request('PATCH', `/admin/reports/${reportId}`, {
        token: adminToken,
        body: {
          status: def.targetStatus,
        },
        expectedStatuses: [200],
      });
      entityMap.reports[def.key] = { id: reportId, state: 'updated' };
    } else {
      entityMap.reports[def.key] = { id: reportId, state: report ? 'reused' : 'created' };
    }
  }

  const adminUsersRes = await api.request('GET', '/admin/users?limit=100&offset=0', {
    token: adminToken,
    expectedStatuses: [200],
  });
  const adminUsers = toArray(getObject(adminUsersRes.body).users);

  for (const target of USER_STATUS_TARGETS) {
    const session = sessions[target.key];
    const current = adminUsers.find((row) => Number(row.id) === session.id);
    const currentStatus = ensureString(current?.status) as UserStatus;

    if (currentStatus !== target.status) {
      await api.request('PATCH', `/admin/users/${session.id}/status`, {
        token: adminToken,
        body: {
          status: target.status,
        },
        expectedStatuses: [200],
      });

      const warning = await api.request('POST', '/admin/warnings', {
        token: adminToken,
        body: {
          targetUserId: session.id,
          message: target.warningMessage,
        },
        expectedStatuses: [201],
      });

      const warningId = Number(getObject(getObject(warning.body).warning).id);
      if (Number.isInteger(warningId) && warningId > 0) {
        entityMap.warnings[target.key] = { id: warningId, state: 'created' };
      }
    } else {
      entityMap.warnings[target.key] = {
        id: session.id,
        state: 'reused',
      };
    }
  }

  await api.request('GET', `/admin/admins`, {
    token: adminToken,
    expectedStatuses: [200],
  });

  await api.request('POST', `/admin/admins/${adminUserId}`, {
    token: adminToken,
    expectedStatuses: [409],
    body: {},
    retryable: false,
  }).catch(() => undefined);
}

async function collectSummary(
  api: SeedApiClient,
  adminToken: string,
  sessions: Record<string, SeedUserSession>,
  totalSeededMessages: number,
  input: DevSeedInput,
): Promise<SeedSummary> {
  const categoriesRes = await api.request('GET', '/categories', { expectedStatuses: [200] });
  const categories = toArray(getObject(categoriesRes.body).categories).filter((row) => ensureString(row.name).startsWith('[DEV]'));

  let available = 0;
  let sold = 0;
  let archived = 0;

  for (const session of Object.values(sessions)) {
    const mine = await api.request('GET', '/my/products?limit=100&offset=0', {
      token: session.accessToken,
      expectedStatuses: [200],
    });
    const items = toArray(getObject(mine.body).items).filter((row) => ensureString(row.name).startsWith('[DEV-SEED:'));

    for (const item of items) {
      const status = ensureString(item.status);
      if (status === 'available') available += 1;
      if (status === 'sold') sold += 1;
      if (status === 'archived') archived += 1;
    }
  }

  const reportStatuses: Record<ReportStatus, number> = {
    open: 0,
    reviewing: 0,
    resolved: 0,
    rejected: 0,
  };

  for (const status of Object.keys(reportStatuses) as ReportStatus[]) {
    const reports = await api.request('GET', `/admin/reports?status=${status}`, {
      token: adminToken,
      expectedStatuses: [200],
    });
    const rows = toArray(getObject(reports.body).reports);
    reportStatuses[status] = rows.filter((row) => ensureString(row.reason).startsWith('[DEV-SEED:report-')).length;
  }

  let ratingsCount = 0;
  for (const session of Object.values(sessions)) {
    const ratings = await api.request('GET', `/ratings/${session.id}`, { expectedStatuses: [200] });
    const rows = toArray(getObject(ratings.body).ratings);
    ratingsCount += rows.filter((row) => ensureString(row.comment).startsWith('[DEV-SEED:rate-')).length;
  }

  const userStatuses: Record<UserStatus, number> = {
    active: 0,
    paused: 0,
    banned: 0,
  };

  const usersRes = await api.request('GET', '/admin/users?limit=100&offset=0', {
    token: adminToken,
    expectedStatuses: [200],
  });

  const users = toArray(getObject(usersRes.body).users);
  for (const session of Object.values(sessions)) {
    const row = users.find((u) => Number(u.id) === session.id);
    const status = ensureString(row?.status) as UserStatus;
    if (status === 'active' || status === 'paused' || status === 'banned') {
      userStatuses[status] += 1;
    }
  }

  return {
    runAt: nowIso(),
    baseUrl: input.baseUrl,
    profile: input.profile,
    users: Object.keys(sessions).length,
    categories: categories.length,
    products: {
      total: available + sold + archived,
      available,
      sold,
      archived,
    },
    conversations: {
      total: CONVERSATION_DEFS.length,
      seededMessages: totalSeededMessages,
    },
    ratings: ratingsCount,
    reports: {
      total: reportStatuses.open + reportStatuses.reviewing + reportStatuses.resolved + reportStatuses.rejected,
      byStatus: reportStatuses,
    },
    userStatuses,
  };
}

async function writeArtifacts(
  api: SeedApiClient,
  entityMap: SeedEntityMap,
  summary: SeedSummary,
): Promise<string> {
  const ts = nowIso().replace(/:/g, '-').replace(/\./g, '-');
  const logDir = path.join(process.cwd(), 'logs', `dev-seed-${ts}`);
  await mkdir(logDir, { recursive: true });

  await writeFile(path.join(logDir, 'api-calls.json'), JSON.stringify(api.callLogs, null, 2));
  await writeFile(path.join(logDir, 'entity-map.json'), JSON.stringify(entityMap, null, 2));
  await writeFile(path.join(logDir, 'summary.json'), JSON.stringify(summary, null, 2));

  return logDir;
}

function createEmptyEntityMap(): SeedEntityMap {
  return {
    users: {},
    categories: {},
    products: {},
    conversations: {},
    reports: {},
    warnings: {},
  };
}

export async function runDevSeed(input: DevSeedInput): Promise<SeedRunArtifacts> {
  const api = new SeedApiClient({
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
  });

  const entityMap = createEmptyEntityMap();
  const { adminToken, adminUserId } = await performPreflightChecks(api, input);

  const sessions: Record<string, SeedUserSession> = {};

  for (let i = 0; i < DEV_USERS.length; i += 1) {
    const user = DEV_USERS[i];
    const session = await ensureUser(api, user, i === 0);
    sessions[user.key] = session;
    entityMap.users[user.key] = {
      id: session.id,
      state: session.created ? 'created' : 'reused',
    };

    await upsertProfileAndContacts(api, session);
  }

  const categoryIds = await upsertCategories(api, adminToken, entityMap);
  await upsertProducts(api, sessions, categoryIds, entityMap);
  await upsertRatings(api, sessions);
  const totalSeededMessages = await upsertConversations(api, input.baseUrl, sessions, entityMap);
  await upsertReportsAndModeration(api, adminToken, adminUserId, sessions, entityMap);

  const summary = await collectSummary(api, adminToken, sessions, totalSeededMessages, input);
  const logDir = await writeArtifacts(api, entityMap, summary);

  return { logDir, summary };
}
