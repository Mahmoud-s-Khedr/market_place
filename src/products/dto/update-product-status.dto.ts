import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ['available', 'sold', 'archived'], description: 'New product status', example: 'sold' })
  @IsEnum(['available', 'sold', 'archived'])
  status!: 'available' | 'sold' | 'archived';
}
