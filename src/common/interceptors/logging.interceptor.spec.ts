import { ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { LoggingInterceptor } from './logging.interceptor';
import { AppLogger } from '../logging/app-logger.service';
import { AppConfig } from '../../config/configuration';

describe('LoggingInterceptor', () => {
  it('logs request start and completion', async () => {
    const appLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as AppLogger;
    const configService = {
      get: jest.fn().mockReturnValue({ logHttpBody: false }),
    } as unknown as ConfigService<{ app: AppConfig }, true>;
    const interceptor = new LoggingInterceptor(appLogger, configService);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/me',
          ip: '127.0.0.1',
          body: { password: 'x' },
        }),
        getResponse: () => ({
          statusCode: 200,
          getHeader: () => '123',
        }),
      }),
    } as unknown as ExecutionContext;

    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) } as any));

    expect((appLogger.log as jest.Mock).mock.calls.length).toBe(2);
    expect(appLogger.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: 'HTTP request started' }),
    );
    expect(appLogger.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'HTTP request completed', statusCode: 200 }),
    );
  });
});

