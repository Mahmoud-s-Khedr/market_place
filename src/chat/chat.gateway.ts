import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { AppConfig } from '../config/configuration';
import { JoinConversationDto } from './dto/join-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkMessageReadDto } from './dto/mark-message-read.dto';

type WsUser = {
  sub: number;
  phone: string;
  isAdmin: boolean;
};

@WebSocketGateway({ namespace: '/chat' })
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const appConfig = this.configService.get('app', { infer: true });
      const payload = await this.jwtService.verifyAsync<WsUser>(token, {
        secret: appConfig.jwtAccessSecret,
      });
      client.data.user = payload;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`WebSocket auth failed for client ${client.id}: ${msg}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('conversation.join')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinConversationDto,
  ): Promise<Record<string, unknown>> {
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      client.emit('error', { event: 'conversation.join', message });
      return { success: false };
    }
  }

  @SubscribeMessage('message.send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SendMessageDto,
  ): Promise<Record<string, unknown>> {
    try {
      const user = this.getUser(client);
      const response = await this.chatService.sendMessage(user.sub, body.conversationId, body.text);
      const wsPayload = { success: true, ...response };

      const room = this.roomName(body.conversationId);
      this.server.to(room).emit('message.received', wsPayload);

      return wsPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      client.emit('error', { event: 'message.send', message });
      return { success: false };
    }
  }

  @SubscribeMessage('message.read')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: MarkMessageReadDto,
  ): Promise<Record<string, unknown>> {
    try {
      const user = this.getUser(client);
      const response = await this.chatService.markRead(user.sub, body.messageId);
      const wsPayload = { success: true, ...response };

      const conversationId = (response.message as { conversation_id: number }).conversation_id;
      this.server.to(this.roomName(conversationId)).emit('message.read', wsPayload);

      return wsPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      client.emit('error', { event: 'message.read', message });
      return { success: false };
    }
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
      throw new Error('Unauthorized');
    }
    return user;
  }

  private roomName(conversationId: number): string {
    return `conversation:${conversationId}`;
  }
}
