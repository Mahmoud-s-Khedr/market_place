import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class OtpCleanupTask {
  private readonly logger = new Logger(OtpCleanupTask.name);

  constructor(private readonly databaseService: DatabaseService) {}

  @Cron('0 * * * *') // every hour at :00
  async purgeExpiredOtps(): Promise<void> {
    const otpResult = await this.databaseService.query(
      `DELETE FROM auth_otps
       WHERE used_at IS NOT NULL
          OR expires_at < NOW() - INTERVAL '1 day'`,
    );
    this.logger.log(`Purged ${otpResult.rowCount ?? 0} expired/used OTP rows`);

    const pendingResult = await this.databaseService.query(
      `DELETE FROM pending_registrations
       WHERE expires_at < NOW() - INTERVAL '1 day'`,
    );
    this.logger.log(`Purged ${pendingResult.rowCount ?? 0} expired pending_registration rows`);
  }
}
