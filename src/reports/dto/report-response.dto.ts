import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RelatedUserDto } from '../../common/dto/related-entities.dto';

export class ReportDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  reporter!: RelatedUserDto | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  reported_user!: RelatedUserDto | null;

  @ApiProperty({ example: 'Selling fake products' })
  reason!: string;

  @ApiProperty({ example: 'open', enum: ['open', 'reviewing', 'resolved', 'rejected'] })
  status!: string;

  @ApiPropertyOptional({ type: RelatedUserDto, nullable: true, description: 'Admin user who reviewed this report' })
  reviewed_by!: RelatedUserDto | null;

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
