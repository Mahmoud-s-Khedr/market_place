import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name (2–150 chars)', example: 'Ahmed Ali', minLength: 2, maxLength: 150 })
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @ApiPropertyOptional({ description: 'File ID of the uploaded avatar image, or null to remove avatar', example: 7, nullable: true })
  @IsOptional()
  @IsNumber()
  avatarFileId?: number | null;

  @ApiPropertyOptional({ description: 'Public contact information string (or null to clear)', example: '+201012345678', nullable: true, minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  contactInfo?: string | null;
}
