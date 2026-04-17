import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';
import { CreateReportDto } from './dto/create-report.dto';
import { assertUserExists, isForeignKeyViolation } from '../common/helpers/db.helpers';

@Injectable()
export class ReportsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async createReport(user: AuthUser, dto: CreateReportDto): Promise<Record<string, unknown>> {
    if (user.sub === dto.reportedUserId) {
      throw new BadRequestException('You cannot report yourself');
    }

    await assertUserExists(this.databaseService, dto.reportedUserId, 'Reported user');

    let query: { rows: Array<Record<string, unknown>> };
    try {
      query = await this.databaseService.query(
        `INSERT INTO user_reports (reporter_id, reported_user_id, reason, status)
         VALUES ($1, $2, $3, 'open')
         RETURNING id, reporter_id, reported_user_id, reason, status, created_at, updated_at`,
        [user.sub, dto.reportedUserId, dto.reason],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Reported user not found');
      }
      throw error;
    }

    return { report: query.rows[0],
    };
  }

  async getMyReports(user: AuthUser): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT id, reporter_id, reported_user_id, reason, status, reviewed_by, reviewed_at, created_at, updated_at
       FROM user_reports
       WHERE reporter_id = $1
       ORDER BY created_at DESC`,
      [user.sub],
    );

    return { reports: query.rows,
    };
  }

}
