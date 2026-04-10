import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const service = new CategoriesService(databaseService as any, redisService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cached categories without hitting the database on cache hit', async () => {
    const cached = [{ id: 1, name: 'Electronics', parent_id: null }];
    redisService.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.listCategories();

    expect(result).toMatchObject({ success: true, categories: cached });
    expect(databaseService.query).not.toHaveBeenCalled();
  });

  it('queries the database and caches the result on cache miss', async () => {
    const rows = [{ id: 1, name: 'Electronics', parent_id: null }];
    redisService.get.mockResolvedValue(null);
    databaseService.query.mockResolvedValue({ rows });
    redisService.set.mockResolvedValue(undefined);

    const result = await service.listCategories();

    expect(result).toMatchObject({ success: true, categories: rows });
    expect(databaseService.query).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'categories:tree',
      JSON.stringify(rows),
      expect.any(Number),
    );
  });
});
