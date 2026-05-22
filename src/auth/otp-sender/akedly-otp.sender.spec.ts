import { BadRequestException, ConflictException } from '@nestjs/common';
import { AkedlyOtpSender } from './akedly-otp.sender';

describe('AkedlyOtpSender', () => {
  const appConfig = {
    akedlyBaseUrl: 'https://api.akedly.io',
    akedlyApiKey: 'api-key',
    akedlyPipelineId: 'pipeline-id',
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('starts verification and returns transactionReqID', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { transactionReqID: 'tx-1' } }),
    } as Response);

    const sender = new AkedlyOtpSender({
      get: jest.fn().mockReturnValue(appConfig),
    } as any);

    const result = await sender.startVerification({
      phone: '201000000001',
      purpose: 'registration',
      userId: null,
      endUserIp: '1.2.3.4',
      powSolution: { challengeToken: 'token', nonce: '42' },
      turnstileToken: 'turn-token',
    });

    expect(result.transactionReqID).toBe('tx-1');
  });

  it('rejects invalid OTP during verify', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ status: 'error', code: 'INVALID_OTP', message: 'Invalid OTP' }),
    } as Response);

    const sender = new AkedlyOtpSender({
      get: jest.fn().mockReturnValue(appConfig),
    } as any);

    await expect(
      sender.checkVerification({
        phone: '+201000000001',
        code: '123456',
        purpose: 'registration',
        transactionReqID: 'tx-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('maps ALREADY_VERIFIED to conflict', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ status: 'error', code: 'ALREADY_VERIFIED', message: 'Already verified' }),
    } as Response);

    const sender = new AkedlyOtpSender({
      get: jest.fn().mockReturnValue(appConfig),
    } as any);

    await expect(
      sender.checkVerification({
        phone: '+201000000001',
        code: '123456',
        purpose: 'registration',
        transactionReqID: 'tx-1',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
