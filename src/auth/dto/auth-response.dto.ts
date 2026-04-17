import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';

export class AuthUserDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '+201012345678' })
  phone!: string;
}

export class TokenDataDto {
  @ApiPropertyOptional({ type: AuthUserDto })
  user?: AuthUserDto;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken!: string;
}

export class TokenResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => TokenDataDto })
  data!: TokenDataDto;
}

export class OtpSentDataDto {
  @ApiProperty({ example: 'OTP sent' })
  message!: string;

  @ApiPropertyOptional({
    example: '000000',
    description: 'Only present when OTP_DEV_MODE=true (fixed to 000000 for console provider)',
  })
  otp?: string;
}

export class OtpSentResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => OtpSentDataDto })
  data!: OtpSentDataDto;
}

export class LogoutDataDto {}

export class LogoutResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => LogoutDataDto })
  data!: LogoutDataDto;
}
