import { ChatSocketRegistryService } from './chat-socket-registry.service';

describe('ChatSocketRegistryService', () => {
  const makeSocket = () => ({
    join: jest.fn().mockResolvedValue(undefined),
  });

  it('joins participant sockets to room and emits conversation.joined', async () => {
    const service = new ChatSocketRegistryService();
    const emit = jest.fn();
    service.setServer({ to: jest.fn().mockReturnValue({ emit }) } as any);

    const socketA = makeSocket();
    const socketB = makeSocket();
    service.registerUserSocket(1, socketA as any);
    service.registerUserSocket(2, socketB as any);

    const payload = { success: true, conversationId: 44 };
    await service.emitConversationJoinedToParticipants(44, [1, 2], payload);

    expect(socketA.join).toHaveBeenCalledWith('conversation:44');
    expect(socketB.join).toHaveBeenCalledWith('conversation:44');
    expect(emit).toHaveBeenCalledWith('conversation.joined', payload);
  });
});
