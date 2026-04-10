import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateReportStatusDto {
  @ApiProperty({ enum: ['open', 'reviewing', 'resolved', 'rejected'], description: 'New status for the abuse report', example: 'resolved' })
  @IsEnum(['open', 'reviewing', 'resolved', 'rejected'])
  status!: 'open' | 'reviewing' | 'resolved' | 'rejected';
}
