import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';
import { RelatedFileDto } from '../../common/dto/related-entities.dto';
import { ProductDto } from '../../products/dto/product-response.dto';

export class UserDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Ahmed Mohamed' })
  name!: string;

  @ApiProperty({ example: '+201012345678' })
  phone!: string;

  @ApiProperty({ example: 'active', enum: ['active', 'paused', 'banned'] })
  status!: string;

  @ApiProperty({ example: '4.50', description: 'Average seller rating (2 decimal places)' })
  rate!: string;

  @ApiPropertyOptional({ type: RelatedFileDto, nullable: true })
  avatar!: RelatedFileDto | null;

  @ApiPropertyOptional({ example: '+201000000001', nullable: true, readOnly: true })
  contactInfo!: string | null;
}

export class UserProfileDataDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;
}

export class UserProfileResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => UserProfileDataDto })
  data!: UserProfileDataDto;
}

export class SuccessDataDto {
  @ApiProperty({ example: 'Operation completed successfully' })
  message!: string;
}

export class SuccessResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => SuccessDataDto })
  data!: SuccessDataDto;
}

export class PublicUserDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({ example: 'Jana Ahmed' })
  name!: string;

  @ApiProperty({ example: '2025-02-22T10:00:00.000Z' })
  member_since!: string;

  @ApiProperty({ example: 10 })
  ads_count!: number;

  @ApiProperty({ example: '4.50' })
  rate!: string;

  @ApiPropertyOptional({ type: RelatedFileDto, nullable: true })
  avatar!: RelatedFileDto | null;

  @ApiPropertyOptional({ example: '+201000000001', nullable: true, readOnly: true })
  contactInfo!: string | null;

  @ApiPropertyOptional({ example: false, nullable: true })
  blocked_by_me?: boolean | null;

  @ApiPropertyOptional({ example: false, nullable: true })
  blocked_me?: boolean | null;
}

export class PublicUserProfileDataDto {
  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;

  @ApiProperty({ type: [ProductDto] })
  products!: ProductDto[];
}

export class PublicUserProfileResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => PublicUserProfileDataDto })
  data!: PublicUserProfileDataDto;
}
