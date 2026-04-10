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
