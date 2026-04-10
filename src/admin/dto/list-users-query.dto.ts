import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'paused', 'banned'], description: 'Filter by account status', example: 'banned' })
  @IsOptional()
  @IsEnum(['active', 'paused', 'banned'])
  status?: 'active' | 'paused' | 'banned';

  @ApiPropertyOptional({ description: 'Search by name or phone (1–100 chars)', example: 'Ahmed', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ description: 'Page size (1–100, default 20)', example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination offset (0–10000, default 0)', example: 0, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;
}
