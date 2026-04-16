import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const service = new FavoritesService(databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects adding a non-existent product', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(service.addFavorite({ sub: 1, phone: '+2010', isAdmin: false }, 999)).rejects.toThrow(NotFoundException);
  });

  it('rejects adding favorite when users are blocked', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10, owner_id: 2 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ exists: true }] });

    await expect(service.addFavorite({ sub: 1, phone: '+2010', isAdmin: false }, 10)).rejects.toThrow(BadRequestException);
  });
});
