import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ListFavoritesDto {
  @ApiPropertyOptional({ enum: ['price', 'created'], description: 'Sort field', example: 'created' })
  @IsOptional()
  @IsEnum(['price', 'created'])
  sortBy?: 'price' | 'created';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Sort direction', example: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Page size (1–100, default 20)', example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination offset (default 0)', example: 0, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number;
}
