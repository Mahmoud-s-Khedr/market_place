import { ConfigService } from '@nestjs/config';
import { TwilioOtpSender } from './twilio-otp.sender';

class TestTwilioOtpSender extends TwilioOtpSender {
  constructor(
    configService: ConfigService,
    private readonly mockClient: {
      messages: {
        create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      };
    },
  ) {
    super(configService as any);
  }

  protected createClient(): any {
    return this.mockClient;
  }
}

describe('TwilioOtpSender', () => {
  it('uses from number and normalizes phone', async () => {
    const messagesCreate = jest.fn().mockResolvedValue({});
    const sender = new TestTwilioOtpSender(
      {
        get: jest.fn().mockReturnValue({
          otpTtlMinutes: 10,
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'token',
          twilioFromNumber: '+15550001111',
          twilioMessagingServiceSid: undefined,
        }),
      } as unknown as ConfigService,
      { messages: { create: messagesCreate } },
    );

    await sender.sendOtp({ phone: '201000000001', otp: '123456', purpose: 'registration' });

    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Your verification code is 123456. It expires in 10 minutes.',
      to: '+201000000001',
      from: '+15550001111',
      messagingServiceSid: undefined,
    });
  });

  it('uses messaging service sid when configured', async () => {
    const messagesCreate = jest.fn().mockResolvedValue({});
    const sender = new TestTwilioOtpSender(
      {
        get: jest.fn().mockReturnValue({
          otpTtlMinutes: 10,
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'token',
          twilioFromNumber: undefined,
          twilioMessagingServiceSid: 'MG123',
        }),
      } as unknown as ConfigService,
      { messages: { create: messagesCreate } },
    );

    await sender.sendOtp({ phone: '+201000000001', otp: '654321', purpose: 'password_reset' });

    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Your verification code is 654321. It expires in 10 minutes.',
      to: '+201000000001',
      from: undefined,
      messagingServiceSid: 'MG123',
    });
  });
});
