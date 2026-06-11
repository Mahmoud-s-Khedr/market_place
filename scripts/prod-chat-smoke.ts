import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { io, Socket } from 'socket.io-client';

type Actor = 'user1' | 'user2' | 'system';
type Direction = 'info' | 'emit' | 'ack' | 'recv' | 'error';
type JsonRecord = Record<string, unknown>;

type UserCredentials = {
  actor: Extract<Actor, 'user1' | 'user2'>;
  phone: string;
  password: string;
};

type Session = UserCredentials & {
  userId: number;
  accessToken: string;
};

type ApiOptions = {
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  body?: JsonRecord;
  expectedStatus?: number | number[];
};

type ApiResult = {
  status: number;
  body: unknown;
};

type EventAck = {
  ok: boolean;
  payload: unknown;
};

const CONFIG = {
  baseUrl: normalizeBaseUrl(process.env.BASE_URL ?? 'https://digitex-market.alkhalifa.vip'),
  timeoutMs: parsePositiveInt(process.env.CHAT_TEST_TIMEOUT_MS, 15000),
  logDir: process.env.CHAT_TEST_LOG_DIR ?? path.join(process.cwd(), 'logs', 'prod-chat-smoke'),
  messagePrefix: process.env.CHAT_TEST_MESSAGE_PREFIX ?? 'prod-chat-smoke',
  user1Phone: requireEnv('USER_1_PHONE'),
  user1Password: requireEnv('USER_1_PASSWORD'),
  user2Phone: requireEnv('USER_2_PHONE'),
  user2Password: requireEnv('USER_2_PASSWORD'),
};

