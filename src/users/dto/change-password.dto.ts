import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password', example: 'OldSecret123', minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  oldPassword!: string;

  @ApiProperty({ description: 'New password — must contain letters and numbers (8–64 chars)', example: 'NewSecret456', minLength: 8, maxLength: 64 })
  @IsString()
  @Length(8, 64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain letters and numbers',
  })
  newPassword!: string;
}
