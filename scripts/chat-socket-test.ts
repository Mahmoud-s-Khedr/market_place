import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { io, Socket } from 'socket.io-client';

type Actor = 'buyer' | 'seller' | 'system';
type Direction = 'info' | 'emit' | 'ack' | 'recv' | 'error';

type JsonRecord = Record<string, unknown>;

type ApiOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  token?: string;
  body?: JsonRecord;
  expectedStatus?: number | number[];
};

type ApiResult = {
  status: number;
  body: unknown;
};

type UserBootstrap = {
  actor: Extract<Actor, 'buyer' | 'seller'>;
  phone: string;
  password: string;
  name: string;
  ssn: string;
  userId: number;
  accessToken: string;
};

type EventAck = {
  ok: boolean;
  payload: unknown;
};

const CONFIG = {
  baseUrl: process.env.BASE_URL ?? 'http://165.227.138.228:800',
  timeoutMs: parsePositiveInt(process.env.CHAT_TEST_TIMEOUT_MS, 12000),
  messageCount: parsePositiveInt(process.env.CHAT_TEST_MESSAGE_COUNT, 2),
  messageTextPrefix: process.env.CHAT_TEST_MESSAGE_PREFIX ?? 'chat-test-message',
  logDir: process.env.CHAT_TEST_LOG_DIR ?? path.join(process.cwd(), 'logs', 'chat-socket-test'),
  forceOtp: process.env.CHAT_TEST_OTP ?? '000000',
};

const RUN_ID = makeRunId();
const LOG_FILE = path.join(CONFIG.logDir, `${RUN_ID}.jsonl`);

let currentConversationId: number | null = null;
const pendingWrites: Promise<void>[] = [];

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function makeRunId(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 10);
  return `${iso}-${rand}`;
}

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

