import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class MarkUploadedDto {
  @ApiPropertyOptional({ description: 'SHA-256 checksum of the uploaded file (hex, 64 chars) for integrity verification', example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', minLength: 64, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  checksumSha256?: string;
}
