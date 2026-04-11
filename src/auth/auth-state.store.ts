import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

type OtpPurpose = 'registration' | 'password_reset';
type QueryRunner = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

type IncrementOtpResult = {
  attempts: number;
  locked: boolean;
};

@Injectable()
export class AuthStateStore implements OnModuleInit {
  private readonly logger = new Logger(AuthStateStore.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    if (this.redisService.isEnabled()) {
      this.logger.log('Auth state mode: hybrid (Postgres source + Redis accelerator)');
      return;
    }

    this.logger.warn('Auth state mode: postgres-fallback (Redis disabled)');
  }

  async incrementOtpAttempts(
    phone: string,
    purpose: OtpPurpose,
    maxAttempts: number,
    ttlSeconds: number,
  ): Promise<IncrementOtpResult> {
    const key = this.otpAttemptsKey(phone, purpose);

    await this.tryRedisSet(
      key,
      async () => {
        const raw = await this.redisService.get(key);
        const attempts = raw ? parseInt(raw, 10) + 1 : 1;
        await this.redisService.set(key, String(attempts), ttlSeconds);
      },
      'OTP attempt increment',
    );

    const result = await this.databaseService.query<{ attempts: number }>(
      `INSERT INTO auth_otp_attempts (phone, purpose, attempts, expires_at)
       VALUES ($1, $2, 1, NOW() + ($3::text || ' seconds')::interval)
       ON CONFLICT (phone, purpose)
       DO UPDATE SET
         attempts = CASE
                      WHEN auth_otp_attempts.expires_at <= NOW() THEN 1
                      ELSE auth_otp_attempts.attempts + 1
                    END,
         expires_at = CASE
                        WHEN auth_otp_attempts.expires_at <= NOW() THEN NOW() + ($3::text || ' seconds')::interval
                        ELSE auth_otp_attempts.expires_at
                      END,
         updated_at = NOW()
       RETURNING attempts`,
      [phone, purpose, ttlSeconds],
    );

    const attempts = result.rows[0].attempts;
    if (attempts >= maxAttempts) {
      await this.clearOtpAttempts(phone, purpose);
      return { attempts, locked: true };
    }

    return { attempts, locked: false };
  }

  async clearOtpAttempts(phone: string, purpose: OtpPurpose): Promise<void> {
    const key = this.otpAttemptsKey(phone, purpose);

    await this.tryRedisSet(
      key,
      () => this.redisService.del(key),
      'OTP attempt clear',
    );

    await this.databaseService.query(
      'DELETE FROM auth_otp_attempts WHERE phone = $1 AND purpose = $2',
      [phone, purpose],
    );
  }

  async saveRefreshTokenJti(
    jti: string,
    userId: number,
    ttlSeconds: number,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    await this.tryRedisSet(
      `refresh_jti:${jti}`,
      () => this.redisService.set(`refresh_jti:${jti}`, String(userId), ttlSeconds),
      'refresh token save',
    );

    const runner = queryRunner ?? this.databaseService;
    await runner.query(
      `INSERT INTO auth_refresh_tokens (jti, user_id, expires_at)
       VALUES ($1, $2, NOW() + ($3::text || ' seconds')::interval)
       ON CONFLICT (jti)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         revoked_at = NULL`,
      [jti, userId, ttlSeconds],
    );
  }

  async consumeRefreshTokenJti(jti: string): Promise<number | null> {
    await this.tryRedisSet(
      `refresh_jti:${jti}`,
      () => this.redisService.del(`refresh_jti:${jti}`),
      'refresh token consume',
    );

    const result = await this.databaseService.query<{ user_id: number }>(
      `DELETE FROM auth_refresh_tokens
       WHERE jti = $1 AND revoked_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [jti],
    );

    if (!result.rowCount) {
      return null;
    }

    return result.rows[0].user_id;
  }

  async revokeRefreshTokenJti(jti: string): Promise<void> {
    await this.tryRedisSet(
      `refresh_jti:${jti}`,
      () => this.redisService.del(`refresh_jti:${jti}`),
      'refresh token revoke',
    );

    await this.databaseService.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = NOW()
       WHERE jti = $1`,
      [jti],
    );
  }

  private otpAttemptsKey(phone: string, purpose: OtpPurpose): string {
    return `otp_attempts:${phone}:${purpose}`;
  }

  private async tryRedisSet(key: string, op: () => Promise<void>, action: string): Promise<void> {
    if (!this.redisService.isEnabled()) {
      return;
    }

    try {
      await op();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis ${action} failed for ${key}, using Postgres only: ${msg}`);
    }
  }
}
