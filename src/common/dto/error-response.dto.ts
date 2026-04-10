import { ApiProperty } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiProperty({ example: 409 })
  code!: number;

  @ApiProperty({ example: 'Conflict' })
  message!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/auth/register/request-otp' })
  path!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success!: boolean;

  @ApiProperty({ type: ErrorDetailDto })
  error!: ErrorDetailDto;
}
