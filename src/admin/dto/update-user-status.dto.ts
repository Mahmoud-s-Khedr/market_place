import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['active', 'paused', 'banned'], description: 'New account status for the user', example: 'banned' })
  @IsEnum(['active', 'paused', 'banned'])
  status!: 'active' | 'paused' | 'banned';
}
