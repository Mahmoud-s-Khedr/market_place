import { resolveOtpSender } from './otp-sender.provider';

describe('resolveOtpSender', () => {
  it('returns twilio sender when provider is twilio', () => {
    const consoleSender = { sendOtp: jest.fn() };
    const twilioSender = { sendOtp: jest.fn() };

    const sender = resolveOtpSender(
      { otpProvider: 'twilio' } as any,
      consoleSender as any,
      twilioSender as any,
    );

    expect(sender).toBe(twilioSender);
  });

  it('returns console sender when provider is console', () => {
    const consoleSender = { sendOtp: jest.fn() };
    const twilioSender = { sendOtp: jest.fn() };

    const sender = resolveOtpSender(
      { otpProvider: 'console' } as any,
      consoleSender as any,
      twilioSender as any,
    );

    expect(sender).toBe(consoleSender);
  });
});
