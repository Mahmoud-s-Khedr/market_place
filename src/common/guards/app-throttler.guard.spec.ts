import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  Throttle,
  ThrottlerModuleOptions,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { AppConfig } from '../../config/configuration';
import { AppThrottlerGuard } from './app-throttler.guard';

type GuardConfig = Pick<AppConfig, 'nodeEnv' | 'throttleDevBypass'>;

type HttpContextParts = {
  context: ExecutionContext;
  responseHeaders: jest.Mock;
};

class TestAuthController {
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  register(): Record<string, boolean> {
    return { success: true };
  }
}

function buildGuard(config: GuardConfig): AppThrottlerGuard {
  const options: ThrottlerModuleOptions = [
    {
      name: 'default',
      ttl: 60_000,
      limit: 120,
    },
  ];
  const storageService = new ThrottlerStorageService();
  const reflector = new Reflector();
  const configService = {
    get: () => config,
  };

  return new AppThrottlerGuard(
    options,
    storageService,
    reflector,
    configService as any,
  );
}

function buildHttpContext(
  handler: (...args: unknown[]) => unknown,
  classRef: new (...args: never[]) => unknown,
  ip = '127.0.0.1',
): HttpContextParts {
  const responseHeaders = jest.fn();
  const request = {
    ip,
    headers: {
      'user-agent': 'jest',
    },
  };
  const response = {
    header: responseHeaders,
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as ExecutionContext;

  return { context, responseHeaders };
}

function shutdownGuard(guard: AppThrottlerGuard): void {
  const storage = (guard as any).storageService as ThrottlerStorageService;
  storage.onApplicationShutdown();
}

describe('AppThrottlerGuard', () => {
  it('skips throttling in development when bypass=true', async () => {
    const guard = buildGuard({ nodeEnv: 'development', throttleDevBypass: true });

    try {
      await expect((guard as any).shouldSkip({})).resolves.toBe(true);
    } finally {
      shutdownGuard(guard);
    }
  });

  it('does not skip throttling in development when bypass=false', async () => {
    const guard = buildGuard({ nodeEnv: 'development', throttleDevBypass: false });

    try {
      await expect((guard as any).shouldSkip({})).resolves.toBe(false);
    } finally {
      shutdownGuard(guard);
    }
  });

  it('does not skip throttling in production when bypass=true', async () => {
    const guard = buildGuard({ nodeEnv: 'production', throttleDevBypass: true });

    try {
      await expect((guard as any).shouldSkip({})).resolves.toBe(false);
    } finally {
      shutdownGuard(guard);
    }
  });

  it('returns throttling error for burst register when bypass is disabled', async () => {
    const guard = buildGuard({ nodeEnv: 'development', throttleDevBypass: false });
    try {
      await guard.onModuleInit();

      const handler = TestAuthController.prototype.register;
      const { context } = buildHttpContext(handler, TestAuthController);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      await expect(guard.canActivate(context)).rejects.toThrow();
    } finally {
      shutdownGuard(guard);
    }
  });

  it('does not throttle burst register when bypass is enabled in development', async () => {
    const guard = buildGuard({ nodeEnv: 'development', throttleDevBypass: true });
    try {
      await guard.onModuleInit();

      const handler = TestAuthController.prototype.register;
      const { context } = buildHttpContext(handler, TestAuthController);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      await expect(guard.canActivate(context)).resolves.toBe(true);
    } finally {
      shutdownGuard(guard);
    }
  });
});
