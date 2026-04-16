import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/image/upload/avatar.jpg', nullable: true })
  avatar_url!: string | null;
}

export class UserProfileResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: UserDto })
  user!: UserDto;
}

export class ContactDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'phone', enum: ['phone', 'email', 'address'] })
  contact_type!: string;

  @ApiProperty({ example: '+201012345678' })
  value!: string;

  @ApiProperty({ example: false })
  is_primary!: boolean;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  updated_at!: string;
}

export class ContactResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ContactDto })
  contact!: ContactDto;
}

export class ContactsListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [ContactDto] })
  contacts!: ContactDto[];
}

export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Operation completed successfully' })
  message!: string;
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

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/image/upload/avatar.jpg', nullable: true })
  avatar_url!: string | null;

  @ApiPropertyOptional({ example: false, nullable: true })
  blocked_by_me?: boolean | null;

  @ApiPropertyOptional({ example: false, nullable: true })
  blocked_me?: boolean | null;
}

export class PublicUserProfileResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;

  @ApiProperty({ type: [ProductDto] })
  products!: ProductDto[];
}
