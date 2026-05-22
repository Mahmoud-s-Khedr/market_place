import { Body, Controller, Get, Headers, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AuthService } from './auth.service';
import { AkedlySendOtpDto } from './dto/akedly-auth.dto';

@ApiTags('Auth')
@Controller('auth/akedly')
export class AuthAkedlyController {
  constructor(private readonly authService: AuthService) {}

  @Get('challenge')
  @ApiOperation({ summary: 'Proxy Akedly challenge endpoint' })
  @ApiResponse({ status: 200, description: 'Challenge fetched successfully' })
  @ApiResponse({ status: 503, description: 'Failed to fetch Akedly challenge', type: ErrorResponseDto })
  getChallenge(): Promise<Record<string, unknown>> {
    return this.authService.getAkedlyChallenge();
  }

  @Post('send')
  @ApiOperation({ summary: 'Send OTP via Akedly Shield' })
  @ApiResponse({ status: 201, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid payload', type: ErrorResponseDto })
  sendOtp(
    @Body() dto: AkedlySendOtpDto,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xForwardedFor?: string,
  ): Promise<Record<string, unknown>> {
    const endUserIp = this.extractEndUserIp(ip, xForwardedFor);
    return this.authService.sendAkedlyOtp(dto, endUserIp);
  }

  private extractEndUserIp(ip: string, xForwardedFor?: string): string {
    if (xForwardedFor) {
      const first = xForwardedFor.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }
    return ip;
  }
}

