import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JoinConversationDto } from './join-conversation.dto';
import { MarkMessageReadDto } from './mark-message-read.dto';
import { SendMessageDto } from './send-message.dto';

describe('Chat websocket DTOs', () => {
  it('rejects invalid join payload', async () => {
    const dto = plainToInstance(JoinConversationDto, { conversationId: 0 });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid send payload', async () => {
    const dto = plainToInstance(SendMessageDto, { conversationId: 1, text: '' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid read payload', async () => {
    const dto = plainToInstance(MarkMessageReadDto, { messageId: 10 });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
