import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user.type';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import {
  ConversationResponseDto,
  ConversationsListResponseDto,
  MessagesListResponseDto,
} from './dto/chat-response.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Get or create a conversation with another user' })
  @ApiResponse({ status: 201, description: 'Conversation created or existing one returned', type: ConversationResponseDto })
  createConversation(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getOrCreateConversation(user.sub, dto.participantId, dto.productId);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations for the current user' })
  @ApiResponse({ status: 200, description: 'Array of conversations with last message preview', type: ConversationsListResponseDto })
  listConversations(
    @CurrentUser() user: AuthUser,
    @Query() query: ListConversationsDto,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listConversations(user.sub, query.scope ?? 'all');
  }

  @Get('conversations/:id')
  @ApiParam({ name: 'id', type: Number, description: 'Conversation ID' })
  @ApiOperation({ summary: 'Get a single conversation with metadata for the current user' })
  @ApiResponse({ status: 200, description: 'Conversation metadata', type: ConversationResponseDto })
  @ApiResponse({ status: 403, description: 'Not a participant of this conversation', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found', type: ErrorResponseDto })
  getConversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) conversationId: number,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getConversationById(user.sub, conversationId);
  }

  @Get('conversations/:id/messages')
  @ApiParam({ name: 'id', type: Number, description: 'Conversation ID' })
  @ApiOperation({ summary: 'List messages in a conversation (cursor-paginated)' })
  @ApiResponse({ status: 200, description: 'Array of messages in descending sent_at order', type: MessagesListResponseDto })
  @ApiResponse({ status: 403, description: 'Not a participant of this conversation', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found', type: ErrorResponseDto })
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) conversationId: number,
    @Query() dto: ListMessagesDto,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listMessages(user.sub, conversationId, dto.limit ?? 20, dto.before);
  }
}
