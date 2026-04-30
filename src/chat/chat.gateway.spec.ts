import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { ChatGateway } from './chat.gateway';
import { AppConfig } from '../config/configuration';
import { SendMessageDto } from './dto/send-message.dto';
import { AppLogger } from '../common/logging/app-logger.service';
import { FkExpansionService } from '../common/relations/fk-expansion.service';

describe('ChatGateway', () => {
  const chatService = {
    assertConversationParticipant: jest.fn(),
    sendMessage: jest.fn(),
    markRead: jest.fn(),
  };

  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const configService = {
    get: jest.fn().mockReturnValue({ jwtAccessSecret: 'secret' }),
  } as unknown as ConfigService<{ app: AppConfig }, true>;

  const appLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as AppLogger;
  const fkExpansionService = {
    expand: jest.fn(async (value: unknown) => value),
  } as unknown as FkExpansionService;
  const gateway = new ChatGateway(chatService as any, jwtService, configService, appLogger, fkExpansionService);

  const makeSocket = (user?: object) => ({
    id: 'test-socket',
    nsp: { name: '/chat' },
    handshake: {
      auth: { token: 'test-token' },
      headers: {},
    },
    data: { user },
    disconnect: jest.fn(),
    join: jest.fn(),
    emit: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (fkExpansionService.expand as jest.Mock).mockImplementation(async (value: unknown) => value);
  });

  describe('handleConnection', () => {
    it('sets user on socket data when token is valid', async () => {
      const payload = { sub: 1, phone: '+201000000001', isAdmin: false };
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(payload);

      const client = makeSocket();
      await gateway.handleConnection(client as any);

      expect(client.data.user).toEqual(payload);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when token is invalid', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('Invalid token'));

      const client = makeSocket();
      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('joinConversation', () => {
    it('joins the room when participant is valid', async () => {
      chatService.assertConversationParticipant.mockResolvedValue(undefined);
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const emitToRoom = jest.fn();
      const client = {
        ...makeSocket(user),
        to: jest.fn().mockReturnValue({ emit: emitToRoom }),
      };

      const result = await gateway.joinConversation(client as any, { conversationId: 5 });

      expect(client.join).toHaveBeenCalledWith('conversation:5');
      expect(client.to).toHaveBeenCalledWith('conversation:5');
      expect(emitToRoom).toHaveBeenCalledWith(
        'conversation.joined',
        expect.objectContaining({ success: true, conversationId: 5, room: 'conversation:5' }),
      );
      expect(result).toMatchObject({ success: true, room: 'conversation:5' });
    });
  });

  describe('sendMessage', () => {
    it('calls chatService.sendMessage and returns expanded response with sender info', async () => {
      const response = { message: { id: 1, conversation_id: 5, sender_id: 1, text: 'Hello' } };
      chatService.sendMessage.mockResolvedValue(response);
      (fkExpansionService.expand as jest.Mock).mockResolvedValue({
        success: true,
        message: {
          id: 1,
          text: 'Hello',
          sender: { id: 1, name: 'User 1' },
        },
      });
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const client = makeSocket(user);

      gateway.server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as any;

      const result = await gateway.sendMessage(client as any, { conversationId: 5, text: 'Hello' });

      expect(chatService.sendMessage).toHaveBeenCalledWith(1, 5, 'Hello');
      expect(fkExpansionService.expand).toHaveBeenCalledWith({ success: true, ...response });
      expect(result).toEqual({
        success: true,
        message: {
          id: 1,
          text: 'Hello',
          sender: { id: 1, name: 'User 1' },
        },
      });
    });

    it('propagates service exceptions for filter handling', async () => {
      chatService.sendMessage.mockRejectedValue(new ForbiddenException('Conversation is not allowed'));
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const client = makeSocket(user);

      await expect(
        gateway.sendMessage(client as any, { conversationId: 5, text: 'Hello' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validation behavior', () => {
    const pipe = new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: () => new WsException({ code: 'VALIDATION_ERROR', message: 'Invalid payload' }),
    });

    it('accepts conversationId numeric string via implicit conversion', async () => {
      const transformed = await pipe.transform(
        { conversationId: '6', text: 'hello' },
        { type: 'body', metatype: SendMessageDto, data: '' },
      );

      expect((transformed as SendMessageDto).conversationId).toBe(6);
    });

    it('throws structured validation exception on invalid payload', async () => {
      await expect(
        pipe.transform(
          { conversationId: 0, text: '' },
          { type: 'body', metatype: SendMessageDto, data: '' },
        ),
      ).rejects.toBeInstanceOf(WsException);
    });
  });
});
