import { ChatSocketRegistryService } from './chat-socket-registry.service';

describe('ChatSocketRegistryService', () => {
  const makeSocket = () => ({
    join: jest.fn().mockResolvedValue(undefined),
  });
  const appLogger = {
    debug: jest.fn(),
  };

  it('joins participant sockets to room and emits conversation.joined', async () => {
    const service = new ChatSocketRegistryService(appLogger as any);
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

  it('normalizes string participant IDs and ignores invalid values', async () => {
    const service = new ChatSocketRegistryService(appLogger as any);
    const emit = jest.fn();
    service.setServer({ to: jest.fn().mockReturnValue({ emit }) } as any);

    const socketA = makeSocket();
    const socketB = makeSocket();
    service.registerUserSocket(550, socketA as any);
    service.registerUserSocket(542, socketB as any);

    const payload = { success: true, conversationId: 215 };
    await service.emitConversationJoinedToParticipants(215, ['550', 550, '542', 'bad'], payload);

    expect(socketA.join).toHaveBeenCalledWith('conversation:215');
    expect(socketB.join).toHaveBeenCalledWith('conversation:215');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('conversation.joined', payload);
  });
});
