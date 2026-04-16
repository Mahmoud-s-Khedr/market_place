import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RelatedUserDto } from '../../common/dto/related-entities.dto';

export class AdminUserDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Ahmed Mohamed' })
  name!: string;

  @ApiProperty({ example: '+201012345678' })
  phone!: string;

  @ApiProperty({ example: 'active', enum: ['active', 'paused', 'banned'] })
  status!: string;

  @ApiProperty({ example: true })
  is_admin!: boolean;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class AdminUserResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AdminUserDto })
  user!: AdminUserDto;
}

export class AdminUsersListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [AdminUserDto] })
  users!: AdminUserDto[];
}

export class AdminAdminsListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [AdminUserDto] })
  admins!: AdminUserDto[];
}

export class WarningDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedUserDto, nullable: true, description: 'Admin user who issued the warning' })
  admin!: RelatedUserDto | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  target_user!: RelatedUserDto | null;

  @ApiProperty({ example: 'Repeated policy violations' })
  message!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;
}

export class WarningResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: WarningDto })
  warning!: WarningDto;
}

export class AdminReportDto {
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

  @ApiPropertyOptional({ type: RelatedUserDto, nullable: true })
  reviewed_by!: RelatedUserDto | null;

  @ApiPropertyOptional({ example: '2026-03-29T09:00:00.000Z', nullable: true })
  reviewed_at!: string | null;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class AdminReportResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AdminReportDto })
  report!: AdminReportDto;
}

export class AdminReportsListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [AdminReportDto] })
  reports!: AdminReportDto[];
}
