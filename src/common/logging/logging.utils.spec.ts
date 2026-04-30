import { payloadShape, sanitizeForLog } from './logging.utils';

describe('logging.utils', () => {
  it('redacts sensitive fields', () => {
    const input = {
      password: 'abc',
      accessToken: 'x',
      nested: { authorization: 'Bearer foo' },
    };
    expect(sanitizeForLog(input)).toEqual({
      password: '[REDACTED]',
      accessToken: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
  });

  it('truncates long strings and limits depth', () => {
    const long = 'x'.repeat(400);
    const input = { msg: long, a: { b: { c: { d: { e: 1 } } } } };
    const out = sanitizeForLog(input) as Record<string, unknown>;
    expect(String(out.msg)).toContain('[truncated:');
    expect(out.a).toBeDefined();
  });

  it('returns payload shape summary', () => {
    const shape = payloadShape({ conversationId: 6, text: 'hello', tags: ['a'] });
    expect(shape).toEqual({
      conversationId: 'number',
      text: 'string',
      tags: 'array(1)',
    });
  });
});