function redactToken(token: string): string {
  if (token.length <= 14) return '[REDACTED]';
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseData<T = JsonRecord>(body: unknown): T {
  if (isRecord(body) && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

function getNestedRecord(body: unknown, key: string): JsonRecord | null {
  const data = responseData<unknown>(body);
  if (!isRecord(data)) return null;
  const val = data[key];
  return isRecord(val) ? val : null;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function extractAccessToken(body: unknown): string {
  const data = responseData<unknown>(body);
  if (!isRecord(data)) {
    throw new Error(`Auth response missing data object: ${JSON.stringify(body)}`);
  }
  const token = data.accessToken;
  if (typeof token !== 'string' || !token) {
    throw new Error(`Auth response missing accessToken: ${JSON.stringify(body)}`);
  }
  return token;
}

function extractUserId(body: unknown): number {
  const data = responseData<unknown>(body);
  if (!isRecord(data)) {
    throw new Error(`Auth response missing data object: ${JSON.stringify(body)}`);
  }
  const user = data.user;
  if (!isRecord(user) || typeof user.id !== 'number' || user.id <= 0) {
    throw new Error(`Auth response missing user.id: ${JSON.stringify(body)}`);
  }
  return user.id;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureLogDir(): Promise<void> {
  await fs.mkdir(CONFIG.logDir, { recursive: true });
}

function formatForConsole(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeLog(entry: JsonRecord): void {
  const line = `${JSON.stringify(entry)}\n`;
  pendingWrites.push(fs.appendFile(LOG_FILE, line, 'utf8'));
}

function logEvent(actor: Actor, direction: Direction, event: string, payload: unknown, meta?: JsonRecord): void {
  const ts = nowIso();
  const row = {
    ts,
    actor,
    direction,
    event,
    payload,
    conversationId: currentConversationId,
    ...meta,
  } satisfies JsonRecord;

  const prefix = `[${ts}] [${actor}] [${direction}] ${event}`;
  if (payload === undefined) {
    console.log(prefix);
  } else {
    console.log(`${prefix} ${formatForConsole(payload)}`);
  }

  writeLog(row);
}

async function flushLogs(): Promise<void> {
  await Promise.allSettled(pendingWrites);
}

async function apiCall(opts: ApiOptions): Promise<ApiResult> {
  const url = `${CONFIG.baseUrl}${opts.path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = { _raw: text };
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }

    const expected = opts.expectedStatus === undefined ? [] : asArray(opts.expectedStatus);
    if (expected.length > 0 && !expected.includes(res.status)) {
      throw new Error(
        `Unexpected status for ${opts.method} ${opts.path}: got ${res.status}, expected [${expected.join(', ')}]. body=${formatForConsole(body)}`,
      );
    }

    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function registerAndVerifyUser(actor: Extract<Actor, 'buyer' | 'seller'>, profile: {
  phone: string;
  password: string;
  name: string;
  ssn: string;
}): Promise<UserBootstrap> {
  logEvent('system', 'info', 'auth.register.request', {
    actor,
    phone: profile.phone,
    name: profile.name,
    ssn: profile.ssn,
  });

  const reg = await apiCall({
    method: 'POST',
    path: '/auth/register',
    body: {
      name: profile.name,
      ssn: profile.ssn,
      phone: profile.phone,
      password: profile.password,
    },
    expectedStatus: 201,
  });

  const regData = responseData<{ otp?: string }>(reg.body);
  const otp = typeof regData?.otp === 'string' ? regData.otp : CONFIG.forceOtp;

  logEvent('system', 'ack', 'auth.register.response', {
    actor,
    status: reg.status,
    otpSource: typeof regData?.otp === 'string' ? 'response' : 'fallback-env',
  });

  const verify = await apiCall({
    method: 'POST',
    path: '/auth/register/verify',
    body: {
      phone: profile.phone,
      otp,
    },
    expectedStatus: 201,
  });

  const accessToken = extractAccessToken(verify.body);
  const userId = extractUserId(verify.body);

  logEvent('system', 'ack', 'auth.register.verify.response', {
    actor,
    status: verify.status,
    userId,
    accessToken: redactToken(accessToken),
  });

  return {
    actor,
    phone: profile.phone,
    password: profile.password,
    name: profile.name,
    ssn: profile.ssn,
    userId,
    accessToken,
  };
}

async function createConversation(buyerToken: string, sellerUserId: number): Promise<number> {
  const res = await apiCall({
    method: 'POST',
    path: '/chat/conversations',
    token: buyerToken,
    body: {
      participantId: sellerUserId,
    },
    expectedStatus: 201,
  });

  const data = responseData<unknown>(res.body);
  const conversation =
    isRecord(data) && isRecord(data.conversation)
      ? data.conversation
      : (isRecord(data) ? data : null);

  const id = toPositiveInt(conversation?.id);
  if (id === null) {
    throw new Error(`Unable to extract conversation id from response: ${formatForConsole(res.body)}`);
  }

  currentConversationId = id;
  logEvent('system', 'ack', 'chat.conversation.created', {
    status: res.status,
    conversationId: id,
  });

  return id;
}

function attachSocketLogging(actor: Extract<Actor, 'buyer' | 'seller'>, socket: Socket): void {
  const socketMeta = (): JsonRecord => ({ socketId: socket.id ?? null, namespace: '/chat' });

  socket.on('connect', () => {
    logEvent(actor, 'info', 'connect', { id: socket.id, connected: socket.connected }, socketMeta());
  });

  socket.on('disconnect', (reason) => {
    logEvent(actor, 'info', 'disconnect', { reason, connected: socket.connected }, socketMeta());
  });

  socket.on('connect_error', (err: Error) => {
    logEvent(actor, 'error', 'connect_error', { message: err.message }, socketMeta());
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    logEvent(actor, 'info', 'reconnect_attempt', { attempt }, socketMeta());
  });

  socket.io.on('reconnect', (attempt) => {
    logEvent(actor, 'info', 'reconnect', { attempt }, socketMeta());
  });

  socket.io.on('reconnect_error', (err: Error) => {
    logEvent(actor, 'error', 'reconnect_error', { message: err.message }, socketMeta());
  });

  socket.io.on('reconnect_failed', () => {
    logEvent(actor, 'error', 'reconnect_failed', {}, socketMeta());
  });

  socket.on('conversation.joined', (payload) => {
    logEvent(actor, 'recv', 'conversation.joined', payload, socketMeta());
  });

  socket.on('message.received', (payload) => {
    logEvent(actor, 'recv', 'message.received', payload, socketMeta());
  });

  socket.on('message.read', (payload) => {
    logEvent(actor, 'recv', 'message.read', payload, socketMeta());
  });

  socket.on('chat.error', (payload) => {
    logEvent(actor, 'error', 'chat.error', payload, socketMeta());
  });

  socket.on('exception', (payload) => {
    logEvent(actor, 'error', 'exception', payload, socketMeta());
  });
}

async function connectSocket(actor: Extract<Actor, 'buyer' | 'seller'>, token: string): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = io(`${CONFIG.baseUrl}/chat`, {
      auth: { token },
      transports: ['websocket'],
      timeout: CONFIG.timeoutMs,
      reconnection: true,
    });

    attachSocketLogging(actor, socket);

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connect timeout for ${actor} (${CONFIG.timeoutMs}ms)`));
    }, CONFIG.timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function emitWithAckLogged(
  actor: Extract<Actor, 'buyer' | 'seller'>,
  socket: Socket,
  event: string,
  payload: JsonRecord,
): Promise<EventAck> {
  logEvent(actor, 'emit', event, payload, { socketId: socket.id ?? null });

  try {
    const ack = await socket.timeout(CONFIG.timeoutMs).emitWithAck(event, payload);
    logEvent(actor, 'ack', event, ack, { socketId: socket.id ?? null });
    return { ok: true, payload: ack };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent(actor, 'error', `${event}.ack_error`, { message }, { socketId: socket.id ?? null });
    return { ok: false, payload: { error: message } };
  }
}

function extractMessageId(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const message = payload.message;
  if (!isRecord(message)) return null;
  return toPositiveInt(message.id);
}

function isAckSuccess(payload: unknown): boolean {
  return isRecord(payload) && payload.success === true;
}

async function runHappyPath(
  buyerSocket: Socket,
  sellerSocket: Socket,
  conversationId: number,
): Promise<void> {
  const sellerJoin = await emitWithAckLogged('seller', sellerSocket, 'conversation.join', { conversationId });
  if (!sellerJoin.ok || !isAckSuccess(sellerJoin.payload)) {
    throw new Error(`seller conversation.join failed: ${formatForConsole(sellerJoin.payload)}`);
  }

  const buyerJoin = await emitWithAckLogged('buyer', buyerSocket, 'conversation.join', { conversationId });
  if (!buyerJoin.ok || !isAckSuccess(buyerJoin.payload)) {
    throw new Error(`buyer conversation.join failed: ${formatForConsole(buyerJoin.payload)}`);
  }

  for (let i = 0; i < CONFIG.messageCount; i += 1) {
    const text = `${CONFIG.messageTextPrefix}-${i + 1}-run-${RUN_ID}`;
    const send = await emitWithAckLogged('buyer', buyerSocket, 'message.send', {
      conversationId,
      text,
    });
    if (!send.ok || !isAckSuccess(send.payload)) {
      throw new Error(`message.send failed: ${formatForConsole(send.payload)}`);
    }

    const messageId = extractMessageId(send.payload);
    if (!messageId) {
      throw new Error(`message.send ack missing message.id: ${formatForConsole(send.payload)}`);
    }

    const read = await emitWithAckLogged('seller', sellerSocket, 'message.read', {
      messageId,
    });
    if (!read.ok || !isAckSuccess(read.payload)) {
      throw new Error(`message.read failed: ${formatForConsole(read.payload)}`);
    }
  }
}

async function runNegativeValidationCheck(socket: Socket, conversationId: number): Promise<void> {
  const invalid = await emitWithAckLogged('buyer', socket, 'message.send', {
    conversationId,
    text: '',
  });

  if (invalid.ok) {
    logEvent('system', 'info', 'negative.validation', {
      note: 'Ack returned (expected with error payload or separate chat.error event).',
      payload: invalid.payload,
    });
  } else {
    logEvent('system', 'info', 'negative.validation', {
      note: 'Ack timeout/error occurred; check chat.error/exception logs for server-side validation output.',
      payload: invalid.payload,
    });
  }
}

async function main(): Promise<void> {
  await ensureLogDir();

  logEvent('system', 'info', 'run.start', {
    runId: RUN_ID,
    baseUrl: CONFIG.baseUrl,
    timeoutMs: CONFIG.timeoutMs,
    messageCount: CONFIG.messageCount,
    logFile: LOG_FILE,
  });

  const seed = numericSeedFromRunId(RUN_ID);
  const buyerProfile = {
    phone: phoneFromSeed(seed + 101, '1'),
    password: 'BuyerPass123',
    name: `Chat Buyer ${seed % 1000}`,
    ssn: ssnFromSeed(seed + 11),
  };
  const sellerProfile = {
    phone: phoneFromSeed(seed + 202, '2'),
    password: 'SellerPass123',
    name: `Chat Seller ${seed % 1000}`,
    ssn: ssnFromSeed(seed + 22),
  };

  const buyer = await registerAndVerifyUser('buyer', buyerProfile);
  const seller = await registerAndVerifyUser('seller', sellerProfile);

  logEvent('system', 'info', 'users.ready', {
    buyer: { userId: buyer.userId, phone: buyer.phone },
    seller: { userId: seller.userId, phone: seller.phone },
  });

  const conversationId = await createConversation(buyer.accessToken, seller.userId);

  let buyerSocket: Socket | null = null;
  let sellerSocket: Socket | null = null;

  try {
    buyerSocket = await connectSocket('buyer', buyer.accessToken);
    sellerSocket = await connectSocket('seller', seller.accessToken);

    await runHappyPath(buyerSocket, sellerSocket, conversationId);
    await runNegativeValidationCheck(buyerSocket, conversationId);

    logEvent('system', 'info', 'run.success', {
      conversationId,
      buyerSocketId: buyerSocket.id,
      sellerSocketId: sellerSocket.id,
      logFile: LOG_FILE,
    });
  } finally {
    buyerSocket?.disconnect();
    sellerSocket?.disconnect();
  }
}

main()
  .then(async () => {
    await flushLogs();
    console.log(`Chat socket test completed. Log file: ${LOG_FILE}`);
  })
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logEvent('system', 'error', 'run.failure', { message });
    await flushLogs();
    console.error(`Chat socket test failed: ${message}`);
    process.exitCode = 1;
  });
