import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PRODUCT_CATEGORIES, PRODUCT_SUBCATEGORIES } from '../product-taxonomy';
import { IsValidProductCategory, IsValidSubcategoryForCategory } from './product-taxonomy.validators';

export class CreateProductDto {
  @ApiProperty({ description: 'Product category enum key', enum: PRODUCT_CATEGORIES, example: 'electronics' })
  @IsString()
  @IsValidProductCategory({ message: 'category must be a valid ProductCategory key' })
  category!: string;

  @ApiPropertyOptional({ description: 'Product subcategory enum key', enum: PRODUCT_SUBCATEGORIES, example: 'smartphones' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsValidSubcategoryForCategory('category', { allowAll: false }, { message: 'subcategory must belong to the selected category and cannot be all' })
  subcategory?: string | null;

  @ApiProperty({ description: 'Product title (1–255 chars)', example: 'iPhone 14 Pro Max', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ description: 'Product description (1–5000 chars)', example: 'Excellent condition, barely used.', minLength: 1, maxLength: 5000 })
  @IsString()
  @Length(1, 5000)
  description!: string;

  @ApiProperty({ description: 'Price in the local currency', example: 1500.00, minimum: 0, maximum: 9999999999.99 })
  @IsNumber()
  @Min(0)
  @Max(9999999999.99)
  price!: number;

  @ApiProperty({ description: 'City where the product is located', example: 'Cairo', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  city!: string;

  @ApiProperty({ description: 'Street / area address text (1–1000 chars)', example: '15 Tahrir Square, Downtown', minLength: 1, maxLength: 1000 })
  @IsString()
  @Length(1, 1000)
  addressText!: string;

  @ApiPropertyOptional({
    description: 'Additional product details as a JSON object',
    example: { condition: 'used', color: 'black', storage: '256GB' },
  })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Number], description: 'Up to 10 pre-uploaded file IDs for product images', example: [1, 2, 3] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  imageFileIds?: number[];

  @ApiPropertyOptional({ description: 'Whether price is negotiable', example: true })
  @IsOptional()
  @IsBoolean()
  isNegotiable?: boolean;

  @ApiPropertyOptional({
    description: 'Preferred contact method',
    enum: ['phone', 'chat', 'both'],
    example: 'both',
  })
  @IsOptional()
  @IsEnum(['phone', 'chat', 'both'])
  preferredContactMethod?: 'phone' | 'chat' | 'both';
}
