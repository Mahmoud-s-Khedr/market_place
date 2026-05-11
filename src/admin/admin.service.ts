import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user.type';
import { DatabaseService } from '../database/database.service';
import { assertUserExists, escapeLike, isForeignKeyViolation } from '../common/helpers/db.helpers';
import { RedisService } from '../redis/redis.service';
import { CategoriesService } from '../categories/categories.service';
import { DEFAULT_PAGE_SIZE } from '../common/constants';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateWarningDto } from './dto/create-warning.dto';
import { ListAdminPaginationQueryDto } from './dto/list-admin-pagination-query.dto';
import { ListUserListingsQueryDto } from './dto/list-user-listings-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { mapToAppUser } from '../common/mappers/app-user.mapper';

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
      clauses.push(`u.status = $${params.length}`);
    }
    if (q) {
      const escaped = escapeLike(q);
      params.push(`%${escaped}%`, `%${escaped}%`);
      const i = params.length;
      clauses.push(`(u.name ILIKE $${i - 1} ESCAPE '\\' OR u.phone ILIKE $${i} ESCAPE '\\')`);
    }

    params.push(limit, offset);

    clauses.push('u.deleted_at IS NULL');
    const whereClause = `WHERE ${clauses.join(' AND ')}`;
    const query = await this.databaseService.query(
      `SELECT u.id,
              u.ssn,
              u.name,
              u.phone,
              u.status,
              u.is_admin,
              u.created_at::text AS created_at,
              u.updated_at::text AS updated_at,
              (
                SELECT COUNT(*)
                FROM products p
                WHERE p.owner_id = u.id
                  AND p.deleted_at IS NULL
              )::int AS published_products_count,
              (
                SELECT COUNT(*)
                FROM user_reports ur
                WHERE ur.reported_user_id = u.id
              )::int AS reports_count
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return { users: query.rows.map((row) => ({
        ...mapToAppUser(row),
        is_admin: row.is_admin,
        published_products_count: Number(row.published_products_count ?? 0),
        reports_count: Number(row.reports_count ?? 0),
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
    };
  }

  async getUserDetails(userId: number): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query<{
      id: number;
      ssn: string | null;
      name: string;
      phone: string;
      status: 'active' | 'paused' | 'banned';
      is_admin: boolean;
      avatar_file_id: number | null;
      contact_info: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, ssn, name, phone, status, is_admin, avatar_file_id, contact_info,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    const row = query.rows[0];
    const user = mapToAppUser(row);
    return { user: {
        ...user,
        status: row.status,
        profileState: user.profileState,
        avatar_file_id: row.avatar_file_id,
        contactInfo: row.contact_info,
        is_admin: row.is_admin,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } };
  }

  async listUserListings(userId: number, queryDto: ListUserListingsQueryDto): Promise<Record<string, unknown>> {
    await assertUserExists(this.databaseService, userId);

    const limit = queryDto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = queryDto.offset ?? 0;
    const status = queryDto.status ?? null;

    const query = await this.databaseService.query(
      `SELECT p.id, p.name, p.price, p.status, p.city, p.created_at::text AS created_at,
              (
                SELECT pi.file_id
                FROM product_images pi
                JOIN files f ON f.id = pi.file_id
                WHERE pi.product_id = p.id
                  AND f.status = 'uploaded'
                ORDER BY pi.sort_order ASC
                LIMIT 1
              ) AS product_image_file_id
       FROM products p
       WHERE p.owner_id = $1
         AND p.deleted_at IS NULL
         AND p.status IN ('available', 'sold')
         AND ($2::product_status IS NULL OR p.status = $2::product_status)
       ORDER BY p.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, status, limit, offset],
    );

    return { items: query.rows };
  }

  async listAdmins(queryDto: ListAdminPaginationQueryDto): Promise<Record<string, unknown>> {
    const limit = queryDto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = queryDto.offset ?? 0;
    const query = await this.databaseService.query(
      `SELECT id, ssn, name, phone, status, is_admin, created_at::text AS created_at, updated_at::text AS updated_at
       FROM users
       WHERE is_admin = true AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return { admins: query.rows.map((row) => ({
        ...mapToAppUser(row),
        is_admin: row.is_admin,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
    };
  }

  async promoteAdmin(admin: AuthUser, userId: number): Promise<Record<string, unknown>> {
    const before = await this.databaseService.query<{ id: number; is_admin: boolean }>(
      'SELECT id, is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
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
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, ssn, name, phone, status, is_admin, token_version, created_at::text AS created_at, updated_at::text AS updated_at`,
      [userId],
    );

    await this.logAdminAction(admin.sub, 'promote_admin', 'user', userId, { is_admin: true });
    return { user: {
        ...mapToAppUser(query.rows[0]),
        is_admin: query.rows[0].is_admin,
        token_version: query.rows[0].token_version,
        created_at: query.rows[0].created_at,
        updated_at: query.rows[0].updated_at,
      } };
  }

  async demoteAdmin(admin: AuthUser, userId: number): Promise<Record<string, unknown>> {
    if (admin.sub === userId) {
      throw new BadRequestException('Admins cannot demote themselves');
    }

    const before = await this.databaseService.query<{ id: number; is_admin: boolean }>(
      'SELECT id, is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
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
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, ssn, name, phone, status, is_admin, token_version, created_at::text AS created_at, updated_at::text AS updated_at`,
      [userId],
    );

    await this.logAdminAction(admin.sub, 'demote_admin', 'user', userId, { is_admin: false });
    return { user: {
        ...mapToAppUser(query.rows[0]),
        is_admin: query.rows[0].is_admin,
        token_version: query.rows[0].token_version,
        created_at: query.rows[0].created_at,
        updated_at: query.rows[0].updated_at,
      } };
  }

  async updateUserStatus(admin: AuthUser, userId: number, dto: UpdateUserStatusDto): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `UPDATE users
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, ssn, name, phone, status, is_admin, created_at::text AS created_at, updated_at::text AS updated_at`,
      [dto.status, userId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    await this.logAdminAction(admin.sub, 'update_user_status', 'user', userId, { status: dto.status });
    await this.redisService.del(`user:status:${userId}`);

    return { user: {
        ...mapToAppUser(query.rows[0]),
        is_admin: query.rows[0].is_admin,
        created_at: query.rows[0].created_at,
        updated_at: query.rows[0].updated_at,
      },
    };
  }

  async deleteUser(admin: AuthUser, userId: number): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `UPDATE users
       SET deleted_at = NOW(),
           token_version = token_version + 1,
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [userId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    await this.logAdminAction(admin.sub, 'delete_user', 'user', userId, {});
    await this.redisService.del(`user:status:${userId}`);

    return { message: 'User deleted' };
  }

  async createWarning(admin: AuthUser, dto: CreateWarningDto): Promise<Record<string, unknown>> {
    await assertUserExists(this.databaseService, dto.targetUserId, 'Target user');

    let query: { rows: Array<Record<string, unknown>> };
    try {
      query = await this.databaseService.query(
        `INSERT INTO admin_warnings (admin_id, target_user_id, message)
         VALUES ($1, $2, $3)
         RETURNING id, admin_id, target_user_id, message, created_at::text AS created_at`,
        [admin.sub, dto.targetUserId, dto.message],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException('Target user not found');
      }
      throw error;
    }

    await this.logAdminAction(admin.sub, 'create_warning', 'user', dto.targetUserId, { message: dto.message });

    return { warning: query.rows[0],
    };
  }

  async listReports(queryDto: ListAdminPaginationQueryDto): Promise<Record<string, unknown>> {
    const limit = queryDto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = queryDto.offset ?? 0;
    const query = await this.databaseService.query(
      `SELECT id, reporter_id, reported_user_id, reason AS description,
              created_at::text AS created_at
       FROM user_reports
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return { reports: query.rows };
  }

  async listUserReports(userId: number, queryDto: ListAdminPaginationQueryDto): Promise<Record<string, unknown>> {
    await assertUserExists(this.databaseService, userId);
    const limit = queryDto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = queryDto.offset ?? 0;

    const query = await this.databaseService.query(
      `SELECT id, reporter_id, reported_user_id, reason AS description,
              created_at::text AS created_at
       FROM user_reports
       WHERE reported_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    return { reports: query.rows };
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
       RETURNING id, reporter_id, reported_user_id, reason, status, reviewed_by,
                 created_at::text AS created_at,
                 reviewed_at::text AS reviewed_at,
                 updated_at::text AS updated_at`,
      [dto.status, admin.sub, reportId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('Report not found');
    }

    await this.logAdminAction(admin.sub, 'update_report_status', 'report', reportId, { status: dto.status });

    return { report: query.rows[0],
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
