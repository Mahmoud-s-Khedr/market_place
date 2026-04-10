import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomBytes, randomInt } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AppConfig } from '../config/configuration';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetOtpDto } from './dto/request-password-reset-otp.dto';
import { RequestRegistrationOtpDto } from './dto/request-registration-otp.dto';
import { ResendRegistrationOtpDto } from './dto/resend-registration-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyRegistrationOtpDto } from './dto/verify-registration-otp.dto';
import { OTP_SENDER, OtpSender } from './otp-sender/otp-sender.interface';
import { AuthStateStore } from './auth-state.store';
import { LogoutDto } from './dto/logout.dto';
import {
  BCRYPT_ROUNDS,
  OTP_RANGE_MIN,
  OTP_RANGE_MAX,
  OTP_MAX_ATTEMPTS,
  OTP_ATTEMPTS_TTL_SECONDS,
  REFRESH_TTL_FALLBACK_SECONDS,
} from '../common/constants';

type UserRow = {
  id: number;
  phone: string;
  password_hash: string;
  status: 'active' | 'paused' | 'banned';
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
    private readonly authStateStore: AuthStateStore,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
  ) {}

  async requestRegistrationOtp(dto: RequestRegistrationOtpDto): Promise<Record<string, unknown>> {
    const existingUser = await this.databaseService.query(
      'SELECT id FROM users WHERE phone = $1 OR ssn = $2 LIMIT 1',
      [dto.phone, dto.ssn],
    );
    if (existingUser.rowCount && existingUser.rowCount > 0) {
      throw new ConflictException('Phone or SSN already exists');
    }

    const existingPending = await this.databaseService.query<{ phone: string; ssn: string }>(
      'SELECT phone, ssn FROM pending_registrations WHERE phone = $1 OR ssn = $2 LIMIT 1',
      [dto.phone, dto.ssn],
    );
    if (existingPending.rowCount && existingPending.rowCount > 0) {
      const row = existingPending.rows[0];
      // Allow re-registration for the same phone (resend scenario via this endpoint).
      // Reject if the SSN belongs to a different phone's pending registration.
      if (row.ssn === dto.ssn && row.phone !== dto.phone) {
        throw new ConflictException('Phone or SSN already exists');
      }
    }

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);

    const pendingResult = await this.databaseService.query<{ id: number }>(
      `INSERT INTO pending_registrations (phone, ssn, name, password_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5::text || ' minutes')::interval)
       ON CONFLICT (phone) DO UPDATE
         SET ssn           = EXCLUDED.ssn,
             name          = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             expires_at    = EXCLUDED.expires_at,
             created_at    = NOW()
       RETURNING id`,
      [dto.phone, dto.ssn, dto.name, passwordHash, this.appConfig.otpTtlMinutes],
    );
    const pendingId = pendingResult.rows[0].id;

    try {
      return await this.createOtp(dto.phone, 'registration', null);
    } catch (error) {
      try {
        await this.databaseService.query('DELETE FROM pending_registrations WHERE id = $1', [pendingId]);
      } catch (cleanupError) {
        const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        this.logger.error(`Failed to cleanup pending_registration row ${pendingId}: ${msg}`);
      }
      throw error;
    }
  }

  async resendRegistrationOtp(dto: ResendRegistrationOtpDto): Promise<Record<string, unknown>> {
    const pending = await this.databaseService.query(
      `SELECT id FROM pending_registrations WHERE phone = $1 AND expires_at > NOW()`,
      [dto.phone],
    );
    if (!pending.rowCount) {
      throw new NotFoundException('No pending registration found for this phone');
    }
    return this.createOtp(dto.phone, 'registration', null);
  }

  async verifyRegistrationOtp(dto: VerifyRegistrationOtpDto): Promise<Record<string, unknown>> {
    return this.databaseService.withTransaction(async (client) => {
      const otpRow = await this.findLatestOtp(client, dto.phone, 'registration');
      await this.validateOtpOrThrow(dto.otp, otpRow.code_hash, otpRow.salt, otpRow.expires_at, otpRow.used_at, dto.phone, 'registration');

      const pendingQuery = await client.query<{ name: string; ssn: string; password_hash: string }>(
        `SELECT name, ssn, password_hash
         FROM pending_registrations
         WHERE phone = $1 AND expires_at > NOW()
         FOR UPDATE`,
        [dto.phone],
      );

      if (!pendingQuery.rowCount) {
        throw new BadRequestException('Registration session expired or not found');
      }

      const pending = pendingQuery.rows[0];

      let userId: number;
      try {
        const insertUser = await client.query<{ id: number }>(
          `INSERT INTO users (name, ssn, phone, password_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [pending.name, pending.ssn, dto.phone, pending.password_hash],
        );
        userId = insertUser.rows[0].id;
      } catch {
        throw new ConflictException('Phone or SSN already exists');
      }

      await client.query('UPDATE auth_otps SET used_at = NOW() WHERE id = $1', [otpRow.id]);
      await client.query('DELETE FROM pending_registrations WHERE phone = $1', [dto.phone]);

      const tokens = await this.generateTokens(userId, dto.phone, false, 0);

      return {
        success: true,
        user: { id: userId, phone: dto.phone },
        ...tokens,
      };
    });
  }

  async login(dto: LoginDto): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query<UserRow & { is_admin: boolean; token_version: number }>(
      'SELECT id, phone, password_hash, status, is_admin, token_version FROM users WHERE phone = $1 LIMIT 1',
      [dto.phone],
    );

    if (!query.rowCount) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = query.rows[0];

    if (user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await compare(dto.password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.phone, user.is_admin, user.token_version);
    return {
      success: true,
      user: { id: user.id, phone: user.phone },
      ...tokens,
    };
  }

  async requestPasswordResetOtp(dto: RequestPasswordResetOtpDto): Promise<Record<string, unknown>> {
    const userQuery = await this.databaseService.query<{ id: number }>(
      'SELECT id FROM users WHERE phone = $1 LIMIT 1',
      [dto.phone],
    );

    if (!userQuery.rowCount) {
      return { success: true, message: 'If this number is registered, an OTP has been sent' };
    }

    return this.createOtp(dto.phone, 'password_reset', userQuery.rows[0].id);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<Record<string, unknown>> {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    return this.databaseService.withTransaction(async (client) => {
      const otpRow = await this.findLatestOtp(client, dto.phone, 'password_reset');
      await this.validateOtpOrThrow(dto.otp, otpRow.code_hash, otpRow.salt, otpRow.expires_at, otpRow.used_at, dto.phone, 'password_reset');

      const account = await client.query<{ id: number; phone: string; status: UserRow['status']; is_admin: boolean; token_version: number }>(
        'SELECT id, phone, status, is_admin, token_version FROM users WHERE phone = $1 LIMIT 1',
        [dto.phone],
      );

      if (!account.rowCount) {
        throw new BadRequestException('User not found');
      }

      const user = account.rows[0];
      if (user.status !== 'active') {
        throw new UnauthorizedException('Invalid credentials');
      }

      const passwordHash = await hash(dto.newPassword, BCRYPT_ROUNDS);
      const updatedUser = await client.query<{ id: number; phone: string }>(
        `UPDATE users
         SET password_hash = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, phone`,
        [passwordHash, user.id],
      );

      if (!updatedUser.rowCount) {
        throw new BadRequestException('User not found');
      }

      await client.query('UPDATE auth_otps SET used_at = NOW() WHERE id = $1', [otpRow.id]);

      const tokens = await this.generateTokens(
        updatedUser.rows[0].id,
        updatedUser.rows[0].phone,
        user.is_admin,
        user.token_version,
      );
      return {
        success: true,
        message: 'Password reset successfully',
        ...tokens,
      };
    });
  }

  async refresh(dto: RefreshTokenDto): Promise<Record<string, unknown>> {
    let payload: { sub: number; phone: string; isAdmin: boolean; tokenVersion: number; jti: string };
    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.appConfig.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!payload.jti) throw new UnauthorizedException('Invalid refresh token');
    const storedUserId = await this.authStateStore.consumeRefreshTokenJti(payload.jti);
    if (!storedUserId || storedUserId !== payload.sub) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.databaseService.query<{ id: number; phone: string; status: UserRow['status']; is_admin: boolean; token_version: number }>(
      'SELECT id, phone, status, is_admin, token_version FROM users WHERE id = $1 LIMIT 1',
      [payload.sub],
    );

    if (!user.rowCount || user.rows[0].status !== 'active' || user.rows[0].token_version !== payload.tokenVersion) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(
      user.rows[0].id,
      user.rows[0].phone,
      user.rows[0].is_admin,
      user.rows[0].token_version,
    );
    return { success: true, ...tokens };
  }

  async logout(dto: LogoutDto): Promise<Record<string, unknown>> {
    try {
      const payload: { jti?: string } = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.appConfig.jwtRefreshSecret,
      });
      if (payload.jti) {
        await this.authStateStore.revokeRefreshTokenJti(payload.jti);
      }
    } catch {
      // Token invalid or already expired — treat as successfully logged out
    }
    return { success: true };
  }

  private get appConfig(): AppConfig {
    return this.configService.get('app', { infer: true });
  }

  private async createOtp(
    phone: string,
    purpose: 'registration' | 'password_reset',
    userId: number | null,
  ): Promise<Record<string, unknown>> {
    const otp = String(randomInt(OTP_RANGE_MIN, OTP_RANGE_MAX));
    const salt = randomBytes(16).toString('hex');
    const otpHash = this.hashOtp(otp, salt);

    const insertOtp = await this.databaseService.query<{ id: number }>(
      `INSERT INTO auth_otps (user_id, phone, code_hash, salt, purpose, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6::text || ' minutes')::interval)
       RETURNING id`,
      [userId, phone, otpHash, salt, purpose, this.appConfig.otpTtlMinutes],
    );

    const otpId = insertOtp.rows[0].id;
    try {
      await this.otpSender.sendOtp({ phone, otp, purpose });
    } catch (error) {
      try {
        await this.databaseService.query('DELETE FROM auth_otps WHERE id = $1', [otpId]);
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        this.logger.error(`Failed to cleanup OTP row ${otpId}: ${cleanupMessage}`);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`OTP delivery failed for ${phone}: ${message}`);
      throw new ServiceUnavailableException('OTP delivery failed');
    }

    return {
      success: true,
      message: 'OTP sent',
      ...(this.appConfig.otpDevMode ? { otp } : {}),
    };
  }

  private async findLatestOtp(
    client: PoolClient,
    phone: string,
    purpose: 'registration' | 'password_reset',
  ): Promise<{ id: number; code_hash: string; salt: string; expires_at: Date; used_at: Date | null }> {
    const otpQuery = await client.query<{
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
      [phone, purpose],
    );

    if (!otpQuery.rowCount) {
      throw new BadRequestException('OTP not found');
    }

    return otpQuery.rows[0];
  }

  private async validateOtpOrThrow(
    otp: string,
    codeHash: string,
    salt: string,
    expiresAt: Date,
    usedAt: Date | null,
    phone: string,
    purpose: 'registration' | 'password_reset',
  ): Promise<void> {
    if (usedAt) {
      throw new BadRequestException('OTP already used');
    }
    if (new Date(expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('OTP expired');
    }
    if (this.hashOtp(otp, salt) !== codeHash) {
      const result = await this.authStateStore.incrementOtpAttempts(phone, purpose, OTP_MAX_ATTEMPTS, OTP_ATTEMPTS_TTL_SECONDS);
      if (result.locked) {
        throw new BadRequestException('Too many attempts — OTP invalidated');
      }
      throw new BadRequestException('Invalid OTP');
    }
    await this.authStateStore.clearOtpAttempts(phone, purpose);
  }

  private hashOtp(otp: string, salt: string): string {
    return createHmac('sha256', this.appConfig.otpSigningSecret)
      .update(`${otp}:${salt}`)
      .digest('hex');
  }

  private parseTtlSeconds(ttl: string): number {
    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) return REFRESH_TTL_FALLBACK_SECONDS; // fallback: 30d
    const val = parseInt(match[1], 10);
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return val * units[match[2]];
  }

  private async generateTokens(
    userId: number,
    phone: string,
    isAdmin: boolean,
    tokenVersion: number,
  ): Promise<Record<string, string>> {
    const jti = randomBytes(16).toString('hex');
    const basePayload = { sub: userId, phone, isAdmin, tokenVersion };
    const refreshPayload = { ...basePayload, jti };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(basePayload, {
        secret: this.appConfig.jwtAccessSecret,
        expiresIn: this.appConfig.jwtAccessTtl as any,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.appConfig.jwtRefreshSecret,
        expiresIn: this.appConfig.jwtRefreshTtl as any,
      }),
    ]);

    const ttlSeconds = this.parseTtlSeconds(this.appConfig.jwtRefreshTtl);
    await this.authStateStore.saveRefreshTokenJti(jti, userId, ttlSeconds);

    return {
      accessToken,
      refreshToken,
    };
  }
}
