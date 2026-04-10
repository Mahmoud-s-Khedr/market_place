import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const guard = new AdminGuard(databaseService as any);

  const createContext = (user: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows admin users based on database role', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ is_admin: true }] });

    await expect(guard.canActivate(createContext({ sub: 1, isAdmin: false }))).resolves.toBe(true);
  });

  it('blocks non-admin users', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ is_admin: false }] });

    await expect(guard.canActivate(createContext({ sub: 2, isAdmin: true }))).rejects.toThrow(ForbiddenException);
  });
});
