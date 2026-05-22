import { resolveOtpVerificationProvider } from './otp-sender.provider';

describe('resolveOtpVerificationProvider', () => {
  it('returns akedly sender when provider is akedly', () => {
    const consoleSender = { startVerification: jest.fn(), checkVerification: jest.fn() };
    const akedlySender = { startVerification: jest.fn(), checkVerification: jest.fn() };

    const sender = resolveOtpVerificationProvider(
      { otpProvider: 'akedly' } as any,
      consoleSender as any,
      akedlySender as any,
    );

    expect(sender).toBe(akedlySender);
  });

  it('returns console sender when provider is console', () => {
    const consoleSender = { startVerification: jest.fn(), checkVerification: jest.fn() };
    const akedlySender = { startVerification: jest.fn(), checkVerification: jest.fn() };

    const sender = resolveOtpVerificationProvider(
      { otpProvider: 'console' } as any,
      consoleSender as any,
      akedlySender as any,
    );

    expect(sender).toBe(consoleSender);
  });
});
