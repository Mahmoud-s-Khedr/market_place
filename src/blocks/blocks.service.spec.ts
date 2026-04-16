import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlocksService } from './blocks.service';

describe('BlocksService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const service = new BlocksService(databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects self block', async () => {
    await expect(service.blockUser({ sub: 5, phone: '+2010', isAdmin: false }, 5)).rejects.toThrow(BadRequestException);
  });

  it('rejects blocking non-existent user', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.blockUser({ sub: 5, phone: '+2010', isAdmin: false }, 99)).rejects.toThrow(NotFoundException);
  });
});
