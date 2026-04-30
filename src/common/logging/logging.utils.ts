const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'secret',
  'otp',
  'ssn',
  'refreshtoken',
  'accesstoken',
]);

const MAX_STRING_LENGTH = 300;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_DEPTH = 4;

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated:${value.length - MAX_STRING_LENGTH}]`
      : value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[depth-limited]';
  }

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeForLog(item, depth + 1));
    if (value.length > MAX_ARRAY_LENGTH) {
      limited.push(`[truncated:${value.length - MAX_ARRAY_LENGTH}]`);
    }
    return limited;
  }

  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = sanitizeForLog(raw, depth + 1);
  }
  return out;
}

export function payloadShape(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value !== 'object') return { type: typeof value };

  const record = value as Record<string, unknown>;
  const shape: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (Array.isArray(child)) {
      shape[key] = `array(${child.length})`;
    } else if (child === null) {
      shape[key] = 'null';
    } else {
      shape[key] = typeof child;
    }
  }
  return shape;
}

