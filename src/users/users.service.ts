import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../common/types/auth-user.type';
import { FileReadUrlService } from '../files/file-read-url.service';
import { DEFAULT_PAGE_SIZE } from '../common/constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GetPublicUserQueryDto } from './dto/get-public-user-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { mapToAppUser } from '../common/mappers/app-user.mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileReadUrlService: FileReadUrlService,
  ) {}

  async getMe(user: AuthUser): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query<{
      id: number;
      ssn: string | null;
      name: string;
      phone: string;
      status: string;
      rate: string;
      avatar_file_id: number | null;
      avatar_object_key: string | null;
      avatar_mime_type: string | null;
      avatar_purpose: string | null;
      avatar_status: string | null;
      avatar_created_at: string | null;
      avatar_uploaded_at: string | null;
      contact_info: string | null;
    }>(
      `SELECT u.id,
              u.ssn,
              u.name,
              u.phone,
              u.status,
              u.avatar_file_id,
              f.object_key AS avatar_object_key,
              f.mime_type AS avatar_mime_type,
              f.purpose AS avatar_purpose,
              f.status AS avatar_status,
              f.created_at::text AS avatar_created_at,
              f.uploaded_at::text AS avatar_uploaded_at,
              u.contact_info,
              COALESCE(ROUND(AVG(ur.rating_value)::numeric, 2), 0.00)::text AS rate
       FROM users u
       LEFT JOIN user_ratings ur ON ur.rated_user_id = u.id
       LEFT JOIN files f ON f.id = u.avatar_file_id
       WHERE u.id = $1
       GROUP BY u.id, f.id, f.object_key, f.mime_type, f.purpose, f.status, f.created_at, f.uploaded_at`,
      [user.sub],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    const row = query.rows[0];
    const { rate } = row;
    const appUser = mapToAppUser(row);
    return { user: {
        ...appUser,
        rate,
        contactInfo: row.contact_info,
        avatar: this.buildAvatarFile(row),
      },
    };
  }

  async getPublicProfile(
    userId: number,
    dto: GetPublicUserQueryDto,
    viewerUserId?: number,
  ): Promise<Record<string, unknown>> {
    let blockedByMe = false;
    let blockedMe = false;

    if (viewerUserId) {
      const block = await this.databaseService.query<{ blocked_by_me: boolean; blocked_me: boolean }>(
        `SELECT EXISTS(
            SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2
          ) AS blocked_by_me,
          EXISTS(
            SELECT 1 FROM user_blocks WHERE blocker_id = $2 AND blocked_id = $1
          ) AS blocked_me`,
        [viewerUserId, userId],
      );
      blockedByMe = block.rows[0]?.blocked_by_me ?? false;
      blockedMe = block.rows[0]?.blocked_me ?? false;
      if (blockedByMe || blockedMe) {
        throw new NotFoundException('User not found');
      }
    }

    const user = await this.databaseService.query<{
      id: number;
      ssn: string | null;
      name: string;
      phone: string;
      status: string;
      created_at: string;
      ads_count: number;
      rate: string;
      avatar_file_id: number | null;
      avatar_object_key: string | null;
      avatar_mime_type: string | null;
      avatar_purpose: string | null;
      avatar_status: string | null;
      avatar_created_at: string | null;
      avatar_uploaded_at: string | null;
      contact_info: string | null;
    }>(
      `SELECT u.id,
              u.ssn,
              u.name,
              u.phone,
              u.status,
              u.created_at,
              u.avatar_file_id,
              (
                SELECT COUNT(*)::int
                FROM products p
                WHERE p.owner_id = u.id AND p.deleted_at IS NULL
              ) AS ads_count,
              COALESCE(ROUND(AVG(ur.rating_value)::numeric, 2), 0.00)::text AS rate,
              f.object_key AS avatar_object_key,
              f.mime_type AS avatar_mime_type,
              f.purpose AS avatar_purpose,
              f.status AS avatar_status,
              f.created_at::text AS avatar_created_at,
              f.uploaded_at::text AS avatar_uploaded_at,
              u.contact_info
       FROM users u
       LEFT JOIN user_ratings ur ON ur.rated_user_id = u.id
       LEFT JOIN files f ON f.id = u.avatar_file_id
       WHERE u.id = $1
       GROUP BY u.id, f.id, f.object_key, f.mime_type, f.purpose, f.status, f.created_at, f.uploaded_at`,
      [userId],
    );

    if (!user.rowCount) {
      throw new NotFoundException('User not found');
    }

    const limit = dto.limit ?? DEFAULT_PAGE_SIZE;
    const offset = dto.offset ?? 0;
    const products = await this.databaseService.query(
      `SELECT plv.id, plv.owner_id, plv.category_id, plv.name, plv.description, plv.price, plv.city, plv.address_text,
              plv.details, plv.status, plv.is_negotiable, plv.preferred_contact_method, plv.created_at, plv.updated_at,
              plv.seller_rate,
              CASE WHEN $2::bigint IS NULL THEN NULL
                   ELSE EXISTS(
                     SELECT 1 FROM user_favorites uf
                     WHERE uf.user_id = $2::bigint AND uf.product_id = plv.id
                   )
              END AS is_favorite,
              COALESCE((
                SELECT json_agg(row_to_json(img) ORDER BY img.sort_order ASC)
                FROM (
                  SELECT pi.id, pi.file_id, pi.sort_order, f.object_key, f.status
                  FROM product_images pi
                  JOIN files f ON f.id = pi.file_id
                  WHERE pi.product_id = plv.id
                ) img
              ), '[]'::json) AS images
       FROM product_listing_view plv
       WHERE plv.owner_id = $1 AND plv.status = 'available'
       ORDER BY plv.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, viewerUserId ?? null, limit, offset],
    );

    const row = user.rows[0];
    const { created_at, ads_count, rate } = row;
    const appUser = mapToAppUser(row);
    return { user: {
        ...appUser,
        created_at,
        ads_count,
        rate,
        contactInfo: row.contact_info,
        avatar: this.buildAvatarFile(row),
        blocked_by_me: viewerUserId ? blockedByMe : null,
        blocked_me: viewerUserId ? blockedMe : null,
      },
      products: products.rows,
    };
  }

  async updateMe(user: AuthUser, dto: UpdateProfileDto): Promise<Record<string, unknown>> {
    const hasName = dto.name !== undefined;
    const hasAvatarFileId = Object.prototype.hasOwnProperty.call(dto, 'avatarFileId');
    const hasContactInfo = Object.prototype.hasOwnProperty.call(dto, 'contactInfo');
    if (!hasName && !hasAvatarFileId && !hasContactInfo) {
      throw new BadRequestException('Nothing to update');
    }

    if (typeof dto.avatarFileId === 'number') {
      const file = await this.databaseService.query<{
        id: number;
        uploader_user_id: number | null;
        purpose: string;
        status: string;
      }>(
        'SELECT id, uploader_user_id, purpose, status FROM files WHERE id = $1 LIMIT 1',
        [dto.avatarFileId],
      );

      if (!file.rowCount) {
        throw new NotFoundException('Avatar file not found');
      }
      if (!file.rows[0].uploader_user_id || file.rows[0].uploader_user_id !== user.sub) {
        throw new ForbiddenException('Not allowed to use this file');
      }
      if (file.rows[0].status !== 'uploaded' || file.rows[0].purpose !== 'avatar') {
        throw new BadRequestException('Avatar file must be an uploaded avatar');
      }
    }

    const avatarFileIdParam = hasAvatarFileId ? dto.avatarFileId ?? null : null;
    const contactInfoParam = hasContactInfo ? dto.contactInfo ?? null : null;
    await this.databaseService.query(
      `UPDATE users
       SET name = CASE WHEN $1::text IS NULL THEN name ELSE $1 END,
           avatar_file_id = CASE WHEN $2::boolean THEN $3::bigint ELSE avatar_file_id END,
           contact_info = CASE WHEN $5::boolean THEN $6::text ELSE contact_info END,
           updated_at = NOW()
       WHERE id = $4`,
      [dto.name ?? null, hasAvatarFileId, avatarFileIdParam, user.sub, hasContactInfo, contactInfoParam],
    );

    return this.getMe(user);
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [user.sub],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    const isOldPasswordValid = await compare(dto.oldPassword, query.rows[0].password_hash);
    if (!isOldPasswordValid) {
      throw new BadRequestException('Invalid old password');
    }

    const newPasswordHash = await hash(dto.newPassword, 12);
    await this.databaseService.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, user.sub],
    );

    return { message: 'Password changed successfully',
    };
  }

  private buildAvatarFile(row: {
    avatar_file_id: number | null;
    avatar_object_key: string | null;
    avatar_mime_type: string | null;
    avatar_purpose: string | null;
    avatar_status: string | null;
    avatar_created_at: string | null;
    avatar_uploaded_at: string | null;
  }): Record<string, unknown> | null {
    if (!row.avatar_file_id || !row.avatar_object_key) {
      return null;
    }

    return {
      id: row.avatar_file_id,
      purpose: row.avatar_purpose ?? 'avatar',
      object_key: row.avatar_object_key,
      mime_type: row.avatar_mime_type,
      status: row.avatar_status ?? 'uploaded',
      created_at: row.avatar_created_at,
      uploaded_at: row.avatar_uploaded_at,
      url: this.fileReadUrlService.buildReadUrl(row.avatar_object_key, row.avatar_mime_type ?? ''),
    };
  }
}
