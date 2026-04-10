import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ListMessagesDto {
  @ApiPropertyOptional({ description: 'Number of messages to return (1–100, default 20)', example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor — return messages sent before this ISO 8601 timestamp', example: '2024-06-01T12:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  before?: string;
}
