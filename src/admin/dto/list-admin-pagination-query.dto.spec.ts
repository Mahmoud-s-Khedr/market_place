import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListAdminPaginationQueryDto } from './list-admin-pagination-query.dto';

describe('ListAdminPaginationQueryDto', () => {
  it('rejects invalid pagination values', async () => {
    const dto = plainToInstance(ListAdminPaginationQueryDto, { limit: 0, offset: 10001 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid pagination values', async () => {
    const dto = plainToInstance(ListAdminPaginationQueryDto, { limit: 20, offset: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
