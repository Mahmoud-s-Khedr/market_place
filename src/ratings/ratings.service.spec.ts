import { NotFoundException } from '@nestjs/common';
import { RatingsService } from './ratings.service';

describe('RatingsService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const service = new RatingsService(databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects rating when rated user does not exist', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      service.rateUser(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        { ratedUserId: 99, ratingValue: 5, comment: 'great' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
