import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppLogger } from '../logging/app-logger.service';

describe('HttpExceptionFilter', () => {
  it('returns unified error envelope for HttpException', () => {
    const appLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as AppLogger;
    const filter = new HttpExceptionFilter(appLogger);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });

    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', url: '/api/test' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new BadRequestException('Invalid payload'), host);

    expect(appLogger.warn).toHaveBeenCalled();

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 400,
        data: null,
        error: expect.objectContaining({
          code: 400,
          message: 'Invalid payload',
          path: '/api/test',
        }),
      }),
    );
  });
});
