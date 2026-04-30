import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
import { ChatService } from './chat.service';
import { AppConfig } from '../config/configuration';
import { JoinConversationDto } from './dto/join-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkMessageReadDto } from './dto/mark-message-read.dto';
import { ChatWsExceptionFilter } from './chat-ws-exception.filter';
import { AppLogger } from '../common/logging/app-logger.service';
import { FkExpansionService } from '../common/relations/fk-expansion.service';

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
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
    private readonly appLogger: AppLogger,
    private readonly fkExpansionService: FkExpansionService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const correlationId = (client.handshake.headers['x-request-id'] as string | undefined) ?? client.id;
    try {
      const token = this.extractToken(client);
      const appConfig = this.configService.get('app', { infer: true });
      const payload = await this.jwtService.verifyAsync<WsUser>(token, {
        secret: appConfig.jwtAccessSecret,
      });
      client.data.user = payload;
      this.appLogger.log({
        service: 'chat-ws',
        protocol: 'ws',
        routeOrEvent: 'connection',
        message: 'WebSocket client connected',
        correlationId,
        requestId: correlationId,
        userId: payload.sub,
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
    const correlationId = (client.handshake.headers['x-request-id'] as string | undefined) ?? client.id;
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
    const user = this.getUser(client);
    await this.chatService.assertConversationParticipant(body.conversationId, user.sub);

    const room = this.roomName(body.conversationId);
    await client.join(room);
    client.to(room).emit('conversation.joined', {
      success: true,
      conversationId: body.conversationId,
      room,
      joinedAt: new Date().toISOString(),
    });

    return { success: true, room };
  }

  @SubscribeMessage('message.send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    const user = this.getUser(client);
    const response = await this.chatService.sendMessage(user.sub, body.conversationId, body.text);
    const wsPayload = await this.fkExpansionService.expand({ success: true, ...response }) as Record<string, unknown>;

    const room = this.roomName(body.conversationId);
    await client.join(room);
    this.server.to(room).emit('message.received', wsPayload);

    return wsPayload;
  }

  @SubscribeMessage('message.read')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: MarkMessageReadDto,
  ): Promise<Record<string, unknown>> {
    const user = this.getUser(client);
    const response = await this.chatService.markRead(user.sub, body.messageId);
    const wsPayload = await this.fkExpansionService.expand({ success: true, ...response }) as Record<string, unknown>;

    const conversationId = (response.message as { conversation_id: number }).conversation_id;
    const room = this.roomName(conversationId);
    await client.join(room);
    this.server.to(room).emit('message.read', wsPayload);

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
