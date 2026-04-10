import { Injectable, Logger } from '@nestjs/common';
import { OtpPayload, OtpSender } from './otp-sender.interface';

@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger(ConsoleOtpSender.name);

  async sendOtp(payload: OtpPayload): Promise<void> {
    this.logger.log(`OTP (${payload.purpose}) for ${payload.phone}: ${payload.otp}`);
  }
}
