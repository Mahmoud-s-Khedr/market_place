import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';
import { RelatedFileDto, RelatedUserDto } from '../../common/dto/related-entities.dto';

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

  @ApiProperty({ example: 12 })
  published_products_count!: number;

  @ApiProperty({ example: 3 })
  reports_count!: number;

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
  @ApiProperty({ type: () => [AdminV1ReportDto] })
  reports!: AdminV1ReportDto[];
}

export class AdminReportsListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminReportsListDataDto })
  data!: AdminReportsListDataDto;
}

export class AdminUserDetailsDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiPropertyOptional({ example: '29876543210987', nullable: true })
  ssn!: string | null;

  @ApiProperty({ example: 'Jana Ahmed' })
  name!: string;

  @ApiProperty({ example: '+201000000012' })
  phone!: string;

  @ApiProperty({ example: 'active', enum: ['active', 'paused', 'banned'] })
  status!: string;

  @ApiProperty({ example: 'active', enum: ['active', 'paused', 'banned'] })
  profileState!: string;

  @ApiPropertyOptional({ type: RelatedFileDto, nullable: true })
  avatar!: RelatedFileDto | null;

  @ApiPropertyOptional({ example: '+201000000012', nullable: true })
  contactInfo!: string | null;

  @ApiProperty({ example: true })
  is_admin!: boolean;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class AdminUserDetailsDataDto {
  @ApiProperty({ type: AdminUserDetailsDto })
  user!: AdminUserDetailsDto;
}

export class AdminUserDetailsResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminUserDetailsDataDto })
  data!: AdminUserDetailsDataDto;
}

export class AdminUserListingDto {
  @ApiProperty({ example: 91 })
  id!: number;

  @ApiProperty({ example: 'iPhone 13' })
  name!: string;

  @ApiProperty({ example: '600.00' })
  price!: string;

  @ApiProperty({ example: 'available', enum: ['available', 'sold'] })
  status!: string;

  @ApiProperty({ example: 'Cairo' })
  city!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiPropertyOptional({ type: RelatedFileDto, nullable: true })
  product_image!: RelatedFileDto | null;
}

export class AdminUserListingsDataDto {
  @ApiProperty({ type: [AdminUserListingDto] })
  items!: AdminUserListingDto[];
}

export class AdminUserListingsResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminUserListingsDataDto })
  data!: AdminUserListingsDataDto;
}

export class AdminV1ReportDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Selling fake products' })
  description!: string;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  reporter!: RelatedUserDto | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  reported_user!: RelatedUserDto | null;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;
}

export class AdminUserReportsDataDto {
  @ApiProperty({ type: [AdminV1ReportDto] })
  reports!: AdminV1ReportDto[];
}

export class AdminUserReportsResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => AdminUserReportsDataDto })
  data!: AdminUserReportsDataDto;
}
