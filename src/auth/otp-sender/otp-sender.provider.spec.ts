import { resolveOtpVerificationProvider } from './otp-sender.provider';

describe('resolveOtpVerificationProvider', () => {
  it('returns twilio sender when provider is twilio', () => {
    const consoleSender = { startVerification: jest.fn(), checkVerification: jest.fn() };
    const twilioSender = { startVerification: jest.fn(), checkVerification: jest.fn() };

    const sender = resolveOtpVerificationProvider(
      { otpProvider: 'twilio' } as any,
      consoleSender as any,
      twilioSender as any,
    );

    expect(sender).toBe(twilioSender);
  });

  it('returns console sender when provider is console', () => {
    const consoleSender = { startVerification: jest.fn(), checkVerification: jest.fn() };
    const twilioSender = { startVerification: jest.fn(), checkVerification: jest.fn() };

    const sender = resolveOtpVerificationProvider(
      { otpProvider: 'console' } as any,
      consoleSender as any,
      twilioSender as any,
    );

    expect(sender).toBe(consoleSender);
  });
});
