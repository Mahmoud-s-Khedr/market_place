import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RelatedFileDto {
  @ApiProperty({ example: 10 })
  id!: number;

  @ApiProperty({ example: 'product_image', enum: ['avatar', 'product_image', 'chat_attachment', 'document'] })
  purpose!: string;

  @ApiProperty({ example: 'products/91/1.jpg' })
  object_key!: string;

  @ApiPropertyOptional({ example: 'image/jpeg', nullable: true })
  mime_type!: string | null;

  @ApiProperty({ example: 'uploaded', enum: ['pending', 'uploaded', 'failed', 'deleted'] })
  status!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiPropertyOptional({ example: '2026-03-28T12:10:00.000Z', nullable: true })
  uploaded_at!: string | null;

  @ApiProperty({ example: 'https://res.cloudinary.com/example/image/upload/products/91/1.jpg' })
  url!: string;
}

export class RelatedUserDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({ example: 'Jana Ahmed' })
  name!: string;

  @ApiPropertyOptional({ type: RelatedFileDto, nullable: true })
  avatar!: RelatedFileDto | null;

  @ApiPropertyOptional({ example: '+201000000012', nullable: true, readOnly: true })
  contactInfo!: string | null;
}

export class RelatedCategoryDto {
  @ApiProperty({ example: 3 })
  id!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  parent_id!: number | null;

  @ApiProperty({ example: 'Mobiles' })
  name!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;
}

export class RelatedProductDto {
  @ApiProperty({ example: 91 })
  id!: number;

  @ApiPropertyOptional({ type: RelatedUserDto, nullable: true })
  owner!: RelatedUserDto | null;

  @ApiProperty({ example: 'iPhone 13' })
  name!: string;

  @ApiProperty({ example: '600.00' })
  price!: string;

  @ApiProperty({ example: 'available', enum: ['available', 'sold', 'archived'] })
  status!: string;

  @ApiProperty({ example: 'Cairo' })
  city!: string;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;
}

export class RelatedMessageDto {
  @ApiProperty({ example: 15 })
  id!: number;

  @ApiProperty({ example: 'Hello, is this still available?' })
  message_text!: string;

  @ApiProperty({ example: '2026-03-28T13:00:00.000Z' })
  sent_at!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  read_at!: string | null;
}

export class RelatedConversationDto {
  @ApiProperty({ example: 4 })
  id!: number;

  @ApiProperty({ example: '2026-03-28T13:00:00.000Z' })
  created_at!: string;
}
