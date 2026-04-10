import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { AppConfig } from '../../config/configuration';
import { DatabaseService } from '../../database/database.service';
import { AuthStateStore } from '../auth-state.store';
import { ConsoleOtpSender } from './console-otp.sender';

describe('ConsoleOtpSender.startVerification', () => {
  function buildSender(otpDevMode: boolean) {
    const queryMock = jest.fn().mockResolvedValue({});
    const databaseService = {
      query: queryMock,
    } as unknown as DatabaseService;
    const configService = {
      get: jest.fn().mockReturnValue({
        otpDevMode,
        otpTtlMinutes: 10,
        otpSigningSecret: 'otp-secret',
      }),
    } as unknown as ConfigService<{ app: AppConfig }, true>;
    const authStateStore = {
      incrementOtpAttempts: jest.fn(),
      clearOtpAttempts: jest.fn(),
    } as unknown as AuthStateStore;

    const sender = new ConsoleOtpSender(databaseService, configService, authStateStore);
    return { sender, queryMock };
  }

  it('uses fixed OTP 000000 when otpDevMode=true and stores matching hash', async () => {
    const { sender, queryMock } = buildSender(true);

    const result = await sender.startVerification({
      userId: null,
      phone: '+201000000001',
      purpose: 'registration',
    });

    expect(result).toEqual({ otp: '000000' });
    expect(queryMock).toHaveBeenCalledTimes(1);

    const params = queryMock.mock.calls[0][1] as [number | null, string, string, string, string, number];
    const hash = params[2];
    const salt = params[3];
    const expectedHash = createHmac('sha256', 'otp-secret')
      .update(`000000:${salt}`)
      .digest('hex');

    expect(hash).toBe(expectedHash);
  });

  it('keeps random OTP generation path when otpDevMode=false', async () => {
    const { sender, queryMock } = buildSender(false);

    const result = await sender.startVerification({
      userId: null,
      phone: '+201000000001',
      purpose: 'registration',
    });

    expect(result).toEqual({});
    expect(queryMock).toHaveBeenCalledTimes(1);

    const params = queryMock.mock.calls[0][1] as [number | null, string, string, string, string, number];
    const hash = params[2];
    const salt = params[3];
    const fixedOtpHash = createHmac('sha256', 'otp-secret')
      .update(`000000:${salt}`)
      .digest('hex');

    expect(hash).not.toBe(fixedOtpHash);
  });
});
