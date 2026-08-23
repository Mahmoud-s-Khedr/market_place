import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password', example: '🔐' })
  @IsString()
  oldPassword!: string;

  @ApiProperty({ description: 'New password', example: '🔐' })
  @IsString()
  newPassword!: string;
}
