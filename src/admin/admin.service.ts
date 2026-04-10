import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';
import { assertUserExists, escapeLike, isForeignKeyViolation } from '../common/helpers/db.helpers';
import { RedisService } from '../redis/redis.service';
import { CategoriesService } from '../categories/categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateWarningDto } from './dto/create-warning.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async listUsers(queryDto: ListUsersQueryDto): Promise<Record<string, unknown>> {
    const status = queryDto.status;
    const q = queryDto.q;
    const limit = queryDto.limit ?? 50;
    const offset = queryDto.offset ?? 0;

    const params: unknown[] = [];
    const clauses: string[] = [];

    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (q) {
      const escaped = escapeLike(q);
      params.push(`%${escaped}%`, `%${escaped}%`);
      const i = params.length;
      clauses.push(`(name ILIKE $${i - 1} ESCAPE '\\' OR phone ILIKE $${i} ESCAPE '\\')`);
    }

    params.push(limit, offset);

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const query = await this.databaseService.query(
      `SELECT id, name, phone, status, is_admin, created_at, updated_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return {
      success: true,
      users: query.rows,
    };
  }

  async listAdmins(): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT id, name, phone, status, is_admin, created_at, updated_at
       FROM users
       WHERE is_admin = true
       ORDER BY created_at DESC`,
    );

    return {
      success: true,
      admins: query.rows,
    };
  }

  async promoteAdmin(admin: AuthUser, userId: number): Promise<Record<string, unknown>> {
    const before = await this.databaseService.query<{ id: number; is_admin: boolean }>(
      'SELECT id, is_admin FROM users WHERE id = $1 LIMIT 1',
      [userId],
    );
    if (!before.rowCount) {
      throw new NotFoundException('User not found');
    }
    if (before.rows[0].is_admin) {
      throw new ConflictException('User is already an admin');
    }

    const query = await this.databaseService.query(
      `UPDATE users
       SET is_admin = true,
           token_version = token_version + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, phone, status, is_admin, token_version, created_at, updated_at`,
      [userId],
    );

    await this.logAdminAction(admin.sub, 'promote_admin', 'user', userId, { is_admin: true });
    return { success: true, user: query.rows[0] };
  }

  async demoteAdmin(admin: AuthUser, userId: number): Promise<Record<string, unknown>> {
    if (admin.sub === userId) {
      throw new BadRequestException('Admins cannot demote themselves');
    }

    const before = await this.databaseService.query<{ id: number; is_admin: boolean }>(
      'SELECT id, is_admin FROM users WHERE id = $1 LIMIT 1',
      [userId],
    );
    if (!before.rowCount) {
      throw new NotFoundException('User not found');
    }
    if (!before.rows[0].is_admin) {
      throw new ConflictException('User is not an admin');
    }

    const query = await this.databaseService.query(
      `UPDATE users
       SET is_admin = false,
           token_version = token_version + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, phone, status, is_admin, token_version, created_at, updated_at`,
      [userId],
    );

    await this.logAdminAction(admin.sub, 'demote_admin', 'user', userId, { is_admin: false });
    return { success: true, user: query.rows[0] };
  }

  async updateUserStatus(admin: AuthUser, userId: number, dto: UpdateUserStatusDto): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `UPDATE users
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, phone, status, is_admin, created_at, updated_at`,
      [dto.status, userId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    await this.logAdminAction(admin.sub, 'update_user_status', 'user', userId, { status: dto.status });
    await this.redisService.del(`user:status:${userId}`);

    return {
      success: true,
      user: query.rows[0],
    };
  }

  async createWarning(admin: AuthUser, dto: CreateWarningDto): Promise<Record<string, unknown>> {
    await assertUserExists(this.databaseService, dto.targetUserId, 'Target user');

    let query: { rows: Array<Record<string, unknown>> };
    try {
      query = await this.databaseService.query(
        `INSERT INTO admin_warnings (admin_id, target_user_id, message)
         VALUES ($1, $2, $3)
         RETURNING id, admin_id, target_user_id, message, created_at`,
        [admin.sub, dto.targetUserId, dto.message],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Target user not found');
      }
      throw error;
    }

    await this.logAdminAction(admin.sub, 'create_warning', 'user', dto.targetUserId, { message: dto.message });

    return {
      success: true,
      warning: query.rows[0],
    };
  }

  async listReports(status?: 'open' | 'reviewing' | 'resolved' | 'rejected'): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT id, reporter_id, reported_user_id, reason, status, reviewed_by, reviewed_at,
              created_at, updated_at
       FROM user_reports
       WHERE ($1::report_status IS NULL OR status = $1::report_status)
       ORDER BY created_at DESC`,
      [status ?? null],
    );

    return {
      success: true,
      reports: query.rows,
    };
  }

  async updateReportStatus(
    admin: AuthUser,
    reportId: number,
    dto: UpdateReportStatusDto,
  ): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `UPDATE user_reports
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, reporter_id, reported_user_id, reason, status, reviewed_by, reviewed_at, updated_at`,
      [dto.status, admin.sub, reportId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('Report not found');
    }

    await this.logAdminAction(admin.sub, 'update_report_status', 'report', reportId, { status: dto.status });

    return {
      success: true,
      report: query.rows[0],
    };
  }

  async createCategory(admin: AuthUser, dto: CreateCategoryDto): Promise<Record<string, unknown>> {
    const result = await this.categoriesService.createCategory(dto.name, dto.parentId ?? null);
    const category = (result as { category: { id: number } }).category;
    await this.logAdminAction(admin.sub, 'create_category', 'category', category.id, { name: dto.name, parentId: dto.parentId ?? null });
    return result;
  }

  async deleteCategory(admin: AuthUser, categoryId: number): Promise<Record<string, unknown>> {
    const result = await this.categoriesService.deleteCategory(categoryId);
    await this.logAdminAction(admin.sub, 'delete_category', 'category', categoryId, {});
    return result;
  }

  private async logAdminAction(
    actorId: number,
    action: string,
    targetType: string,
    targetId: number | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.databaseService.query(
        `INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [actorId, action, targetType, targetId, JSON.stringify(payload)],
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Audit log failed for action "${action}": ${msg}`);
    }
  }

}
