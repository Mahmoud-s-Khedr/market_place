import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '+201012345678' })
  phone!: string;
}

export class TokenResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiPropertyOptional({ type: AuthUserDto })
  user?: AuthUserDto;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken!: string;
}

export class OtpSentResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'OTP sent' })
  message!: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Only present when OTP_DEV_MODE=true',
  })
  otp?: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}
