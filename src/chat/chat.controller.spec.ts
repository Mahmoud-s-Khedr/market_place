import { ChatController } from './chat.controller';
import { ChatJoinedPayloadBuilder } from './chat-joined-payload.builder';
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
  const chatJoinedPayloadBuilder = {
    buildConversationJoinedPayload: jest.fn(),
  } as unknown as ChatJoinedPayloadBuilder;

  const controller = new ChatController(chatService, chatSocketRegistry, chatJoinedPayloadBuilder);

  beforeEach(() => {
    jest.clearAllMocks();
    (chatJoinedPayloadBuilder.buildConversationJoinedPayload as jest.Mock).mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: 212, peer_user_id: 541 },
    });
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
        statusCode: 200,
        data: expect.objectContaining({ id: 212 }),
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
        statusCode: 200,
      }),
    );
  });
});
