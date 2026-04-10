import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';
import { AppConfig } from '../../config/configuration';
import { OtpPayload, OtpSender } from './otp-sender.interface';

type TwilioMessagesClient = {
  messages: {
    create(params: {
      body: string;
      to: string;
      from?: string;
      messagingServiceSid?: string;
    }): Promise<unknown>;
  };
};

@Injectable()
export class TwilioOtpSender implements OtpSender {
  private client: TwilioMessagesClient | null = null;

  constructor(private readonly configService: ConfigService<{ app: AppConfig }, true>) {}

  async sendOtp(payload: OtpPayload): Promise<void> {
    const appConfig = this.configService.get('app', { infer: true });
    const messageBody = `Your verification code is ${payload.otp}. It expires in ${appConfig.otpTtlMinutes} minutes.`;

    await this.getClient().messages.create({
      body: messageBody,
      to: this.normalizePhone(payload.phone),
      from: appConfig.twilioFromNumber,
      messagingServiceSid: appConfig.twilioMessagingServiceSid,
    });
  }

  protected createClient(accountSid: string, authToken: string): TwilioMessagesClient {
    return twilio(accountSid, authToken) as unknown as TwilioMessagesClient;
  }

  private getClient(): TwilioMessagesClient {
    if (!this.client) {
      const appConfig = this.configService.get('app', { infer: true });
      this.client = this.createClient(appConfig.twilioAccountSid!, appConfig.twilioAuthToken!);
    }

    return this.client;
  }

  private normalizePhone(phone: string): string {
    return phone.startsWith('+') ? phone : `+${phone}`;
  }
}
