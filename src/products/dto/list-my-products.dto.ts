import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SearchProductsDto } from './search-products.dto';

export class ListMyProductsDto extends SearchProductsDto {
  @ApiPropertyOptional({ enum: ['available', 'sold', 'archived'], description: 'Filter by product status', example: 'available' })
  @IsOptional()
  @IsEnum(['available', 'sold', 'archived'])
  status?: 'available' | 'sold' | 'archived';
}
