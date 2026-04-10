import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { RatingResponseDto, RatingSummaryResponseDto } from './dto/rating-response.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Ratings')
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rate a user (1–5 stars)' })
  @ApiResponse({ status: 201, description: 'Rating submitted or updated', type: RatingResponseDto })
  @ApiResponse({ status: 400, description: 'Cannot rate yourself', type: ErrorResponseDto })
  rateUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRatingDto,
  ): Promise<Record<string, unknown>> {
    return this.ratingsService.rateUser(user, dto);
  }

  @Get(':userId')
  @ApiParam({ name: 'userId', type: Number, description: 'Target user ID' })
  @ApiOperation({ summary: 'Get rating summary for a user' })
  @ApiResponse({ status: 200, description: 'Average rating and review count', type: RatingSummaryResponseDto })
  @ApiResponse({ status: 404, description: 'User not found', type: ErrorResponseDto })
  getUserRatingSummary(@Param('userId', ParseIntPipe) userId: number): Promise<Record<string, unknown>> {
    return this.ratingsService.getUserRatingSummary(userId);
  }
}
