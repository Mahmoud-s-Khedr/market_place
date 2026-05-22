import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AkedlyOtpSender } from './akedly-otp.sender';
import { ConsoleOtpSender } from './console-otp.sender';
import { OTP_VERIFICATION_PROVIDER, OtpVerificationProvider } from './otp-sender.interface';

export function resolveOtpVerificationProvider(
  appConfig: AppConfig,
  consoleOtpSender: OtpVerificationProvider,
  akedlyOtpSender: OtpVerificationProvider,
): OtpVerificationProvider {
  return appConfig.otpProvider === 'akedly' ? akedlyOtpSender : consoleOtpSender;
}

export const otpVerificationProvider: Provider = {
  provide: OTP_VERIFICATION_PROVIDER,
  inject: [ConfigService, ConsoleOtpSender, AkedlyOtpSender],
  useFactory: (
    configService: ConfigService<{ app: AppConfig }, true>,
    consoleOtpSender: ConsoleOtpSender,
    akedlyOtpSender: AkedlyOtpSender,
  ) => {
    const appConfig = configService.get('app', { infer: true });
    return resolveOtpVerificationProvider(appConfig, consoleOtpSender, akedlyOtpSender);
  },
};
