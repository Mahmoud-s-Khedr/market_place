import { ConfigService } from '@nestjs/config';
import { TwilioOtpSender } from './twilio-otp.sender';

class TestTwilioOtpSender extends TwilioOtpSender {
  constructor(
    configService: ConfigService,
    private readonly mockClient: any,
  ) {
    super(configService as any);
  }

  protected createClient(): any {
    return this.mockClient;
  }
}

describe('TwilioOtpSender', () => {
  it('starts verification and normalizes phone', async () => {
    const verificationCreate = jest.fn().mockResolvedValue({});
    const verificationCheckCreate = jest.fn().mockResolvedValue({ status: 'approved' });
    const services = jest.fn().mockReturnValue({
      verifications: { create: verificationCreate },
      verificationChecks: { create: verificationCheckCreate },
    });
    const sender = new TestTwilioOtpSender(
      {
        get: jest.fn().mockReturnValue({
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'token',
          twilioVerifyServiceSid: 'VA123',
        }),
      } as unknown as ConfigService,
      { verify: { v2: { services } } },
    );

    await sender.startVerification({ phone: '201000000001', purpose: 'registration', userId: null });

    expect(services).toHaveBeenCalledWith('VA123');
    expect(verificationCreate).toHaveBeenCalledWith({
      channel: 'sms',
      to: '+201000000001',
    });
  });

  it('checks verification and accepts approved status', async () => {
    const verificationCreate = jest.fn().mockResolvedValue({});
    const verificationCheckCreate = jest.fn().mockResolvedValue({ status: 'approved' });
    const services = jest.fn().mockReturnValue({
      verifications: { create: verificationCreate },
      verificationChecks: { create: verificationCheckCreate },
    });
    const sender = new TestTwilioOtpSender(
      {
        get: jest.fn().mockReturnValue({
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'token',
          twilioVerifyServiceSid: 'VA123',
        }),
      } as unknown as ConfigService,
      { verify: { v2: { services } } },
    );

    await sender.checkVerification({ phone: '+201000000001', code: '654321', purpose: 'password_reset' });

    expect(verificationCheckCreate).toHaveBeenCalledWith({
      code: '654321',
      to: '+201000000001',
    });
  });

  it('rejects non-approved verification status', async () => {
    const verificationCheckCreate = jest.fn().mockResolvedValue({ status: 'pending' });
    const sender = new TestTwilioOtpSender(
      {
        get: jest.fn().mockReturnValue({
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'token',
          twilioVerifyServiceSid: 'VA123',
        }),
      } as unknown as ConfigService,
      {
        verify: {
          v2: {
            services: jest.fn().mockReturnValue({
              verifications: { create: jest.fn() },
              verificationChecks: { create: verificationCheckCreate },
            }),
          },
        },
      },
    );

    await expect(
      sender.checkVerification({ phone: '+201000000001', code: '000000', purpose: 'registration' }),
    ).rejects.toThrow('Invalid or expired OTP');
  });
});
