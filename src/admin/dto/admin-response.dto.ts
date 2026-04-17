import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';
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

export class AdminUserDataDto {
  @ApiProperty({ type: AdminUserDto })
  user!: AdminUserDto;
}

export class AdminUserResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminUserDataDto })
  data!: AdminUserDataDto;
}

export class AdminUsersListDataDto {
  @ApiProperty({ type: [AdminUserDto] })
  users!: AdminUserDto[];
}

export class AdminUsersListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminUsersListDataDto })
  data!: AdminUsersListDataDto;
}

export class AdminAdminsListDataDto {
  @ApiProperty({ type: [AdminUserDto] })
  admins!: AdminUserDto[];
}

export class AdminAdminsListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminAdminsListDataDto })
  data!: AdminAdminsListDataDto;
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

export class WarningDataDto {
  @ApiProperty({ type: WarningDto })
  warning!: WarningDto;
}

export class WarningResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => WarningDataDto })
  data!: WarningDataDto;
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

export class AdminReportDataDto {
  @ApiProperty({ type: AdminReportDto })
  report!: AdminReportDto;
}

export class AdminReportResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminReportDataDto })
  data!: AdminReportDataDto;
}

export class AdminReportsListDataDto {
  @ApiProperty({ type: [AdminReportDto] })
  reports!: AdminReportDto[];
}

export class AdminReportsListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminReportsListDataDto })
  data!: AdminReportsListDataDto;
}
