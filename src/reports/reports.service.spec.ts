import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const service = new ReportsService(databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects report creation when reported user does not exist', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      service.createReport(
        { sub: 1, phone: '+201000000001', isAdmin: false },
        { reportedUserId: 99, reason: 'fraudulent behavior' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
