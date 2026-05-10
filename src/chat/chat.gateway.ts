import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UnauthorizedException, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { ValidationError } from 'class-validator';
import { WsException } from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import { ChatService } from './chat.service';
import { AppConfig } from '../config/configuration';
import { JoinConversationDto } from './dto/join-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkMessageReadDto } from './dto/mark-message-read.dto';
import { ChatWsExceptionFilter } from './chat-ws-exception.filter';
import { AppLogger } from '../common/logging/app-logger.service';
import { FkExpansionService } from '../common/relations/fk-expansion.service';
import { payloadShape, sanitizeForLog } from '../common/logging/logging.utils';
import { ChatSocketRegistryService } from './chat-socket-registry.service';
import { ChatJoinedPayloadBuilder } from './chat-joined-payload.builder';

type WsUserPayload = {
  sub: number | string;
  phone: string;
  isAdmin: boolean;
};

type WsUser = {
  sub: number;
  phone: string;
  isAdmin: boolean;
};

@WebSocketGateway({ namespace: '/chat' })
@UseFilters(ChatWsExceptionFilter)
@UsePipes(
  new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors: ValidationError[]) => {
  const details = flattenValidationErrors(errors);
      throw new WsException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload',
        details,
      });
    },
  }),
)
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
    private readonly appLogger: AppLogger,
    private readonly fkExpansionService: FkExpansionService,
    private readonly chatSocketRegistry: ChatSocketRegistryService,
    private readonly chatJoinedPayloadBuilder: ChatJoinedPayloadBuilder,
  ) {}

  afterInit(server: Server): void {
    this.chatSocketRegistry.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const correlationId = this.getCorrelationId(client);
    try {
      const token = this.extractToken(client);
      const appConfig = this.configService.get('app', { infer: true });
      const payload = await this.jwtService.verifyAsync<WsUserPayload>(token, {
        secret: appConfig.jwtAccessSecret,
      });
      const normalizedSub = Number(payload.sub);
      if (!Number.isInteger(normalizedSub) || normalizedSub <= 0) {
        throw new Error('Invalid token subject');
      }
      client.data.user = {
        ...payload,
        sub: normalizedSub,
      } satisfies WsUser;
      this.chatSocketRegistry.registerUserSocket(normalizedSub, client);
      this.appLogger.log({
        service: 'chat-ws',
        protocol: 'ws',
        routeOrEvent: 'connection',
        message: 'WebSocket client connected',
        correlationId,
        requestId: correlationId,
        userId: normalizedSub,
        meta: { socketId: client.id, namespace: client.nsp.name },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.appLogger.warn({
        service: 'chat-ws',
        protocol: 'ws',
        routeOrEvent: 'connection',
        message: 'WebSocket auth failed',
        correlationId,
        requestId: correlationId,
        userId: null,
        statusCode: 401,
        meta: { socketId: client.id, namespace: client.nsp.name, reason: msg },
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as WsUser | undefined;
    if (user?.sub) {
      this.chatSocketRegistry.unregisterUserSocket(user.sub, client);
    }
    const correlationId = this.getCorrelationId(client);
    this.appLogger.log({
      service: 'chat-ws',
      protocol: 'ws',
      routeOrEvent: 'disconnect',
      message: 'WebSocket client disconnected',
      correlationId,
      requestId: correlationId,
      userId: user?.sub ?? null,
      meta: { socketId: client.id, namespace: client.nsp.name },
    });
  }

  @SubscribeMessage('conversation.join')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinConversationDto,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const user = this.getUser(client);
    const correlationId = this.getCorrelationId(client);
    this.logInboundEventReceived(client, {
      event: 'conversation.join',
      correlationId,
      userId: user.sub,
      payload: body,
      keyMeta: { conversationId: body.conversationId },
    });

    await this.chatService.assertConversationParticipant(body.conversationId, user.sub);
    const conversationResponse = await this.chatService.getConversationById(user.sub, body.conversationId);
    const outboundPayload = await this.chatJoinedPayloadBuilder.buildConversationJoinedPayload(conversationResponse);

    const room = this.roomName(body.conversationId);
    await client.join(room);
    this.server.to(room).emit('conversation.joined', outboundPayload);
    this.logEmitSent(client, {
      emitEvent: 'conversation.joined',
      room,
      correlationId,
      userId: user.sub,
      payload: outboundPayload,
    });

    this.logInboundEventSucceeded(client, {
      event: 'conversation.join',
      correlationId,
      userId: user.sub,
      startedAt,
      meta: { conversationId: body.conversationId, emitEvent: 'conversation.joined', room },
    });

    return { success: true, room };
  }

  @SubscribeMessage('message.send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const user = this.getUser(client);
    const correlationId = this.getCorrelationId(client);
    this.logInboundEventReceived(client, {
      event: 'message.send',
      correlationId,
      userId: user.sub,
      payload: body,
      keyMeta: { conversationId: body.conversationId },
    });

    const response = await this.chatService.sendMessage(user.sub, body.conversationId, body.text);
    const wsPayload = await this.fkExpansionService.expand({ success: true, ...response }) as Record<string, unknown>;

    const room = this.roomName(body.conversationId);
    await client.join(room);
    this.server.to(room).emit('message.received', wsPayload);
    this.logEmitSent(client, {
      emitEvent: 'message.received',
      room,
      correlationId,
      userId: user.sub,
      payload: wsPayload,
    });
    this.logInboundEventSucceeded(client, {
      event: 'message.send',
      correlationId,
      userId: user.sub,
      startedAt,
      meta: { conversationId: body.conversationId, emitEvent: 'message.received', room },
    });

    return wsPayload;
  }

  @SubscribeMessage('message.read')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: MarkMessageReadDto,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const user = this.getUser(client);
    const correlationId = this.getCorrelationId(client);
    this.logInboundEventReceived(client, {
      event: 'message.read',
      correlationId,
      userId: user.sub,
      payload: body,
      keyMeta: { messageId: body.messageId },
    });

    const response = await this.chatService.markRead(user.sub, body.messageId);
    const wsPayload = await this.fkExpansionService.expand({ success: true, ...response }) as Record<string, unknown>;

    const conversationId = (response.message as { conversation_id: number }).conversation_id;
    const room = this.roomName(conversationId);
    await client.join(room);
    this.server.to(room).emit('message.read', wsPayload);
    this.logEmitSent(client, {
      emitEvent: 'message.read',
      room,
      correlationId,
      userId: user.sub,
      payload: wsPayload,
    });
    this.logInboundEventSucceeded(client, {
      event: 'message.read',
      correlationId,
      userId: user.sub,
      startedAt,
      meta: { messageId: body.messageId, conversationId, emitEvent: 'message.read', room },
    });

    return wsPayload;
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.length > 0) {
      return header.replace(/^Bearer\s+/i, '');
    }

    throw new Error('Missing token');
  }

  private getUser(client: Socket): WsUser {
    const user = client.data.user as WsUser | undefined;
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }
    return user;
  }

  private roomName(conversationId: number): string {
    return `conversation:${conversationId}`;
  }

  private getCorrelationId(client: Socket): string {
    const fromHeader = client.handshake.headers['x-request-id'];
    if (typeof fromHeader === 'string' && fromHeader.length > 0) {
      return fromHeader;
    }
    return client.id || randomUUID();
  }

  private shouldLogWsPayload(): boolean {
    return this.configService.get('app', { infer: true }).logWsPayload;
  }

  private logInboundEventReceived(
    client: Socket,
    input: {
      event: string;
      correlationId: string;
      userId: number | null;
      payload: unknown;
      keyMeta?: Record<string, unknown>;
    },
  ): void {
    const includePayload = this.shouldLogWsPayload();
    this.appLogger.log({
      service: 'chat-ws',
      protocol: 'ws',
      routeOrEvent: input.event,
      message: 'WebSocket event received',
      correlationId: input.correlationId,
      requestId: input.correlationId,
      userId: input.userId,
      meta: {
        socketId: client.id,
        namespace: client.nsp.name,
        payload: includePayload ? sanitizeForLog(input.payload) : undefined,
        payloadShape: payloadShape(input.payload),
        ...(input.keyMeta ?? {}),
      },
    });
  }

  private logInboundEventSucceeded(
    client: Socket,
    input: {
      event: string;
      correlationId: string;
      userId: number | null;
      startedAt: number;
      meta?: Record<string, unknown>;
    },
  ): void {
    this.appLogger.log({
      service: 'chat-ws',
      protocol: 'ws',
      routeOrEvent: input.event,
      message: 'WebSocket event succeeded',
      correlationId: input.correlationId,
      requestId: input.correlationId,
      userId: input.userId,
      statusCode: 200,
      durationMs: Date.now() - input.startedAt,
      meta: {
        socketId: client.id,
        namespace: client.nsp.name,
        ...(input.meta ?? {}),
      },
    });
  }

  private logEmitSent(
    client: Socket,
    input: {
      emitEvent: string;
      room: string;
      correlationId: string;
      userId: number | null;
      payload: unknown;
    },
  ): void {
    const includePayload = this.shouldLogWsPayload();
    this.appLogger.log({
      service: 'chat-ws',
      protocol: 'ws',
      routeOrEvent: input.emitEvent,
      message: 'WebSocket emit sent',
      correlationId: input.correlationId,
      requestId: input.correlationId,
      userId: input.userId,
      meta: {
        socketId: client.id,
        namespace: client.nsp.name,
        room: input.room,
        payload: includePayload ? sanitizeForLog(input.payload) : undefined,
        payloadShape: payloadShape(input.payload),
      },
    });
  }
}

function flattenValidationErrors(errors: ValidationError[]): Array<Record<string, unknown>> {
  const details: Array<Record<string, unknown>> = [];
  const walk = (errs: ValidationError[], parentPath = ''): void => {
    for (const err of errs) {
      const field = parentPath ? `${parentPath}.${err.property}` : err.property;
      if (err.constraints) {
        for (const [rule, message] of Object.entries(err.constraints)) {
          details.push({
            field,
            rule,
            message,
            value: err.value,
          });
        }
      }
      if (err.children?.length) {
        walk(err.children, field);
      }
    }
  };
  walk(errors);
  return details;
}
