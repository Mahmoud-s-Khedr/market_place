import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyRegistrationOtpDto {
  @ApiProperty({ description: 'Phone number (E.164 format)', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phone!: string;

  @ApiProperty({ description: 'One-time password sent via SMS (4–8 digits)', example: '000000', minLength: 4, maxLength: 8 })
  @IsString()
  @Length(4, 8)
  otp!: string;

  @ApiPropertyOptional({ description: 'Akedly transaction request ID', example: '68b4a1e8d686446a498008bd' })
  @IsOptional()
  @IsString()
  transactionReqID?: string;
}
