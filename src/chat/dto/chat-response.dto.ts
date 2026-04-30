import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuccessEnvelopeDto } from '../../common/dto/api-response-envelope.dto';
import {
  RelatedConversationDto,
  RelatedMessageDto,
  RelatedProductDto,
  RelatedUserDto,
} from '../../common/dto/related-entities.dto';

export class ConversationDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  user_a!: RelatedUserDto | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  user_b!: RelatedUserDto | null;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z' })
  created_at!: string;

  @ApiPropertyOptional({ type: RelatedProductDto, nullable: true })
  product?: RelatedProductDto | null;
}

export class ConversationDataDto {
  @ApiProperty({ type: ConversationDto })
  conversation!: ConversationDto;
}

export class ConversationResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => ConversationDataDto })
  data!: ConversationDataDto;
}

export class ConversationWithLastMessageDto extends ConversationDto {
  @ApiPropertyOptional({ type: RelatedMessageDto, nullable: true })
  last_message!: RelatedMessageDto | null;

  @ApiPropertyOptional({ example: 'Hello, is this still available?', nullable: true })
  last_message_text!: string | null;

  @ApiPropertyOptional({ example: '2026-03-28T13:00:00.000Z', nullable: true })
  last_message_sent_at!: string | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  peer_user!: RelatedUserDto | null;

  @ApiProperty({ example: 2 })
  unread_count!: number;

  @ApiPropertyOptional({ example: 'iPhone 13', nullable: true })
  product_name?: string | null;

  @ApiPropertyOptional({ example: 600, nullable: true })
  product_price?: number | null;

  @ApiPropertyOptional({ example: 'products/1/image.jpg', nullable: true })
  product_image_object_key?: string | null;
}

export class ConversationsListDataDto {
  @ApiProperty({ type: [ConversationWithLastMessageDto] })
  conversations!: ConversationWithLastMessageDto[];
}

export class ConversationsListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => ConversationsListDataDto })
  data!: ConversationsListDataDto;
}

export class MessageDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ type: RelatedConversationDto, nullable: true })
  conversation!: RelatedConversationDto | null;

  @ApiProperty({ type: RelatedUserDto, nullable: true })
  sender!: RelatedUserDto | null;

  @ApiProperty({ example: 'Hello, is this still available?' })
  message_text!: string;

  @ApiProperty({ example: '2026-03-28T13:00:00.000Z' })
  sent_at!: string;

  @ApiPropertyOptional({ example: '2026-03-28T13:01:00.000Z', nullable: true })
  read_at!: string | null;
}

export class MessagesListDataDto {
  @ApiProperty({ type: [MessageDto] })
  messages!: MessageDto[];
}

export class MessagesListResponseDto extends SuccessEnvelopeDto {
  @ApiProperty({ type: () => MessagesListDataDto })
  data!: MessagesListDataDto;
}
