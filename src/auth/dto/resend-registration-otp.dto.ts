import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class ResendRegistrationOtpDto {
  @ApiProperty({ description: 'Phone number (E.164 format)', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phone!: string;
}
