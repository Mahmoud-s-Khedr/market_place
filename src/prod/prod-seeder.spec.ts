import { parseProdSeedInput, runProdSeed, seedCategories } from './prod-seeder';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hashed'),
}));

jest.mock('../admin/admin-seeder', () => ({
  ...jest.requireActual('../admin/admin-seeder'),
  seedAdminUser: jest.fn(),
}));

import { seedAdminUser } from '../admin/admin-seeder';

describe('prod-seeder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses admin env parsing rules', () => {
    const input = parseProdSeedInput({
      ADMIN_PHONE: '+201000000000',
      ADMIN_PASSWORD: 'Secret123',
    });

    expect(input).toEqual({ phone: '+201000000000', password: 'Secret123' });
  });

  it('seeds categories idempotently', async () => {
    const ids = new Map<string, number>();
    let seq = 1;
    const query = jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO categories')) {
        const name = String(params?.[0] ?? '');
        const parentId = params?.[1] === null || params?.[1] === undefined ? 'root' : String(params?.[1]);
        const key = `${parentId}:${name.toLowerCase()}`;
        const existing = ids.get(key);
        if (existing) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }
        const id = seq++;
        ids.set(key, id);
        return Promise.resolve({ rowCount: 1, rows: [{ id }] });
      }
      if (sql.includes('SELECT id') && sql.includes('FROM categories')) {
        const name = String(params?.[1] ?? '');
        const parentId = params?.[0] === null || params?.[0] === undefined ? 'root' : String(params?.[0]);
        const key = `${parentId}:${name.toLowerCase()}`;
        const id = ids.get(key);
        if (!id) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }
        return Promise.resolve({ rowCount: 1, rows: [{ id }] });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    const first = await seedCategories({ query } as any);
    const second = await seedCategories({ query } as any);

    expect(first.created).toBeGreaterThan(0);
    expect(first.reused).toBe(0);
    expect(second.created).toBe(0);
    expect(second.reused).toBeGreaterThan(0);
  });

  it('runs admin step before categories and returns summary', async () => {
    (seedAdminUser as jest.Mock).mockResolvedValue({ id: 7, phone: '+201000000000', created: true });

    const query = jest
      .fn()
      .mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO categories')) {
          return Promise.resolve({ rowCount: 1, rows: [{ id: 11 }] });
        }
        if (sql.includes('SELECT id') && sql.includes('FROM categories')) {
          return Promise.resolve({ rowCount: 1, rows: [{ id: 11 }] });
        }
        return Promise.resolve({ rowCount: 1, rows: [] });
      });

    const summary = await runProdSeed({ query } as any, { phone: '+201000000000', password: 'Secret123' });

    expect(seedAdminUser).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalled();
    expect(summary.admin).toEqual({
      action: 'created',
      id: 7,
      phone: '+201000000000',
    });
    expect(summary.categories.created + summary.categories.reused).toBeGreaterThan(0);
  });

  it('propagates failures from admin step', async () => {
    (seedAdminUser as jest.Mock).mockRejectedValue(new Error('admin failure'));

    await expect(
      runProdSeed({ query: jest.fn() } as any, { phone: '+201000000000', password: 'Secret123' }),
    ).rejects.toThrow('admin failure');
  });
});
