import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { requestContext } from '../context/request-context';
import { AppLogger } from '../logging/app-logger.service';
import { sanitizeForLog } from '../logging/logging.utils';

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly appLogger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorBody =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const message =
      typeof errorBody === 'string'
        ? errorBody
        : Array.isArray((errorBody as { message?: unknown }).message)
          ? (errorBody as { message: string[] }).message.join(', ')
          : ((errorBody as { message?: string }).message ?? 'Unknown error');

    const requestId = requestContext.getStore()?.requestId;
    const userId = (request.user as { sub?: unknown } | undefined)?.sub;
    const logPayload = {
      service: 'http',
      protocol: 'http' as const,
      routeOrEvent: `${request.method} ${request.url}`,
      message: 'HTTP request failed',
      correlationId: requestId,
      requestId,
      userId: typeof userId === 'number' ? userId : null,
      statusCode: status,
      meta: {
        method: request.method,
        path: request.url,
        errorMessage: message,
        exceptionType: exception instanceof Error ? exception.name : typeof exception,
        query: sanitizeForLog(request.query),
      },
    };
    if (status >= 500) {
      this.appLogger.error(logPayload);
    } else {
      this.appLogger.warn(logPayload);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      data: null,
      error: {
        code: status,
        message,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }
}

