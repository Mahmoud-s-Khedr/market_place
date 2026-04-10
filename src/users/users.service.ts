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
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileReadUrlService: FileReadUrlService,
  ) {}

  async getMe(user: AuthUser): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query<{
      id: number;
      name: string;
      phone: string;
      status: string;
      rate: string;
      avatar_object_key: string | null;
      avatar_mime_type: string | null;
    }>(
      `SELECT u.id,
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
    const { avatar_object_key, avatar_mime_type, ...rest } = row;
    return {
      success: true,
      user: {
        ...rest,
        avatar_url: avatar_object_key
          ? this.fileReadUrlService.buildReadUrl(avatar_object_key, avatar_mime_type ?? '')
          : null,
      },
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

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }

  async listContacts(user: AuthUser): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query(
      `SELECT id, type, value, city, is_primary, created_at, updated_at
       FROM user_contacts
       WHERE user_id = $1
       ORDER BY is_primary DESC, id DESC`,
      [user.sub],
    );

    return {
      success: true,
      contacts: query.rows,
    };
  }

  async createContact(user: AuthUser, dto: CreateContactDto): Promise<Record<string, unknown>> {
    if (dto.isPrimary) {
      await this.databaseService.query(
        'UPDATE user_contacts SET is_primary = FALSE WHERE user_id = $1 AND type = $2',
        [user.sub, dto.type],
      );
    }

    const query = await this.databaseService.query(
      `INSERT INTO user_contacts (user_id, type, value, city, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, type, value, city, is_primary, created_at, updated_at`,
      [user.sub, dto.type, dto.value, dto.city ?? null, dto.isPrimary ?? false],
    );

    return {
      success: true,
      contact: query.rows[0],
    };
  }

  async updateContact(
    user: AuthUser,
    contactId: number,
    dto: UpdateContactDto,
  ): Promise<Record<string, unknown>> {
    const existing = await this.databaseService.query<{ id: number; type: string }>(
      'SELECT id, type FROM user_contacts WHERE id = $1 AND user_id = $2',
      [contactId, user.sub],
    );

    if (!existing.rowCount) {
      throw new NotFoundException('Contact not found');
    }

    if (dto.isPrimary) {
      await this.databaseService.query(
        'UPDATE user_contacts SET is_primary = FALSE WHERE user_id = $1 AND type = $2',
        [user.sub, existing.rows[0].type],
      );
    }

    const query = await this.databaseService.query(
      `UPDATE user_contacts
       SET value = COALESCE($1, value),
           city = COALESCE($2, city),
           is_primary = COALESCE($3, is_primary),
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5
       RETURNING id, user_id, type, value, city, is_primary, created_at, updated_at`,
      [dto.value ?? null, dto.city ?? null, dto.isPrimary ?? null, contactId, user.sub],
    );

    return {
      success: true,
      contact: query.rows[0],
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

    return {
      success: true,
      message: 'Contact deleted',
    };
  }
}
