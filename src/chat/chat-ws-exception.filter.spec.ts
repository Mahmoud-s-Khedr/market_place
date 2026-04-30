import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ChatWsExceptionFilter } from './chat-ws-exception.filter';
import { AppLogger } from '../common/logging/app-logger.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

describe('ChatWsExceptionFilter', () => {
  const appLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as AppLogger;
  const configService = {
    get: jest.fn().mockReturnValue({ logWsPayload: false }),
  } as unknown as ConfigService<{ app: AppConfig }, true>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeHost = (event = 'message.send', data: unknown = {}, userId?: number) => {
    const emit = jest.fn();
    const client = {
      id: 'sock-1',
      nsp: { name: '/chat' },
      data: { user: userId ? { sub: userId } : undefined },
      emit,
    };
    const host = {
      switchToWs: () => ({
        getClient: () => client,
        getPattern: () => event,
        getData: () => data,
      }),
    } as unknown as ArgumentsHost;
    return { host, emit };
  };

  it('maps validation ws exception into structured chat.error details', () => {
    const filter = new ChatWsExceptionFilter(appLogger, configService);
    const { host, emit } = makeHost('message.send', { conversationId: 0, text: '' }, 10);
    const exception = new WsException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid payload',
      details: [{ field: 'text', rule: 'isLength', message: 'text must be longer than or equal to 1 characters' }],
    });

    filter.catch(exception, host);

    expect(emit).toHaveBeenCalledWith(
      'chat.error',
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          event: 'message.send',
          message: 'Invalid payload',
          details: expect.any(Array),
          correlationId: expect.any(String),
          timestamp: expect.any(String),
        }),
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'exception',
      expect.objectContaining({
        status: 'error',
        cause: expect.objectContaining({
          pattern: 'message.send',
          code: 'VALIDATION_ERROR',
          correlationId: expect.any(String),
        }),
      }),
    );
  });

  it('maps unauthorized exception', () => {
    const filter = new ChatWsExceptionFilter(appLogger, configService);
    const { host, emit } = makeHost('conversation.join');

    filter.catch(new UnauthorizedException('Unauthorized'), host);

    expect(emit).toHaveBeenCalledWith(
      'chat.error',
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHORIZED',
          event: 'conversation.join',
        }),
      }),
    );
  });

  it('maps forbidden and not found exception codes', () => {
    const filter = new ChatWsExceptionFilter(appLogger, configService);
    const forbidden = makeHost('message.send');
    filter.catch(new ForbiddenException('Conversation is not allowed'), forbidden.host);
    expect(forbidden.emit).toHaveBeenCalledWith(
      'chat.error',
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
      }),
    );

    const notFound = makeHost('message.read');
    filter.catch(new NotFoundException('Message not found'), notFound.host);
    expect(notFound.emit).toHaveBeenCalledWith(
      'chat.error',
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    );
  });

  it('maps unknown exceptions to internal error without leaking details', () => {
    const filter = new ChatWsExceptionFilter(appLogger, configService);
    const { host, emit } = makeHost('message.send');

    filter.catch(new Error('database blew up'), host);

    expect(emit).toHaveBeenCalledWith(
      'chat.error',
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        }),
      }),
    );
  });

  it('maps bad request to validation error', () => {
    const filter = new ChatWsExceptionFilter(appLogger, configService);
    const { host, emit } = makeHost('message.send');
    filter.catch(new BadRequestException({ message: 'Invalid payload', details: [{ field: 'conversationId' }] }), host);

    expect(emit).toHaveBeenCalledWith(
      'chat.error',
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.arrayContaining([expect.objectContaining({ field: 'conversationId' })]),
        }),
      }),
    );
  });
});
