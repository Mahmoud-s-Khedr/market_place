import { ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { HttpResponseEnvelopeInterceptor } from './http-response-envelope.interceptor';

function buildContext(statusCode: number): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

describe('HttpResponseEnvelopeInterceptor', () => {
  it('flattens wrapped data when payload has exactly one top-level key', async () => {
    const interceptor = new HttpResponseEnvelopeInterceptor();
    const context = buildContext(201);

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({ file: { id: 42 } }) } as any),
    );

    expect(result).toEqual({
      success: true,
      statusCode: 201,
      data: { id: 42 },
    });
  });

  it('keeps wrapped data object when payload has more than one top-level key', async () => {
    const interceptor = new HttpResponseEnvelopeInterceptor();
    const context = buildContext(200);

    const result = await lastValueFrom(
      interceptor.intercept(
        context,
        { handle: () => of({ user: { id: 1 }, products: [{ id: 2 }] }) } as any,
      ),
    );

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      data: { user: { id: 1 }, products: [{ id: 2 }] },
    });
  });

  it('does not re-wrap already enveloped payloads', async () => {
    const interceptor = new HttpResponseEnvelopeInterceptor();
    const context = buildContext(200);

    const existing = { success: true, statusCode: 200, data: { ok: true } };
    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: () => of(existing) } as any),
    );

    expect(result).toBe(existing);
  });
});
