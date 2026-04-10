import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  parent_id!: number | null;

  @ApiProperty({ example: 'Electronics' })
  name!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;
}

export class CategoriesListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [CategoryDto] })
  categories!: CategoryDto[];
}
