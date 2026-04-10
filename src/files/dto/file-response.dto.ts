import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadIntentDto {
  @ApiProperty({ example: 'PUT', description: 'HTTP method to use for the upload request' })
  method!: string;

  @ApiProperty({ example: 'https://api.cloudinary.com/v1_1/example/upload' })
  url!: string;

  @ApiProperty({ example: '2026-03-28T12:15:00.000Z' })
  expiresAt!: string;

  @ApiPropertyOptional({
    example: { 'Content-Type': 'image/jpeg' },
    description: 'Headers to include in the upload request (optional)',
  })
  headers?: Record<string, string>;

  @ApiPropertyOptional({
    example: { signature: 'abc123', timestamp: '1711622400' },
    description: 'Form fields for multipart uploads (optional)',
  })
  fields?: Record<string, string>;
}

export class UploadIntentFileDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'users/5/avatar.jpg' })
  objectKey!: string;

  @ApiProperty({ example: 'pending', enum: ['pending', 'uploaded', 'failed', 'deleted'] })
  status!: string;
}

export class UploadIntentResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: UploadIntentFileDto })
  file!: UploadIntentFileDto;

  @ApiProperty({ type: UploadIntentDto })
  upload!: UploadIntentDto;
}

export class FileMarkUploadedResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: UploadIntentFileDto })
  file!: UploadIntentFileDto;
}

export class FileMetadataDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiPropertyOptional({ example: 5, nullable: true })
  uploader_user_id!: number | null;

  @ApiProperty({ example: 'user', enum: ['user', 'product', 'message'] })
  owner_type!: string;

  @ApiPropertyOptional({ example: 1, nullable: true })
  owner_id!: number | null;

  @ApiProperty({ example: 'avatar', enum: ['avatar', 'product_image', 'chat_attachment', 'document'] })
  purpose!: string;

  @ApiProperty({ example: 'users/5/avatar.jpg' })
  object_key!: string;

  @ApiPropertyOptional({ example: 'image/jpeg', nullable: true })
  mime_type!: string | null;

  @ApiPropertyOptional({ example: 204800, nullable: true })
  file_size_bytes!: number | null;

  @ApiProperty({ example: 'uploaded', enum: ['pending', 'uploaded', 'failed', 'deleted'] })
  status!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiPropertyOptional({ example: '2026-03-28T12:05:00.000Z', nullable: true })
  uploaded_at!: string | null;

  @ApiProperty({ example: 'https://res.cloudinary.com/example/image/upload/users/5/avatar.jpg' })
  readUrl!: string;
}

export class FileResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: FileMetadataDto })
  file!: FileMetadataDto;
}
