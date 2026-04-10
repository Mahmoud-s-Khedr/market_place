import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const redisService = {
    del: jest.fn().mockResolvedValue(undefined),
  };

  const categoriesService = {
    createCategory: jest.fn(),
    deleteCategory: jest.fn(),
  };

  const service = new AdminService(databaseService as any, redisService as any, categoriesService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects warning creation when target user does not exist', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      service.createWarning(
        { sub: 1, phone: '+201000000001', isAdmin: true },
        { targetUserId: 99, message: 'warning text' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists admins only', async () => {
    databaseService.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 2, name: 'Admin', phone: '+201000000002', status: 'active', is_admin: true }],
    });

    const result = await service.listAdmins();

    expect(result).toEqual({
      success: true,
      admins: [{ id: 2, name: 'Admin', phone: '+201000000002', status: 'active', is_admin: true }],
    });
  });

  it('promotes a regular user to admin', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7, is_admin: false }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 7, name: 'User', phone: '+201000000007', status: 'active', is_admin: true, token_version: 1 }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await service.promoteAdmin(
      { sub: 1, phone: '+201000000001', isAdmin: true },
      7,
    );

    expect(result).toEqual({
      success: true,
      user: { id: 7, name: 'User', phone: '+201000000007', status: 'active', is_admin: true, token_version: 1 },
    });
  });

  it('rejects promote when user is already admin', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7, is_admin: true }] });

    await expect(
      service.promoteAdmin({ sub: 1, phone: '+201000000001', isAdmin: true }, 7),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects demote for self-demotion', async () => {
    await expect(
      service.demoteAdmin({ sub: 1, phone: '+201000000001', isAdmin: true }, 1),
    ).rejects.toThrow(BadRequestException);
  });

  it('demotes another admin', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 8, is_admin: true }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 8, name: 'Other Admin', phone: '+201000000008', status: 'active', is_admin: false, token_version: 4 }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await service.demoteAdmin(
      { sub: 1, phone: '+201000000001', isAdmin: true },
      8,
    );

    expect(result).toEqual({
      success: true,
      user: { id: 8, name: 'Other Admin', phone: '+201000000008', status: 'active', is_admin: false, token_version: 4 },
    });
  });
});
