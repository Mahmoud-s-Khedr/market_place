import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ConsoleOtpSender } from './console-otp.sender';
import { OTP_SENDER, OtpSender } from './otp-sender.interface';
import { TwilioOtpSender } from './twilio-otp.sender';

export function resolveOtpSender(
  appConfig: AppConfig,
  consoleOtpSender: OtpSender,
  twilioOtpSender: OtpSender,
): OtpSender {
  return appConfig.otpProvider === 'twilio' ? twilioOtpSender : consoleOtpSender;
}

export const otpSenderProvider: Provider = {
  provide: OTP_SENDER,
  inject: [ConfigService, ConsoleOtpSender, TwilioOtpSender],
  useFactory: (
    configService: ConfigService<{ app: AppConfig }, true>,
    consoleOtpSender: ConsoleOtpSender,
    twilioOtpSender: TwilioOtpSender,
  ) => {
    const appConfig = configService.get('app', { infer: true });
    return resolveOtpSender(appConfig, consoleOtpSender, twilioOtpSender);
  },
};
