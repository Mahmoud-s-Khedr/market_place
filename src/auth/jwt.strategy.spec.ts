import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const configService = {
    get: jest.fn().mockReturnValue({
      jwtAccessSecret: 'access-secret',
    }),
  } as unknown as ConfigService;

  const strategy = new JwtStrategy(configService as any, databaseService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts token when tokenVersion matches database', async () => {
    databaseService.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 1, phone: '+201000000001', token_version: 2 }],
    });

    await expect(
      strategy.validate({ sub: 1, phone: '+201000000001', isAdmin: true, tokenVersion: 2 }),
    ).resolves.toEqual({ sub: 1, phone: '+201000000001', isAdmin: true, tokenVersion: 2 });
  });

  it('accepts numeric-string sub and normalizes it to number', async () => {
    databaseService.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 63, phone: '+201000000063', token_version: 7 }],
    });

    await expect(
      strategy.validate({ sub: '63', phone: '+201000000063', isAdmin: false, tokenVersion: 7 } as any),
    ).resolves.toEqual({ sub: 63, phone: '+201000000063', isAdmin: false, tokenVersion: 7 });
    expect(databaseService.query).toHaveBeenCalledWith(
      'SELECT id, phone, token_version FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [63],
    );
  });

  it('rejects invalid sub values early', async () => {
    await expect(
      strategy.validate({ sub: 'abc', phone: '+201000000001', isAdmin: false, tokenVersion: 1 } as any),
    ).rejects.toThrow('Invalid token');
    await expect(
      strategy.validate({ sub: 0, phone: '+201000000001', isAdmin: false, tokenVersion: 1 } as any),
    ).rejects.toThrow('Invalid token');
    await expect(
      strategy.validate({ sub: -5, phone: '+201000000001', isAdmin: false, tokenVersion: 1 } as any),
    ).rejects.toThrow('Invalid token');
    await expect(
      strategy.validate({ phone: '+201000000001', isAdmin: false, tokenVersion: 1 } as any),
    ).rejects.toThrow('Invalid token');
    expect(databaseService.query).not.toHaveBeenCalled();
  });

  it('rejects stale token versions', async () => {
    databaseService.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 2, phone: '+201000000002', token_version: 5 }],
    });

    await expect(
      strategy.validate({ sub: 2, phone: '+201000000002', isAdmin: false, tokenVersion: 4 }),
    ).rejects.toThrow('Token is stale');
  });
});
