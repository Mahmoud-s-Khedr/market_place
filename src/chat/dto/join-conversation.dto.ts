import { IsInt, Min } from 'class-validator';

export class JoinConversationDto {
  @IsInt()
  @Min(1)
  conversationId!: number;
}