const RUN_ID = makeRunId();
const LOG_FILE = path.join(CONFIG.logDir, `${RUN_ID}.jsonl`);
const pendingWrites: Promise<void>[] = [];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('BASE_URL cannot be empty');
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function makeRunId(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 10);
  return `${iso}-${rand}`;
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

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function formatForConsole(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureLogDir(): Promise<void> {
  await fs.mkdir(CONFIG.logDir, { recursive: true });
}

function writeLog(entry: JsonRecord): void {
  pendingWrites.push(fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8'));
}

function logEvent(actor: Actor, direction: Direction, event: string, payload: unknown, meta?: JsonRecord): void {
  const ts = nowIso();
  const row = {
    ts,
    actor,
    direction,
    event,
    payload,
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
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

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
      // Keep raw response when server does not return JSON.
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

function extractAccessToken(body: unknown): string {
  const data = responseData<unknown>(body);
  if (!isRecord(data) || typeof data.accessToken !== 'string' || !data.accessToken) {
    throw new Error(`Auth response missing accessToken: ${formatForConsole(body)}`);
  }
  return data.accessToken;
}

function extractUserId(body: unknown): number {
  const data = responseData<unknown>(body);
  if (!isRecord(data) || !isRecord(data.user)) {
    throw new Error(`Auth response missing user object: ${formatForConsole(body)}`);
  }
  const userId = toPositiveInt(data.user.id);
  if (!userId) {
    throw new Error(`Auth response missing valid user.id: ${formatForConsole(body)}`);
  }
  return userId;
}

function extractConversationId(body: unknown): number {
  const data = responseData<unknown>(body);
  const conversation =
    isRecord(data) && isRecord(data.conversation)
      ? data.conversation
      : isRecord(data)
        ? data
        : null;
  const conversationId = toPositiveInt(conversation?.id);
  if (!conversationId) {
    throw new Error(`Conversation response missing id: ${formatForConsole(body)}`);
  }
  return conversationId;
}

function extractMessages(body: unknown): JsonRecord[] {
  const data = responseData<unknown>(body);
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  if (isRecord(data) && Array.isArray(data.messages)) {
    return data.messages.filter(isRecord);
  }
  throw new Error(`Messages response missing messages array: ${formatForConsole(body)}`);
}

function extractMessageId(payload: unknown): number | null {
  if (!isRecord(payload) || !isRecord(payload.message)) return null;
  return toPositiveInt(payload.message.id);
}

function isAckSuccess(payload: unknown): boolean {
  return isRecord(payload) && payload.success === true;
}

async function loginUser(credentials: UserCredentials): Promise<Session> {
  logEvent('system', 'info', 'auth.login.request', {
    actor: credentials.actor,
    phone: credentials.phone,
  });

  const res = await apiCall({
    method: 'POST',
    path: '/auth/login',
    body: {
      phone: credentials.phone,
      password: credentials.password,
    },
    expectedStatus: 201,
  });

  const accessToken = extractAccessToken(res.body);
  const userId = extractUserId(res.body);

  logEvent('system', 'ack', 'auth.login.response', {
    actor: credentials.actor,
    userId,
    accessToken: redactToken(accessToken),
  });

  return {
    ...credentials,
    userId,
    accessToken,
  };
}

async function createOrGetConversation(session: Session, participantId: number): Promise<number> {
  const res = await apiCall({
    method: 'POST',
    path: '/chat/conversations',
    token: session.accessToken,
    body: { participantId },
    expectedStatus: 201,
  });

  const conversationId = extractConversationId(res.body);
  logEvent('system', 'ack', 'chat.conversation.ready', {
    conversationId,
    actor: session.actor,
    participantId,
  });
  return conversationId;
}

async function verifyConversationReadable(session: Session, conversationId: number): Promise<void> {
  const conversationRes = await apiCall({
    method: 'GET',
    path: `/chat/conversations/${conversationId}`,
    token: session.accessToken,
    expectedStatus: 200,
  });
  const messagesRes = await apiCall({
    method: 'GET',
    path: `/chat/conversations/${conversationId}/messages?limit=5`,
    token: session.accessToken,
    expectedStatus: 200,
  });

  const messages = extractMessages(messagesRes.body);
  logEvent('system', 'ack', 'chat.rest.verified', {
    actor: session.actor,
    conversationId,
    messageCount: messages.length,
    conversationSnapshot: responseData(conversationRes.body),
  });
}

function attachSocketLogging(actor: Extract<Actor, 'user1' | 'user2'>, socket: Socket): void {
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

async function connectSocket(actor: Extract<Actor, 'user1' | 'user2'>, token: string): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = io(`${CONFIG.baseUrl}/chat`, {
      auth: { token },
      timeout: CONFIG.timeoutMs,
      reconnection: false,
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

    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function emitWithAckLogged(
  actor: Extract<Actor, 'user1' | 'user2'>,
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

async function assertJoin(socket: Socket, actor: Extract<Actor, 'user1' | 'user2'>, conversationId: number): Promise<void> {
  const ack = await emitWithAckLogged(actor, socket, 'conversation.join', { conversationId });
  if (!ack.ok || !isAckSuccess(ack.payload)) {
    throw new Error(`${actor} failed to join conversation ${conversationId}: ${formatForConsole(ack.payload)}`);
  }
}

async function sendAndRead(
  sender: { actor: Extract<Actor, 'user1' | 'user2'>; socket: Socket },
  reader: { actor: Extract<Actor, 'user1' | 'user2'>; socket: Socket },
  conversationId: number,
  text: string,
): Promise<void> {
  const sendAck = await emitWithAckLogged(sender.actor, sender.socket, 'message.send', {
    conversationId,
    text,
  });
  if (!sendAck.ok || !isAckSuccess(sendAck.payload)) {
    throw new Error(`${sender.actor} message.send failed: ${formatForConsole(sendAck.payload)}`);
  }

  const messageId = extractMessageId(sendAck.payload);
  if (!messageId) {
    throw new Error(`message.send ack missing message id: ${formatForConsole(sendAck.payload)}`);
  }

  const readAck = await emitWithAckLogged(reader.actor, reader.socket, 'message.read', {
    messageId,
  });
  if (!readAck.ok || !isAckSuccess(readAck.payload)) {
    throw new Error(`${reader.actor} message.read failed: ${formatForConsole(readAck.payload)}`);
  }
}

async function main(): Promise<void> {
  await ensureLogDir();

  logEvent('system', 'info', 'run.start', {
    runId: RUN_ID,
    baseUrl: CONFIG.baseUrl,
    timeoutMs: CONFIG.timeoutMs,
    logFile: LOG_FILE,
  });

  const user1 = await loginUser({
    actor: 'user1',
    phone: CONFIG.user1Phone,
    password: CONFIG.user1Password,
  });
  const user2 = await loginUser({
    actor: 'user2',
    phone: CONFIG.user2Phone,
    password: CONFIG.user2Password,
  });

  const conversationId = await createOrGetConversation(user1, user2.userId);
  await verifyConversationReadable(user1, conversationId);
  await verifyConversationReadable(user2, conversationId);

  let user1Socket: Socket | null = null;
  let user2Socket: Socket | null = null;

  try {
    user1Socket = await connectSocket('user1', user1.accessToken);
    user2Socket = await connectSocket('user2', user2.accessToken);

    await assertJoin(user1Socket, 'user1', conversationId);
    await assertJoin(user2Socket, 'user2', conversationId);

    await sendAndRead(
      { actor: 'user1', socket: user1Socket },
      { actor: 'user2', socket: user2Socket },
      conversationId,
      `${CONFIG.messagePrefix}-user1-${RUN_ID}`,
    );
    await sendAndRead(
      { actor: 'user2', socket: user2Socket },
      { actor: 'user1', socket: user1Socket },
      conversationId,
      `${CONFIG.messagePrefix}-user2-${RUN_ID}`,
    );

    logEvent('system', 'info', 'run.success', {
      conversationId,
      user1Id: user1.userId,
      user2Id: user2.userId,
      user1SocketId: user1Socket.id,
      user2SocketId: user2Socket.id,
      logFile: LOG_FILE,
    });
  } finally {
    user1Socket?.disconnect();
    user2Socket?.disconnect();
  }
}

main()
  .then(async () => {
    await flushLogs();
    console.log(`Production chat smoke test completed. Log file: ${LOG_FILE}`);
  })
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logEvent('system', 'error', 'run.failure', { message });
    await flushLogs();
    console.error(`Production chat smoke test failed: ${message}`);
    process.exitCode = 1;
  });
