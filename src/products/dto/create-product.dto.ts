import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateProductDto {
  @ApiProperty({ description: 'ID of the leaf category this product belongs to', example: 3, minimum: 1 })
  @IsNumber()
  @Min(1)
  categoryId!: number;

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

  @ApiPropertyOptional({ type: [Number], description: 'Up to 10 pre-uploaded file IDs for product images', example: [1, 2, 3] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  imageFileIds?: number[];
}
