import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';
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

export class CategoriesListDataDto {
  @ApiProperty({ type: [CategoryDto] })
  categories!: CategoryDto[];
}

export class CategoryDataDto {
  @ApiProperty({ type: CategoryDto })
  category!: CategoryDto;
}

export class CategoryResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => CategoryDataDto })
  data!: CategoryDataDto;
}

export class CategoriesListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => CategoriesListDataDto })
  data!: CategoriesListDataDto;
}
