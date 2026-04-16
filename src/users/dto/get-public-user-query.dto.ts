import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class GetPublicUserQueryDto {
  @ApiPropertyOptional({ description: 'Page size (1–50, default 20)', minimum: 1, maximum: 50, example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination offset (default 0)', minimum: 0, example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number;
}
