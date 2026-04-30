import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AppLogger } from './app-logger.service';

describe('AppLogger', () => {
  it('writes structured payload and redacts sensitive meta fields', () => {
    const configService = {
      get: jest.fn().mockReturnValue({ nodeEnv: 'test', logLevel: 'log', logPretty: false }),
    } as unknown as ConfigService<{ app: AppConfig }, true>;
    const logger = new AppLogger(configService);
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    logger.log({
      service: 'http',
      protocol: 'http',
      routeOrEvent: 'GET /me',
      message: 'test',
      meta: { password: '123' },
    });

    expect(spy).toHaveBeenCalled();
    const msg = String(spy.mock.calls[0][0]);
    expect(msg).toContain('"service":"http"');
    expect(msg).toContain('"password":"[REDACTED]"');
    spy.mockRestore();
  });
});

