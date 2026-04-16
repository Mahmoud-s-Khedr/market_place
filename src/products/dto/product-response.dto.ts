import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RelatedCategoryDto, RelatedFileDto, RelatedUserDto } from '../../common/dto/related-entities.dto';

export class ProductImageDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedFileDto, nullable: true })
  file!: RelatedFileDto | null;

  @ApiProperty({ example: 0 })
  sort_order!: number;

  @ApiProperty({ example: 'products/1/image.jpg' })
  object_key!: string;

  @ApiProperty({ example: 'uploaded', enum: ['pending', 'uploaded', 'failed', 'deleted'] })
  status!: string;
}

export class ProductDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  owner!: RelatedUserDto | null;

  @ApiProperty({ type: RelatedCategoryDto, nullable: true })
  category!: RelatedCategoryDto | null;

  @ApiProperty({ example: 'Used Laptop' })
  name!: string;

  @ApiPropertyOptional({ example: 'Good condition, 1 year old', nullable: true })
  description!: string | null;

  @ApiProperty({ example: 1500.00 })
  price!: number;

  @ApiProperty({ example: 'Cairo' })
  city!: string;

  @ApiPropertyOptional({ example: '10 Tahrir Square', nullable: true })
  address_text!: string | null;

  @ApiPropertyOptional({
    example: { condition: 'used', brand: 'Apple', storage: '256GB' },
    nullable: true,
  })
  details!: Record<string, unknown> | null;

  @ApiProperty({ example: 'available', enum: ['available', 'sold', 'archived'] })
  status!: string;

  @ApiProperty({ example: false })
  is_negotiable!: boolean;

  @ApiProperty({ example: 'both', enum: ['phone', 'chat', 'both'] })
  preferred_contact_method!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;

  @ApiPropertyOptional({
    example: '4.50',
    description: 'Seller average rating — only present in search results',
    nullable: true,
  })
  seller_rate?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this product is favorited by the current authenticated user',
    nullable: true,
  })
  is_favorite?: boolean | null;

  @ApiProperty({ type: [ProductImageDto] })
  images!: ProductImageDto[];
}

export class ProductResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ProductDto })
  product!: ProductDto;
}

export class ProductListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [ProductDto] })
  items!: ProductDto[];
}

export class ProductStatusDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'sold', enum: ['available', 'sold', 'archived'] })
  status!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class ProductStatusResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ProductStatusDto })
  product!: ProductStatusDto;
}

export class ProductDeleteResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Product deleted' })
  message!: string;
}
