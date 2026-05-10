import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListCategoriesDto } from './list-categories.dto';

describe('ListCategoriesDto', () => {
  it('rejects invalid pagination values', async () => {
    const dto = plainToInstance(ListCategoriesDto, { limit: 0, offset: -1 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid pagination values', async () => {
    const dto = plainToInstance(ListCategoriesDto, { limit: 20, offset: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
