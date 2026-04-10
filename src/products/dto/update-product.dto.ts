import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateProductDto {
  @ApiPropertyOptional({ description: 'ID of the leaf category', example: 3, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Product title (1–255 chars)', example: 'iPhone 14 Pro Max', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ description: 'Product description (1–5000 chars)', example: 'Excellent condition.', minLength: 1, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  description?: string;

  @ApiPropertyOptional({ description: 'Price in local currency', example: 1500.00, minimum: 0, maximum: 9999999999.99 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9999999999.99)
  price?: number;

  @ApiPropertyOptional({ description: 'City where the product is located', example: 'Cairo', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  city?: string;

  @ApiPropertyOptional({ description: 'Street / area address text (1–1000 chars)', example: '15 Tahrir Square, Downtown', minLength: 1, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  addressText?: string;

  @ApiPropertyOptional({ type: [Number], description: 'Replaces the full image set with up to 10 file IDs', example: [1, 2] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  imageFileIds?: number[];
}
