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
import { CreateContactDto } from './dto/create-contact.dto';
import { GetPublicUserQueryDto } from './dto/get-public-user-query.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
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
      avatar_object_key: string | null;
      avatar_mime_type: string | null;
    }>(
      `SELECT u.id,
              u.ssn,
              u.name,
              u.phone,
              u.status,
              f.object_key AS avatar_object_key,
              f.mime_type AS avatar_mime_type,
              COALESCE(ROUND(AVG(ur.rating_value)::numeric, 2), 0.00)::text AS rate
       FROM users u
       LEFT JOIN user_ratings ur ON ur.rated_user_id = u.id
       LEFT JOIN files f ON f.id = u.avatar_file_id
       WHERE u.id = $1
       GROUP BY u.id, f.object_key, f.mime_type`,
      [user.sub],
    );

    if (!query.rowCount) {
      throw new NotFoundException('User not found');
    }

    const row = query.rows[0];
    const { avatar_object_key, avatar_mime_type, rate } = row;
    const appUser = mapToAppUser(row);
    return { user: {
        ...appUser,
        rate,
        avatar_url: avatar_object_key
          ? this.fileReadUrlService.buildReadUrl(avatar_object_key, avatar_mime_type ?? '')
          : null,
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
      avatar_object_key: string | null;
      avatar_mime_type: string | null;
    }>(
      `SELECT u.id,
              u.ssn,
              u.name,
              u.phone,
              u.status,
              u.created_at,
              (
                SELECT COUNT(*)::int
                FROM products p
                WHERE p.owner_id = u.id AND p.deleted_at IS NULL
              ) AS ads_count,
              COALESCE(ROUND(AVG(ur.rating_value)::numeric, 2), 0.00)::text AS rate,
              f.object_key AS avatar_object_key,
              f.mime_type AS avatar_mime_type
       FROM users u
       LEFT JOIN user_ratings ur ON ur.rated_user_id = u.id
       LEFT JOIN files f ON f.id = u.avatar_file_id
       WHERE u.id = $1
       GROUP BY u.id, f.object_key, f.mime_type`,
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
    const { avatar_object_key, avatar_mime_type, created_at, ads_count, rate } = row;
    const appUser = mapToAppUser(row);
    return { user: {
        ...appUser,
        created_at,
        ads_count,
        rate,
        avatar_url: avatar_object_key
          ? this.fileReadUrlService.buildReadUrl(avatar_object_key, avatar_mime_type ?? '')
          : null,
        blocked_by_me: viewerUserId ? blockedByMe : null,
        blocked_me: viewerUserId ? blockedMe : null,
      },
      products: products.rows,
    };
  }

  async updateMe(user: AuthUser, dto: UpdateProfileDto): Promise<Record<string, unknown>> {
    if (!dto.name && !dto.avatarFileId) {
      throw new BadRequestException('Nothing to update');
    }

    if (dto.avatarFileId) {
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

    await this.databaseService.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           avatar_file_id = COALESCE($2, avatar_file_id),
           updated_at = NOW()
       WHERE id = $3`,
      [dto.name ?? null, dto.avatarFileId ?? null, user.sub],
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

  async listContacts(user: AuthUser): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT id, contact_type, value, is_primary, created_at, updated_at
       FROM user_contacts
       WHERE user_id = $1
       ORDER BY is_primary DESC, id DESC`,
      [user.sub],
    );

    return { contacts: query.rows,
    };
  }

  async createContact(user: AuthUser, dto: CreateContactDto): Promise<Record<string, unknown>> {
    if (dto.isPrimary) {
      await this.databaseService.query(
        'UPDATE user_contacts SET is_primary = FALSE WHERE user_id = $1 AND contact_type = $2',
        [user.sub, dto.contactType],
      );
    }

    const query = await this.databaseService.query(
      `INSERT INTO user_contacts (user_id, contact_type, value, is_primary)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, contact_type, value, is_primary, created_at, updated_at`,
      [user.sub, dto.contactType, dto.value, dto.isPrimary ?? false],
    );

    return { contact: query.rows[0],
    };
  }

  async updateContact(
    user: AuthUser,
    contactId: number,
    dto: UpdateContactDto,
  ): Promise<Record<string, unknown>> {
    const existing = await this.databaseService.query<{ id: number; contact_type: string }>(
      'SELECT id, contact_type FROM user_contacts WHERE id = $1 AND user_id = $2',
      [contactId, user.sub],
    );

    if (!existing.rowCount) {
      throw new NotFoundException('Contact not found');
    }

    if (dto.isPrimary) {
      await this.databaseService.query(
        'UPDATE user_contacts SET is_primary = FALSE WHERE user_id = $1 AND contact_type = $2',
        [user.sub, existing.rows[0].contact_type],
      );
    }

    const query = await this.databaseService.query(
      `UPDATE user_contacts
       SET value = COALESCE($1, value),
           is_primary = COALESCE($2, is_primary),
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING id, user_id, contact_type, value, is_primary, created_at, updated_at`,
      [dto.value ?? null, dto.isPrimary ?? null, contactId, user.sub],
    );

    return { contact: query.rows[0],
    };
  }

  async deleteContact(user: AuthUser, contactId: number): Promise<Record<string, unknown>> {
    const result = await this.databaseService.query(
      'DELETE FROM user_contacts WHERE id = $1 AND user_id = $2',
      [contactId, user.sub],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException('Contact not found');
    }

    return { message: 'Contact deleted',
    };
  }
}
