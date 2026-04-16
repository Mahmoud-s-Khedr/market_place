import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RelatedCategoryDto } from '../../common/dto/related-entities.dto';

export class CategoryDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiPropertyOptional({ type: RelatedCategoryDto, nullable: true })
  parent!: RelatedCategoryDto | null;

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
