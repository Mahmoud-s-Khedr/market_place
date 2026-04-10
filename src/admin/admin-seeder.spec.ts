import { parseAdminSeedInput, seedAdminUser } from './admin-seeder';

describe('admin-seeder', () => {
  it('parses valid env input', () => {
    const input = parseAdminSeedInput({
      ADMIN_PHONE: '+201000000000',
      ADMIN_PASSWORD: 'Secret123',
    });

    expect(input).toEqual({ phone: '+201000000000', password: 'Secret123' });
  });

  it('throws for invalid env input', () => {
    expect(() =>
      parseAdminSeedInput({
        ADMIN_PHONE: 'invalid',
        ADMIN_PASSWORD: 'short',
      }),
    ).toThrow('ADMIN_PHONE must be a valid E.164-like phone number');
  });

  it('creates missing admin and returns created=true', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, phone: '+201000000000' }] });

    const result = await seedAdminUser({ query } as any, '+201000000000', 'hash');

    expect(result).toEqual({ id: 1, phone: '+201000000000', created: true });
  });

  it('updates existing user and returns created=false', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2, phone: '+201000000000' }] });

    const result = await seedAdminUser({ query } as any, '+201000000000', 'hash');

    expect(result).toEqual({ id: 2, phone: '+201000000000', created: false });
  });
});
