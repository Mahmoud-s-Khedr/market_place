import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Phone number associated with the account', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phone!: string;

  @ApiProperty({ description: 'One-time password received via SMS (4–8 digits)', example: '123456', minLength: 4, maxLength: 8 })
  @IsString()
  @Length(4, 8)
  otp!: string;

  @ApiProperty({ description: 'New password — must contain letters and numbers (8–64 chars)', example: 'NewSecret123', minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain letters and numbers',
  })
  newPassword!: string;

  @ApiProperty({ description: 'Must match newPassword', example: 'NewSecret123', minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  confirmPassword!: string;
}
