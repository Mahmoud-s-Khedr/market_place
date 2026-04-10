import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateUploadIntentDto {
  @ApiProperty({ enum: ['user', 'product', 'message'], description: 'Entity type that owns this file', example: 'product' })
  @IsEnum(['user', 'product', 'message'])
  ownerType!: 'user' | 'product' | 'message';

  @ApiPropertyOptional({ description: 'ID of the owning entity (omit for new entities)', example: 5, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  ownerId?: number;

  @ApiProperty({ enum: ['avatar', 'product_image', 'chat_attachment', 'document'], description: 'Intended use of the file', example: 'product_image' })
  @IsEnum(['avatar', 'product_image', 'chat_attachment', 'document'])
  purpose!: 'avatar' | 'product_image' | 'chat_attachment' | 'document';

  @ApiProperty({ description: 'Original filename including extension', example: 'photo.jpg', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  filename!: string;

  @ApiProperty({
    enum: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-msvideo',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/webm',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ],
    description: 'MIME type of the file',
    example: 'image/jpeg',
  })
  @IsIn([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ])
  mimeType!: string;

  @ApiPropertyOptional({ description: 'File size in bytes (max 50 MB)', example: 204800, minimum: 0, maximum: 52428800 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50 * 1024 * 1024)
  fileSizeBytes?: number;
}
