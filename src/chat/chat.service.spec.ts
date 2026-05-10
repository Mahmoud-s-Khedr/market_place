import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const service = new ChatService(databaseService as any);

  beforeEach(() => {
    jest.restoreAllMocks();
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

  it('normalizes message timestamps to ISO strings', async () => {
    jest.spyOn(service, 'assertConversationParticipant').mockResolvedValue(undefined);
    databaseService.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          conversation_id: 10,
          sender_id: 1,
          message_text: 'hello',
          sent_at: new Date('2026-01-01T00:00:00.000Z'),
          read_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.sendMessage(1, 10, 'hello');

    expect((result.message as Record<string, unknown>).sent_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('normalizes conversation last_message_sent_at in listConversations', async () => {
    databaseService.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        last_message_sent_at: new Date('2026-01-01T00:01:00.000Z'),
      }],
    });

    const result = await service.listConversations(1, 'all');
    const row = (result.conversations as Array<Record<string, unknown>>)[0];
    expect(row.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect(row.last_message_sent_at).toBe('2026-01-01T00:01:00.000Z');
  });

  it('throws forbidden with NOT_PARTICIPANT reason when sender is outside conversation', async () => {
    databaseService.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 12, user_a_id: 7, user_b_id: 8 }],
    });

    try {
      await service.sendMessage(99, 12, 'hello');
      throw new Error('Expected forbidden exception');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(response.reason).toBe('NOT_PARTICIPANT');
      expect(response.context).toMatchObject({ conversationId: 12, userId: 99, userAId: 7, userBId: 8 });
    }
  });

  it('throws forbidden with CONVERSATION_BLOCKED reason when participants are blocked', async () => {
    databaseService.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 14, user_a_id: 1, user_b_id: 2 }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ exists: true }],
      });

    try {
      await service.sendMessage(1, 14, 'hello');
      throw new Error('Expected forbidden exception');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(response.reason).toBe('CONVERSATION_BLOCKED');
      expect(response.context).toMatchObject({ conversationId: 14, userId: 1, userAId: 1, userBId: 2 });
    }
  });
});
