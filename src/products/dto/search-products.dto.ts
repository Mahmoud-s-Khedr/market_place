import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

function IsNotAfter(siblingProperty: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotAfter',
      target: (object as { constructor: new (...args: unknown[]) => unknown }).constructor,
      propertyName,
      constraints: [siblingProperty],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];
          if (typeof value !== 'string' || typeof relatedValue !== 'string') return true;
          return new Date(relatedValue) <= new Date(value);
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          return `${args.property} must be on or after ${relatedPropertyName}`;
        },
      },
    });
  };
}

export class SearchProductsDto {
  @ApiPropertyOptional({ description: 'Filter by category ID', example: 3, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Minimum price filter', example: 100, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price filter', example: 5000, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Filter products listed on or after this date (ISO 8601)', example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Filter products listed on or before this date (ISO 8601); must be ≥ fromDate', example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  @IsNotAfter('fromDate', { message: 'toDate must be on or after fromDate' })
  toDate?: string;

  @ApiPropertyOptional({ description: 'Minimum seller average rating (0–5)', example: 3.5, minimum: 0, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  minRate?: number;

  @ApiPropertyOptional({ description: 'Filter by city', example: 'Cairo' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Filter by address text (partial match)', example: 'Tahrir' })
  @IsOptional()
  @IsString()
  addressText?: string;

  @ApiPropertyOptional({ description: 'Full-text search across product name and description', example: 'iPhone' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['price', 'address', 'rate', 'created'], description: 'Sort field', example: 'created' })
  @IsOptional()
  @IsEnum(['price', 'address', 'rate', 'created'])
  sortBy?: 'price' | 'address' | 'rate' | 'created';

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
