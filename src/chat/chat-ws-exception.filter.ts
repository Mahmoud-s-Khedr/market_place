import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import { Socket } from 'socket.io';
import { AppLogger } from '../common/logging/app-logger.service';
import { payloadShape, sanitizeForLog } from '../common/logging/logging.utils';
import { AppConfig } from '../config/configuration';

type ChatErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

@Catch()
@Injectable()
export class ChatWsExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly appLogger: AppLogger,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const wsCtx = host.switchToWs();
    const client = wsCtx.getClient<Socket>();
    const event = String(wsCtx.getPattern?.() ?? 'unknown');
    const payload = wsCtx.getData();
    const correlationId = randomUUID();
    const normalized = this.normalizeError(exception, event, correlationId);

    const envelope = {
      success: false,
      error: normalized,
    };

    client.emit('chat.error', envelope);
    client.emit('exception', {
      status: 'error',
      message: normalized.message,
      cause: {
        pattern: event,
        data: payload,
        code: normalized.code,
        correlationId,
      },
    });

    const shouldLogWsPayload = this.configService.get('app', { infer: true }).logWsPayload;
    const logPayload = {
      service: 'chat-ws',
      protocol: 'ws' as const,
      routeOrEvent: event,
      message: 'WebSocket event failed',
      correlationId,
      requestId: correlationId,
      userId: this.getUserId(client),
      statusCode: normalized.statusCode,
      meta: {
        namespace: client.nsp?.name ?? '/chat',
        socketId: client.id,
        payload: shouldLogWsPayload ? sanitizeForLog(payload) : undefined,
        payloadShape: payloadShape(payload),
        code: normalized.code,
        detailsCount: normalized.details?.length ?? 0,
        details: normalized.details?.slice(0, 5),
        exceptionType: getExceptionName(exception),
      },
    };

    if (normalized.statusCode >= 500) {
      this.appLogger.error(logPayload);
      return;
    }
    this.appLogger.warn(logPayload);
  }

  private normalizeError(
    exception: unknown,
    event: string,
    correlationId: string,
  ): {
    code: ChatErrorCode;
    event: string;
    message: string;
    details?: Array<Record<string, unknown>>;
    correlationId: string;
    timestamp: string;
    statusCode: number;
  } {
    const timestamp = new Date().toISOString();

    if (exception instanceof WsException) {
      const wsError = exception.getError();
      if (typeof wsError === 'object' && wsError !== null) {
        const obj = wsError as {
          code?: ChatErrorCode;
          message?: string;
          details?: Array<Record<string, unknown>>;
        };
        return {
          code: obj.code ?? 'INTERNAL_ERROR',
          event,
          message: obj.message ?? 'Internal server error',
          details: obj.details,
          correlationId,
          timestamp,
          statusCode: obj.code === 'VALIDATION_ERROR' ? 400 : 500,
        };
      }
      return {
        code: 'INTERNAL_ERROR',
        event,
        message: typeof wsError === 'string' ? wsError : 'Internal server error',
        correlationId,
        timestamp,
        statusCode: 500,
      };
    }

    if (exception instanceof BadRequestException) {
      const response = exception.getResponse();
      const { message, details } = extractBadRequestDetails(response);
      return {
        code: 'VALIDATION_ERROR',
        event,
        message,
        details,
        correlationId,
        timestamp,
        statusCode: 400,
      };
    }

    if (exception instanceof UnauthorizedException) {
      return {
        code: 'UNAUTHORIZED',
        event,
        message: exception.message || 'Unauthorized',
        correlationId,
        timestamp,
        statusCode: 401,
      };
    }

    if (exception instanceof ForbiddenException) {
      return {
        code: 'FORBIDDEN',
        event,
        message: exception.message || 'Forbidden',
        correlationId,
        timestamp,
        statusCode: 403,
      };
    }

    if (exception instanceof NotFoundException) {
      return {
        code: 'NOT_FOUND',
        event,
        message: exception.message || 'Not found',
        correlationId,
        timestamp,
        statusCode: 404,
      };
    }

    return {
      code: 'INTERNAL_ERROR',
      event,
      message: 'Internal server error',
      correlationId,
      timestamp,
      statusCode: 500,
    };
  }

  private getUserId(client: Socket): number | null {
    const sub = (client.data.user as { sub?: unknown } | undefined)?.sub;
    return typeof sub === 'number' ? sub : null;
  }
}

function extractBadRequestDetails(response: unknown): {
  message: string;
  details?: Array<Record<string, unknown>>;
} {
  if (typeof response === 'string') {
    return { message: response };
  }
  if (typeof response !== 'object' || response === null) {
    return { message: 'Invalid payload' };
  }
  const body = response as { message?: unknown; details?: unknown };
  const message = Array.isArray(body.message)
    ? body.message.join(', ')
    : (typeof body.message === 'string' ? body.message : 'Invalid payload');
  const details = Array.isArray(body.details)
    ? (body.details as Array<Record<string, unknown>>)
    : undefined;
  return { message, details };
}

function getExceptionName(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.name;
  }
  return typeof exception;
}
