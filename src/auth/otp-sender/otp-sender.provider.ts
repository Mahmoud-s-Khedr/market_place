import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ConsoleOtpSender } from './console-otp.sender';
import { OTP_VERIFICATION_PROVIDER, OtpVerificationProvider } from './otp-sender.interface';
import { TwilioOtpSender } from './twilio-otp.sender';

export function resolveOtpVerificationProvider(
  appConfig: AppConfig,
  consoleOtpSender: OtpVerificationProvider,
  twilioOtpSender: OtpVerificationProvider,
): OtpVerificationProvider {
  return appConfig.otpProvider === 'twilio' ? twilioOtpSender : consoleOtpSender;
}

export const otpVerificationProvider: Provider = {
  provide: OTP_VERIFICATION_PROVIDER,
  inject: [ConfigService, ConsoleOtpSender, TwilioOtpSender],
  useFactory: (
    configService: ConfigService<{ app: AppConfig }, true>,
    consoleOtpSender: ConsoleOtpSender,
    twilioOtpSender: TwilioOtpSender,
  ) => {
    const appConfig = configService.get('app', { infer: true });
    return resolveOtpVerificationProvider(appConfig, consoleOtpSender, twilioOtpSender);
  },
};
