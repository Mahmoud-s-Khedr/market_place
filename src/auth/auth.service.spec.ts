import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const appConfig = {
    jwtAccessSecret: 'access',
    jwtRefreshSecret: 'refresh',
    jwtAccessTtl: '15m',
    jwtRefreshTtl: '30d',
    storageSigningSecret: 'secret',
    otpSigningSecret: 'otp-secret',
    otpProvider: 'console' as const,
    otpDevMode: true,
    otpTtlMinutes: 10,
    adminPhones: [],
  };

  const configService = {
    get: jest.fn().mockImplementation(() => appConfig),
  } as unknown as ConfigService;

  const authStateStore = {
    incrementOtpAttempts: jest.fn().mockResolvedValue({ attempts: 1, locked: false }),
    clearOtpAttempts: jest.fn().mockResolvedValue(undefined),
    saveRefreshTokenJti: jest.fn().mockResolvedValue(undefined),
    consumeRefreshTokenJti: jest.fn().mockResolvedValue(1),
    revokeRefreshTokenJti: jest.fn().mockResolvedValue(undefined),
  };

  const otpSender = {
    sendOtp: jest.fn(),
  };

  const service = new AuthService(
    databaseService as any,
    jwtService,
    configService as any,
    authStateStore as any,
    otpSender as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    appConfig.otpDevMode = true;
  });

  it('rejects duplicate phone/ssn on registration OTP request', async () => {
    databaseService.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 1 }] });

    await expect(
      service.requestRegistrationOtp({
        name: 'User',
        ssn: '11111111',
        phone: '+201000000001',
        password: 'abc12345',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects login for non-active users', async () => {
    databaseService.query.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 1,
          phone: '+201000000001',
          password_hash: '$2b$12$UOnNZ9OeWkCpW0fQ8LQXbu0Y8i2JYtrrSIRB2x00D1B5wYAkqM8Fi',
          status: 'banned',
          token_version: 0,
        },
      ],
    });

    await expect(service.login({ phone: '+201000000001', password: 'abc12345' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects password reset token issuance for non-active users', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 1, phone: '+201000000001', status: 'banned', token_version: 0 }],
      }),
    };
    databaseService.withTransaction.mockImplementation((callback: any) => callback(client));
    jest.spyOn(service as any, 'findLatestOtp').mockResolvedValue({
      id: 101,
      code_hash: 'hash',
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    });
    jest.spyOn(service as any, 'validateOtpOrThrow').mockResolvedValue(undefined);

    await expect(
      service.resetPassword({
        phone: '+201000000001',
        otp: '123456',
        newPassword: 'abc12345',
        confirmPassword: 'abc12345',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('sends OTP via selected sender and includes otp in dev mode', async () => {
    databaseService.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 77 }] });
    otpSender.sendOtp.mockResolvedValue(undefined);

    const response = await (service as any).createOtp('+201000000001', 'registration', null);

    expect(otpSender.sendOtp).toHaveBeenCalledWith({
      phone: '+201000000001',
      otp: expect.any(String),
      purpose: 'registration',
    });
    expect(response).toMatchObject({ success: true, message: 'OTP sent', otp: expect.any(String) });
  });

  it('hides otp in response when otpDevMode is false', async () => {
    appConfig.otpDevMode = false;
    databaseService.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 78 }] });
    otpSender.sendOtp.mockResolvedValue(undefined);

    const response = await (service as any).createOtp('+201000000001', 'password_reset', 1);

    expect(response).toMatchObject({ success: true, message: 'OTP sent' });
    expect(response).not.toHaveProperty('otp');
  });

  it('rolls back OTP row and throws when sender fails', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 79 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    otpSender.sendOtp.mockRejectedValue(new Error('twilio down'));

    await expect((service as any).createOtp('+201000000001', 'registration', null)).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(databaseService.query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM auth_otps WHERE id = $1',
      [79],
    );
  });

  it('throws ServiceUnavailableException (not cleanup error) when both OTP send and cleanup fail', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 80 }] })
      .mockRejectedValueOnce(new Error('DB cleanup failed'));
    otpSender.sendOtp.mockRejectedValue(new Error('twilio down'));

    await expect((service as any).createOtp('+201000000001', 'registration', null)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws UnauthorizedException when refresh token has no jti', async () => {
    (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
      sub: 1,
      phone: '+201000000001',
      isAdmin: false,
      tokenVersion: 0,
    });
    // no jti in payload

    await expect(service.refresh({ refreshToken: 'no-jti-token' })).rejects.toThrow(UnauthorizedException);
  });

  it('throws BadRequestException when OTP is expired', async () => {
    await expect(
      (service as any).validateOtpOrThrow(
        '123456',
        'hash',
        'salt',
        new Date(Date.now() - 1000), // expired
        null,
        '+201000000001',
        'registration',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when OTP already used', async () => {
    await expect(
      (service as any).validateOtpOrThrow(
        '123456',
        'hash',
        'salt',
        new Date(Date.now() + 60_000),
        new Date(), // used_at set
        '+201000000001',
        'registration',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('increments attempt counter on wrong OTP and throws after max attempts', async () => {
    authStateStore.incrementOtpAttempts.mockResolvedValue({ attempts: 5, locked: true });

    await expect(
      (service as any).validateOtpOrThrow(
        'wrong',
        'correcthash',
        'salt',
        new Date(Date.now() + 60_000),
        null,
        '+201000000001',
        'registration',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(authStateStore.incrementOtpAttempts).toHaveBeenCalledWith(
      '+201000000001',
      'registration',
      5,
      600,
    );
  });

  it('rejects resetPassword when confirmPassword does not match', async () => {
    await expect(
      service.resetPassword({
        phone: '+201000000001',
        otp: '123456',
        newPassword: 'abc12345',
        confirmPassword: 'different1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
