import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class RequestPasswordResetOtpDto {
  @ApiProperty({ description: 'Registered phone number to receive the reset OTP', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phone!: string;
}
