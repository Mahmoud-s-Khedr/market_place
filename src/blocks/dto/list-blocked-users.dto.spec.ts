import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListBlockedUsersDto } from './list-blocked-users.dto';

describe('ListBlockedUsersDto', () => {
  it('rejects invalid pagination values', async () => {
    const dto = plainToInstance(ListBlockedUsersDto, { limit: 101, offset: -2 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid pagination values', async () => {
    const dto = plainToInstance(ListBlockedUsersDto, { limit: 20, offset: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
