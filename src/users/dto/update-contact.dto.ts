import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateContactDto {
  @ApiPropertyOptional({ description: 'New contact value', example: '+201111111111', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  value?: string;

  @ApiPropertyOptional({ description: 'Set as primary contact of its type', example: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
