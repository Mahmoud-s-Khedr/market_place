import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSocketRegistryService } from './chat-socket-registry.service';

describe('ChatController', () => {
  const chatService = {
    getOrCreateConversation: jest.fn(),
    getConversationParticipants: jest.fn(),
  } as unknown as ChatService;

  const chatSocketRegistry = {
    emitConversationJoinedToParticipants: jest.fn(),
  } as unknown as ChatSocketRegistryService;

  const controller = new ChatController(chatService, chatSocketRegistry);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits conversation.joined to both participants after REST create/get', async () => {
    (chatService.getOrCreateConversation as jest.Mock).mockResolvedValue({
      conversation: { id: 212, peer_user_id: 541 },
    });
    (chatService.getConversationParticipants as jest.Mock).mockResolvedValue({
      userAId: 550,
      userBId: 541,
    });

    const res = await controller.createConversation(
      { sub: 550 } as any,
      { participantId: 541 } as any,
    );

    expect(res).toEqual({ conversation: { id: 212, peer_user_id: 541 } });
    expect(chatSocketRegistry.emitConversationJoinedToParticipants).toHaveBeenCalledWith(
      212,
      [550, 541],
      expect.objectContaining({
        success: true,
        conversationId: 212,
        room: 'conversation:212',
        joinedAt: expect.any(String),
        conversation: expect.objectContaining({ id: 212 }),
      }),
    );
  });

  it('passes through participant IDs when service returns BIGINT-like strings', async () => {
    (chatService.getOrCreateConversation as jest.Mock).mockResolvedValue({
      conversation: { id: 215, peer_user_id: 542 },
    });
    (chatService.getConversationParticipants as jest.Mock).mockResolvedValue({
      userAId: '550',
      userBId: '542',
    });

    await controller.createConversation(
      { sub: 550 } as any,
      { participantId: 542 } as any,
    );

    expect(chatSocketRegistry.emitConversationJoinedToParticipants).toHaveBeenCalledWith(
      215,
      ['550', '542'],
      expect.objectContaining({
        success: true,
        conversationId: 215,
        room: 'conversation:215',
      }),
    );
  });
});
