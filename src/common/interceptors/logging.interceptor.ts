import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, tap } from 'rxjs';
import { requestContext } from '../context/request-context';
import { AppLogger } from '../logging/app-logger.service';
import { sanitizeForLog } from '../logging/logging.utils';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly appLogger: AppLogger,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startedAt = Date.now();
    const requestId = requestContext.getStore()?.requestId;
    const userId = (request.user as { sub?: unknown } | undefined)?.sub;
    const shouldLogBody = this.configService.get('app', { infer: true }).logHttpBody;
    this.appLogger.log({
      service: 'http',
      protocol: 'http',
      routeOrEvent: `${request.method} ${request.originalUrl}`,
      message: 'HTTP request started',
      correlationId: requestId,
      requestId,
      userId: typeof userId === 'number' ? userId : null,
      meta: {
        method: request.method,
        path: request.originalUrl,
        clientIp: request.ip,
        body: shouldLogBody ? sanitizeForLog(request.body) : undefined,
      },
    });

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - startedAt;
        const responseBytes = response.getHeader?.('content-length');
        this.appLogger.log({
          service: 'http',
          protocol: 'http',
          routeOrEvent: `${request.method} ${request.originalUrl}`,
          message: 'HTTP request completed',
          correlationId: requestId,
          requestId,
          userId: typeof userId === 'number' ? userId : null,
          statusCode: response.statusCode,
          durationMs,
          meta: {
            method: request.method,
            path: request.originalUrl,
            responseBytes: typeof responseBytes === 'string' ? Number(responseBytes) : responseBytes,
          },
        });
      }),
    );
  }
}
