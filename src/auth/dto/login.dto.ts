import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'User phone number (E.164 format)', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phone!: string;

  @ApiProperty({ description: 'User password', example: '🔐' })
  @IsString()
  password!: string;
}
