import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'User phone number (E.164 format)', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phone!: string;

  @ApiProperty({ description: 'User password (8–64 chars)', example: 'Secret123', minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  password!: string;
}
