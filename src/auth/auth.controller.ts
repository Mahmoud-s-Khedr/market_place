import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetOtpDto } from './dto/request-password-reset-otp.dto';
import { RequestRegistrationOtpDto } from './dto/request-registration-otp.dto';
import { ResendRegistrationOtpDto } from './dto/resend-registration-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyRegistrationOtpDto } from './dto/verify-registration-otp.dto';
import { LogoutResponseDto, OtpSentResponseDto, TokenResponseDto } from './dto/auth-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register and request a verification OTP via SMS' })
  @ApiResponse({ status: 201, description: 'OTP sent successfully', type: OtpSentResponseDto })
  @ApiResponse({ status: 409, description: 'Phone or SSN already exists', type: ErrorResponseDto })
  requestRegistrationOtp(@Body() dto: RequestRegistrationOtpDto): Promise<Record<string, unknown>> {
    return this.authService.requestRegistrationOtp(dto);
  }

  @Post('register/resend-otp')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend registration OTP to an existing pending registration' })
  @ApiResponse({ status: 201, description: 'OTP resent successfully', type: OtpSentResponseDto })
  @ApiResponse({ status: 404, description: 'No pending registration found for this phone', type: ErrorResponseDto })
  resendRegistrationOtp(@Body() dto: ResendRegistrationOtpDto): Promise<Record<string, unknown>> {
    return this.authService.resendRegistrationOtp(dto);
  }

  @Post('register/verify')
  @ApiOperation({ summary: 'Verify OTP and complete registration' })
  @ApiResponse({ status: 201, description: 'User registered; returns access + refresh tokens', type: TokenResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP', type: ErrorResponseDto })
  verifyRegistrationOtp(@Body() dto: VerifyRegistrationOtpDto): Promise<Record<string, unknown>> {
    return this.authService.verifyRegistrationOtp(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with phone and password' })
  @ApiResponse({ status: 201, description: 'Returns access + refresh tokens', type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials', type: ErrorResponseDto })
  login(@Body() dto: LoginDto): Promise<Record<string, unknown>> {
    return this.authService.login(dto);
  }

  @Post('password/request-otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password-reset OTP via SMS' })
  @ApiResponse({ status: 201, description: 'OTP sent (or silently ignored if phone not found)', type: OtpSentResponseDto })
  requestPasswordResetOtp(
    @Body() dto: RequestPasswordResetOtpDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.requestPasswordResetOtp(dto);
  }

  @Post('password/reset')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password using OTP' })
  @ApiResponse({ status: 201, description: 'Password updated; returns new tokens', type: TokenResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP', type: ErrorResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<Record<string, unknown>> {
    return this.authService.resetPassword(dto);
  }

  @Post('refresh')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh access token using a refresh token' })
  @ApiResponse({ status: 201, description: 'Returns new access + refresh tokens', type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid refresh token', type: ErrorResponseDto })
  refresh(@Body() dto: RefreshTokenDto): Promise<Record<string, unknown>> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke refresh token and logout' })
  @ApiResponse({ status: 201, description: 'Logged out successfully', type: LogoutResponseDto })
  logout(@Body() dto: LogoutDto): Promise<Record<string, unknown>> {
    return this.authService.logout(dto);
  }
}
