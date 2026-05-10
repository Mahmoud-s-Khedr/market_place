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

type ChatForbiddenReason =
  | 'NOT_PARTICIPANT'
  | 'CONVERSATION_BLOCKED';

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
    const correlationId = this.getCorrelationId(client);
    const normalized = this.normalizeError(exception, event, correlationId);

    const envelope = {
      success: false,
      error: {
        ...normalized,
        context: this.exposeSafeContext(event, normalized.code, normalized.context),
      },
    };

    client.emit('chat.error', envelope);
    this.appLogger.log({
      service: 'chat-ws',
      protocol: 'ws',
      routeOrEvent: 'chat.error',
      message: 'WebSocket emit sent',
      correlationId,
      requestId: correlationId,
      userId: this.getUserId(client),
      meta: {
        namespace: client.nsp?.name ?? '/chat',
        socketId: client.id,
        payloadShape: payloadShape(envelope),
      },
    });
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
        reason: normalized.reason,
        conversationId: this.extractConversationId(payload, normalized.context),
        participantIds: this.extractParticipantIds(normalized.context),
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
    reason?: ChatForbiddenReason;
    context?: Record<string, unknown>;
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
      const response = exception.getResponse();
      const { message, reason, context } = extractForbiddenDetails(response);
      return {
        code: 'FORBIDDEN',
        event,
        message,
        reason,
        context,
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

  private getCorrelationId(client: Socket): string {
    const fromHeader = client.handshake.headers['x-request-id'];
    if (typeof fromHeader === 'string' && fromHeader.length > 0) {
      return fromHeader;
    }
    return randomUUID();
  }

  private exposeSafeContext(
    event: string,
    code: ChatErrorCode,
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (event !== 'message.send' || code !== 'FORBIDDEN' || !context) {
      return undefined;
    }
    const safe: Record<string, unknown> = {};
    const conversationId = toPositiveInt(context.conversationId);
    if (conversationId !== null) {
      safe.conversationId = conversationId;
    }
    return safe;
  }

  private extractConversationId(payload: unknown, context?: Record<string, unknown>): number | null {
    if (typeof payload === 'object' && payload !== null) {
      const payloadId = toPositiveInt((payload as { conversationId?: unknown }).conversationId);
      if (payloadId !== null) {
        return payloadId;
      }
    }
    return toPositiveInt(context?.conversationId);
  }

  private extractParticipantIds(context?: Record<string, unknown>): number[] | undefined {
    const userAId = toPositiveInt(context?.userAId);
    const userBId = toPositiveInt(context?.userBId);
    if (userAId === null || userBId === null) {
      return undefined;
    }
    return [userAId, userBId];
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

function extractForbiddenDetails(response: unknown): {
  message: string;
  reason?: ChatForbiddenReason;
  context?: Record<string, unknown>;
} {
  if (typeof response === 'string') {
    return { message: response };
  }
  if (typeof response !== 'object' || response === null) {
    return { message: 'Forbidden' };
  }
  const body = response as { message?: unknown; reason?: unknown; context?: unknown };
  const message = Array.isArray(body.message)
    ? body.message.join(', ')
    : (typeof body.message === 'string' ? body.message : 'Forbidden');
  const reason = typeof body.reason === 'string' ? body.reason as ChatForbiddenReason : undefined;
  const context = typeof body.context === 'object' && body.context !== null
    ? body.context as Record<string, unknown>
    : undefined;
  return { message, reason, context };
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function getExceptionName(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.name;
  }
  return typeof exception;
}
