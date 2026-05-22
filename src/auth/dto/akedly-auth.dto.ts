import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PowSolutionDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  @IsString()
  challengeToken!: string;

  @ApiProperty({ example: '42' })
  @IsString()
  nonce!: string;
}

export class AkedlySendOtpDto {
  @ApiProperty({ description: 'Phone number (E.164 format)', example: '+201234567890' })
  @Matches(/^\+?[1-9]\d{7,15}$/)
  phoneNumber!: string;

  @ApiProperty({ enum: ['registration', 'password_reset'], example: 'registration' })
  @IsIn(['registration', 'password_reset'])
  purpose!: 'registration' | 'password_reset';

  @ApiProperty({ type: PowSolutionDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PowSolutionDto)
  powSolution!: PowSolutionDto;

  @ApiPropertyOptional({ description: 'Cloudflare Turnstile token' })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}

