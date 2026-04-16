import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  const databaseService = {
    query: jest.fn(),
  };
  const fileReadUrlService = {
    buildReadUrl: jest.fn().mockReturnValue('https://cdn.example/avatar.jpg'),
  };

  const service = new ChatService(databaseService as any, fileReadUrlService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects conversation creation when participant does not exist', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(service.getOrCreateConversation(1, 99)).rejects.toThrow(NotFoundException);
  });

  it('maps message FK violations to NotFoundException', async () => {
    jest.spyOn(service, 'assertConversationParticipant').mockResolvedValue(undefined);
    databaseService.query.mockRejectedValueOnce({ code: '23503' });

    await expect(service.sendMessage(1, 10, 'hello')).rejects.toThrow(NotFoundException);
  });
});
