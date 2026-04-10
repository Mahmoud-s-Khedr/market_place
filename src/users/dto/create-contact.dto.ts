import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class CreateContactDto {
  @ApiProperty({ enum: ['phone', 'email', 'address'], description: 'Contact type', example: 'phone' })
  @IsEnum(['phone', 'email', 'address'])
  type!: 'phone' | 'email' | 'address';

  @ApiProperty({ description: 'Contact value (phone number, email, or address string)', example: '+201234567890', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  value!: string;

  @ApiPropertyOptional({ description: 'City (required when type is address)', example: 'Cairo', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  city?: string;

  @ApiPropertyOptional({ description: 'Whether this is the primary contact of its type', example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
