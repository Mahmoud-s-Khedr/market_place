import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../common/types/auth-user.type';
import { AppConfig } from '../config/configuration';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { MarkUploadedDto } from './dto/mark-uploaded.dto';
import { FileReadUrlService } from './file-read-url.service';
import { STORAGE_UPLOADER, StorageUploader } from './storage/storage-uploader.interface';

@Injectable()
export class FilesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService<{ app: AppConfig }, true>,
    private readonly fileReadUrlService: FileReadUrlService,
    @Inject(STORAGE_UPLOADER) private readonly storageUploader: StorageUploader,
  ) {}

  async createUploadIntent(
    user: AuthUser,
    dto: CreateUploadIntentDto,
  ): Promise<Record<string, unknown>> {
    const objectKey = this.buildObjectKey(dto.ownerType, dto.ownerId, dto.filename);
    const storageBucket = this.appConfig.storageProvider === 'cloudinary' ? null : this.appConfig.storageBucket;

    const insert = await this.databaseService.query<{ id: number }>(
      `INSERT INTO files (
          uploader_user_id,
          owner_type,
          owner_id,
          purpose,
          storage_provider,
          bucket,
          object_key,
          original_filename,
          mime_type,
          file_size_bytes,
          status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING id`,
      [
        user.sub,
        dto.ownerType,
        dto.ownerId ?? null,
        dto.purpose,
        this.appConfig.storageProvider,
        storageBucket,
        objectKey,
        dto.filename,
        dto.mimeType,
        dto.fileSizeBytes ?? null,
      ],
    );

    const fileId = insert.rows[0].id;
    const uploadIntent = await this.storageUploader.createUploadIntent({
      objectKey,
      mimeType: dto.mimeType,
      expiresInSeconds: this.appConfig.storageUploadTtlSeconds,
    });
    const upload: Record<string, unknown> = {
      method: uploadIntent.method,
      url: uploadIntent.url,
      expiresAt: uploadIntent.expiresAt,
    };
    if (uploadIntent.headers) {
      upload.headers = uploadIntent.headers;
    }
    if (uploadIntent.fields) {
      upload.fields = uploadIntent.fields;
    }

    return {
      success: true,
      file: {
        id: fileId,
        objectKey,
        status: 'pending',
      },
      upload,
    };
  }

  async markUploaded(
    user: AuthUser,
    fileId: number,
    dto: MarkUploadedDto,
  ): Promise<Record<string, unknown>> {
    const file = await this.databaseService.query<{
      id: number;
      uploader_user_id: number | null;
      object_key: string;
      status: string;
    }>('SELECT id, uploader_user_id, object_key, status FROM files WHERE id = $1', [fileId]);

    if (!file.rowCount) {
      throw new NotFoundException('File not found');
    }

    const row = file.rows[0];
    if (!row.uploader_user_id || row.uploader_user_id !== user.sub) {
      throw new ForbiddenException('Not allowed');
    }

    await this.databaseService.query(
      `UPDATE files
       SET status = 'uploaded',
           uploaded_at = NOW(),
           checksum_sha256 = COALESCE($1, checksum_sha256),
           updated_at = NOW()
       WHERE id = $2`,
      [dto.checksumSha256 ?? null, fileId],
    );

    return {
      success: true,
      file: {
        id: fileId,
        objectKey: row.object_key,
        status: 'uploaded',
      },
    };
  }

  async getFile(user: AuthUser, fileId: number): Promise<Record<string, unknown>> {
    const query = await this.databaseService.query<{
      id: number;
      uploader_user_id: number | null;
      owner_type: string;
      owner_id: number | null;
      purpose: string;
      object_key: string;
      mime_type: string | null;
      file_size_bytes: number | null;
      status: string;
      created_at: Date;
      uploaded_at: Date | null;
    }>(
      `SELECT id, uploader_user_id, owner_type, owner_id, purpose, object_key, mime_type,
              file_size_bytes, status, created_at, uploaded_at
       FROM files
       WHERE id = $1`,
      [fileId],
    );

    if (!query.rowCount) {
      throw new NotFoundException('File not found');
    }

    const file = query.rows[0];
    if (!user.isAdmin && (!file.uploader_user_id || file.uploader_user_id !== user.sub)) {
      throw new ForbiddenException('Not allowed');
    }

    return {
      success: true,
      file: {
        ...file,
        readUrl: this.fileReadUrlService.buildReadUrl(file.object_key, file.mime_type ?? ''),
      },
    };
  }

  private get appConfig(): AppConfig {
    return this.configService.get('app', { infer: true });
  }

  private buildObjectKey(ownerType: string, ownerId: number | undefined, filename: string): string {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${ownerType}/${ownerId ?? 'temp'}/${Date.now()}-${randomBytes(4).toString('hex')}-${safeFilename}`;
  }
}
