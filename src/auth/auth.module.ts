import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthStateStore } from './auth-state.store';
import { AuthAkedlyController } from './auth.akedly.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpCleanupTask } from './otp-cleanup.task';
import { AkedlyOtpSender } from './otp-sender/akedly-otp.sender';
import { ConsoleOtpSender } from './otp-sender/console-otp.sender';
import { otpVerificationProvider } from './otp-sender/otp-sender.provider';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, AuthAkedlyController],
  providers: [AuthService, AuthStateStore, JwtStrategy, OtpCleanupTask, ConsoleOtpSender, AkedlyOtpSender, otpVerificationProvider],
  exports: [AuthService],
})
export class AuthModule {}
