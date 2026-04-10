import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';
import { AppConfig } from '../../config/configuration';
import {
  CheckVerificationPayload,
  CheckVerificationResult,
  OtpVerificationProvider,
  StartVerificationPayload,
  StartVerificationResult,
} from './otp-sender.interface';

type TwilioVerifyClient = {
  verify: {
    v2: {
      services(serviceSid: string): {
        verifications: {
          create(params: {
            channel: 'sms';
            to: string;
          }): Promise<unknown>;
        };
        verificationChecks: {
          create(params: {
            code: string;
            to: string;
          }): Promise<{ status?: string }>;
        };
      };
    };
  };
};

type TwilioError = Error & {
  status?: number;
  code?: number;
};

@Injectable()
export class TwilioOtpSender implements OtpVerificationProvider {
  private client: TwilioVerifyClient | null = null;

  constructor(private readonly configService: ConfigService<{ app: AppConfig }, true>) {}

  async startVerification(payload: StartVerificationPayload): Promise<StartVerificationResult> {
    const service = this.getVerifyService();
    try {
      await service.verifications.create({
        channel: 'sms',
        to: this.normalizePhone(payload.phone),
      });
      return {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`OTP delivery failed: ${message}`);
    }
  }

  async checkVerification(payload: CheckVerificationPayload): Promise<CheckVerificationResult> {
    const service = this.getVerifyService();
    try {
      const result = await service.verificationChecks.create({
        code: payload.code,
        to: this.normalizePhone(payload.phone),
      });

      if (result.status !== 'approved') {
        throw new BadRequestException('Invalid or expired OTP');
      }

      return {};
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const twilioError = error as TwilioError;
      const status = twilioError.status;
      if (status && status >= 400 && status < 500) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      const message = twilioError instanceof Error ? twilioError.message : String(twilioError);
      throw new ServiceUnavailableException(`OTP verification failed: ${message}`);
    }
  }

  protected createClient(accountSid: string, authToken: string): TwilioVerifyClient {
    return twilio(accountSid, authToken) as unknown as TwilioVerifyClient;
  }

  private getClient(): TwilioVerifyClient {
    if (!this.client) {
      const appConfig = this.configService.get('app', { infer: true });
      this.client = this.createClient(appConfig.twilioAccountSid!, appConfig.twilioAuthToken!);
    }

    return this.client;
  }

  private getVerifyService() {
    return this.getClient().verify.v2.services(this.appConfig.twilioVerifyServiceSid!);
  }

  private get appConfig(): AppConfig {
    return this.configService.get('app', { infer: true });
  }

  private normalizePhone(phone: string): string {
    return phone.startsWith('+') ? phone : `+${phone}`;
  }
}
