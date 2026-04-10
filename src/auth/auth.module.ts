import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthStateStore } from './auth-state.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpCleanupTask } from './otp-cleanup.task';
import { ConsoleOtpSender } from './otp-sender/console-otp.sender';
import { otpVerificationProvider } from './otp-sender/otp-sender.provider';
import { TwilioOtpSender } from './otp-sender/twilio-otp.sender';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthStateStore, JwtStrategy, OtpCleanupTask, ConsoleOtpSender, TwilioOtpSender, otpVerificationProvider],
  exports: [AuthService],
})
export class AuthModule {}
