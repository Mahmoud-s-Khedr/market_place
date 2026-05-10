import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListConversationsDto } from './list-conversations.dto';

describe('ListConversationsDto', () => {
  it('rejects invalid pagination values', async () => {
    const dto = plainToInstance(ListConversationsDto, { limit: 0, offset: -1 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid scope and pagination', async () => {
    const dto = plainToInstance(ListConversationsDto, { scope: 'buy', limit: 20, offset: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
