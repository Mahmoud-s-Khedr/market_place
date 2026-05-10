import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const service = new CategoriesService(databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries the database with pagination', async () => {
    const rows = [{ id: 1, name: 'Electronics', parent_id: null }];
    databaseService.query.mockResolvedValue({ rows });

    const result = await service.listCategories(20, 0);

    expect(result).toMatchObject({ categories: rows });
    expect(databaseService.query).toHaveBeenCalledTimes(1);
    expect(databaseService.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1 OFFSET $2'), [20, 0]);
  });
});
