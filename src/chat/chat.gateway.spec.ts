import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { AppConfig } from '../config/configuration';

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

  const gateway = new ChatGateway(chatService as any, jwtService, configService);

  const makeSocket = (user?: object) => ({
    id: 'test-socket',
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

    it('disconnects when token is missing', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('Missing token'));

      const client = { ...makeSocket(), handshake: { auth: {}, headers: {} } };
      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('joinConversation', () => {
    it('joins the room when participant is valid', async () => {
      chatService.assertConversationParticipant.mockResolvedValue(undefined);
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const client = makeSocket(user);

      const result = await gateway.joinConversation(client as any, { conversationId: 5 });

      expect(client.join).toHaveBeenCalledWith('conversation:5');
      expect(client.emit).toHaveBeenCalledWith(
        'conversation.joined',
        expect.objectContaining({ success: true, conversationId: 5, room: 'conversation:5' }),
      );
      expect(result).toMatchObject({ success: true, room: 'conversation:5' });
    });

    it('emits error event and returns failure when participant check fails', async () => {
      chatService.assertConversationParticipant.mockRejectedValue(
        new ForbiddenException('Not a participant'),
      );
      const user = { sub: 2, phone: '+201000000002', isAdmin: false };
      const client = makeSocket(user);

      const result = await gateway.joinConversation(client as any, { conversationId: 5 });

      expect(client.emit).toHaveBeenCalledWith('error', expect.objectContaining({ event: 'conversation.join' }));
      expect(result).toMatchObject({ success: false });
    });
  });

  describe('sendMessage', () => {
    it('calls chatService.sendMessage and returns response', async () => {
      const response = { success: true, message: { id: 1, text: 'Hello' } };
      chatService.sendMessage.mockResolvedValue(response);
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const client = makeSocket(user);

      gateway.server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as any;

      const result = await gateway.sendMessage(client as any, { conversationId: 5, text: 'Hello' });

      expect(chatService.sendMessage).toHaveBeenCalledWith(1, 5, 'Hello');
      expect(result).toEqual(response);
    });

    it('emits error event when sendMessage fails', async () => {
      chatService.sendMessage.mockRejectedValue(new Error('DB error'));
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const client = makeSocket(user);

      const result = await gateway.sendMessage(client as any, { conversationId: 5, text: 'Hello' });

      expect(client.emit).toHaveBeenCalledWith('error', expect.objectContaining({ event: 'message.send' }));
      expect(result).toMatchObject({ success: false });
    });
  });

  describe('markRead', () => {
    it('emits error event when markRead fails', async () => {
      chatService.markRead.mockRejectedValue(new Error('Not found'));
      const user = { sub: 1, phone: '+201000000001', isAdmin: false };
      const client = makeSocket(user);

      const result = await gateway.markRead(client as any, { messageId: 99 });

      expect(client.emit).toHaveBeenCalledWith('error', expect.objectContaining({ event: 'message.read' }));
      expect(result).toMatchObject({ success: false });
    });
  });
});
