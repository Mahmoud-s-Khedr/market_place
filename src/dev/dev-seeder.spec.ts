import { parseDevSeedInput, SeedApiClient } from './dev-seeder';

describe('dev-seeder', () => {
  it('parses valid input', () => {
    const input = parseDevSeedInput({
      BASE_URL: 'http://localhost',
      ADMIN_PHONE: '+201000000000',
      ADMIN_PASSWORD: 'Secret123',
      SEED_PROFILE: 'medium',
      SEED_TIMEOUT_MS: '9000',
    });

    expect(input).toEqual({
      baseUrl: 'http://localhost',
      adminPhone: '+201000000000',
      adminPassword: 'Secret123',
      profile: 'medium',
      timeoutMs: 9000,
    });
  });

  it('throws for invalid profile', () => {
    expect(() =>
      parseDevSeedInput({
        BASE_URL: 'http://localhost',
        ADMIN_PHONE: '+201000000000',
        ADMIN_PASSWORD: 'Secret123',
        SEED_PROFILE: 'small',
      }),
    ).toThrow('SEED_PROFILE must be "medium" for this version');
  });

  it('retries on 429 and succeeds', async () => {
    const fetchMock = jest
      .fn<Promise<Pick<Response, 'status' | 'text'>>, []>()
      .mockResolvedValueOnce({
        status: 429,
        text: async () => JSON.stringify({ success: false }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });

    const originalFetch = global.fetch;
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const sleeps: number[] = [];
    const client = new SeedApiClient({
      baseUrl: 'http://localhost',
      timeoutMs: 2000,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });

    try {
      const response = await client.request<{ success: boolean }>('GET', '/health/live', {
        expectedStatuses: [200],
      });

      expect(response.body.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sleeps.length).toBe(1);
      expect(sleeps[0]).toBeGreaterThan(0);
    } finally {
      (global as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});
