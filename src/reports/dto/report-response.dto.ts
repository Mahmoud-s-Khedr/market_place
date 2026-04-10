import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 3 })
  reporter_id!: number;

  @ApiProperty({ example: 7 })
  reported_user_id!: number;

  @ApiProperty({ example: 'Selling fake products' })
  reason!: string;

  @ApiProperty({ example: 'open', enum: ['open', 'reviewing', 'resolved', 'rejected'] })
  status!: string;

  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Admin user ID who reviewed this report' })
  reviewed_by!: number | null;

  @ApiPropertyOptional({ example: '2026-03-29T09:00:00.000Z', nullable: true })
  reviewed_at!: string | null;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class ReportResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ReportDto })
  report!: ReportDto;
}

export class ReportsListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [ReportDto] })
  reports!: ReportDto[];
}
