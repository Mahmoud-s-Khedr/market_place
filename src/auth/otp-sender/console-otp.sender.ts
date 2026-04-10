import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt } from 'crypto';
import { AppConfig } from '../../config/configuration';
import { DatabaseService } from '../../database/database.service';
import { OTP_ATTEMPTS_TTL_SECONDS, OTP_MAX_ATTEMPTS, OTP_RANGE_MAX, OTP_RANGE_MIN } from '../../common/constants';
import { AuthStateStore } from '../auth-state.store';
import {
  CheckVerificationPayload,
  CheckVerificationResult,
  OtpVerificationProvider,
  StartVerificationPayload,
  StartVerificationResult,
} from './otp-sender.interface';

@Injectable()
export class ConsoleOtpSender implements OtpVerificationProvider {
  private readonly logger = new Logger(ConsoleOtpSender.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
    private readonly authStateStore: AuthStateStore,
  ) {}

  async startVerification(payload: StartVerificationPayload): Promise<StartVerificationResult> {
    const otp = this.appConfig.otpDevMode ? '000000' : String(randomInt(OTP_RANGE_MIN, OTP_RANGE_MAX));
    const salt = randomBytes(16).toString('hex');
    const otpHash = this.hashOtp(otp, salt);

    await this.databaseService.query(
      `INSERT INTO auth_otps (user_id, phone, code_hash, salt, purpose, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6::text || ' minutes')::interval)`,
      [payload.userId, payload.phone, otpHash, salt, payload.purpose, this.appConfig.otpTtlMinutes],
    );

    this.logger.log(`OTP (${payload.purpose}) for ${payload.phone}: ${otp}`);

    return {
      ...(this.appConfig.otpDevMode ? { otp } : {}),
    };
  }

  async checkVerification(payload: CheckVerificationPayload): Promise<CheckVerificationResult> {
    const otpQuery = await this.databaseService.query<{
      id: number;
      code_hash: string;
      salt: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, code_hash, salt, expires_at, used_at
       FROM auth_otps
       WHERE phone = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [payload.phone, payload.purpose],
    );

    if (!otpQuery.rowCount) {
      throw new BadRequestException('OTP not found');
    }

    const otpRow = otpQuery.rows[0];

    if (otpRow.used_at) {
      throw new BadRequestException('OTP already used');
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('OTP expired');
    }
    if (this.hashOtp(payload.code, otpRow.salt) !== otpRow.code_hash) {
      const result = await this.authStateStore.incrementOtpAttempts(
        payload.phone,
        payload.purpose,
        OTP_MAX_ATTEMPTS,
        OTP_ATTEMPTS_TTL_SECONDS,
      );
      if (result.locked) {
        throw new BadRequestException('Too many attempts — OTP invalidated');
      }
      throw new BadRequestException('Invalid OTP');
    }

    await this.authStateStore.clearOtpAttempts(payload.phone, payload.purpose);

    return { localOtpId: otpRow.id };
  }

  private get appConfig(): AppConfig {
    return this.configService.get('app', { infer: true });
  }

  private hashOtp(otp: string, salt: string): string {
    return createHmac('sha256', this.appConfig.otpSigningSecret)
      .update(`${otp}:${salt}`)
      .digest('hex');
  }
}
