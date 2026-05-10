import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ListMyReportsDto } from './dto/list-my-reports.dto';
import { ReportResponseDto, ReportsListResponseDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit an abuse report against another user' })
  @ApiResponse({ status: 201, description: 'Report created', type: ReportResponseDto })
  @ApiResponse({ status: 409, description: 'Report already filed against this user', type: ErrorResponseDto })
  createReport(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportDto,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.createReport(user, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'List reports filed by the current user' })
  @ApiResponse({ status: 200, description: 'Array of report records', type: ReportsListResponseDto })
  getMyReports(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMyReportsDto,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.getMyReports(user, query.limit ?? 20, query.offset ?? 0);
  }
}
