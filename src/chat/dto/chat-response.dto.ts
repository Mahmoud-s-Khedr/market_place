import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 3 })
  user_a_id!: number;

  @ApiProperty({ example: 7 })
  user_b_id!: number;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiPropertyOptional({ example: 22, nullable: true })
  product_id?: number | null;
}

export class ConversationResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ConversationDto })
  conversation!: ConversationDto;
}

export class ConversationWithLastMessageDto extends ConversationDto {
  @ApiPropertyOptional({ example: 15, nullable: true })
  last_message_id!: number | null;

  @ApiPropertyOptional({ example: 'Hello, is this still available?', nullable: true })
  last_message_text!: string | null;

  @ApiPropertyOptional({ example: '2026-03-28T13:00:00.000Z', nullable: true })
  last_message_sent_at!: string | null;

  @ApiProperty({ example: 12 })
  peer_user_id!: number;

  @ApiProperty({ example: 'Jana Ahmed' })
  peer_name!: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/image/upload/avatar.jpg', nullable: true })
  peer_avatar_url!: string | null;

  @ApiProperty({ example: 2 })
  unread_count!: number;

  @ApiPropertyOptional({ example: 'iPhone 13', nullable: true })
  product_name?: string | null;

  @ApiPropertyOptional({ example: 600, nullable: true })
  product_price?: number | null;

  @ApiPropertyOptional({ example: 'products/1/image.jpg', nullable: true })
  product_image_object_key?: string | null;
}

export class ConversationsListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [ConversationWithLastMessageDto] })
  conversations!: ConversationWithLastMessageDto[];
}

export class MessageDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  conversation_id!: number;

  @ApiProperty({ example: 3 })
  sender_id!: number;

  @ApiProperty({ example: 'Hello, is this still available?' })
  message_text!: string;

  @ApiProperty({ example: '2026-03-28T13:00:00.000Z' })
  sent_at!: string;

  @ApiPropertyOptional({ example: '2026-03-28T13:01:00.000Z', nullable: true })
  read_at!: string | null;
}

export class MessagesListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [MessageDto] })
  messages!: MessageDto[];
}
