import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — always returns 200' })
  @ApiResponse({ status: 200, description: 'Service is alive', type: HealthResponseDto })
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB connectivity' })
  @ApiResponse({ status: 200, description: 'Service is ready', type: HealthResponseDto })
  @ApiResponse({ status: 503, description: 'Database unavailable', type: ErrorResponseDto })
  async ready(): Promise<{ status: string }> {
    await this.databaseService.query('SELECT 1');
    return { status: 'ok' };
  }
}
